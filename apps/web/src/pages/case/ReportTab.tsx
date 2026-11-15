import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, AiText, CaseDetail, ReportView, Template } from '../../api';
import { useAiEnabled, useAuth } from '../../auth';
import { Badge, CitedText, classTone, ErrorBox, fmtDate, Modal, OriginBadge, Spinner, StatusBadge } from '../../components/ui';
import { useReportState } from './useLocked';

export function ReportTab({ caseDetail }: { caseDetail: CaseDetail }) {
  const caseId = caseDetail.id;
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const { query } = useReportState(caseId);
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/templates') });
  const [modal, setModal] = useState<null | 'return' | 'sign' | 'amend'>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['report', caseId] });
    qc.invalidateQueries({ queryKey: ['cases'] });
    qc.invalidateQueries({ queryKey: ['case-audit', caseId] });
  };
  if (query.isLoading) return <div className="empty"><Spinner /></div>;
  const r = query.data?.report;
  if (!r) return <div className="card empty">No report yet.</div>;
  const status = r.report.status;
  const editable = can('ANALYST') && (status === 'DRAFT' || status === 'RETURNED');
  const isSubmitter = r.report.submittedById === user?.id;

  const run = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setActionError(e);
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="spread">
          <div className="row">
            <h2 style={{ margin: 0 }}>Report v{r.report.version}</h2>
            <StatusBadge status={status} />
            {r.pendingAi.length > 0 && editable && <Badge tone="ai">{r.pendingAi.length} AI section(s) awaiting review</Badge>}
          </div>
          <div className="row">
            <select
              aria-label="Report template"
              value={r.report.templateId ?? ''}
              disabled={!editable}
              onChange={(e) => run(() => api.patch(`/reports/${r.report.id}/template`, { templateId: e.target.value }))}
              style={{ width: 'auto' }}
            >
              <option value="" disabled>Template…</option>
              {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
            </select>
            <button onClick={() => run(() => api.openPdf(`/reports/${r.report.id}/pdf`))}>{status === 'SIGNED' ? 'Download signed PDF' : 'Preview PDF'}</button>
            {editable && <button className="primary" onClick={() => run(() => api.post(`/reports/${r.report.id}/submit`))}>Submit for director review</button>}
            {can('LAB_DIRECTOR') && status === 'IN_REVIEW' && (
              <>
                <button onClick={() => setModal('return')}>Return to analyst</button>
                <button className="primary" disabled={isSubmitter} title={isSubmitter ? 'You submitted this report; another director must sign' : ''} onClick={() => setModal('sign')}>Sign & release</button>
              </>
            )}
            {can('LAB_DIRECTOR') && status === 'SIGNED' && <button onClick={() => setModal('amend')}>Create amendment</button>}
          </div>
        </div>
        <ErrorBox error={actionError} />
        {status === 'RETURNED' && r.report.reviewComment && <div className="alert warn" style={{ marginTop: '0.6rem' }}><strong>Returned by director:</strong> {r.report.reviewComment}</div>}
        {status === 'DRAFT' && r.report.reviewComment && <div className="alert info" style={{ marginTop: '0.6rem' }}>{r.report.reviewComment}</div>}
        {status === 'IN_REVIEW' && <div className="alert info" style={{ marginTop: '0.6rem' }}>Submitted by {r.submittedBy} on {fmtDate(r.report.submittedAt)}. Content is locked until signed or returned.</div>}
        {status === 'SIGNED' && <div className="alert ok" style={{ marginTop: '0.6rem' }}>Signed by {r.signedBy} on {fmtDate(r.report.signedAt)}. PDF SHA-256 <code>{r.report.pdfSha256?.slice(0, 16)}…</code> — this version is frozen.</div>}
        {query.data!.versions.length > 1 && (
          <div className="small muted" style={{ marginTop: '0.5rem' }}>
            Versions: {query.data!.versions.map((v: any) => (
              <button key={v.id} className="small ghost" onClick={() => run(() => api.openPdf(`/reports/${v.id}/pdf`))}>v{v.version} ({v.status.toLowerCase()})</button>
            ))}
          </div>
        )}
      </div>

      <AiSection title="Summary of results" sectionKey="summary" t={r.content.summary} report={r} editable={editable} onChange={refresh} />

      {[...r.somatic.map((f) => ({ ...f, lens: 'Somatic' })), ...r.germline.map((f) => ({ ...f, lens: 'Germline' }))].map((f) => (
        <AiSection
          key={f.variantId}
          title={<span className="row">{f.lens}: <strong>{f.gene}</strong> <span className="mono">{f.change}</span> <Badge tone={classTone(f.classification)}>{f.classification}</Badge>{f.vaf != null && <span className="muted small">VAF {(f.vaf * 100).toFixed(1)}%</span>}</span>}
          sectionKey={`narrative:${f.variantId}`}
          t={f.narrative ?? { text: '', citations: {}, origin: 'MANUAL' }}
          report={r}
          editable={editable}
          onChange={refresh}
          footer={f.therapies.length ? <div className="small muted">Therapies with associated evidence: {f.therapies.join(', ')}</div> : null}
        />
      ))}
      {r.somatic.length + r.germline.length === 0 && <div className="card muted">No variants are marked reportable. Use the Variants tab to include findings.</div>}

      <div className="card">
        <h3>Also included</h3>
        <div className="small">
          <strong>Pharmacogenomics:</strong> {r.pgx.length ? r.pgx.map((p: any) => `${p.gene} ${p.diplotype ?? ''} (${p.phenotype ?? '—'})`).join('; ') : 'none selected'}
        </div>
        <div className="small"><strong>Clinical trials:</strong> {r.trials.length ? r.trials.map((t: any) => t.nctId).join(', ') : 'none selected (tick “in report” in the Trials tab)'}</div>
        <div className="small"><strong>VUS / Tier III:</strong> {r.vus.length ? r.vus.map((v) => `${v.gene} ${v.change}`).join('; ') : 'none'}</div>
      </div>

      <PlainSection title="Comments / recommendations" sectionKey="recommendations" text={r.content.recommendations} reportId={r.report.id} editable={editable} onChange={refresh} />
      <PlainSection title="Methodology" sectionKey="methodology" text={r.content.methodology} reportId={r.report.id} editable={editable} onChange={refresh} />
      <PlainSection title="Limitations" sectionKey="limitations" text={r.content.limitations} reportId={r.report.id} editable={editable} onChange={refresh} />

      {modal === 'return' && <ReasonModal title="Return to analyst" label="What needs to change?" cta="Return" onClose={() => setModal(null)} onSubmit={(comment) => run(() => api.post(`/reports/${r.report.id}/return`, { comment })).then(() => setModal(null))} />}
      {modal === 'sign' && (
        <ReasonModal
          title="Sign and release report"
          label="Attestation"
          initial="I have reviewed this report, the supporting evidence and all AI-assisted content, and approve its release."
          cta="Sign"
          onClose={() => setModal(null)}
          onSubmit={(attestation) => run(() => api.post(`/reports/${r.report.id}/sign`, { attestation })).then(() => setModal(null))}
        />
      )}
      {modal === 'amend' && <ReasonModal title="Create amendment" label="Reason for amendment" cta="Create draft v+1" onClose={() => setModal(null)} onSubmit={(reason) => run(() => api.post(`/reports/${r.report.id}/amend`, { reason })).then(() => setModal(null))} />}
    </div>
  );
}

