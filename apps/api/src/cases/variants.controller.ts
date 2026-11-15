import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiService } from '../ai/ai.service';
import { AuthUser, CurrentUser, Roles } from '../auth/roles';
import { ZodPipe } from '../common/zod.pipe';
import { detectPhi } from '../deid/phi';
import { PipelineService } from '../pipeline/pipeline.service';

const GERMLINE = ['Pathogenic', 'Likely pathogenic', 'Uncertain significance', 'Likely benign', 'Benign'] as const;
const SOMATIC = ['Tier I (Level A)', 'Tier I (Level B)', 'Tier II (Level C)', 'Tier II (Level D)', 'Tier III', 'Tier IV'] as const;

const VariantPatch = z
  .object({
    reportable: z.boolean().optional(),
    analystNote: z.string().max(2000).optional(),
    override: z
      .object({ germline: z.enum(GERMLINE).optional(), somatic: z.enum(SOMATIC).optional(), reason: z.string().min(5).max(1000) })
      .nullable()
      .optional(),
  })
  .strict();

const EvidenceBody = z.object({
  source: z.enum(['CLINVAR', 'CIVIC', 'CPIC', 'GNOMAD', 'PUBMED', 'MANUAL']).default('MANUAL'),
  sourceId: z.string().max(100).optional(),
  url: z.string().url().max(500).optional().or(z.literal('')),
  category: z.enum(['PATHOGENICITY', 'ONCOGENICITY', 'THERAPEUTIC', 'PROGNOSTIC', 'DIAGNOSTIC', 'PGX', 'POPULATION', 'LITERATURE', 'FUNCTIONAL', 'OTHER']),
  level: z.string().max(40).optional(),
  significance: z.string().max(120).optional(),
  direction: z.string().max(40).optional(),
  disease: z.string().max(200).optional(),
  therapies: z.array(z.string().max(80)).max(20).default([]),
  summary: z.string().min(3).max(4000),
  citation: z.string().max(300).optional(),
  includeInReport: z.boolean().default(true),
});
const EvidencePatch = EvidenceBody.partial().strict();

const LOCKED = ['IN_REVIEW', 'SIGNED'];

