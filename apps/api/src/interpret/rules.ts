import { CANCER_GENES, LOF_CONSEQUENCES, LOF_MECHANISM_GENES } from '../kb/gene-lists';
import { Annotation, EvidenceDraft } from '../kb/types';
import { diseaseMatches } from './tumor-types';

/**
 * Deterministic interpretation engine. AI never classifies variants; it only explains and
 * prioritises. Every criterion that fires is recorded so the analyst can see why.
 */
export interface Criterion {
  code: string;
  strength: 'standalone' | 'very_strong' | 'strong' | 'moderate' | 'supporting';
  direction: 'pathogenic' | 'benign';
  detail: string;
}

export interface GermlineCall {
  lens: 'germline';
  classification: 'Pathogenic' | 'Likely pathogenic' | 'Uncertain significance' | 'Likely benign' | 'Benign';
  points: number;
  criteria: Criterion[];
  notes: string[];
}

export interface SomaticCall {
  lens: 'somatic';
  tier: 'Tier I' | 'Tier II' | 'Tier III' | 'Tier IV';
  level?: 'A' | 'B' | 'C' | 'D';
  basis: string[];
}

const POINTS: Record<Criterion['strength'], number> = { standalone: 99, very_strong: 8, strong: 4, moderate: 2, supporting: 1 };

/** gnomAD population key for the patient's ancestry (VEP frequency key suffix). */
const ANCESTRY_POP: Record<string, string> = {
  south_asian: 'sas', european: 'nfe', african: 'afr', east_asian: 'eas', latino: 'amr', ashkenazi: 'asj', middle_eastern: 'mid',
};

export function popStats(freq: Record<string, number>, ancestry?: string) {
  const entries = Object.entries(freq).filter(([k]) => /^gnomad[eg]_/.test(k) && !/_(remaining|oth)$/.test(k));
  const overall = Math.max(freq.gnomade ?? 0, freq.gnomadg ?? 0);
  const maxPop = entries.reduce((m, [, v]) => Math.max(m, v), overall);
  const pop = ancestry ? ANCESTRY_POP[ancestry] : undefined;
  const patientPop = pop ? Math.max(freq[`gnomade_${pop}`] ?? 0, freq[`gnomadg_${pop}`] ?? 0) : undefined;
  const anyData = Object.keys(freq).length > 0;
  return { overall, maxPop, patientPop, anyData };
}

