/**
 * Curated tumour-type vocabulary (OncoTree-style codes) used to
 *  - normalise free-text diagnoses (by keywords, and by the LLM restricted to this list),
 *  - decide whether a piece of evidence is "same tumour type" for AMP tiering,
 *  - build trial search terms.
 */
export interface TumorType {
  code: string;
  label: string;
  keywords: string[];
  trialTerm: string;
}

export const TUMOR_TYPES: TumorType[] = [
  { code: 'NSCLC', label: 'Non-small cell lung cancer', keywords: ['non-small cell', 'nsclc', 'lung adenocarcinoma', 'lung squamous', 'lung cancer', 'lung carcinoma', 'lung'], trialTerm: 'Non-small Cell Lung Cancer' },
  { code: 'SCLC', label: 'Small cell lung cancer', keywords: ['small cell lung', 'sclc'], trialTerm: 'Small Cell Lung Cancer' },
  { code: 'BRCA', label: 'Breast cancer', keywords: ['breast'], trialTerm: 'Breast Cancer' },
  { code: 'COADREAD', label: 'Colorectal cancer', keywords: ['colorectal', 'colon', 'rectal', 'rectum', 'crc'], trialTerm: 'Colorectal Cancer' },
  { code: 'MEL', label: 'Melanoma', keywords: ['melanoma'], trialTerm: 'Melanoma' },
  { code: 'THY', label: 'Thyroid cancer', keywords: ['thyroid'], trialTerm: 'Thyroid Cancer' },
  { code: 'OVT', label: 'Ovarian / fallopian tube / primary peritoneal cancer', keywords: ['ovarian', 'ovary', 'fallopian', 'peritoneal'], trialTerm: 'Ovarian Cancer' },
  { code: 'PAAD', label: 'Pancreatic cancer', keywords: ['pancrea'], trialTerm: 'Pancreatic Cancer' },
  { code: 'PRAD', label: 'Prostate cancer', keywords: ['prostat'], trialTerm: 'Prostate Cancer' },
  { code: 'GIST', label: 'Gastrointestinal stromal tumour', keywords: ['gastrointestinal stromal', 'gist'], trialTerm: 'Gastrointestinal Stromal Tumor' },
  { code: 'GLIOMA', label: 'Glioma / glioblastoma', keywords: ['glioma', 'glioblastoma', 'astrocytoma', 'oligodendroglioma', 'gbm'], trialTerm: 'Glioma' },
  { code: 'AML', label: 'Acute myeloid leukaemia', keywords: ['acute myeloid', 'aml'], trialTerm: 'Acute Myeloid Leukemia' },
  { code: 'CML', label: 'Chronic myeloid leukaemia', keywords: ['chronic myeloid', 'cml'], trialTerm: 'Chronic Myeloid Leukemia' },
  { code: 'ALL', label: 'Acute lymphoblastic leukaemia', keywords: ['acute lymphoblastic', 'b-all', 't-all'], trialTerm: 'Acute Lymphoblastic Leukemia' },
  { code: 'MDS', label: 'Myelodysplastic syndrome', keywords: ['myelodysplastic', 'mds'], trialTerm: 'Myelodysplastic Syndromes' },
  { code: 'BLCA', label: 'Urothelial / bladder cancer', keywords: ['bladder', 'urothelial'], trialTerm: 'Urothelial Carcinoma' },
  { code: 'STAD', label: 'Gastric / gastro-oesophageal cancer', keywords: ['gastric', 'stomach', 'gastroesophageal', 'gastro-oesophageal'], trialTerm: 'Gastric Cancer' },
  { code: 'ESCA', label: 'Oesophageal cancer', keywords: ['esophag', 'oesophag'], trialTerm: 'Esophageal Cancer' },
  { code: 'HNSC', label: 'Head and neck squamous cell carcinoma (incl. oral cavity)', keywords: ['head and neck', 'oral cavity', 'oral cancer', 'buccal', 'tongue', 'laryn', 'pharyn', 'hnscc'], trialTerm: 'Head and Neck Squamous Cell Carcinoma' },
  { code: 'CHOL', label: 'Cholangiocarcinoma / biliary tract cancer', keywords: ['cholangio', 'biliary', 'gallbladder'], trialTerm: 'Cholangiocarcinoma' },
  { code: 'HCC', label: 'Hepatocellular carcinoma', keywords: ['hepatocellular', 'liver cancer', 'hcc'], trialTerm: 'Hepatocellular Carcinoma' },
  { code: 'UCEC', label: 'Endometrial cancer', keywords: ['endometri', 'uterine'], trialTerm: 'Endometrial Cancer' },
  { code: 'CESC', label: 'Cervical cancer', keywords: ['cervical', 'cervix'], trialTerm: 'Cervical Cancer' },
  { code: 'RCC', label: 'Renal cell carcinoma', keywords: ['renal', 'kidney'], trialTerm: 'Renal Cell Carcinoma' },
  { code: 'LYMPH', label: 'Lymphoma', keywords: ['lymphoma'], trialTerm: 'Lymphoma' },
  { code: 'MM', label: 'Multiple myeloma', keywords: ['myeloma'], trialTerm: 'Multiple Myeloma' },
  { code: 'SARC', label: 'Sarcoma', keywords: ['sarcoma'], trialTerm: 'Sarcoma' },
  { code: 'SOLID', label: 'Solid tumour, other / unspecified', keywords: ['solid tumor', 'solid tumour', 'carcinoma', 'cancer', 'neoplasm', 'malignan'], trialTerm: 'Solid Tumor' },
  { code: 'HEREDITARY', label: 'Hereditary / germline indication (no cancer diagnosis)', keywords: ['hereditary', 'family history', 'carrier', 'predisposition', 'screening'], trialTerm: '' },
  { code: 'UNKNOWN', label: 'Unknown / not provided', keywords: [], trialTerm: '' },
];

