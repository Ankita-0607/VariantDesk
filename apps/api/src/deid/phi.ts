/**
 * PHI / PII detector used in two places:
 *   1. on case intake — free-text fields are rejected if they look like identifiers;
 *   2. before any LLM call — the prompt payload is scanned and the call is blocked on a hit.
 * Covers HIPAA Safe Harbor identifiers relevant to free text, and Indian identifiers
 * (Aadhaar, PAN, +91 mobile numbers, 6-digit PIN codes) for DPDP Act compliance.
 * This is a safety net, not a guarantee: labs must still de-identify upstream.
 */
export interface PhiFinding {
  type: string;
  match: string;
}

const PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { type: 'us_ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'aadhaar', re: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  { type: 'pan', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { type: 'phone', re: /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g },
  { type: 'phone_in', re: /(?:\+91[\s-]?|\b0)?\b[6-9]\d{9}\b/g },
  { type: 'full_date', re: /\b(?:\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}|(?:19|20)\d{2}[/.-]\d{1,2}[/.-]\d{1,2})\b/g },
  { type: 'mrn', re: /\b(?:MRN|UHID|IP\s?No|Medical\s+Record)\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi },
  { type: 'name_label', re: /\b(?:patient\s+name|name\s*:|mr\.|mrs\.|ms\.|shri|smt\.?)\s+[A-Z][a-z]+/gi },
  { type: 'street_address', re: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Blvd|Nagar|Marg)\b/g },
  { type: 'zip5', re: /\b\d{5}(?:-\d{4})?\b/g },
  { type: 'pin6', re: /\b[1-9]\d{5}\b/g },
];

export function detectPhi(text: string): PhiFinding[] {
  if (!text) return [];
  const findings: PhiFinding[] = [];
  for (const { type, re } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) findings.push({ type, match: m[0] });
  }
  return findings;
}

/** Walks any JSON-like value and returns findings with their path. */
export function scanObject(value: unknown, path = '$'): Array<PhiFinding & { path: string }> {
  if (value == null) return [];
  if (typeof value === 'string') return detectPhi(value).map((f) => ({ ...f, path }));
  if (typeof value === 'number' || typeof value === 'boolean') return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => scanObject(v, `${path}[${i}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => scanObject(v, `${path}.${k}`));
}

export function redact(text: string): string {
  let out = text;
  for (const { type, re } of PATTERNS) out = out.replace(re, `[REDACTED:${type}]`);
  return out;
}
