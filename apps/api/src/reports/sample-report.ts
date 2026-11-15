import type { AssembledReport } from './reports.service';
import { DEFAULT_LIMITATIONS, methodologyText } from '../pipeline/report-content';
import { NOT_ASSESSED_GENES } from '../kb/pgx';

/** Fictional, clearly-labelled sample data used only for template previews. */
export function sampleReport(): AssembledReport {
  const ev = (id: string, source: string, sourceId: string, citation: string, url: string) =>
    [id, { id, source, sourceId, citation, url } as any] as const;
  return {
    report: { id: 'sample', caseId: 'sample', version: 1, status: 'DRAFT', submittedAt: null, signedAt: null } as any,
    case: { id: 'sample', caseCode: 'SAMPLE-0001', sampleType: 'tumor', genomeBuild: 'GRCh38', assay: 'Sample 50-gene solid tumour panel' },
    patient: { ageYears: 58, sex: 'female', diagnosis: 'Lung adenocarcinoma', indication: 'SAMPLE DATA — template preview', priorTherapies: [], currentMedications: [], ancestry: 'south_asian' },
    diagnosisLabel: 'Non-small cell lung cancer',
    content: {
      summary: { text: 'SAMPLE: A Tier I EGFR L858R variant was detected [E1], associated with sensitivity to EGFR tyrosine kinase inhibitors in non-small cell lung cancer [E2]. The patient is predicted to be a CYP2C19 intermediate metabolizer. 12 potentially relevant clinical trials were identified.', citations: { E1: 'e1', E2: 'e2' }, origin: 'PASSED' },
      narratives: { v1: { text: 'SAMPLE: EGFR c.2573T>G (p.L858R) is an activating mutation in the kinase domain [E1]. Level A evidence supports sensitivity to EGFR tyrosine kinase inhibitors such as osimertinib in NSCLC [E2].', citations: { E1: 'e1', E2: 'e2' }, origin: 'PASSED' } },
      methodology: methodologyText('GRCh38', ['ClinVar', 'CIViC', 'CPIC', 'PubMed'], 'sample-model'),
      limitations: DEFAULT_LIMITATIONS,
      recommendations: 'SAMPLE: Consider confirmation of germline status if clinically indicated.',
    },
    somatic: [{ variantId: 'v1', gene: 'EGFR', change: 'c.2573T>G p.L858R', vaf: 0.34, zygosity: 'heterozygous', classification: 'Tier I (Level A)', therapies: ['Osimertinib', 'Erlotinib'], narrative: undefined }].map((f) => ({ ...f, narrative: { text: 'SAMPLE: EGFR c.2573T>G (p.L858R) is an activating mutation in the kinase domain [E1]. Level A evidence supports sensitivity to EGFR tyrosine kinase inhibitors such as osimertinib in NSCLC [E2].', citations: { E1: 'e1', E2: 'e2' }, origin: 'PASSED' } })),
    germline: [],
    vus: [{ gene: 'ATM', change: 'c.1234A>G p.K412E', classification: 'Tier III' }],
    pgx: [{ gene: 'CYP2C19', diplotype: '*1/*2', phenotype: 'Intermediate Metabolizer', recommendations: [{ drug: 'clopidogrel', recommendation: 'SAMPLE recommendation text from CPIC.', classification: 'Strong' }] }],
    pgxNotAssessed: NOT_ASSESSED_GENES,
    trials: [{ nctId: 'NCT00000000', title: 'SAMPLE trial of an EGFR inhibitor in NSCLC', phase: 'Phase 2', nearest: { facility: 'Sample Cancer Centre', city: 'Pune', country: 'India' }, distanceKm: 12 }],
    evidenceById: new Map([
      ev('e1', 'CLINVAR', 'VCV000016609', 'ClinVar', 'https://www.ncbi.nlm.nih.gov/clinvar/'),
      ev('e2', 'CIVIC', 'EID000', 'Sample et al., 2020', 'https://civicdb.org'),
    ]),
    submittedBy: 'Sample Analyst',
    signedBy: undefined,
    ai: { used: true, model: 'sample-model' },
    pendingAi: [],
  };
}
