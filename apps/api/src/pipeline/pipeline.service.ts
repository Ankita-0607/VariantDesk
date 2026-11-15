import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, Variant, Evidence } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiService } from '../ai/ai.service';
import { diagnosisTask, narrativeTask, summaryTask, triageTask, TriageEvidence } from '../ai/tasks';
import { VepClient } from '../kb/vep.client';
import { ClinVarClient } from '../kb/clinvar.client';
import { CivicClient } from '../kb/civic.client';
import { PubMedClient } from '../kb/pubmed.client';
import { CpicClient, callDiplotypes, NOT_ASSESSED_GENES } from '../kb/pgx';
import { Annotation, EvidenceDraft, VariantKey } from '../kb/types';
import { classifyGermline, classifySomatic, defaultReportable, GermlineCall, SomaticCall, popStats } from '../interpret/rules';
import { normalizeDiagnosisByRules, tumorByCode } from '../interpret/tumor-types';
import { TrialsService } from '../trials/trials.service';
import { GeoService } from '../geo/geo.service';
import { PatientProfile } from '../deid/patient.schema';
import { AiText, DEFAULT_LIMITATIONS, methodologyText, ReportContent } from './report-content';
import { config } from '../common/config';

const CANDIDATE_CONSEQUENCE = /missense|stop_gained|stop_lost|start_lost|frameshift|inframe|splice_(acceptor|donor|region)|protein_altering/;

/**
 * In-process job runner (no Redis needed — suits single-server small-lab installs).
 * Steps are idempotent per case, so a failed case can simply be re-run.
 */