@Controller()
export class VariantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
    private readonly pipeline: PipelineService,
  ) {}

  private async assertCaseEditable(caseId: string) {
    const r = await this.prisma.report.findFirst({ where: { caseId }, orderBy: { version: 'desc' } });
    if (r && LOCKED.includes(r.status)) throw new ConflictException(`Report v${r.version} is ${r.status}; changes are locked. Return it or create an amendment.`);
  }

  @Get('cases/:id/variants')
  variants(@Param('id') caseId: string, @Query('reportableOnly') reportableOnly?: string) {
    return this.prisma.variant.findMany({
      where: { caseId, ...(reportableOnly === '1' ? { reportable: true } : {}) },
      include: { evidence: { orderBy: [{ status: 'asc' }, { source: 'asc' }, { level: 'asc' }] } },
      orderBy: [{ reportable: 'desc' }, { gene: 'asc' }, { pos: 'asc' }],
    });
  }

  @Get('cases/:id/pgx')
  pgx(@Param('id') caseId: string) {
    return this.prisma.pgxResult.findMany({ where: { caseId }, orderBy: { gene: 'asc' } });
  }

  @Roles('ANALYST')
  @Patch('pgx/:id')
  async patchPgx(@Param('id') id: string, @Body(new ZodPipe(z.object({ includeInReport: z.boolean() }))) body: { includeInReport: boolean }, @CurrentUser() user: AuthUser) {
    const p = await this.prisma.pgxResult.findUniqueOrThrow({ where: { id } });
    await this.assertCaseEditable(p.caseId);
    const updated = await this.prisma.pgxResult.update({ where: { id }, data: body });
    await this.audit.record({ actor: user, action: 'pgx.updated', entityType: 'PgxResult', entityId: id, caseId: p.caseId, before: { includeInReport: p.includeInReport }, after: body });
    return updated;
  }

  @Roles('ANALYST')
  @Patch('variants/:id')
  async patchVariant(@Param('id') id: string, @Body(new ZodPipe(VariantPatch)) body: z.infer<typeof VariantPatch>, @CurrentUser() user: AuthUser) {
    const v = await this.prisma.variant.findUnique({ where: { id } });
    if (!v) throw new NotFoundException();
    await this.assertCaseEditable(v.caseId);
    if (body.analystNote && detectPhi(body.analystNote).length) throw new BadRequestException('Note appears to contain identifiers.');
    const data: Prisma.VariantUpdateInput = {};
    if (body.reportable !== undefined) data.reportable = body.reportable;
    if (body.analystNote !== undefined) data.analystNote = body.analystNote;
    if (body.override !== undefined) data.override = body.override ? { ...body.override, by: user.id, at: new Date().toISOString() } : Prisma.JsonNull;
    const updated = await this.prisma.variant.update({ where: { id }, data });
    await this.audit.record({
      actor: user,
      action: body.override !== undefined ? 'variant.classification_overridden' : 'variant.updated',
      entityType: 'Variant',
      entityId: id,
      caseId: v.caseId,
      before: { reportable: v.reportable, override: v.override, analystNote: v.analystNote },
      after: { reportable: updated.reportable, override: updated.override, analystNote: updated.analystNote },
      reason: body.override?.reason,
    });
    return updated;
  }

  @Roles('ANALYST')
  @Post('variants/:id/evidence')
  async addEvidence(@Param('id') variantId: string, @Body(new ZodPipe(EvidenceBody)) body: z.infer<typeof EvidenceBody>, @CurrentUser() user: AuthUser) {
    const v = await this.prisma.variant.findUnique({ where: { id: variantId } });
    if (!v) throw new NotFoundException();
    await this.assertCaseEditable(v.caseId);
    if (detectPhi(body.summary).some((f) => !['zip5', 'pin6'].includes(f.type))) throw new BadRequestException('Summary appears to contain identifiers.');
    const e = await this.prisma.evidence.create({
      data: { ...body, url: body.url || null, caseId: v.caseId, variantId, origin: 'MANUAL', createdById: user.id, updatedById: user.id, retrievedAt: new Date() },
    });
    await this.audit.record({ actor: user, action: 'evidence.added', entityType: 'Evidence', entityId: e.id, caseId: v.caseId, after: e });
    return e;
  }

  @Roles('ANALYST')
  @Patch('evidence/:id')
  async updateEvidence(@Param('id') id: string, @Body(new ZodPipe(EvidencePatch)) body: z.infer<typeof EvidencePatch>, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.evidence.findUnique({ where: { id } });
    if (!before || before.status === 'DELETED') throw new NotFoundException();
    await this.assertCaseEditable(before.caseId);
    const after = await this.prisma.evidence.update({ where: { id }, data: { ...body, url: body.url === '' ? null : body.url, updatedById: user.id } });
    await this.audit.record({ actor: user, action: 'evidence.updated', entityType: 'Evidence', entityId: id, caseId: before.caseId, before, after });
    return after;
  }

  /** Soft delete with a mandatory reason — the row stays for the audit trail. */
  @Roles('ANALYST')
  @Delete('evidence/:id')
  async deleteEvidence(@Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().min(3).max(500) }))) body: { reason: string }, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.evidence.findUnique({ where: { id } });
    if (!before || before.status === 'DELETED') throw new NotFoundException();
    await this.assertCaseEditable(before.caseId);
    await this.prisma.evidence.update({ where: { id }, data: { status: 'DELETED', deleteReason: body.reason, updatedById: user.id, includeInReport: false } });
    await this.audit.record({ actor: user, action: 'evidence.deleted', entityType: 'Evidence', entityId: id, caseId: before.caseId, before, reason: body.reason });
    return { ok: true };
  }

  @Roles('ANALYST')
  @Post('evidence/:id/restore')
  async restoreEvidence(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.evidence.findUniqueOrThrow({ where: { id } });
    await this.assertCaseEditable(before.caseId);
    await this.prisma.evidence.update({ where: { id }, data: { status: 'ACTIVE', deleteReason: null, updatedById: user.id } });
    await this.audit.record({ actor: user, action: 'evidence.restored', entityType: 'Evidence', entityId: id, caseId: before.caseId });
    return { ok: true };
  }

  /** Accept / reject the AI relevance suggestion on an evidence item. */
  @Roles('ANALYST')
  @Post('evidence/:id/ai-decision')
  async evidenceAiDecision(@Param('id') id: string, @Body(new ZodPipe(z.object({ decision: z.enum(['ACCEPTED', 'REJECTED']) }))) body: { decision: 'ACCEPTED' | 'REJECTED' }, @CurrentUser() user: AuthUser) {
    const e = await this.prisma.evidence.findUniqueOrThrow({ where: { id } });
    const ai = e.ai as any;
    if (!ai) throw new BadRequestException('No AI suggestion on this evidence');
    const data: Prisma.EvidenceUpdateInput = { ai: { ...ai, decision: body.decision, decidedById: user.id, decidedAt: new Date().toISOString() } };
    // Accepting a LOW relevance suggestion removes the item from the report; rejecting keeps current state.
    if (body.decision === 'ACCEPTED' && ai.relevance === 'LOW') data.includeInReport = false;
    await this.prisma.evidence.update({ where: { id }, data });
    await this.audit.record({ actor: user, action: `ai.evidence_relevance_${body.decision.toLowerCase()}`, entityType: 'Evidence', entityId: id, caseId: e.caseId, after: { relevance: ai.relevance, aiRunId: ai.aiRunId } });
    return { ok: true };
  }

  /** Re-run AI evidence triage for one variant (after evidence was edited). */
  @Roles('ANALYST')
  @Post('variants/:id/ai-triage')
  async retriage(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const v = await this.prisma.variant.findUniqueOrThrow({ where: { id }, include: { evidence: { where: { status: 'ACTIVE' } }, case: true } });
    await this.pipeline.triage(v.caseId, v, v.evidence, (v.case.diagnosis as any)?.label ?? 'Unknown', v.case.sampleType);
    await this.audit.record({ actor: user, action: 'ai.evidence_triage_rerun', entityType: 'Variant', entityId: id, caseId: v.caseId });
    return { ok: true };
  }
}
