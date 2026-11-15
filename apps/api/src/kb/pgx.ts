import { Injectable } from '@nestjs/common';
import { KbHttpService } from './http.service';

/**
 * Lightweight star-allele caller for CPIC level-A genes whose key alleles are single SNVs.
 * Positions are GRCh38 (from CPIC sequence_location); rsIDs make it build-independent.
 * It deliberately does NOT call CYP2D6, HLA, UGT1A1 (*28 TA-repeat) or CYP2B6, which need
 * CNV/haplotype-aware tools (e.g. PharmCAT, Stargazer) — those are reported as "not assessed".
 */
export interface AlleleDef {
  gene: string;
  allele: string;
  rsId: string;
  chrom: string;
  pos38: number;
  ref: string;
  alt: string;
  /** DPYD only: CPIC activity value of the allele */
  activity?: number;
}

export const ALLELE_DEFS: AlleleDef[] = [
  { gene: 'CYP2C19', allele: '*2', rsId: 'rs4244285', chrom: '10', pos38: 94781859, ref: 'G', alt: 'A' },
  { gene: 'CYP2C19', allele: '*3', rsId: 'rs4986893', chrom: '10', pos38: 94780653, ref: 'G', alt: 'A' },
  { gene: 'CYP2C19', allele: '*17', rsId: 'rs12248560', chrom: '10', pos38: 94761900, ref: 'C', alt: 'T' },
  { gene: 'CYP2C9', allele: '*2', rsId: 'rs1799853', chrom: '10', pos38: 94942290, ref: 'C', alt: 'T' },
  { gene: 'CYP2C9', allele: '*3', rsId: 'rs1057910', chrom: '10', pos38: 94981296, ref: 'A', alt: 'C' },
  { gene: 'DPYD', allele: 'c.1905+1G>A (*2A)', rsId: 'rs3918290', chrom: '1', pos38: 97450058, ref: 'C', alt: 'T', activity: 0 },
  { gene: 'DPYD', allele: 'c.1679T>G (*13)', rsId: 'rs55886062', chrom: '1', pos38: 97515787, ref: 'A', alt: 'C', activity: 0 },
  { gene: 'DPYD', allele: 'c.2846A>T', rsId: 'rs67376798', chrom: '1', pos38: 97082391, ref: 'T', alt: 'A', activity: 0.5 },
  { gene: 'DPYD', allele: 'c.1129-5923C>G, c.1236G>A (HapB3)', rsId: 'rs75017182', chrom: '1', pos38: 97579893, ref: 'G', alt: 'C', activity: 0.5 },
  { gene: 'TPMT', allele: '*2', rsId: 'rs1800462', chrom: '6', pos38: 18143724, ref: 'C', alt: 'G' },
  { gene: 'TPMT', allele: '*3B', rsId: 'rs1800460', chrom: '6', pos38: 18138997, ref: 'C', alt: 'T' },
  { gene: 'TPMT', allele: '*3C', rsId: 'rs1142345', chrom: '6', pos38: 18130687, ref: 'T', alt: 'C' },
  { gene: 'NUDT15', allele: '*3', rsId: 'rs116855232', chrom: '13', pos38: 48045719, ref: 'C', alt: 'T' },
  { gene: 'SLCO1B1', allele: '*5', rsId: 'rs4149056', chrom: '12', pos38: 21178615, ref: 'T', alt: 'C' },
  { gene: 'CYP3A5', allele: '*3', rsId: 'rs776746', chrom: '7', pos38: 99672916, ref: 'T', alt: 'C' },
  { gene: 'VKORC1', allele: 'rs9923231 variant (T)', rsId: 'rs9923231', chrom: '16', pos38: 31096368, ref: 'C', alt: 'T' },
];

export const CALLED_GENES = ['CYP2C19', 'CYP2C9', 'DPYD', 'TPMT', 'NUDT15', 'SLCO1B1', 'CYP3A5', 'VKORC1'];
export const NOT_ASSESSED_GENES = ['CYP2D6', 'HLA-A', 'HLA-B', 'UGT1A1', 'CYP2B6', 'G6PD', 'CYP4F2', 'IFNL3', 'RYR1', 'CACNA1S'];

export interface PgxInputVariant {
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  rsIds: string[];
  zygosity?: string;
}

export interface DiplotypeCall {
  gene: string;
  diplotype?: string;
  activityScore?: string;
  calledVariants: Array<{ allele: string; rsId: string; copies: number }>;
  caveats: string[];
}

const COMMON_CAVEAT =
  'Alleles not present in the VCF are assumed to be reference. Confirm the defining positions were sequenced (gVCF or panel BED); otherwise the call may be incomplete.';

