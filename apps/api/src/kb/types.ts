/** Normalised evidence produced by any knowledge-base connector. */
export interface EvidenceDraft {
  source: 'CLINVAR' | 'CIVIC' | 'CPIC' | 'GNOMAD' | 'PUBMED' | 'VEP' | 'MANUAL';
  sourceId?: string;
  url?: string;
  category:
    | 'PATHOGENICITY'
    | 'ONCOGENICITY'
    | 'THERAPEUTIC'
    | 'PROGNOSTIC'
    | 'DIAGNOSTIC'
    | 'PGX'
    | 'POPULATION'
    | 'LITERATURE'
    | 'FUNCTIONAL'
    | 'OTHER';
  level?: string;
  significance?: string;
  direction?: string;
  disease?: string;
  therapies?: string[];
  summary: string;
  citation?: string;
  sourceVersion?: string;
  retrievedAt?: Date;
  /** connector-specific extras used by the rule engine (e.g. ClinVar review stars) */
  meta?: Record<string, unknown>;
}

export interface VariantKey {
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  build: 'GRCh37' | 'GRCh38';
}

export interface Annotation {
  gene?: string;
  transcript?: string;
  maneSelect?: string;
  hgvsc?: string;
  hgvsp?: string;
  proteinShort?: string;
  consequence?: string;
  consequences?: string[];
  impact?: string;
  exon?: string;
  intron?: string;
  sift?: string;
  polyphen?: string;
  rsIds: string[];
  popFreq: Record<string, number>;
  vepClinSig?: string[];
  pubmedIds: number[];
  raw?: unknown;
}