export function classifyGermline(ann: Annotation, evidence: EvidenceDraft[], ancestry?: string): GermlineCall {
  const criteria: Criterion[] = [];
  const notes: string[] = [];
  const f = popStats(ann.popFreq, ancestry);

  // Population data (ClinGen SVI: PM2 applied at supporting strength)
  if (f.maxPop > 0.05) criteria.push({ code: 'BA1', strength: 'standalone', direction: 'benign', detail: `Max gnomAD population AF ${fmt(f.maxPop)} > 5%` });
  else if (f.maxPop > 0.01) criteria.push({ code: 'BS1', strength: 'strong', direction: 'benign', detail: `Max gnomAD population AF ${fmt(f.maxPop)} > 1%` });
  else if (f.maxPop < 0.0001) {
    criteria.push({ code: 'PM2_Supporting', strength: 'supporting', direction: 'pathogenic', detail: f.anyData ? `Rare in gnomAD (max population AF ${fmt(f.maxPop)})` : 'Absent from gnomAD' });
  }
  if (f.patientPop !== undefined && f.patientPop > 0.01 && f.maxPop <= 0.01) {
    notes.push(`AF in the patient's ancestral population is ${fmt(f.patientPop)}; consider population-specific frequency.`);
  }

  // Null variant in a gene where LoF is a known mechanism
  const lof = (ann.consequences ?? []).some((c) => LOF_CONSEQUENCES.has(c));
  if (lof && ann.gene && LOF_MECHANISM_GENES.has(ann.gene)) {
    const [exonNo, exonTotal] = (ann.exon ?? '').split('/').map(Number);
    const lastExon = exonNo && exonTotal && exonNo === exonTotal && (ann.consequences ?? []).some((c) => c === 'stop_gained' || c === 'frameshift_variant');
    if (lastExon) {
      criteria.push({ code: 'PVS1_Moderate', strength: 'moderate', direction: 'pathogenic', detail: `${ann.consequence} in last exon of ${ann.gene} (may escape NMD)` });
    } else {
      criteria.push({ code: 'PVS1', strength: 'very_strong', direction: 'pathogenic', detail: `${ann.consequence} in ${ann.gene}, a gene where loss of function causes disease` });
    }
    notes.push('PVS1 applied automatically; confirm transcript relevance and splicing/NMD prediction (ClinGen PVS1 decision tree).');
  }

  // In-silico predictors (SIFT + PolyPhen concordance, supporting only)
  if (ann.consequence === 'missense_variant') {
    const sDel = ann.sift?.startsWith('deleterious');
    const pDam = ann.polyphen === 'probably_damaging';
    const sTol = ann.sift?.startsWith('tolerated');
    const pBen = ann.polyphen === 'benign';
    if (sDel && pDam) criteria.push({ code: 'PP3', strength: 'supporting', direction: 'pathogenic', detail: `SIFT ${ann.sift}, PolyPhen ${ann.polyphen}` });
    else if (sTol && pBen) criteria.push({ code: 'BP4', strength: 'supporting', direction: 'benign', detail: `SIFT ${ann.sift}, PolyPhen ${ann.polyphen}` });
  }
  if (ann.consequence === 'synonymous_variant' && !(ann.consequences ?? []).some((c) => c.includes('splice'))) {
    criteria.push({ code: 'BP7', strength: 'supporting', direction: 'benign', detail: 'Synonymous variant without predicted splice impact' });
  }

  const benignStandalone = criteria.some((c) => c.strength === 'standalone');
  let points = 0;
  if (!benignStandalone) for (const c of criteria) points += (c.direction === 'pathogenic' ? 1 : -1) * POINTS[c.strength];
  let classification: GermlineCall['classification'] = benignStandalone ? 'Benign' : pointsToClass(points);

  // ClinVar consensus (≥ 2★) is shown as context; expert panel / guideline (≥ 3★) is adopted.
  const cv = evidence
    .filter((e) => e.source === 'CLINVAR' && e.category === 'PATHOGENICITY')
    .sort((a, b) => Number(b.meta?.stars ?? 0) - Number(a.meta?.stars ?? 0))[0];
  if (cv) {
    const stars = Number(cv.meta?.stars ?? 0);
    const cvClass = clinvarToClass(cv.significance);
    if (stars >= 3 && cvClass) {
      if (cvClass !== classification) notes.push(`Adopted ClinVar ${stars}★ classification (${cv.significance}); rule-based score was ${points} (${classification}).`);
      classification = cvClass;
    } else if (stars >= 2 && cvClass && cvClass !== classification) {
      notes.push(`ClinVar ${stars}★ consensus is "${cv.significance}" but rule-based call is "${classification}" — analyst review required.`);
    }
  }
  return { lens: 'germline', classification, points, criteria, notes };
}

export function pointsToClass(p: number): GermlineCall['classification'] {
  // Tavtigian et al. 2020 Bayesian point system
  if (p >= 10) return 'Pathogenic';
  if (p >= 6) return 'Likely pathogenic';
  if (p >= 0) return 'Uncertain significance';
  if (p >= -6) return 'Likely benign';
  return 'Benign';
}

function clinvarToClass(sig?: string): GermlineCall['classification'] | undefined {
  const s = (sig ?? '').toLowerCase();
  if (s.startsWith('pathogenic/likely pathogenic')) return 'Likely pathogenic';
  if (s === 'pathogenic') return 'Pathogenic';
  if (s === 'likely pathogenic') return 'Likely pathogenic';
  if (s === 'benign') return 'Benign';
  if (s === 'likely benign' || s === 'benign/likely benign') return 'Likely benign';
  if (s === 'uncertain significance') return 'Uncertain significance';
  return undefined;
}

