/** Thin fetch wrapper: JSON in/out, bearer token, structured errors. */
const TOKEN_KEY = 'vd.token';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues: Array<{ path: string; message: string }> = [],
    public body: any = null,
  ) {
    super(message);
  }
}

export const getToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string | null) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null);
    window.location.assign('/login');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = typeof data?.message === 'string' ? data.message : Array.isArray(data?.message) ? data.message.join(', ') : res.statusText;
    throw new ApiError(res.status, msg, data?.issues ?? [], data);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string, b?: unknown) => request<T>('DELETE', p, b ?? {}),
  /** Fetches a PDF with auth and opens it in a new tab (token never goes in a URL). */
  async openPdf(path: string, init?: { method?: string; body?: unknown }) {
    const win = window.open('', '_blank');
    const res = await fetch(`/api${path}`, {
      method: init?.method ?? 'GET',
      headers: { Authorization: `Bearer ${getToken()}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      win?.close();
      const d = await res.json().catch(() => ({}));
      throw new ApiError(res.status, d.message ?? 'Could not render PDF', d.issues ?? []);
    }
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url;
    else window.location.assign(url);
  },
  async pdfUrl(path: string, body: unknown) {
    const res = await fetch(`/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new ApiError(res.status, d.message ?? 'Preview failed', d.issues ?? []);
    }
    return URL.createObjectURL(await res.blob());
  },
};

// ---------- types ----------
export type Role = 'ADMIN' | 'ANALYST' | 'LAB_DIRECTOR';
export interface User { id: string; email: string; name: string; role: Role }

export interface Evidence {
  id: string;
  variantId: string | null;
  source: string;
  sourceId: string | null;
  url: string | null;
  category: string;
  level: string | null;
  significance: string | null;
  direction: string | null;
  disease: string | null;
  therapies: string[];
  summary: string;
  citation: string | null;
  sourceVersion: string | null;
  retrievedAt: string | null;
  origin: 'AUTO' | 'MANUAL';
  status: 'ACTIVE' | 'DELETED';
  includeInReport: boolean;
  ai: { relevance: 'HIGH' | 'MEDIUM' | 'LOW'; rationale: string; aiRunId: string; method: 'ai' | 'rule'; decision: string } | null;
  deleteReason: string | null;
}

export interface Criterion { code: string; strength: string; direction: string; detail: string }
export interface Variant {
  id: string;
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  rsId: string | null;
  genotype: string | null;
  zygosity: string | null;
  vaf: number | null;
  depth: number | null;
  gene: string | null;
  transcript: string | null;
  hgvsc: string | null;
  hgvsp: string | null;
  proteinShort: string | null;
  consequence: string | null;
  impact: string | null;
  annotation: any;
  popFreq: Record<string, number> | null;
  classification: {
    germline?: { classification: string; points: number; criteria: Criterion[]; notes: string[] };
    somatic?: { tier: string; level?: string; basis: string[] };
  } | null;
  override: { germline?: string; somatic?: string; reason: string; by: string; at: string } | null;
  reportable: boolean;
  analystNote: string | null;
  evidence: Evidence[];
}

export interface CaseRow {
  id: string;
  caseCode: string;
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
  sampleType: string;
  createdAt: string;
  diagnosis: { label: string } | null;
  diagnosisText: string;
  variantCount: number;
  report: { status: string; version: number } | null;
}

export interface CaseDetail {
  id: string;
  caseCode: string;
  status: CaseRow['status'];
  progress: Array<{ step: string; detail?: string; at: string }>;
  error: string | null;
  sampleType: string;
  genomeBuild: string;
  assay: string | null;
  patient: any;
  location: { country: string; kind: string; value: string; label: string } | null;
  diagnosis: { code: string; label: string; method: string; confidence: string; rationale: string; ruleCode: string; agreement: boolean; needsReview: boolean; aiRunId: string } | null;
  vcfFileName: string;
  vcfStats: any;
  createdAt: string;
  counts: { variants: number; reportable: number; trials: number };
}

export interface Pgx {
  id: string;
  gene: string;
  diplotype: string | null;
  phenotype: string | null;
  activityScore: string | null;
  calledVariants: Array<{ allele: string; rsId: string; copies: number }>;
  caveats: string[];
  recommendations: Array<{ drug: string; recommendation: string; classification?: string; implication?: string; population?: string; guideline?: string; guidelineUrl?: string }>;
  includeInReport: boolean;
}

export interface Trial {
  id: string;
  nctId: string;
  title: string;
  phase: string | null;
  status: string | null;
  conditions: string[];
  interventions: string[];
  matchedTerms: string[];
  nearestSite: { facility?: string; city?: string; state?: string; country?: string; distanceKm?: number } | null;
  distanceKm: number | null;
  sites: Array<{ facility?: string; city?: string; state?: string; country?: string; distanceKm?: number }>;
  minAge: string | null;
  maxAge: string | null;
  sex: string | null;
  aiScreen: { verdict: string; reasons: Array<{ criterionQuote: string; assessment: string; note: string }>; method: 'ai' | 'rule'; aiRunId?: string; decision?: string } | null;
  includeInReport: boolean;
  hidden: boolean;
}

export interface AiText { text: string; citations: Record<string, string>; aiRunId?: string; origin: string; editedById?: string; editedAt?: string }
export interface Finding { variantId: string; gene: string | null; change: string; vaf: number | null; zygosity: string | null; classification: string; narrative?: AiText; therapies: string[] }
export interface ReportView {
  report: { id: string; version: number; status: string; templateId: string | null; reviewComment: string | null; submittedAt: string | null; signedAt: string | null; pdfSha256: string | null; submittedById: string | null };
  content: { summary: AiText; narratives: Record<string, AiText>; methodology: string; limitations: string; recommendations: string };
  somatic: Finding[];
  germline: Finding[];
  vus: Array<{ gene: string | null; change: string; classification: string }>;
  pgx: any[];
  trials: any[];
  evidence: Record<string, Evidence>;
  submittedBy?: string;
  signedBy?: string;
  ai: { used: boolean; model?: string };
  pendingAi: Array<{ section: string; aiRunId: string }>;
}

export interface AuditEvent { seq: number; at: string; actorEmail: string | null; actorRole: string | null; action: string; entityType: string; entityId: string | null; before: any; after: any; reason: string | null; hash: string }
export interface AiRun { id: string; at: string; task: string; provider: string; model: string | null; promptVersion: string; status: string; guardrails: Array<{ name: string; passed: boolean; detail?: string }>; input: any; output: any; outputRaw: string | null; error: string | null; latencyMs: number | null; tokensIn: number | null; tokensOut: number | null; attempts: number; humanDecision: string; decisionNote: string | null }

export interface Template {
  id: string;
  name: string;
  isDefault: boolean;
  theme: {
    primaryColor: string; accentColor: string; textColor: string; fontFamily: 'Helvetica' | 'Times' | 'Courier'; fontSize: number;
    labName: string; labAddress: string; accreditation: string; headerText: string; footerText: string; logoDataUrl: string; draftWatermark: boolean;
  };
  sections: Array<{ key: string; title: string; enabled: boolean }>;
  updatedAt?: string;
}
