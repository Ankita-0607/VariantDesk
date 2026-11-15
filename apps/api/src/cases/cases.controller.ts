import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { GeoService } from '../geo/geo.service';
import { AiService } from '../ai/ai.service';
import { AuthUser, CurrentUser, Public, Roles } from '../auth/roles';
import { CaseIntakeSchema } from '../deid/patient.schema';
import { scanObject } from '../deid/phi';
import { guessBuild, parseVcf } from '../vcf/vcf.parser';
import { sha256 } from '../common/hash';
import { config } from '../common/config';
import { TUMOR_TYPES } from '../interpret/tumor-types';

const MAX_VCF_BYTES = 50 * 1024 * 1024;

@Controller()
export class CasesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pipeline: PipelineService,
    private readonly geo: GeoService,
    private readonly ai: AiService,
  ) {}

  @Public()
  @Get('meta')
  meta() {
    return { name: 'VariantDesk', version: '0.1.0', ai: this.ai.info, tumorTypes: TUMOR_TYPES.map(({ code, label }) => ({ code, label })) };
  }

  @Get('geo/cities')
  cities(@Query('country') country: 'US' | 'IN', @Query('q') q = '') {
    if (country !== 'US' && country !== 'IN') throw new BadRequestException('country must be US or IN');
    return this.geo.searchCities(country, q, 10).map(({ label, lat, lon }) => ({ label, lat, lon }));
  }

  /** Multipart: field "vcf" (file) + field "data" (JSON matching CaseIntakeSchema). */
  @Roles('ANALYST')
  @Post('cases')
  @UseInterceptors(FileInterceptor('vcf', { limits: { fileSize: MAX_VCF_BYTES } }))
  async create(@UploadedFile() file: Express.Multer.File | undefined, @Body('data') data: string, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException('VCF file is required (field "vcf")');
    let raw: unknown;
    try {
      raw = JSON.parse(data ?? '');
    } catch {
      throw new BadRequestException('Field "data" must be JSON');
    }
    const parsed = CaseIntakeSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: 'Validation failed', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const intake = parsed.data;

    // De-identification gate: reject free text that looks like an identifier.
    const { ageYears, sex, ecog, ancestry, ...freeText } = intake.patient;
    const phi = scanObject({ ...freeText, assay: intake.assay, caseCode: intake.caseCode }).filter((f) => !(f.path === '$.caseCode' && /^(zip5|pin6)$/.test(f.type)));
    if (phi.length) {
      throw new BadRequestException({
        message: 'Possible identifiers detected. VariantDesk only accepts de-identified data — please remove them.',
        issues: phi.map((p) => ({ path: p.path.replace('$.', 'patient.'), message: `Looks like ${p.type.replace('_', ' ')}` })),
      });
    }
    if (await this.prisma.case.findUnique({ where: { caseCode: intake.caseCode } })) throw new ConflictException('Case code already exists');

    let location = null;
    if (intake.location) {
      location = this.geo.resolve(intake.location);
      if (!location) throw new BadRequestException({ message: 'Location not recognised', issues: [{ path: 'location.value', message: intake.location.kind === 'zip3' ? 'Unknown or restricted ZIP3 prefix (HIPAA Safe Harbor restricts small-population prefixes)' : 'Not found' }] });
    }

    const text = file.buffer.toString('utf8');
    let vcf;
    try {
      vcf = parseVcf(text);
    } catch (e) {
      throw new BadRequestException(`VCF error: ${e instanceof Error ? e.message : e}`);
    }
    const warnings = [...vcf.stats.warnings];
    const hinted = guessBuild(vcf.stats.declaredReference);
    if (hinted && hinted !== intake.genomeBuild) warnings.push(`VCF header suggests ${hinted} but ${intake.genomeBuild} was selected.`);
    if (vcf.variants.length > config.kb.maxVariants) {
      throw new BadRequestException(`VCF has ${vcf.variants.length} PASS variants; the limit is ${config.kb.maxVariants}. Filter to a panel/region first (WGS/WES support via local VEP is on the roadmap).`);
    }
    if (!vcf.variants.length) throw new BadRequestException('VCF contains no PASS variants');

    const patient = { ...intake.patient, ageYears: intake.patient.ageYears != null ? Math.min(intake.patient.ageYears, 90) : undefined };
    const kase = await this.prisma.case.create({
      data: {
        caseCode: intake.caseCode,
        sampleType: intake.sampleType,
        genomeBuild: intake.genomeBuild,
        assay: intake.assay,
        patient: patient as Prisma.InputJsonValue,
        location: location ? (location as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        vcfFileName: file.originalname.replace(/[^\w.-]/g, '_').slice(0, 100),
        vcfSha256: sha256(file.buffer),
        vcfStats: { ...vcf.stats, warnings } as Prisma.InputJsonValue,
        createdById: user.id,
        variants: { createMany: { data: vcf.variants.map((v) => ({ chrom: v.chrom, pos: v.pos, ref: v.ref, alt: v.alt, rsId: v.rsId, filter: v.filter, genotype: v.genotype, zygosity: v.zygosity, vaf: v.vaf, depth: v.depth })) } },
      },
    });
    await this.audit.record({ actor: user, action: 'case.created', entityType: 'Case', entityId: kase.id, caseId: kase.id, after: { caseCode: kase.caseCode, variants: vcf.variants.length, vcfSha256: kase.vcfSha256, sampleType: kase.sampleType } });
    this.pipeline.enqueue(kase.id);
    return { id: kase.id, warnings };
  }

  @Get('cases')
  async list() {
    const cases = await this.prisma.case.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true, caseCode: true, status: true, sampleType: true, createdAt: true, diagnosis: true, patient: true,
        _count: { select: { variants: true } },
        reports: { orderBy: { version: 'desc' }, take: 1, select: { status: true, version: true } },
      },
    });
    return cases.map(({ patient, reports, _count, ...c }) => ({ ...c, diagnosisText: (patient as any)?.diagnosis, variantCount: _count.variants, report: reports[0] ?? null }));
  }

  @Get('cases/:id')
  async get(@Param('id') id: string) {
    const c = await this.prisma.case.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    const [variantCount, reportableCount, trialCount] = await Promise.all([
      this.prisma.variant.count({ where: { caseId: id } }),
      this.prisma.variant.count({ where: { caseId: id, reportable: true } }),
      this.prisma.trialMatch.count({ where: { caseId: id, hidden: false } }),
    ]);
    return { ...c, counts: { variants: variantCount, reportable: reportableCount, trials: trialCount } };
  }

  @Roles('ANALYST')
  @Post('cases/:id/rerun')
  async rerun(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const locked = await this.prisma.report.findFirst({ where: { caseId: id, status: { in: ['IN_REVIEW', 'SIGNED'] } } });
    if (locked) throw new ConflictException('A report for this case is in review or signed; create an amendment instead of re-running.');
    await this.prisma.report.deleteMany({ where: { caseId: id, status: { in: ['DRAFT', 'RETURNED'] } } });
    await this.prisma.case.update({ where: { id }, data: { status: 'QUEUED' } });
    await this.audit.record({ actor: user, action: 'case.rerun', entityType: 'Case', entityId: id, caseId: id });
    this.pipeline.enqueue(id);
    return { ok: true };
  }
}