/** AMP/ASCO/CAP 2017 somatic tiers from CIViC + ClinVar somatic evidence. */
export function classifySomatic(ann: Annotation, evidence: EvidenceDraft[], tumorCode?: string): SomaticCall {
  const basis: string[] = [];
  let best: { tier: SomaticCall['tier']; level: SomaticCall['level']; rank: number } | undefined;
  const consider = (tier: SomaticCall['tier'], level: SomaticCall['level'], why: string) => {
    const rank = { 'Tier I': 0, 'Tier II': 10, 'Tier III': 20, 'Tier IV': 30 }[tier] + ({ A: 0, B: 1, C: 2, D: 3 }[level ?? 'D'] ?? 3);
    if (!best || rank < best.rank) best = { tier, level, rank };
    basis.push(why);
  };

  for (const e of evidence) {
    if (e.direction && e.direction.toLowerCase().startsWith('does not')) continue;
    const same = diseaseMatches(e.disease, tumorCode);
    if (e.source === 'CIVIC' && e.meta?.kind === 'assertion' && typeof e.meta.ampLevel === 'string') {
      const m = (e.meta.ampLevel as string).match(/TIER_(I{1,3}|IV)_LEVEL_([ABCD])/);
      if (m && same) consider(`Tier ${m[1]}` as SomaticCall['tier'], m[2] as SomaticCall['level'], `CIViC ${e.sourceId}: ${e.level} in ${e.disease}`);
      else if (m && (m[1] === 'I' || m[1] === 'II')) consider('Tier II', 'C', `CIViC ${e.sourceId}: ${e.level} in another tumour type (${e.disease})`);
    }
    if (e.source === 'CIVIC' && e.meta?.kind === 'evidence' && ['THERAPEUTIC', 'DIAGNOSTIC', 'PROGNOSTIC'].includes(e.category)) {
      const lvl = e.level;
      if ((lvl === 'A' || lvl === 'B') && same) consider('Tier I', lvl, `CIViC ${e.sourceId}: level ${lvl} ${e.category.toLowerCase()} evidence in ${e.disease}`);
      else if (lvl === 'A' || lvl === 'B') consider('Tier II', 'C', `CIViC ${e.sourceId}: level ${lvl} evidence in another tumour type (${e.disease})`);
      else if (lvl === 'C') consider('Tier II', 'C', `CIViC ${e.sourceId}: level C (case study) evidence`);
      else if (lvl === 'D') consider('Tier II', 'D', `CIViC ${e.sourceId}: level D (preclinical) evidence`);
    }
    if (e.source === 'CLINVAR' && e.meta?.clinicalImpact) {
      if (/tier i\b/i.test(e.significance ?? '') && same) consider('Tier I', 'A', `ClinVar somatic clinical impact: ${e.significance} (${e.disease})`);
      else if (/tier i\b/i.test(e.significance ?? '')) consider('Tier II', 'C', `ClinVar somatic clinical impact: ${e.significance} in another tumour type`);
      else if (/tier ii\b/i.test(e.significance ?? '')) consider('Tier II', 'C', `ClinVar somatic clinical impact: ${e.significance}`);
    }
  }
  if (best) return { lens: 'somatic', tier: best.tier, level: best.level, basis: dedupe(basis).slice(0, 8) };

  const f = popStats(ann.popFreq);
  const cvBenign = evidence.some((e) => e.source === 'CLINVAR' && e.category === 'PATHOGENICITY' && /benign/i.test(e.significance ?? '') && !/conflict/i.test(e.significance ?? ''));
  if (f.maxPop >= 0.01 || cvBenign) {
    return { lens: 'somatic', tier: 'Tier IV', basis: [f.maxPop >= 0.01 ? `Common in gnomAD (max population AF ${fmt(f.maxPop)}) — likely germline polymorphism` : 'ClinVar benign/likely benign'] };
  }
  const coding = (ann.consequences ?? []).some((c) => /missense|stop_gained|frameshift|inframe|splice_(acceptor|donor)|start_lost|stop_lost/.test(c));
  if (ann.gene && CANCER_GENES.has(ann.gene) && coding) {
    return { lens: 'somatic', tier: 'Tier III', basis: [`${ann.consequence} in cancer gene ${ann.gene} with no documented clinical evidence`] };
  }
  return { lens: 'somatic', tier: 'Tier IV', basis: ['Not in a known cancer gene or not protein-altering'] };
}

/** Default "include in report" decision; analysts can change it. */
export function defaultReportable(sampleType: string, g?: GermlineCall, s?: SomaticCall): boolean {
  if (s && (s.tier === 'Tier I' || s.tier === 'Tier II')) return true;
  if (g && (g.classification === 'Pathogenic' || g.classification === 'Likely pathogenic')) return true;
  if (sampleType !== 'tumor' && g?.classification === 'Uncertain significance' && g.points >= 3) return true;
  return false;
}

const fmt = (x: number) => (x === 0 ? '0' : x < 0.001 ? x.toExponential(1) : x.toFixed(4));
const dedupe = (a: string[]) => [...new Set(a)];
