import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Evidence, Prisma, Report } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiService } from '../ai/ai.service';
import { AuthUser } from '../auth/roles';
import { sha256 } from '../common/hash';
import { PipelineService, effectiveGermline, effectiveSomatic } from '../pipeline/pipeline.service';
import { AiText, ReportContent } from '../pipeline/report-content';
import { NOT_ASSESSED_GENES } from '../kb/pgx';
import { PatientProfile } from '../deid/patient.schema';
import { renderPdf } from './pdf';
import { DEFAULT_SECTIONS, DEFAULT_THEME, Theme } from './template.defaults';

export interface Finding {
  variantId: string;
  gene: string | null;
  change: string;
  vaf: number | null;
  zygosity: string | null;
  classification: string;
  narrative?: AiText;
  therapies: string[];
}

export interface AssembledReport {
  report: Report;
  case: { id: string; caseCode: string; sampleType: string; genomeBuild: string; assay: string | null };
  patient: PatientProfile;
  diagnosisLabel: string;
  content: ReportContent;
  somatic: Finding[];
  germline: Finding[];
  vus: Array<{ gene: string | null; change: string; classification: string }>;
  pgx: Array<{ gene: string; diplotype: string | null; phenotype: string | null; recommendations: Array<{ drug: string; recommendation: string; classification?: string }> }>;
  pgxNotAssessed: string[];
  trials: Array<{ nctId: string; title: string; phase: string | null; nearest: any; distanceKm: number | null }>;
  evidenceById: Map<string, Evidence>;
  submittedBy?: string;
  signedBy?: string;
  ai: { used: boolean; model?: string };
  pendingAi: Array<{ section: string; aiRunId: string }>;
}