@Injectable()
export class PipelineService implements OnModuleInit {
  private readonly log = new Logger('Pipeline');
  private queue: string[] = [];
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
    private readonly vep: VepClient,
    private readonly clinvar: ClinVarClient,
    private readonly civic: CivicClient,
    private readonly pubmed: PubMedClient,
    private readonly cpic: CpicClient,
    private readonly trials: TrialsService,
    private readonly geo: GeoService,
  ) {}

  async onModuleInit() {
    // Resume cases interrupted by a restart.
    const stuck = await this.prisma.case.findMany({ where: { status: { in: ['QUEUED', 'PROCESSING'] } }, select: { id: true } });
    stuck.forEach((c) => this.enqueue(c.id));
  }

  enqueue(caseId: string) {
    if (!this.queue.includes(caseId)) this.queue.push(caseId);
    void this.drain();
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const id = this.queue.shift()!;
      try {
        await this.process(id);
      } catch (e) {
        this.log.error(`Case ${id} failed: ${e instanceof Error ? e.stack : e}`);
        await this.prisma.case.update({ where: { id }, data: { status: 'FAILED', error: String(e instanceof Error ? e.message : e).slice(0, 1000) } });
        await this.audit.record({ action: 'pipeline.failed', entityType: 'Case', entityId: id, caseId: id, after: { error: String(e) } });
      }
    }
    this.running = false;
  }

  private async step(caseId: string, name: string, detail?: string) {
    const c = await this.prisma.case.findUnique({ where: { id: caseId }, select: { progress: true } });
    const progress = [...((c?.progress as any[]) ?? []), { step: name, detail, at: new Date().toISOString() }];
    await this.prisma.case.update({ where: { id: caseId }, data: { progress } });
  }

  async process(caseId: string) {
    const kase = await this.prisma.case.findUniqueOrThrow({ where: { id: caseId } });
    await this.prisma.case.update({ where: { id: caseId }, data: { status: 'PROCESSING', error: null, progress: [] } });
    const patient = kase.patient as unknown as PatientProfile;
    const build = kase.genomeBuild as 'GRCh37' | 'GRCh38';

    // Re-runs start clean (manual evidence is preserved).
    await this.prisma.evidence.deleteMany({ where: { caseId, origin: 'AUTO' } });
    await this.prisma.pgxResult.deleteMany({ where: { caseId } });

    // 1. Diagnosis normalisation (AI, cross-checked against keyword rules)
    await this.step(caseId, 'diagnosis', 'Normalising diagnosis');
    const ruleTumor = normalizeDiagnosisByRules(patient.diagnosis, patient.indication);
    const dx = await this.ai.run(diagnosisTask, { diagnosis: patient.diagnosis, indication: patient.indication }, { caseId });
    const tumor = tumorByCode(dx.output.code) ?? ruleTumor;
    const agreement = tumor.code === ruleTumor.code;
    await this.prisma.case.update({
      where: { id: caseId },
      data: {
        diagnosis: {
          code: tumor.code,
          label: tumor.label,
          method: dx.aiGenerated ? 'ai' : 'rule',
          confidence: dx.output.confidence,
          rationale: dx.output.rationale,
          ruleCode: ruleTumor.code,
          agreement,
          aiRunId: dx.runId,
          needsReview: dx.aiGenerated && (!agreement || dx.output.confidence === 'low'),
        },
      },
    });

    // 2. Annotation
    const variants = await this.prisma.variant.findMany({ where: { caseId }, orderBy: [{ chrom: 'asc' }, { pos: 'asc' }] });
    await this.step(caseId, 'annotation', `Annotating ${variants.length} variants with Ensembl VEP`);
    const keyOf = (v: { chrom: string; pos: number; ref: string; alt: string }) => `${v.chrom}-${v.pos}-${v.ref}-${v.alt}`;
    const anns = await this.vep.annotate(variants.map((v) => ({ chrom: v.chrom, pos: v.pos, ref: v.ref, alt: v.alt, build })));

    // 3. Evidence matching for candidate variants
    await this.step(caseId, 'evidence', 'Matching evidence (ClinVar, CIViC, PubMed, gnomAD)');
    const sources = new Set<string>(['Ensembl VEP', 'gnomAD v4 (via VEP)', 'ClinVar']);
    const results: Array<{ v: Variant; ann: Annotation; evidence: EvidenceDraft[]; g: GermlineCall; s: SomaticCall }> = [];
    await mapLimit(variants, 4, async (v) => {
      const ann = anns.get(keyOf(v)) ?? { rsIds: [], popFreq: {}, pubmedIds: [] };
      const key: VariantKey = { chrom: v.chrom, pos: v.pos, ref: v.ref, alt: v.alt, build };
      const f = popStats(ann.popFreq);
      const candidate = (ann.consequences ?? []).some((c) => CANDIDATE_CONSEQUENCE.test(c)) && f.maxPop < 0.05;
      const evidence: EvidenceDraft[] = [];
      if (candidate) {
        evidence.push(...(await safe(() => this.clinvar.lookup(key, ann), [])));
        if (ann.gene && ann.proteinShort) {
          const civ = await safe(() => this.civic.lookup(ann.gene!, ann.proteinShort!), []);
          if (civ.length) sources.add('CIViC');
          evidence.push(...civ);
        }
      }
      if (Object.keys(ann.popFreq).length) evidence.push(populationEvidence(ann, patient.ancestry));
      const g = classifyGermline(ann, evidence, patient.ancestry);
      const s = classifySomatic(ann, evidence, tumor.code);
      if (candidate && ann.gene && ann.proteinShort && (s.tier !== 'Tier IV' || g.classification !== 'Benign')) {
        const lit = await safe(() => this.pubmed.search(ann.gene!, ann.proteinShort!, 3), []);
        if (lit.length) sources.add('PubMed');
        evidence.push(...lit);
      }
      results.push({ v, ann, evidence, g, s });
    });

    // 4. Persist annotation, classification and evidence
    await this.step(caseId, 'classification', 'Applying ACMG/AMP and AMP/ASCO/CAP rules');
    const lens = kase.sampleType;
    for (const { v, ann, evidence, g, s } of results) {
      const reportable = defaultReportable(lens, lens === 'tumor' ? undefined : g, lens === 'germline' ? undefined : s);
      await this.prisma.variant.update({
        where: { id: v.id },
        data: {
          gene: ann.gene,
          transcript: ann.maneSelect ?? ann.transcript,
          hgvsc: ann.hgvsc,
          hgvsp: ann.hgvsp,
          proteinShort: ann.proteinShort,
          consequence: ann.consequence,
          impact: ann.impact,
          rsId: v.rsId ?? ann.rsIds[0],
          annotation: { exon: ann.exon, intron: ann.intron, sift: ann.sift, polyphen: ann.polyphen, consequences: ann.consequences, rsIds: ann.rsIds, vepClinSig: ann.vepClinSig, transcriptId: ann.transcript, maneSelect: ann.maneSelect } as Prisma.InputJsonValue,
          popFreq: ann.popFreq as Prisma.InputJsonValue,
          classification: { germline: g, somatic: s } as unknown as Prisma.InputJsonValue,
          reportable: v.override ? v.reportable : reportable,
        },
      });
      if (evidence.length) {
        await this.prisma.evidence.createMany({ data: evidence.map((e) => toEvidenceRow(caseId, v.id, e)) });
      }
    }

    // 5. Pharmacogenomics
    await this.step(caseId, 'pgx', 'Calling pharmacogenomic diplotypes (CPIC)');
    sources.add('CPIC');
    const calls = callDiplotypes(
      results.map(({ v, ann }) => ({ chrom: v.chrom, pos: v.pos, ref: v.ref, alt: v.alt, zygosity: v.zygosity ?? undefined, rsIds: [v.rsId, ...ann.rsIds].filter(Boolean) as string[] })),
      build,
    );
    for (const call of calls) {
      const interp = await safe(() => this.cpic.interpret(call), { phenotype: undefined, recommendations: [] });
      const caveats = [...call.caveats];
      if (kase.sampleType === 'tumor') caveats.push('Derived from a tumour-only sample; somatic changes or loss of heterozygosity can distort germline genotypes. Confirm with a germline sample.');
      await this.prisma.pgxResult.create({
        data: {
          caseId,
          gene: call.gene,
          diplotype: call.diplotype,
          phenotype: interp.phenotype,
          activityScore: call.activityScore,
          calledVariants: call.calledVariants,
          caveats,
          recommendations: interp.recommendations as unknown as Prisma.InputJsonValue,
          includeInReport: !!interp.phenotype && !/^normal/i.test(interp.phenotype) ? true : kase.sampleType !== 'tumor',
        },
      });
    }

    // 6. AI evidence triage for reportable variants
    await this.step(caseId, 'ai_triage', 'AI evidence prioritisation');
    const reportable = await this.prisma.variant.findMany({ where: { caseId, reportable: true }, include: { evidence: { where: { status: 'ACTIVE' } } } });
    for (const v of reportable) await this.triage(caseId, v, v.evidence, tumor.label, kase.sampleType);

    // 7. Clinical trials
    await this.step(caseId, 'trials', 'Searching ClinicalTrials.gov');
    const location = kase.location as any;
    const trialCount = await safe(
      () =>
        this.trials.findForCase(caseId, {
          tumorCode: tumor.code,
          diagnosisText: patient.diagnosis,
          location: location?.lat != null ? location : null,
          patient,
          variants: reportable.filter((v) => v.gene).map((v) => ({ gene: v.gene!, proteinShort: v.proteinShort })),
        }),
      0,
    );
    if (this.ai.enabled && trialCount) {
      await this.step(caseId, 'ai_trials', 'AI eligibility pre-screen of nearest trials');
      const top = await this.prisma.trialMatch.findMany({ where: { caseId, aiScreen: { equals: Prisma.AnyNull } }, orderBy: [{ distanceKm: { sort: 'asc', nulls: 'last' } }], take: 10 });
      await this.trials.screen(caseId, top.map((t) => t.id), { patient, tumorLabel: tumor.label, variants: reportable.map((v) => `${v.gene} ${v.proteinShort ?? v.hgvsc ?? ''}`.trim()) });
    }

    // 8. Draft report (AI narratives + summary)
    await this.step(caseId, 'report', 'Drafting report');
    await this.buildDraft(caseId, [...sources]);

    await this.prisma.case.update({ where: { id: caseId }, data: { status: 'READY' } });
    await this.step(caseId, 'done', 'Ready for review');
    await this.audit.record({ action: 'pipeline.completed', entityType: 'Case', entityId: caseId, caseId, after: { variants: variants.length, reportable: reportable.length, trials: trialCount } });
  }

  /** AI relevance ranking of a variant's evidence; stored as a suggestion on each evidence row. */
  async triage(caseId: string, v: Variant, evidence: Evidence[], tumorLabel: string, sampleType: string) {
    if (!evidence.length) return;
    const { list, aliases } = aliasEvidence(evidence);
    const res = await this.ai.run(
      triageTask,
      { tumorType: tumorLabel, sampleType, variant: { gene: v.gene, hgvsp: v.hgvsp, hgvsc: v.hgvsc, consequence: v.consequence }, evidence: list },
      { caseId, humanReview: false },
    );
    for (const item of res.output.items) {
      const id = aliases[item.alias];
      if (!id) continue;
      await this.prisma.evidence.update({
        where: { id },
        data: { ai: { relevance: item.relevance, rationale: item.rationale, aiRunId: res.runId, method: res.aiGenerated ? 'ai' : 'rule', decision: 'PENDING' } },
      });
    }
  }

  /** Builds (or rebuilds) the latest DRAFT/RETURNED report version's AI text. */
  async buildDraft(caseId: string, sources?: string[], only?: { variantId?: string; summary?: boolean }) {
    const kase = await this.prisma.case.findUniqueOrThrow({ where: { id: caseId } });
    const dx = (kase.diagnosis as any) ?? {};
    const variants = await this.prisma.variant.findMany({ where: { caseId, reportable: true }, include: { evidence: { where: { status: 'ACTIVE', includeInReport: true } } } });
    const pgx = await this.prisma.pgxResult.findMany({ where: { caseId, includeInReport: true } });
    const trialsCount = await this.prisma.trialMatch.count({ where: { caseId, hidden: false } });

    let report = await this.prisma.report.findFirst({ where: { caseId }, orderBy: { version: 'desc' } });
    if (report && !['DRAFT', 'RETURNED'].includes(report.status)) throw new Error('Latest report version is locked; create an amendment first.');
    const content: ReportContent = (report?.content as unknown as ReportContent) ?? {
      summary: { text: '', citations: {}, origin: 'DISABLED' },
      narratives: {},
      methodology: methodologyText(kase.genomeBuild, sources ?? [], this.ai.info.model),
      limitations: DEFAULT_LIMITATIONS,
      recommendations: '',
    };

    const narrativeFor = async (v: (typeof variants)[number]) => {
      const sorted = sortEvidenceForAi(v.evidence);
      const { list, aliases } = aliasEvidence(sorted.slice(0, 15));
      const cls = v.classification as any;
      const res = await this.ai.run(
        narrativeTask,
        {
          tumorType: dx.label ?? 'Unknown',
          sampleType: kase.sampleType,
          variant: { gene: v.gene, hgvsc: v.hgvsc, hgvsp: v.hgvsp, consequence: v.consequence, zygosity: v.zygosity, vaf: v.vaf },
          classification: {
            germline: kase.sampleType !== 'tumor' ? effectiveGermline(v) : undefined,
            somatic: kase.sampleType !== 'germline' ? effectiveSomatic(v) : undefined,
            criteria: (cls?.germline?.criteria ?? []).map((c: any) => `${c.code}: ${c.detail}`),
          },
          evidence: list,
        },
        { caseId },
      );
      content.narratives[v.id] = { text: res.output.narrative, citations: pick(aliases, res.output.citedEvidence, res.output.narrative), aiRunId: res.runId, origin: res.status };
    };

    if (!only || only.variantId) {
      for (const v of variants) {
        if (only?.variantId && v.id !== only.variantId) continue;
        const existing = content.narratives[v.id];
        if (!only && existing?.editedById) continue; // never overwrite human edits on a full rebuild
        await narrativeFor(v);
      }
    }

    if (!only || only.summary) {
      const allAliases: Record<string, string> = {};
      let n = 0;
      const findings = variants.map((v) => {
        const ev = sortEvidenceForAi(v.evidence).slice(0, 5).map((e) => {
          const alias = `E${++n}`;
          allAliases[alias] = e.id;
          return toTriage(e, alias);
        });
        return { gene: v.gene, change: v.proteinShort ?? v.hgvsc?.split(':')[1], classification: [kase.sampleType !== 'germline' ? effectiveSomatic(v) : null, kase.sampleType !== 'tumor' ? effectiveGermline(v) : null].filter(Boolean).join('; '), evidence: ev };
      });
      const res = await this.ai.run(
        summaryTask,
        {
          tumorType: dx.label ?? 'Unknown',
          sampleType: kase.sampleType,
          findings,
          pgx: pgx.map((p) => ({ gene: p.gene, diplotype: p.diplotype, phenotype: p.phenotype, drugs: ((p.recommendations as any[]) ?? []).map((r) => r.drug) })),
          trialsCount,
        },
        { caseId },
      );
      content.summary = { text: res.output.summary, citations: pick(allAliases, res.output.citedEvidence, res.output.summary), aiRunId: res.runId, origin: res.status };
    }

    if (report) {
      report = await this.prisma.report.update({ where: { id: report.id }, data: { content: content as unknown as Prisma.InputJsonValue } });
    } else {
      const tpl = await this.prisma.reportTemplate.findFirst({ where: { isDefault: true } });
      report = await this.prisma.report.create({ data: { caseId, version: 1, content: content as unknown as Prisma.InputJsonValue, templateId: tpl?.id } });
    }
    return report;
  }
}

