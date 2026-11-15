import { ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../api';

export function Badge({ tone, children, title }: { tone?: 'ok' | 'warn' | 'danger' | 'info' | 'ai' | 'outline'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone ?? ''}`} title={title}>
      {children}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Modal({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose(): void; actions?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="alert danger" role="alert">
      <strong>{e.message ?? String(error)}</strong>
      {e.issues?.length ? (
        <ul>
          {e.issues.map((i, n) => (
            <li key={n}>
              {i.path ? <code>{i.path}</code> : null} {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      {e.body?.pending?.length ? <div className="small">Pending AI sections: {e.body.pending.map((p: any) => p.section).join(', ')}</div> : null}
    </div>
  );
}

const TONES: Record<string, 'ok' | 'warn' | 'danger' | 'info' | 'ai' | undefined> = {
  READY: 'ok', SIGNED: 'ok', PROCESSING: 'info', QUEUED: 'info', IN_REVIEW: 'warn', RETURNED: 'danger', FAILED: 'danger', DRAFT: undefined, SUPERSEDED: undefined,
};
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={TONES[status]}>{status.replace('_', ' ')}</Badge>;

export function classTone(c?: string): 'ok' | 'warn' | 'danger' | 'info' | undefined {
  if (!c) return undefined;
  if (/^Pathogenic|Tier I\b|^Tier I \(/.test(c)) return 'danger';
  if (/Likely pathogenic|Tier II/.test(c)) return 'warn';
  if (/Uncertain|Tier III/.test(c)) return 'info';
  if (/benign|Tier IV/i.test(c)) return 'ok';
  return undefined;
}

/** Shows where a piece of text came from: AI (passed guardrails), rule template, or human. */
export function OriginBadge({ origin, edited }: { origin: string; edited?: boolean }) {
  if (edited) return <Badge tone="info" title="Edited by a person">Human-edited</Badge>;
  if (origin === 'PASSED') return <Badge tone="ai" title="AI draft — passed all automated guardrails; needs human review">AI draft</Badge>;
  if (origin === 'MANUAL') return <Badge tone="info">Human-written</Badge>;
  const why: Record<string, string> = { FALLBACK: 'AI output failed guardrails', BLOCKED: 'AI call blocked by input guardrail', ERROR: 'AI provider error', DISABLED: 'AI disabled' };
  return <Badge tone="outline" title={why[origin] ?? ''}>Template{why[origin] ? ` (${why[origin]})` : ''}</Badge>;
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—');
export const fmtAf = (x?: number) => (x == null ? '—' : x === 0 ? '0' : x < 0.001 ? x.toExponential(1) : x.toFixed(4));
export const shortHgvs = (h?: string | null) => (h ? h.split(':').pop() : '');

/** Renders "[E3]" citation aliases as hoverable markers with the source. */
export function CitedText({ text, citations, evidence }: { text: string; citations: Record<string, string>; evidence: Record<string, { source: string; sourceId: string | null; summary: string }> }) {
  const parts = text.split(/(\[E\d+\])/g);
  return (
    <span className="text">
      {parts.map((p, i) => {
        const m = p.match(/^\[(E\d+)\]$/);
        if (!m) return <span key={i}>{p}</span>;
        const e = evidence[citations[m[1]]];
        return (
          <span key={i} className="cite" title={e ? `${e.source} ${e.sourceId ?? ''}: ${e.summary.slice(0, 200)}` : 'Evidence no longer active'}>
            [{e ? `${e.source} ${e.sourceId ?? ''}`.trim() : '?'}]
          </span>
        );
      })}
    </span>
  );
}