function AiSection({ title, sectionKey, t, report, editable, onChange, footer }: { title: React.ReactNode; sectionKey: string; t: AiText; report: ReportView; editable: boolean; onChange(): void; footer?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const aiOn = useAiEnabled();
  const [text, setText] = useState(t.text);
  const id = report.report.id;
  const pending = report.pendingAi.some((p) => p.section === (sectionKey === 'summary' ? 'summary' : sectionKey.replace('narrative:', '')));
  const save = useMutation({ mutationFn: () => api.patch(`/reports/${id}/content`, { section: sectionKey, text }), onSuccess: () => { setEditing(false); onChange(); } });
  const decide = useMutation({ mutationFn: (decision: string) => api.post(`/reports/${id}/ai-decision`, { section: sectionKey, decision }), onSuccess: onChange });
  const regen = useMutation({ mutationFn: () => api.post(`/reports/${id}/regenerate`, { target: sectionKey }), onSuccess: onChange });

  return (
    <div className="card">
      <div className="spread">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div className="row">
          <OriginBadge origin={t.origin} edited={!!t.editedById} />
          {pending && <Badge tone="warn">needs review</Badge>}
        </div>
      </div>
      {editing ? (
        <div style={{ marginTop: '0.6rem' }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} />
          <div className="hint">Citation markers like [E1] link to evidence; keep or remove them as needed.</div>
          <ErrorBox error={save.error} />
          <div className="row" style={{ marginTop: '0.4rem' }}>
            <button className="primary small" onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
            <button className="small" onClick={() => { setText(t.text); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p style={{ marginTop: '0.6rem' }}>{t.text ? <CitedText text={t.text} citations={t.citations} evidence={report.evidence} /> : <span className="muted">Empty — write this section{editable ? ' or regenerate with AI' : ''}.</span>}</p>
      )}
      {footer}
      {editable && !editing && (
        <div className="row" style={{ marginTop: '0.4rem' }}>
          {pending && (
            <>
              <button className="small primary" onClick={() => decide.mutate('ACCEPTED')}>Accept AI draft</button>
              <button className="small" onClick={() => decide.mutate('REJECTED')}>Reject</button>
            </>
          )}
          <button className="small" onClick={() => { setText(t.text); setEditing(true); }}>Edit</button>
          {aiOn && <button className="small ai" onClick={() => regen.mutate()} disabled={regen.isPending}>{regen.isPending ? 'Generating…' : '✦ Regenerate'}</button>}
        </div>
      )}
      <ErrorBox error={decide.error ?? regen.error} />
    </div>
  );
}

function PlainSection({ title, sectionKey, text, reportId, editable, onChange }: { title: string; sectionKey: string; text: string; reportId: string; editable: boolean; onChange(): void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const save = useMutation({ mutationFn: () => api.patch(`/reports/${reportId}/content`, { section: sectionKey, text: value }), onSuccess: () => { setEditing(false); onChange(); } });
  return (
    <details className="card" open={sectionKey === 'recommendations'}>
      <summary><strong>{title}</strong></summary>
      {editing ? (
        <div style={{ marginTop: '0.5rem' }}>
          <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={6} />
          <ErrorBox error={save.error} />
          <div className="row"><button className="small primary" onClick={() => save.mutate()}>Save</button><button className="small" onClick={() => setEditing(false)}>Cancel</button></div>
        </div>
      ) : (
        <>
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{text || <span className="muted">Empty</span>}</p>
          {editable && <button className="small" onClick={() => { setValue(text); setEditing(true); }}>Edit</button>}
        </>
      )}
    </details>
  );
}

function ReasonModal({ title, label, cta, initial = '', onClose, onSubmit }: { title: string; label: string; cta: string; initial?: string; onClose(): void; onSubmit(text: string): Promise<unknown> }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} actions={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || text.trim().length < 10} onClick={async () => { setBusy(true); await onSubmit(text); setBusy(false); }}>{cta}</button></>}>
      <label>{label}</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      <p className="hint">Recorded with your name and time in the tamper-evident audit trail.</p>
    </Modal>
  );
}