// ---------- helpers ----------

export function effectiveGermline(v: Variant): string | undefined {
  const o = v.override as any;
  if (o?.germline) return o.germline;
  return (v.classification as any)?.germline?.classification;
}
export function effectiveSomatic(v: Variant): string | undefined {
  const o = v.override as any;
  if (o?.somatic) return o.somatic;
  const s = (v.classification as any)?.somatic;
  return s ? `${s.tier}${s.level ? ` (Level ${s.level})` : ''}` : undefined;
}

function toTriage(e: Evidence, alias: string): TriageEvidence {
  return {
    alias,
    source: e.source,
    category: e.category,
    level: e.level,
    significance: e.significance,
    disease: e.disease,
    therapies: (e.therapies as string[]) ?? [],
    summary: e.summary.slice(0, 500),
  };
}

export function aliasEvidence(evidence: Evidence[]) {
  const aliases: Record<string, string> = {};
  const list = evidence.map((e, i) => {
    aliases[`E${i + 1}`] = e.id;
    return toTriage(e, `E${i + 1}`);
  });
  return { list, aliases };
}

const REL_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const SRC_RANK: Record<string, number> = { MANUAL: 0, CLINVAR: 1, CIVIC: 2, CPIC: 3, GNOMAD: 4, PUBMED: 5 };
function sortEvidenceForAi(ev: Evidence[]) {
  return [...ev].sort((a, b) => {
    const ra = REL_RANK[(a.ai as any)?.relevance] ?? 1;
    const rb = REL_RANK[(b.ai as any)?.relevance] ?? 1;
    return ra - rb || (SRC_RANK[a.source] ?? 9) - (SRC_RANK[b.source] ?? 9) || (a.level ?? 'Z').localeCompare(b.level ?? 'Z');
  });
}

