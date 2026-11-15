import { detectPhi } from '../deid/phi';

/**
 * Guardrails applied to every AI task. Each returns a named pass/fail verdict that is stored
 * on the AiRun record, so reviewers and auditors can see exactly which checks ran.
 */
export interface GuardResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const HIGH_SPECIFICITY_PHI = new Set(['email', 'us_ssn', 'aadhaar', 'pan', 'mrn', 'name_label', 'phone', 'phone_in', 'street_address']);

/** Patient-derived text must contain no identifiers at all. */
export function guardPatientContext(patientText: string): GuardResult {
  const hits = detectPhi(patientText);
  return { name: 'input.no_phi_in_patient_context', passed: hits.length === 0, detail: hits.length ? `Found: ${[...new Set(hits.map((h) => h.type))].join(', ')}` : undefined };
}

/** Whole prompt (incl. public knowledge text) is checked for high-specificity identifiers only. */
export function guardPromptPhi(prompt: string): GuardResult {
  const hits = detectPhi(prompt).filter((h) => HIGH_SPECIFICITY_PHI.has(h.type));
  return { name: 'input.no_high_risk_identifiers', passed: hits.length === 0, detail: hits.length ? `Found: ${[...new Set(hits.map((h) => h.type))].join(', ')}` : undefined };
}

export function guardOutputPhi(text: string): GuardResult {
  const hits = detectPhi(text).filter((h) => HIGH_SPECIFICITY_PHI.has(h.type));
  return { name: 'output.no_identifiers', passed: hits.length === 0, detail: hits.length ? `Found: ${hits.map((h) => h.type).join(', ')}` : undefined };
}

/** Every cited evidence alias must exist in the evidence supplied to the model. */
export function guardCitations(text: string, cited: string[], allowed: Set<string>, requireAtLeastOne: boolean): GuardResult[] {
  const inline = [...text.matchAll(/\[(E\d+)\]/g)].map((m) => m[1]);
  const all = [...new Set([...cited, ...inline])];
  const unknown = all.filter((id) => !allowed.has(id));
  const results: GuardResult[] = [
    { name: 'output.citations_grounded', passed: unknown.length === 0, detail: unknown.length ? `Unknown evidence ids: ${unknown.join(', ')}` : undefined },
  ];
  if (requireAtLeastOne && allowed.size > 0) {
    results.push({ name: 'output.has_citation', passed: all.length > 0, detail: all.length ? undefined : 'Narrative cites no evidence' });
  }
  return results;
}

const DRUG_SUFFIX = /\b[a-z]{3,}(?:tinib|nib|lisib|ciclib|rafenib|parib|zumab|ximab|tumab|mumab|umab|mab|platin|taxel|rubicin|abine|trexate|olimus|degib|sidenib)\b/gi;

/** The model may only name drugs that appear in the supplied evidence / guidelines / medication list. */
export function guardDrugs(text: string, allowedDrugs: string[]): GuardResult {
  const allowed = new Set(allowedDrugs.flatMap((d) => d.toLowerCase().split(/[\s+/,()-]+/)).filter(Boolean));
  const mentioned = [...new Set([...text.matchAll(DRUG_SUFFIX)].map((m) => m[0].toLowerCase()))];
  const unsupported = mentioned.filter((d) => !allowed.has(d));
  return { name: 'output.drugs_supported_by_evidence', passed: unsupported.length === 0, detail: unsupported.length ? `Unsupported drugs: ${unsupported.join(', ')}` : undefined };
}

const DIRECTIVE = /\b(you should|the patient should|must (?:start|stop|take|receive|be treated)|we recommend (?:starting|stopping|prescribing)|prescribe\b|guarantee[sd]?|will cure|is cured|definitely (?:has|will)|100% (?:effective|certain))/i;
const DOSE = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|µg|g|ml|units?)(?:\/(?:kg|m2|m²|day))?\b/i;

/** Decision-support tone: no treatment orders, no doses, no certainty claims. */
export function guardTone(text: string, allowDoseText = ''): GuardResult[] {
  const d = text.match(DIRECTIVE);
  const dose = text.match(DOSE);
  const doseOk = !dose || allowDoseText.includes(dose[0]);
  return [
    { name: 'output.no_treatment_directives', passed: !d, detail: d ? `Directive phrase: "${d[0]}"` : undefined },
    { name: 'output.no_unsourced_dosing', passed: doseOk, detail: doseOk ? undefined : `Dose mentioned: "${dose![0]}"` },
  ];
}

export function guardLength(text: string, max: number): GuardResult {
  return { name: 'output.length', passed: text.length <= max, detail: text.length > max ? `${text.length} > ${max} chars` : undefined };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%<>=≤≥.]+/g, ' ').trim();

/** Quotes from eligibility criteria must actually occur in the trial text (no invented criteria). */
export function guardQuotes(quotes: string[], source: string): GuardResult {
  const src = norm(source);
  const missing = quotes.filter((q) => q && !src.includes(norm(q)));
  return { name: 'output.criteria_quotes_verbatim', passed: missing.length === 0, detail: missing.length ? `Not found in trial text: ${missing.map((m) => `"${m.slice(0, 60)}"`).join('; ')}` : undefined };
}
