import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { haversineKm, ResolvedLocation } from '../geo/geo.service';
import { tumorByCode } from '../interpret/tumor-types';
import { AiService } from '../ai/ai.service';
import { trialScreenTask } from '../ai/tasks';
import { PatientProfile } from '../deid/patient.schema';
import { CtGovClient, CtStudy, parseAge } from './ctgov.client';

export interface TrialQueryVariant {
  gene: string;
  proteinShort?: string | null;
}

/**
 * Finds recruiting trials for the case's tumour type and reportable genes, computes the
 * nearest recruiting site to the patient's coarse location (ZIP3/PIN3/city centroid), and
 * sorts nearest-first. Deterministic age/sex checks run first; the LLM pre-screen is optional.
 */
@Injectable()
export class TrialsService {
  private readonly log = new Logger('Trials');
  constructor(
    private readonly prisma: PrismaService,
    private readonly ct: CtGovClient,
    private readonly ai: AiService,
  ) {}

  async findForCase(caseId: string, opts: { tumorCode: string; diagnosisText: string; location?: ResolvedLocation | null; patient: PatientProfile; variants: TrialQueryVariant[] }) {
    const tt = tumorByCode(opts.tumorCode);
    const genes = [...new Set(opts.variants.map((v) => v.gene))].slice(0, 8);
    const cond = tt?.trialTerm || (opts.tumorCode === 'HEREDITARY' ? undefined : opts.diagnosisText || undefined);
    if (!cond && !genes.length) return [];
    const country = opts.location ? (opts.location.country === 'IN' ? 'India' : 'United States') : undefined;

    const seen = new Map<string, CtStudy>();
    const add = (list: CtStudy[]) => list.forEach((s) => s.nctId && !seen.has(s.nctId) && seen.set(s.nctId, s));
    if (genes.length) add(await this.ct.search({ cond, term: genes.join(' OR '), country, max: 150 }));
    if (cond && seen.size < 25) add(await this.ct.search({ cond, country, max: 100 }));

    const terms = [
      ...genes,
      ...opts.variants.filter((v) => v.proteinShort).map((v) => `${v.gene} ${v.proteinShort}`),
      ...opts.variants.filter((v) => v.proteinShort).map((v) => v.proteinShort!),
    ];

    const rows = [...seen.values()].map((s) => {
      const hay = `${s.title}\n${s.conditions.join(' ')}\n${s.keywords.join(' ')}\n${s.eligibility ?? ''}`.toLowerCase();
      const matchedTerms = terms.filter((t) => new RegExp(`\\b${t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay));
      const recruitingSites = s.sites.filter((x) => !x.status || x.status === 'RECRUITING' || x.status === 'NOT_YET_RECRUITING');
      const withDist = recruitingSites
        .filter((x) => x.lat != null && x.lon != null)
        .map((x) => ({ ...x, distanceKm: opts.location ? Math.round(haversineKm(opts.location, { lat: x.lat!, lon: x.lon! })) : undefined }))
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
      const nearest = withDist[0];
      return { s, matchedTerms: [...new Set(matchedTerms)], sites: withDist, nearest, flags: this.basicEligibility(s, opts.patient) };
    });

    rows.sort((a, b) => {
      if (opts.location) {
        const da = a.nearest?.distanceKm ?? Infinity;
        const db = b.nearest?.distanceKm ?? Infinity;
        if (da !== db) return da - db;
      }
      return b.matchedTerms.length - a.matchedTerms.length;
    });

    await this.prisma.trialMatch.deleteMany({ where: { caseId } });
    const keep = rows.slice(0, 60);
    for (const r of keep) {
      await this.prisma.trialMatch.create({
        data: {
          caseId,
          nctId: r.s.nctId,
          title: r.s.title,
          phase: r.s.phase,
          status: r.s.status,
          conditions: r.s.conditions,
          interventions: r.s.interventions,
          matchedTerms: r.matchedTerms,
          nearestSite: (r.nearest ?? null) as unknown as Prisma.InputJsonValue,
          distanceKm: r.nearest?.distanceKm ?? null,
          sites: r.sites.slice(0, 25) as unknown as Prisma.InputJsonValue,
          eligibility: r.s.eligibility,
          minAge: r.s.minAge,
          maxAge: r.s.maxAge,
          sex: r.s.sex,
          aiScreen: r.flags.length ? ({ verdict: 'LIKELY_INELIGIBLE', reasons: r.flags.map((f) => ({ criterionQuote: f, assessment: 'NOT_MET', note: 'Deterministic age/sex check' })), method: 'rule' } as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
    }
    return keep.length;
  }

  basicEligibility(s: CtStudy, p: PatientProfile): string[] {
    const flags: string[] = [];
    const min = parseAge(s.minAge);
    const max = parseAge(s.maxAge);
    if (p.ageYears != null && min != null && p.ageYears < min) flags.push(`Minimum age ${s.minAge}`);
    if (p.ageYears != null && max != null && p.ageYears > max) flags.push(`Maximum age ${s.maxAge}`);
    if (s.sex === 'FEMALE' && p.sex === 'male') flags.push('Sex: female participants only');
    if (s.sex === 'MALE' && p.sex === 'female') flags.push('Sex: male participants only');
    return flags;
  }

  /** LLM pre-screen of the top trials (guardrailed: verbatim criteria quotes, consistent verdict). */
  async screen(caseId: string, trialIds: string[], ctx: { patient: PatientProfile; tumorLabel: string; variants: string[] }) {
    const trials = await this.prisma.trialMatch.findMany({ where: { caseId, id: { in: trialIds } } });
    for (const t of trials) {
      if (!t.eligibility) continue;
      const res = await this.ai.run(
        trialScreenTask,
        {
          patient: {
            ageYears: ctx.patient.ageYears,
            sex: ctx.patient.sex,
            tumorType: ctx.tumorLabel,
            stage: ctx.patient.stage,
            ecog: ctx.patient.ecog,
            priorTherapies: ctx.patient.priorTherapies,
          },
          variants: ctx.variants,
          trial: { nctId: t.nctId, title: t.title, eligibility: t.eligibility.slice(0, 8000) },
        },
        { caseId },
      );
      if (!res.aiGenerated) continue;
      await this.prisma.trialMatch.update({
        where: { id: t.id },
        data: { aiScreen: { ...res.output, method: 'ai', aiRunId: res.runId, decision: 'PENDING' } as Prisma.InputJsonValue },
      });
    }
  }
}