function pick(aliases: Record<string, string>, cited: string[], text: string) {
  const ids = new Set([...cited, ...[...text.matchAll(/\[(E\d+)\]/g)].map((m) => m[1])]);
  return Object.fromEntries([...ids].filter((a) => aliases[a]).map((a) => [a, aliases[a]]));
}

function populationEvidence(ann: Annotation, ancestry?: string): EvidenceDraft {
  const f = popStats(ann.popFreq, ancestry);
  const sas = Math.max(ann.popFreq.gnomade_sas ?? 0, ann.popFreq.gnomadg_sas ?? 0);
  return {
    source: 'GNOMAD',
    sourceId: ann.rsIds[0],
    url: ann.rsIds[0] ? `https://gnomad.broadinstitute.org/variant/${ann.rsIds[0]}?dataset=gnomad_r4` : undefined,
    category: 'POPULATION',
    level: f.maxPop > 0.05 ? 'BA1' : f.maxPop > 0.01 ? 'BS1' : f.maxPop < 0.0001 ? 'PM2' : undefined,
    summary: `gnomAD v4: overall AF ${fmtAf(f.overall)}, highest population AF ${fmtAf(f.maxPop)}, South Asian AF ${fmtAf(sas)}${f.patientPop !== undefined ? `, patient ancestry AF ${fmtAf(f.patientPop)}` : ''}.`,
    sourceVersion: 'gnomAD v4 via Ensembl VEP',
    retrievedAt: new Date(),
  };
}
const fmtAf = (x: number) => (x === 0 ? '0' : x < 0.001 ? x.toExponential(2) : x.toFixed(4));

function toEvidenceRow(caseId: string, variantId: string, e: EvidenceDraft): Prisma.EvidenceCreateManyInput {
  return {
    caseId,
    variantId,
    source: e.source,
    sourceId: e.sourceId,
    url: e.url,
    category: e.category,
    level: e.level,
    significance: e.significance,
    direction: e.direction,
    disease: e.disease,
    therapies: e.therapies ?? [],
    summary: e.summary ?? '',
    citation: e.citation,
    sourceVersion: e.sourceVersion,
    retrievedAt: e.retrievedAt,
    origin: 'AUTO',
    includeInReport: e.category !== 'LITERATURE' && e.category !== 'POPULATION',
  };
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    new Logger('Pipeline').warn(`Knowledge source unavailable: ${e instanceof Error ? e.message : e}`);
    return fallback;
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export { NOT_ASSESSED_GENES, config };
