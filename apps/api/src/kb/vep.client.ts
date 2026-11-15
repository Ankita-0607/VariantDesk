import { Injectable } from '@nestjs/common';
import { KbHttpService } from './http.service';
import { Annotation, VariantKey } from './types';
import { toProteinShort } from './protein';

const VEP_OPTS = 'hgvs=1&canonical=1&mane=1&af_gnomade=1&af_gnomadg=1&variant_class=1&numbers=1&protein=1';
const BATCH = 200; // Ensembl REST limit for POST /vep/:species/region

/** Ensembl VEP REST: transcript consequence, HGVS, gnomAD frequencies, colocated IDs. */
@Injectable()
export class VepClient {
  constructor(private readonly http: KbHttpService) {}

  base(build: 'GRCh37' | 'GRCh38') {
    return build === 'GRCh37' ? 'https://grch37.rest.ensembl.org' : 'https://rest.ensembl.org';
  }

  async annotate(variants: VariantKey[]): Promise<Map<string, Annotation>> {
    const out = new Map<string, Annotation>();
    if (!variants.length) return out;
    const build = variants[0].build;
    for (let i = 0; i < variants.length; i += BATCH) {
      const chunk = variants.slice(i, i + BATCH);
      const body = { variants: chunk.map((v) => `${v.chrom} ${v.pos} . ${v.ref} ${v.alt} . . .`) };
      const { data } = await this.http.json<any[]>('VEP', `${this.base(build)}/vep/homo_sapiens/region?${VEP_OPTS}`, {
        method: 'POST',
        body,
      });
      for (const rec of data) {
        const [chrom, pos, , ref, alt] = String(rec.input).split(' ');
        out.set(`${chrom}-${pos}-${ref}-${alt}`, parseVepRecord(rec, alt));
      }
    }
    return out;
  }
}

export function pickTranscript(tcs: any[] = []): any | undefined {
  const coding = tcs.filter((t) => t.biotype === 'protein_coding');
  return (
    tcs.find((t) => t.mane_select) ??
    coding.find((t) => t.canonical) ??
    tcs.find((t) => t.canonical) ??
    coding[0] ??
    tcs[0]
  );
}

export function parseVepRecord(rec: any, alt: string): Annotation {
  const tc = pickTranscript(rec.transcript_consequences);
  const popFreq: Record<string, number> = {};
  const rsIds: string[] = [];
  const pubmed = new Set<number>();
  let clinSig: string[] | undefined;
  for (const cv of rec.colocated_variants ?? []) {
    if (typeof cv.id === 'string' && cv.id.startsWith('rs')) rsIds.push(cv.id);
    const f = cv.frequencies?.[alt];
    if (f) for (const [k, v] of Object.entries(f)) if (typeof v === 'number') popFreq[k] = v;
    for (const p of cv.pubmed ?? []) pubmed.add(p);
    if (cv.clin_sig_allele) {
      clinSig = String(cv.clin_sig_allele)
        .split(';')
        .filter((s) => s.startsWith(`${alt}:`))
        .map((s) => s.slice(alt.length + 1));
    }
  }
  const hgvsp = tc?.hgvsp ? decodeURIComponent(tc.hgvsp) : undefined;
  return {
    gene: tc?.gene_symbol,
    transcript: tc?.transcript_id,
    maneSelect: tc?.mane_select,
    hgvsc: tc?.hgvsc,
    hgvsp,
    proteinShort: toProteinShort(hgvsp),
    consequence: tc?.consequence_terms?.[0] ?? rec.most_severe_consequence,
    consequences: tc?.consequence_terms ?? [],
    impact: tc?.impact,
    exon: tc?.exon,
    intron: tc?.intron,
    sift: tc?.sift_prediction,
    polyphen: tc?.polyphen_prediction,
    rsIds,
    popFreq,
    vepClinSig: clinSig,
    pubmedIds: [...pubmed].slice(0, 50),
  };
}
