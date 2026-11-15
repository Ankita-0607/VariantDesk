import { Injectable } from '@nestjs/common';
import { config } from '../common/config';
import { KbHttpService } from './http.service';
import { Annotation, EvidenceDraft, VariantKey } from './types';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export function reviewStars(status?: string): number {
  const s = (status ?? '').toLowerCase();
  if (s.includes('practice guideline')) return 4;
  if (s.includes('expert panel')) return 3;
  if (s.includes('no assertion') || s.includes('no classification')) return 0;
  if (s.includes('multiple submitters') && s.includes('no conflicts')) return 2;
  if (s.includes('criteria provided')) return 1;
  return 0;
}

const REFSEQ_CHR38: Record<string, string> = {
  '1': 'NC_000001.11', '2': 'NC_000002.12', '3': 'NC_000003.12', '4': 'NC_000004.12', '5': 'NC_000005.10',
  '6': 'NC_000006.12', '7': 'NC_000007.14', '8': 'NC_000008.11', '9': 'NC_000009.12', '10': 'NC_000010.11',
  '11': 'NC_000011.10', '12': 'NC_000012.12', '13': 'NC_000013.11', '14': 'NC_000014.9', '15': 'NC_000015.10',
  '16': 'NC_000016.10', '17': 'NC_000017.11', '18': 'NC_000018.10', '19': 'NC_000019.10', '20': 'NC_000020.11',
  '21': 'NC_000021.9', '22': 'NC_000022.11', X: 'NC_000023.11', Y: 'NC_000024.10', MT: 'NC_012920.1',
};

/** ClinVar via NCBI E-utilities: germline classification, somatic oncogenicity and clinical impact. */
@Injectable()
export class ClinVarClient {
  constructor(private readonly http: KbHttpService) {}

  private key() {
    return config.kb.ncbiApiKey ? `&api_key=${config.kb.ncbiApiKey}` : '';
  }

  async lookup(v: VariantKey, ann?: Annotation): Promise<EvidenceDraft[]> {
    const field = v.build === 'GRCh38' ? 'chrpos38' : 'chrpos37';
    // Indels are indexed by ClinVar at the affected bases, not the VCF anchor base → search a small window.
    const isIndel = v.ref.length !== v.alt.length;
    const span = isIndel ? `${v.pos}:${v.pos + Math.max(v.ref.length, v.alt.length)}` : `${v.pos}`;
    const term = encodeURIComponent(`${v.chrom}[chr] AND ${span}[${field}]`);
    const search = await this.http.json<any>('CLINVAR', `${EUTILS}/esearch.fcgi?db=clinvar&retmode=json&retmax=50&term=${term}${this.key()}`);
    const ids: string[] = search.data?.esearchresult?.idlist ?? [];
    if (!ids.length) return [];
    const sum = await this.http.json<any>('CLINVAR', `${EUTILS}/esummary.fcgi?db=clinvar&retmode=json&id=${ids.join(',')}${this.key()}`);
    const result = sum.data?.result ?? {};
    const records = ids.map((id) => result[id]).filter(Boolean).filter((r) => matchesVariant(r, v, ann));
    return records.flatMap((r) => toEvidence(r, sum.fetchedAt));
  }
}

export function matchesVariant(rec: any, v: VariantKey, ann?: Annotation): boolean {
  const vs = rec.variation_set?.[0];
  if (!vs) return false;
  if (v.build === 'GRCh38' && vs.canonical_spdi && v.ref.length === 1 && v.alt.length === 1) {
    const acc = REFSEQ_CHR38[v.chrom];
    return vs.canonical_spdi === `${acc}:${v.pos - 1}:${v.ref}:${v.alt}`;
  }
  // Indels, or GRCh37: compare cDNA change against the VEP HGVS (transcript-agnostic suffix).
  const cdot = ann?.hgvsc?.split(':')[1];
  const name: string = vs.variation_name ?? rec.title ?? '';
  if (cdot && ann?.gene && name.includes(`(${ann.gene})`) && name.includes(cdot)) return true;
  if (cdot && vs.cdna_change === cdot) return true;
  return false;
}

function traits(cls: any): string | undefined {
  const names = (cls?.trait_set ?? []).map((t: any) => t.trait_name).filter((n: string) => n && n !== 'not provided');
  return names.length ? names.slice(0, 6).join('; ') : undefined;
}

function toEvidence(rec: any, fetchedAt: Date): EvidenceDraft[] {
  const url = `https://www.ncbi.nlm.nih.gov/clinvar/variation/${rec.uid}/`;
  const out: EvidenceDraft[] = [];
  const base = { source: 'CLINVAR' as const, sourceId: `VCV${String(rec.uid).padStart(9, '0')}`, url, retrievedAt: fetchedAt, sourceVersion: 'ClinVar (live E-utilities)' };
  const g = rec.germline_classification;
  if (g?.description) {
    const stars = reviewStars(g.review_status);
    out.push({
      ...base,
      category: 'PATHOGENICITY',
      significance: g.description,
      level: `${stars}★`,
      disease: traits(g),
      summary: `ClinVar germline classification: ${g.description} (${g.review_status}; last evaluated ${g.last_evaluated?.slice(0, 10) ?? 'n/a'}). ${rec.title}`,
      meta: { stars, reviewStatus: g.review_status, title: rec.title },
    });
  }
  const o = rec.oncogenicity_classification;
  if (o?.description) {
    out.push({
      ...base,
      category: 'ONCOGENICITY',
      significance: o.description,
      level: `${reviewStars(o.review_status)}★`,
      disease: traits(o),
      summary: `ClinVar somatic oncogenicity: ${o.description} (${o.review_status}).`,
      meta: { stars: reviewStars(o.review_status), reviewStatus: o.review_status },
    });
  }
  const c = rec.clinical_impact_classification;
  if (c?.description) {
    out.push({
      ...base,
      category: 'THERAPEUTIC',
      significance: c.description,
      level: c.description.match(/Tier\s+\w+/)?.[0],
      disease: traits(c),
      summary: `ClinVar somatic clinical impact: ${c.description} (${c.review_status}).`,
      meta: { stars: reviewStars(c.review_status), reviewStatus: c.review_status, clinicalImpact: true },
    });
  }
  return out;
}