export function callDiplotypes(variants: PgxInputVariant[], build: 'GRCh37' | 'GRCh38'): DiplotypeCall[] {
  const hits = new Map<string, Array<{ def: AlleleDef; copies: number }>>();
  for (const def of ALLELE_DEFS) {
    const v = variants.find(
      (x) =>
        x.rsIds.includes(def.rsId) ||
        (build === 'GRCh38' && x.chrom === def.chrom && x.pos === def.pos38 && x.ref === def.ref && x.alt === def.alt),
    );
    if (!v) continue;
    const copies = v.zygosity === 'homozygous' ? 2 : 1;
    hits.set(def.gene, [...(hits.get(def.gene) ?? []), { def, copies }]);
  }

  return CALLED_GENES.map((gene) => {
    const found = hits.get(gene) ?? [];
    const caveats = [COMMON_CAVEAT];
    const calledVariants = found.map((f) => ({ allele: f.def.allele, rsId: f.def.rsId, copies: f.copies }));
    let alleles: string[] = [];
    for (const f of found) for (let i = 0; i < f.copies; i++) alleles.push(f.def.allele);

    if (gene === 'TPMT' && alleles.includes('*3B') && alleles.includes('*3C')) {
      // *3B + *3C on the same chromosome = *3A (by far the most common haplotype).
      const pairs = Math.min(alleles.filter((a) => a === '*3B').length, alleles.filter((a) => a === '*3C').length);
      for (let i = 0; i < pairs; i++) {
        alleles.splice(alleles.indexOf('*3B'), 1);
        alleles.splice(alleles.indexOf('*3C'), 1);
        alleles.push('*3A');
      }
      caveats.push('*3B and *3C were assumed to be in cis (*3A). Phase is not determined by short-read VCF; *3B/*3C in trans is possible but rare.');
    }

    if (gene === 'VKORC1') {
      const n = alleles.length;
      return {
        gene,
        diplotype: n === 0 ? 'rs9923231 C/C' : n === 1 ? 'rs9923231 C/T' : 'rs9923231 T/T',
        calledVariants,
        caveats: [...caveats, 'Warfarin dosing requires combining VKORC1 with CYP2C9 (and CYP4F2) in a dosing algorithm; no stand-alone recommendation is given.'],
      };
    }

    if (gene === 'DPYD') {
      if (alleles.length > 2) {
        return { gene, calledVariants, caveats: [...caveats, 'More than two decreased/no-function DPYD variants found; phase unknown. Manual review required.'] };
      }
      const values = alleles.map((a) => ALLELE_DEFS.find((d) => d.allele === a)!.activity!);
      while (values.length < 2) values.push(1);
      const score = values.reduce((s, x) => s + x, 0);
      const names = [...alleles];
      while (names.length < 2) names.push('Reference');
      return { gene, diplotype: names.join('/'), activityScore: score.toFixed(1), calledVariants, caveats };
    }

    if (gene === 'CYP3A5' && alleles.length === 0) {
      caveats.push('No *3 allele detected → *1/*1 (expressor). Note *3 is the most common allele in many populations; verify coverage of rs776746.');
    }

    if (alleles.length > 2) {
      return { gene, calledVariants, caveats: [...caveats, 'More than two star alleles detected; diplotype is indeterminate without phasing.'] };
    }
    while (alleles.length < 2) alleles.unshift('*1');
    if (alleles.length === 2 && alleles.every((a) => a !== '*1')) {
      if (new Set(alleles).size === 2) caveats.push('Two different non-reference alleles assumed to be on opposite chromosomes (trans).');
    }
    alleles = sortAlleles(alleles);
    return { gene, diplotype: alleles.join('/'), calledVariants, caveats };
  });
}

function sortAlleles(a: string[]) {
  const n = (s: string) => Number(s.replace(/\D/g, '')) || 0;
  return [...a].sort((x, y) => n(x) - n(y) || x.localeCompare(y));
}

export interface PgxRecommendation {
  drug: string;
  recommendation: string;
  classification?: string;
  implication?: string;
  phenotype?: string;
  population?: string;
  guideline?: string;
  guidelineUrl?: string;
}

/** CPIC API: phenotype for a diplotype and the matching single-gene drug recommendations. */
@Injectable()
export class CpicClient {
  constructor(private readonly http: KbHttpService) {}
  private readonly base = 'https://api.cpicpgx.org/v1';

  async interpret(call: DiplotypeCall): Promise<{ phenotype?: string; recommendations: PgxRecommendation[]; lookupkey?: Record<string, string> }> {
    let lookupkey: Record<string, string> | undefined;
    let phenotype: string | undefined;
    if (call.gene === 'DPYD' && call.activityScore) {
      const as = Number(call.activityScore);
      phenotype = as >= 2 ? 'Normal Metabolizer' : as >= 1 ? 'Intermediate Metabolizer' : 'Poor Metabolizer';
      lookupkey = { DPYD: call.activityScore };
    } else if (call.diplotype && call.gene !== 'VKORC1') {
      const url = `${this.base}/diplotype?genesymbol=eq.${encodeURIComponent(call.gene)}&diplotype=eq.${encodeURIComponent(call.diplotype)}&select=generesult,lookupkey,totalactivityscore`;
      const { data } = await this.http.json<any[]>('CPIC', url);
      const row = data?.[0];
      if (row) {
        phenotype = row.generesult;
        lookupkey = typeof row.lookupkey === 'string' ? JSON.parse(row.lookupkey.replace(/'/g, '"')) : row.lookupkey;
        if (row.totalactivityscore && row.totalactivityscore !== 'n/a') call.activityScore = row.totalactivityscore;
      }
    }
    if (!lookupkey) return { phenotype, recommendations: [] };
    const sel = 'drugrecommendation,classification,implications,phenotypes,population,lookupkey,drug(name),guideline(name,url)';
    const url = `${this.base}/recommendation?select=${encodeURIComponent(sel)}&lookupkey=cs.${encodeURIComponent(JSON.stringify(lookupkey))}`;
    const { data } = await this.http.json<any[]>('CPIC', url);
    const recs = (data ?? [])
      // keep only single-gene recommendations — multi-gene ones need genes we did not call (e.g. CYP2D6)
      .filter((r) => Object.keys(r.lookupkey ?? {}).length === 1)
      .map((r) => ({
        drug: r.drug?.name ?? 'unknown',
        recommendation: r.drugrecommendation,
        classification: r.classification,
        implication: r.implications?.[call.gene],
        phenotype: r.phenotypes?.[call.gene] ?? phenotype,
        population: r.population,
        guideline: r.guideline?.name,
        guidelineUrl: r.guideline?.url,
      }));
    return { phenotype, recommendations: recs, lookupkey };
  }
}