export const TUMOR_CODES = TUMOR_TYPES.map((t) => t.code) as [string, ...string[]];
export const tumorByCode = (code?: string) => TUMOR_TYPES.find((t) => t.code === code);

/** Keyword-based normalisation; returns the most specific match (earliest in list wins on ties). */
export function normalizeDiagnosisByRules(diagnosis: string, indication = ''): TumorType {
  // The diagnosis wins; the indication is only consulted when the diagnosis is empty or unrecognised.
  const fromDx = matchKeywords(diagnosis);
  if (fromDx.code !== 'UNKNOWN') return fromDx;
  return matchKeywords(indication);
}

function matchKeywords(text: string): TumorType {
  const t = (text ?? '').toLowerCase();
  if (!t.trim()) return tumorByCode('UNKNOWN')!;
  let best: { tt: TumorType; len: number } | undefined;
  // Specific tumour types first; the generic SOLID bucket only if nothing specific matched.
  for (const tt of TUMOR_TYPES) {
    if (tt.code === 'SOLID') continue;
    for (const k of tt.keywords) {
      if (t.includes(k) && (!best || k.length > best.len)) best = { tt, len: k.length };
    }
  }
  if (best) return best.tt;
  const solid = tumorByCode('SOLID')!;
  return solid.keywords.some((k) => t.includes(k)) ? solid : tumorByCode('UNKNOWN')!;
}

const PAN_CANCER = ['cancer', 'solid tumor', 'solid tumour', 'neoplasm', 'carcinoma'];

/** Does an evidence disease name refer to the patient's tumour type? Pan-cancer evidence counts as a match. */
export function diseaseMatches(evidenceDisease: string | undefined, tumorCode: string | undefined): boolean {
  if (!evidenceDisease || !tumorCode) return false;
  const d = evidenceDisease.toLowerCase().trim();
  if (PAN_CANCER.includes(d)) return true;
  const tt = tumorByCode(tumorCode);
  if (!tt || tt.code === 'SOLID' || tt.code === 'UNKNOWN' || tt.code === 'HEREDITARY') return false;
  if (tt.code === 'NSCLC' && d.includes('small cell') && !d.includes('non-small')) return false;
  return tt.keywords.some((k) => d.includes(k));
}
