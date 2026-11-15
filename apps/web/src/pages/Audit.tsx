import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, AiRun, AuditEvent } from '../api';
import { Badge, ErrorBox, fmtDate } from '../components/ui';

export function AuditPage() {
  const [verify, setVerify] = useState<{ ok: boolean; checked: number; brokenAt?: number } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const events = useQuery({ queryKey: ['audit'], queryFn: () => api.get<AuditEvent[]>('/audit?limit=500') });
  const runs = useQuery({ queryKey: ['ai-runs'], queryFn: () => api.get<AiRun[]>('/audit/ai-runs?limit=300') });
  const stats = (runs.data ?? []).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  return (
    <div className="stack">
      <div className="spread">
        <h1>Audit</h1>
        <button onClick={() => api.get<any>('/audit/verify').then(setVerify).catch(setErr)}>Verify audit chain integrity</button>
      </div>
      <ErrorBox error={err} />
      {verify && (
        <div className={`alert ${verify.ok ? 'ok' : 'danger'}`}>
          {verify.ok ? `Hash chain intact — ${verify.checked} events verified.` : `Chain broken at event #${verify.brokenAt}. The audit log has been altered outside the application.`}
        </div>
      )}
      <div className="card">
        <h2>AI runs</h2>
        <div className="row small" style={{ marginBottom: '0.5rem' }}>
          {Object.entries(stats).map(([k, v]) => <Badge key={k} tone={k === 'PASSED' ? 'ok' : k === 'DISABLED' ? 'outline' : 'warn'}>{k}: {v}</Badge>)}
        </div>
        <AiRunsTable runs={runs.data ?? []} />
      </div>
      <div className="card">
        <h2>Events</h2>
        <AuditTable events={events.data ?? []} showCase />
      </div>
    </div>
  );
}

export function AuditTable({ events, showCase }: { events: AuditEvent[]; showCase?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!events.length) return <div className="empty small">No events.</div>;
  return (
    <div className="table-wrap">
      <table className="small">
        <thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Entity</th>{showCase && <th>Case</th>}<th>Reason</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <Fragment key={e.seq}>
              <tr className="clickable" onClick={() => setOpen(open === e.seq ? null : e.seq)}>
                <td className="mono">{e.seq}</td>
                <td>{fmtDate(e.at)}</td>
                <td>{e.actorEmail ?? <span className="muted">system</span>} {e.actorRole && <span className="muted">({e.actorRole})</span>}</td>
                <td><code>{e.action}</code></td>
                <td>{e.entityType}</td>
                {showCase && <td className="mono">{(e as any).caseId?.slice(-6) ?? ''}</td>}
                <td>{e.reason}</td>
              </tr>
              {open === e.seq && (
                <tr>
                  <td colSpan={showCase ? 7 : 6}>
                    <div className="grid2">
                      <div><strong>Before</strong><pre>{JSON.stringify(e.before, null, 2)}</pre></div>
                      <div><strong>After</strong><pre>{JSON.stringify(e.after, null, 2)}</pre></div>
                    </div>
                    <div className="hint mono">hash {e.hash}</div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_TONE: Record<string, any> = { PASSED: 'ok', FALLBACK: 'warn', BLOCKED: 'danger', ERROR: 'danger', DISABLED: 'outline' };

export function AiRunsTable({ runs }: { runs: AiRun[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!runs.length) return <div className="empty small">No AI runs.</div>;
  return (
    <div className="table-wrap">
      <table className="small">
        <thead><tr><th>When</th><th>Task</th><th>Model</th><th>Status</th><th>Guardrails</th><th>Human decision</th><th>Latency</th></tr></thead>
        <tbody>
          {runs.map((r) => {
            const failed = r.guardrails.filter((g) => !g.passed);
            return (
              <Fragment key={r.id}>
                <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td>{fmtDate(r.at)}</td>
                  <td><code>{r.task}</code></td>
                  <td>{r.model ?? r.provider}</td>
                  <td><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>{r.attempts > 1 && <span className="muted"> ×{r.attempts}</span>}</td>
                  <td>{r.guardrails.length ? (failed.length ? <Badge tone="danger">{failed.length} failed</Badge> : <Badge tone="ok">{r.guardrails.length} passed</Badge>) : '—'}</td>
                  <td>{r.humanDecision.replace('_', ' ').toLowerCase()}</td>
                  <td>{r.latencyMs != null ? `${(r.latencyMs / 1000).toFixed(1)}s` : '—'}</td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td colSpan={7}>
                      <div className="small">Prompt version <code>{r.promptVersion}</code>{r.tokensIn ? ` · ${r.tokensIn} in / ${r.tokensOut} out tokens` : ''}{r.error && <> · <span style={{ color: 'var(--danger)' }}>{r.error}</span></>}</div>
                      {r.guardrails.length > 0 && (
                        <ul className="small">{r.guardrails.map((g, i) => <li key={i}>{g.passed ? '✓' : '✗'} <code>{g.name}</code> {g.detail && <span className="muted">— {g.detail}</span>}</li>)}</ul>
                      )}
                      <div className="grid2">
                        <div><strong>Input sent</strong><pre>{JSON.stringify(r.input, null, 2)}</pre></div>
                        <div><strong>Output used</strong><pre>{JSON.stringify(r.output, null, 2)}</pre>{r.outputRaw && <details><summary className="small">Raw model output</summary><pre>{r.outputRaw}</pre></details>}</div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
