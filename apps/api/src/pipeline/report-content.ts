/** Shape of Report.content (editable narrative parts of a report version). */
export interface AiText {
  text: string;
  /** alias → Evidence.id, so [E1] in text links to a stored evidence row */
  citations: Record<string, string>;
  aiRunId?: string;
  /** PASSED (AI text), FALLBACK/BLOCKED/ERROR/DISABLED (template text), MANUAL (human-written) */
  origin: string;
  editedById?: string;
  editedAt?: string;
}

export interface ReportContent {
  summary: AiText;
  narratives: Record<string, AiText>;
  methodology: string;
  limitations: string;
  recommendations: string;
}

export const DEFAULT_LIMITATIONS = `This report is based on the variants provided in the submitted VCF file; variant calling quality, coverage and copy-number/structural variants were not assessed unless stated. Pharmacogenomic diplotypes are inferred from a limited set of defining variants, assume reference alleles where no variant is reported, and do not assess CYP2D6, HLA or other genes requiring copy-number or haplotype analysis. Classifications reflect the knowledge bases at the time of analysis and may change as evidence evolves. AI-assisted text was generated as a draft, checked by automated guardrails, and reviewed by laboratory staff. Clinical trial matches are a screening aid; eligibility is determined by the trial team. This report should be interpreted in the context of the patient's clinical findings and family history.`;

export function methodologyText(build: string, sources: string[], aiModel?: string | null) {
  return `Variants from the submitted VCF (${build}) were annotated with Ensembl VEP (MANE Select / canonical transcripts, gnomAD v4 population frequencies). Evidence was retrieved from: ${sources.join(', ')}. Germline variants were classified with an ACMG/AMP points-based framework (Tavtigian et al., 2020) with ClinGen SVI refinements; somatic variants were tiered per AMP/ASCO/CAP 2017 guidelines; pharmacogenomic recommendations follow CPIC guidelines. Recruiting clinical trials were identified from ClinicalTrials.gov and ordered by distance to the nearest recruiting site from the patient's approximate (3-digit postal prefix or city) location.${aiModel ? ` Draft narrative text and evidence prioritisation were assisted by a large language model (${aiModel}) under automated guardrails and human review.` : ''}`;
}