const EDITABLE = ['DRAFT', 'RETURNED'];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
    private readonly pipeline: PipelineService,
  ) {}

  async latest(caseId: string) {
    const versions = await this.prisma.report.findMany({ where: { caseId }, orderBy: { version: 'desc' }, select: { id: true, version: true, status: true, signedAt: true, submittedAt: true, pdfSha256: true } });
    if (!versions.length) return { report: null, versions };
    const assembled = await this.assemble(versions[0].id);
    return { report: serialise(assembled), versions };
  }

  async assemble(reportId: string): Promise<AssembledReport> {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');
    // Signed reports render from their frozen snapshot so later edits can never change them.
    if (report.status === 'SIGNED' || report.status === 'SUPERSEDED') {
      if (report.snapshot) return reviveSnapshot(report, report.snapshot as any);
    }
    const kase = await this.prisma.case.findUniqueOrThrow({ where: { id: report.caseId } });
    const content = report.content as unknown as ReportContent;
    const variants = await this.prisma.variant.findMany({
      where: { caseId: kase.id },
      include: { evidence: { where: { status: 'ACTIVE' } } },
      orderBy: [{ gene: 'asc' }],
    });
    const evidenceById = new Map<string, Evidence>();
    variants.forEach((v) => v.evidence.forEach((e) => evidenceById.set(e.id, e)));
    const change = (v: (typeof variants)[number]) => [v.hgvsc?.split(':')[1], v.proteinShort ? `p.${v.proteinShort}` : null].filter(Boolean).join(' ') || `${v.chrom}:${v.pos} ${v.ref}>${v.alt}`;

    const somatic: Finding[] = [];
    const germline: Finding[] = [];
    const vus: AssembledReport['vus'] = [];
    for (const v of variants) {
      const s = effectiveSomatic(v);
      const g = effectiveGermline(v);
      const therapies = [...new Set(v.evidence.filter((e) => e.includeInReport && e.category === 'THERAPEUTIC').flatMap((e) => (e.therapies as string[]) ?? []))].slice(0, 10);
      const base = { variantId: v.id, gene: v.gene, change: change(v), vaf: v.vaf, zygosity: v.zygosity, narrative: content.narratives?.[v.id], therapies };
      if (v.reportable) {
        if (kase.sampleType !== 'germline' && s && /Tier (I|II)\b/.test(s) && !/Tier III|Tier IV/.test(s)) somatic.push({ ...base, classification: s });
        else if (kase.sampleType !== 'tumor' && g) germline.push({ ...base, classification: g });
        else if (kase.sampleType === 'tumor' && s) somatic.push({ ...base, classification: s });
      } else if (kase.sampleType !== 'tumor' && g === 'Uncertain significance' && v.consequence && /missense|frameshift|stop|splice|inframe/.test(v.consequence)) {
        vus.push({ gene: v.gene, change: change(v), classification: g });
      } else if (kase.sampleType !== 'germline' && s?.startsWith('Tier III')) {
        vus.push({ gene: v.gene, change: change(v), classification: s });
      }
    }

    const pgx = (await this.prisma.pgxResult.findMany({ where: { caseId: kase.id, includeInReport: true }, orderBy: { gene: 'asc' } })).map((p) => ({
      gene: p.gene,
      diplotype: p.diplotype,
      phenotype: p.phenotype,
      recommendations: ((p.recommendations as any[]) ?? []).filter((r) => !r.population || r.population === 'general' || r.population === 'adults'),
    }));
    const trials = (await this.prisma.trialMatch.findMany({ where: { caseId: kase.id, includeInReport: true }, orderBy: [{ distanceKm: { sort: 'asc', nulls: 'last' } }] })).map((t) => ({
      nctId: t.nctId,
      title: t.title,
      phase: t.phase,
      nearest: t.nearestSite,
      distanceKm: t.distanceKm,
    }));

    const users = await this.prisma.user.findMany({ where: { id: { in: [report.submittedById, report.signedById].filter(Boolean) as string[] } } });
    const nameOf = (id?: string | null) => users.find((u) => u.id === id)?.name;
    const aiTexts: Array<[string, AiText | undefined]> = [['summary', content.summary], ...Object.entries(content.narratives ?? {})];
    const runIds = aiTexts.map(([, t]) => t?.aiRunId).filter(Boolean) as string[];
    const runs = runIds.length ? await this.prisma.aiRun.findMany({ where: { id: { in: runIds } } }) : [];
    const reportedVariantIds = new Set([...somatic, ...germline].map((f) => f.variantId));
    const pendingAi = aiTexts
      .filter(([k, t]) => t?.aiRunId && (k === 'summary' || reportedVariantIds.has(k)))
      .filter(([, t]) => runs.find((r) => r.id === t!.aiRunId)?.humanDecision === 'PENDING' && !t!.editedById)
      .map(([k, t]) => ({ section: k, aiRunId: t!.aiRunId! }));
    const usedAi = runs.some((r) => r.status === 'PASSED');

    return {
      report,
      case: { id: kase.id, caseCode: kase.caseCode, sampleType: kase.sampleType, genomeBuild: kase.genomeBuild, assay: kase.assay },
      patient: kase.patient as unknown as PatientProfile,
      diagnosisLabel: (kase.diagnosis as any)?.label ?? (kase.patient as any)?.diagnosis ?? 'Not provided',
      content,
      somatic,
      germline,
      vus,
      pgx,
      pgxNotAssessed: NOT_ASSESSED_GENES,
      trials,
      evidenceById,
      submittedBy: nameOf(report.submittedById),
      signedBy: nameOf(report.signedById),
      ai: { used: usedAi, model: runs.find((r) => r.status === 'PASSED')?.model ?? undefined },
      pendingAi,
    };
  }

  private async editable(reportId: string) {
    const r = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!r) throw new NotFoundException();
    if (!EDITABLE.includes(r.status)) throw new ConflictException(`Report is ${r.status} and cannot be edited. Create an amendment.`);
    return r;
  }

  async editSection(reportId: string, user: AuthUser, section: string, text: string) {
    const r = await this.editable(reportId);
    const content = r.content as unknown as ReportContent;
    const before = JSON.parse(JSON.stringify(content));
    const now = new Date().toISOString();
    if (section === 'summary') {
      content.summary = { ...content.summary, text, editedById: user.id, editedAt: now, origin: content.summary.aiRunId ? content.summary.origin : 'MANUAL' };
      if (content.summary.aiRunId) await this.ai.decide(content.summary.aiRunId, 'EDITED', user.id);
    } else if (section.startsWith('narrative:')) {
      const vid = section.slice('narrative:'.length);
      const prev = content.narratives[vid] ?? { text: '', citations: {}, origin: 'MANUAL' };
      content.narratives[vid] = { ...prev, text, editedById: user.id, editedAt: now };
      if (prev.aiRunId) await this.ai.decide(prev.aiRunId, 'EDITED', user.id);
    } else if (['methodology', 'limitations', 'recommendations'].includes(section)) {
      (content as any)[section] = text;
    } else throw new BadRequestException('Unknown section');
    await this.prisma.report.update({ where: { id: r.id }, data: { content: content as unknown as Prisma.InputJsonValue } });
    await this.audit.record({ actor: user, action: 'report.section_edited', entityType: 'Report', entityId: r.id, caseId: r.caseId, before: pickSection(before, section), after: pickSection(content, section) });
    return { ok: true };
  }

  async decideAi(reportId: string, user: AuthUser, section: string, decision: 'ACCEPTED' | 'REJECTED', note?: string) {
    const r = await this.editable(reportId);
    const content = r.content as unknown as ReportContent;
    const t = section === 'summary' ? content.summary : content.narratives[section.replace('narrative:', '')];
    if (!t?.aiRunId) throw new BadRequestException('Section has no AI suggestion');
    await this.ai.decide(t.aiRunId, decision, user.id, note);
    if (decision === 'REJECTED') {
      // Rejected AI text is replaced with an empty manual section for the analyst to write.
      const replacement: AiText = { text: '', citations: {}, origin: 'MANUAL', editedById: user.id, editedAt: new Date().toISOString() };
      if (section === 'summary') content.summary = replacement;
      else content.narratives[section.replace('narrative:', '')] = replacement;
      await this.prisma.report.update({ where: { id: r.id }, data: { content: content as unknown as Prisma.InputJsonValue } });
    }
    await this.audit.record({ actor: user, action: `ai.suggestion_${decision.toLowerCase()}`, entityType: 'AiRun', entityId: t.aiRunId, caseId: r.caseId, after: { section, note }, reason: note });
    return { ok: true };
  }

  async regenerate(reportId: string, user: AuthUser, target: string) {
    const r = await this.editable(reportId);
    await this.pipeline.buildDraft(r.caseId, undefined, target === 'summary' ? { summary: true } : { variantId: target.replace('narrative:', '') });
    await this.audit.record({ actor: user, action: 'report.ai_regenerated', entityType: 'Report', entityId: r.id, caseId: r.caseId, after: { target } });
    return { ok: true };
  }

  async submit(reportId: string, user: AuthUser) {
    const r = await this.editable(reportId);
    const a = await this.assemble(r.id);
    if (a.pendingAi.length) {
      throw new ConflictException({ message: 'Every AI-drafted section must be accepted, edited or rejected before submission.', pending: a.pendingAi });
    }
    if (!a.content.summary.text.trim()) throw new ConflictException('The summary section is empty.');
    const updated = await this.prisma.report.update({ where: { id: r.id }, data: { status: 'IN_REVIEW', submittedById: user.id, submittedAt: new Date(), reviewComment: null } });
    await this.audit.record({ actor: user, action: 'report.submitted', entityType: 'Report', entityId: r.id, caseId: r.caseId, before: { status: r.status }, after: { status: 'IN_REVIEW' } });
    return updated;
  }

  async returnToAnalyst(reportId: string, user: AuthUser, comment: string) {
    const r = await this.prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    if (r.status !== 'IN_REVIEW') throw new ConflictException('Only reports in review can be returned.');
    const updated = await this.prisma.report.update({ where: { id: r.id }, data: { status: 'RETURNED', reviewComment: comment } });
    await this.audit.record({ actor: user, action: 'report.returned', entityType: 'Report', entityId: r.id, caseId: r.caseId, before: { status: r.status }, after: { status: 'RETURNED' }, reason: comment });
    return updated;
  }

  async sign(reportId: string, user: AuthUser, attestation: string) {
    const r = await this.prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    if (r.status !== 'IN_REVIEW') throw new ConflictException('Only reports in review can be signed.');
    if (r.submittedById === user.id) throw new ForbiddenException('Separation of duties: the person who submitted a report cannot sign it.');
    if (!attestation?.trim()) throw new BadRequestException('Attestation is required.');
    const signedAt = new Date();
    const staged = { ...r, status: 'SIGNED' as const, signedById: user.id, signedAt };
    const assembled = await this.assemble(r.id);
    assembled.report = staged;
    assembled.signedBy = user.name;
    const tpl = await this.template(r.templateId);
    const pdf = await renderPdf(assembled, tpl.theme, tpl.sections);
    const pdfSha256 = sha256(pdf);
    const snapshot = { ...serialise(assembled), template: tpl, attestation };
    await this.prisma.$transaction([
      this.prisma.report.update({ where: { id: r.id }, data: { status: 'SIGNED', signedById: user.id, signedAt, pdf: new Uint8Array(pdf), pdfSha256, snapshot: snapshot as unknown as Prisma.InputJsonValue } }),
      this.prisma.report.updateMany({ where: { caseId: r.caseId, status: 'SIGNED', id: { not: r.id } }, data: { status: 'SUPERSEDED' } }),
    ]);
    await this.audit.record({ actor: user, action: 'report.signed', entityType: 'Report', entityId: r.id, caseId: r.caseId, before: { status: 'IN_REVIEW' }, after: { status: 'SIGNED', pdfSha256 }, reason: attestation });
    return { ok: true, pdfSha256 };
  }

  async amend(reportId: string, user: AuthUser, reason: string) {
    const r = await this.prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    if (r.status !== 'SIGNED') throw new ConflictException('Only signed reports can be amended.');
    const max = await this.prisma.report.aggregate({ where: { caseId: r.caseId }, _max: { version: true } });
    const next = await this.prisma.report.create({
      data: { caseId: r.caseId, version: (max._max.version ?? 1) + 1, content: r.content as Prisma.InputJsonValue, templateId: r.templateId, reviewComment: `Amendment of v${r.version}: ${reason}` },
    });
    await this.audit.record({ actor: user, action: 'report.amendment_created', entityType: 'Report', entityId: next.id, caseId: r.caseId, after: { fromVersion: r.version, version: next.version }, reason });
    return next;
  }

  async setTemplate(reportId: string, user: AuthUser, templateId: string) {
    const r = await this.editable(reportId);
    await this.prisma.reportTemplate.findUniqueOrThrow({ where: { id: templateId } });
    await this.prisma.report.update({ where: { id: r.id }, data: { templateId } });
    await this.audit.record({ actor: user, action: 'report.template_changed', entityType: 'Report', entityId: r.id, caseId: r.caseId, before: { templateId: r.templateId }, after: { templateId } });
  }

  async pdf(reportId: string): Promise<{ pdf: Buffer; name: string }> {
    const r = await this.prisma.report.findUniqueOrThrow({ where: { id: reportId }, include: { case: { select: { caseCode: true } } } });
    if ((r.status === 'SIGNED' || r.status === 'SUPERSEDED') && r.pdf) return { pdf: Buffer.from(r.pdf), name: `${r.case.caseCode}_v${r.version}.pdf` };
    const a = await this.assemble(r.id);
    const tpl = await this.template(r.templateId);
    return { pdf: await renderPdf(a, tpl.theme, tpl.sections), name: `${r.case.caseCode}_v${r.version}_DRAFT.pdf` };
  }

  async template(id?: string | null): Promise<{ theme: Theme; sections: typeof DEFAULT_SECTIONS }> {
    const t = (id && (await this.prisma.reportTemplate.findUnique({ where: { id } }))) || (await this.prisma.reportTemplate.findFirst({ where: { isDefault: true } }));
    return t ? { theme: { ...DEFAULT_THEME, ...(t.theme as any) }, sections: t.sections as any } : { theme: DEFAULT_THEME, sections: DEFAULT_SECTIONS };
  }
}

function pickSection(content: any, section: string) {
  if (section.startsWith('narrative:')) return content.narratives?.[section.slice(10)]?.text;
  return section === 'summary' ? content.summary?.text : content[section];
}

/** JSON-safe form of an assembled report (Map → object). */
export function serialise(a: AssembledReport) {
  const { evidenceById, report, ...rest } = a;
  const { pdf, snapshot, ...reportMeta } = report as any;
  return { ...rest, report: reportMeta, evidence: Object.fromEntries(evidenceById) };
}

function reviveSnapshot(report: Report, snap: any): AssembledReport {
  const { pdf, snapshot, ...reportMeta } = report as any;
  return { ...snap, report: { ...snap.report, ...reportMeta }, evidenceById: new Map(Object.entries(snap.evidence ?? {})) } as AssembledReport;
}
