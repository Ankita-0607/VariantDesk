import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, CaseDetail, Evidence, Variant } from '../../api';
import { useAiEnabled, useAuth } from '../../auth';
import { Badge, classTone, ErrorBox, fmtAf, Modal, shortHgvs, Spinner } from '../../components/ui';
import { useReportState } from './useLocked';

const CATEGORIES = ['PATHOGENICITY', 'ONCOGENICITY', 'THERAPEUTIC', 'PROGNOSTIC', 'DIAGNOSTIC', 'PGX', 'POPULATION', 'LITERATURE', 'FUNCTIONAL', 'OTHER'];
const SOURCES = ['MANUAL', 'CLINVAR', 'CIVIC', 'CPIC', 'GNOMAD', 'PUBMED'];
const GERMLINE = ['Pathogenic', 'Likely pathogenic', 'Uncertain significance', 'Likely benign', 'Benign'];
const SOMATIC = ['Tier I (Level A)', 'Tier I (Level B)', 'Tier II (Level C)', 'Tier II (Level D)', 'Tier III', 'Tier IV'];

export function effective(v: Variant, sampleType: string) {
  const g = v.override?.germline ?? v.classification?.germline?.classification;
  const s0 = v.classification?.somatic;
  const s = v.override?.somatic ?? (s0 ? `${s0.tier}${s0.level ? ` (Level ${s0.level})` : ''}` : undefined);
  return sampleType === 'germline' ? { primary: g, secondary: undefined } : sampleType === 'tumor' ? { primary: s, secondary: undefined } : { primary: s, secondary: g };
}

export function VariantsTab({ caseDetail }: { caseDetail: CaseDetail }) {
  const caseId = caseDetail.id;
  const { can } = useAuth();
  const { locked } = useReportState(caseId);
  const editable = can('ANALYST') && !locked;
  const [filter, setFilter] = useState<'reportable' | 'all'>('reportable');
  const [selected, setSelected] = useState<string | null>(null);
  const variants = useQuery({ queryKey: ['variants', caseId], queryFn: () => api.get<Variant[]>(`/cases/${caseId}/variants`) });
  const list = useMemo(() => (variants.data ?? []).filter((v) => filter === 'all' || v.reportable), [variants.data, filter]);
  useEffect(() => {
    if (!selected && list.length) setSelected(list[0].id);
  }, [list, selected]);
  const v = variants.data?.find((x) => x.id === selected);

  if (variants.isLoading) return <div className="empty"><Spinner /></div>;
  return (
    <div>
      {locked && <div className="alert info">The report is in review or signed, so evidence and classifications are read-only. A lab director can return it, or create an amendment.</div>}
      <div className="workspace">
        <div className="card variant-list">
          <div className="spread" style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid var(--border)' }}>
            <strong>Variants</strong>
            <select value={filter} onChange={(e) => setFilter(e.target.value as any)} style={{ width: 'auto' }} aria-label="Filter variants">
              <option value="reportable">Reportable ({variants.data?.filter((x) => x.reportable).length})</option>
              <option value="all">All ({variants.data?.length})</option>
            </select>
          </div>
          {list.length === 0 && <div className="empty small">No reportable variants. Switch to “All” to review every variant.</div>}
          {list.map((x) => {
            const e = effective(x, caseDetail.sampleType);
            return (
              <div key={x.id} className={`variant-item ${x.id === selected ? 'active' : ''}`} onClick={() => setSelected(x.id)}>
                <div className="spread">
                  <strong>{x.gene ?? `${x.chrom}:${x.pos}`} <span className="mono">{x.proteinShort ? `p.${x.proteinShort}` : shortHgvs(x.hgvsc)}</span></strong>
                  {x.reportable && <Badge tone="info">report</Badge>}
                </div>
                <div className="row small">
                  {e.primary && <Badge tone={classTone(e.primary)}>{e.primary}</Badge>}
                  {e.secondary && <Badge tone={classTone(e.secondary)}>{e.secondary}</Badge>}
                  {x.override && <Badge tone="warn">overridden</Badge>}
                  <span className="muted">{x.consequence?.replace(/_/g, ' ')}</span>
                  {x.vaf != null && <span className="muted">VAF {(x.vaf * 100).toFixed(0)}%</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div>{v ? <VariantDetail key={v.id} v={v} caseDetail={caseDetail} editable={editable} /> : <div className="card empty">Select a variant</div>}</div>
      </div>
    </div>
  );
}

function VariantDetail({ v, caseDetail, editable }: { v: Variant; caseDetail: CaseDetail; editable: boolean }) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['variants', caseDetail.id] });
    qc.invalidateQueries({ queryKey: ['case', caseDetail.id] });
    qc.invalidateQueries({ queryKey: ['report', caseDetail.id] });
  };
  const [showOverride, setShowOverride] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const patch = useMutation({ mutationFn: (body: any) => api.patch(`/variants/${v.id}`, body), onSuccess: refresh });
  const aiOn = useAiEnabled();
  const triage = useMutation({ mutationFn: () => api.post(`/variants/${v.id}/ai-triage`), onSuccess: refresh });
  const g = v.classification?.germline;
  const s = v.classification?.somatic;
  const pf = v.popFreq ?? {};
  const active = v.evidence.filter((e) => e.status === 'ACTIVE');
  const deleted = v.evidence.filter((e) => e.status === 'DELETED');
  const order: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  active.sort((a, b) => (order[a.ai?.relevance ?? 'MEDIUM'] - order[b.ai?.relevance ?? 'MEDIUM']) || a.source.localeCompare(b.source));

  return (
    <div className="stack">
      <div className="card">
        <div className="spread">
          <h2 style={{ margin: 0 }}>
            {v.gene ?? 'Intergenic'} <span className="mono">{shortHgvs(v.hgvsc)}</span> {v.hgvsp && <span className="mono muted">({shortHgvs(v.hgvsp)})</span>}
          </h2>
          {editable && (
            <label className="check">
              <input type="checkbox" checked={v.reportable} onChange={(e) => patch.mutate({ reportable: e.target.checked })} /> Include in report
            </label>
          )}
        </div>
        <ErrorBox error={patch.error} />
        <dl className="kv" style={{ marginTop: '0.75rem' }}>
          <dt>Position</dt><dd className="mono">chr{v.chrom}:{v.pos} {v.ref}&gt;{v.alt} ({caseDetail.genomeBuild}){v.rsId && <> · <a href={`https://www.ncbi.nlm.nih.gov/snp/${v.rsId}`} target="_blank" rel="noreferrer">{v.rsId}</a></>}</dd>
          <dt>Transcript</dt><dd className="mono">{v.transcript ?? '—'}{v.annotation?.exon && ` · exon ${v.annotation.exon}`}{v.annotation?.intron && ` · intron ${v.annotation.intron}`}</dd>
          <dt>Consequence</dt><dd>{v.annotation?.consequences?.join(', ').replace(/_/g, ' ') ?? v.consequence} {v.impact && <Badge>{v.impact}</Badge>}</dd>
          <dt>Genotype</dt><dd>{v.genotype ?? '—'} ({v.zygosity}) · VAF {v.vaf != null ? `${(v.vaf * 100).toFixed(1)}%` : '—'} · depth {v.depth ?? '—'}</dd>
          <dt>In silico</dt><dd>SIFT {v.annotation?.sift ?? '—'} · PolyPhen {v.annotation?.polyphen ?? '—'}</dd>
          <dt>gnomAD v4</dt><dd>{Object.keys(pf).length === 0 ? 'Absent from gnomAD' : <>overall {fmtAf(Math.max(pf.gnomade ?? 0, pf.gnomadg ?? 0))} · South Asian {fmtAf(Math.max(pf.gnomade_sas ?? 0, pf.gnomadg_sas ?? 0))} · European {fmtAf(Math.max(pf.gnomade_nfe ?? 0, pf.gnomadg_nfe ?? 0))} · African {fmtAf(Math.max(pf.gnomade_afr ?? 0, pf.gnomadg_afr ?? 0))}</>}</dd>
        </dl>
      </div>

      <div className="card">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Classification <span className="muted small">(deterministic rules — AI never classifies)</span></h3>
          {editable && <button className="small" onClick={() => setShowOverride(true)}>Override…</button>}
        </div>
        {v.override && (
          <div className="alert warn small" style={{ marginTop: '0.5rem' }}>
            <strong>Analyst override:</strong> {[v.override.somatic, v.override.germline].filter(Boolean).join(' · ')} — “{v.override.reason}”
            {editable && <button className="small ghost" onClick={() => patch.mutate({ override: null })}>Remove override</button>}
          </div>
        )}
        <div className="grid2" style={{ marginTop: '0.5rem' }}>
          {caseDetail.sampleType !== 'germline' && s && (
            <div>
              <div className="row"><strong>Somatic (AMP/ASCO/CAP):</strong> <Badge tone={classTone(s.tier)}>{s.tier}{s.level ? ` · Level ${s.level}` : ''}</Badge></div>
              <ul className="small">{s.basis.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
          )}
          {g && (
            <div>
              <div className="row"><strong>Germline (ACMG/AMP):</strong> <Badge tone={classTone(g.classification)}>{g.classification}</Badge> <span className="muted small">{g.points} pts</span></div>
              <div className="row small" style={{ marginTop: '0.3rem' }}>
                {g.criteria.map((c) => <Badge key={c.code} tone={c.direction === 'pathogenic' ? 'danger' : 'ok'} title={c.detail}>{c.code}</Badge>)}
              </div>
              {g.notes.length > 0 && <ul className="small muted">{g.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              {caseDetail.sampleType === 'tumor' && <div className="hint">Tumour-only sample: germline origin cannot be confirmed.</div>}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Evidence ({active.length})</h3>
          {editable && (
            <div className="row">
              {aiOn && <button className="small ai" onClick={() => triage.mutate()} disabled={triage.isPending}>{triage.isPending ? 'Ranking…' : '✦ Re-rank with AI'}</button>}
              <button className="small primary" onClick={() => setAdding(true)}>+ Add evidence</button>
            </div>
          )}
        </div>
        <ErrorBox error={triage.error} />
        <div style={{ marginTop: '0.6rem' }}>
          {active.length === 0 && <div className="empty small">No evidence matched in public knowledge bases. Add evidence manually if available.</div>}
          {active.map((e) => <EvidenceCard key={e.id} e={e} editable={editable} onChange={refresh} />)}
        </div>
        {deleted.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <button className="small ghost" onClick={() => setShowDeleted((x) => !x)}>{showDeleted ? 'Hide' : 'Show'} {deleted.length} deleted</button>
            {showDeleted && deleted.map((e) => <EvidenceCard key={e.id} e={e} editable={editable} onChange={refresh} />)}
          </div>
        )}
      </div>

      {showOverride && (
        <OverrideModal
          v={v}
          sampleType={caseDetail.sampleType}
          onClose={() => setShowOverride(false)}
          onSave={async (body) => {
            await patch.mutateAsync({ override: body });
            setShowOverride(false);
          }}
        />
      )}
      {adding && <EvidenceModal variantId={v.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />}
    </div>
  );
}

const SRC_TONE: Record<string, any> = { CLINVAR: 'info', CIVIC: 'warn', CPIC: 'ok', GNOMAD: 'outline', PUBMED: 'outline', MANUAL: 'ai' };

function EvidenceCard({ e, editable, onChange }: { e: Evidence; editable: boolean; onChange(): void }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const toggle = useMutation({ mutationFn: () => api.patch(`/evidence/${e.id}`, { includeInReport: !e.includeInReport }), onSuccess: onChange });
  const decide = useMutation({ mutationFn: (decision: string) => api.post(`/evidence/${e.id}/ai-decision`, { decision }), onSuccess: onChange });
  const restore = useMutation({ mutationFn: () => api.post(`/evidence/${e.id}/restore`), onSuccess: onChange });
  const long = e.summary.length > 280;
  const relTone = e.ai?.relevance === 'HIGH' ? 'danger' : e.ai?.relevance === 'MEDIUM' ? 'warn' : 'outline';

  return (
    <div className={`evidence ${e.status === 'DELETED' ? 'deleted' : ''} ${!e.includeInReport && e.status === 'ACTIVE' ? 'excluded' : ''}`}>
      <div className="spread">
        <div className="row small">
          <Badge tone={SRC_TONE[e.source]}>{e.source}</Badge>
          {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="mono">{e.sourceId ?? 'link'}</a> : <span className="mono">{e.sourceId}</span>}
          <Badge tone="outline">{e.category.toLowerCase()}</Badge>
          {e.level && <Badge title="Evidence level">{e.level}</Badge>}
          {e.significance && <strong>{e.significance}</strong>}
          {e.disease && <span className="muted">· {e.disease}</span>}
          {e.origin === 'MANUAL' && <Badge tone="ai">added by analyst</Badge>}
        </div>
        {editable && e.status === 'ACTIVE' && (
          <div className="row">
            <label className="check small" title="Include this evidence in the report"><input type="checkbox" checked={e.includeInReport} onChange={() => toggle.mutate()} /> in report</label>
            <button className="small ghost" onClick={() => setEditing(true)}>Edit</button>
            <button className="small ghost" style={{ color: 'var(--danger)' }} onClick={() => setDeleting(true)}>Delete</button>
          </div>
        )}
        {editable && e.status === 'DELETED' && <button className="small" onClick={() => restore.mutate()}>Restore</button>}
      </div>
      {e.therapies?.length > 0 && <div className="small">Therapies: <strong>{e.therapies.join(', ')}</strong></div>}
      <div className="summary small">{long && !expanded ? `${e.summary.slice(0, 280)}…` : e.summary} {long && <button className="small ghost" onClick={() => setExpanded((x) => !x)}>{expanded ? 'less' : 'more'}</button>}</div>
      {e.citation && <div className="small muted">{e.citation}</div>}
      {e.status === 'DELETED' && <div className="small" style={{ color: 'var(--danger)' }}>Deleted: {e.deleteReason}</div>}
      {e.ai && e.status === 'ACTIVE' && (
        <div className="ai-note spread">
          <span>
            <Badge tone={relTone}>{e.ai.relevance} relevance</Badge> {e.ai.method === 'ai' ? '✦ AI' : 'Rule'}: {e.ai.rationale}
            {e.ai.decision !== 'PENDING' && <span className="muted"> · {e.ai.decision.toLowerCase()}</span>}
          </span>
          {editable && e.ai.method === 'ai' && e.ai.decision === 'PENDING' && (
            <span className="row">
              <button className="small" onClick={() => decide.mutate('ACCEPTED')} title={e.ai.relevance === 'LOW' ? 'Accepting LOW relevance removes this item from the report' : ''}>Accept</button>
              <button className="small" onClick={() => decide.mutate('REJECTED')}>Reject</button>
            </span>
          )}
        </div>
      )}
      <div className="hint">{e.sourceVersion}{e.retrievedAt && ` · retrieved ${new Date(e.retrievedAt).toLocaleDateString()}`}</div>
      {editing && <EvidenceModal evidence={e} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChange(); }} />}
      {deleting && <DeleteModal e={e} onClose={() => setDeleting(false)} onDone={() => { setDeleting(false); onChange(); }} />}
    </div>
  );
}

function EvidenceModal({ variantId, evidence, onClose, onSaved }: { variantId?: string; evidence?: Evidence; onClose(): void; onSaved(): void }) {
  const [f, setF] = useState({
    source: evidence?.source ?? 'MANUAL',
    sourceId: evidence?.sourceId ?? '',
    url: evidence?.url ?? '',
    category: evidence?.category ?? 'THERAPEUTIC',
    level: evidence?.level ?? '',
    significance: evidence?.significance ?? '',
    disease: evidence?.disease ?? '',
    therapies: (evidence?.therapies ?? []).join(', '),
    summary: evidence?.summary ?? '',
    citation: evidence?.citation ?? '',
  });
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF((s) => ({ ...s, [k]: ev.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...f, therapies: f.therapies.split(',').map((x) => x.trim()).filter(Boolean) };
      for (const k of ['sourceId', 'level', 'significance', 'disease', 'citation']) if (!body[k]) delete body[k];
      return evidence ? api.patch(`/evidence/${evidence.id}`, body) : api.post(`/variants/${variantId}/evidence`, body);
    },
    onSuccess: onSaved,
  });
  return (
    <Modal title={evidence ? 'Edit evidence' : 'Add evidence'} onClose={onClose} actions={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={save.isPending || f.summary.length < 3} onClick={() => save.mutate()}>Save</button></>}>
      <ErrorBox error={save.error} />
      <div className="grid2">
        <div><label>Source</label><select value={f.source} onChange={set('source')}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><label>Category</label><select value={f.category} onChange={set('category')}>{CATEGORIES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><label>Source ID</label><input value={f.sourceId} onChange={set('sourceId')} placeholder="e.g. PMID:21639808" /></div>
        <div><label>Level</label><input value={f.level} onChange={set('level')} placeholder="A / B / C / D, 3★, Tier I…" /></div>
        <div><label>Significance</label><input value={f.significance} onChange={set('significance')} placeholder="e.g. Sensitivity/response" /></div>
        <div><label>Disease</label><input value={f.disease} onChange={set('disease')} /></div>
      </div>
      <div style={{ marginTop: '0.6rem' }}><label>Therapies (comma-separated)</label><input value={f.therapies} onChange={set('therapies')} /></div>
      <div style={{ marginTop: '0.6rem' }}><label>URL</label><input value={f.url} onChange={set('url')} placeholder="https://" /></div>
      <div style={{ marginTop: '0.6rem' }}><label>Summary *</label><textarea value={f.summary} onChange={set('summary')} /></div>
      <div style={{ marginTop: '0.6rem' }}><label>Citation</label><input value={f.citation} onChange={set('citation')} placeholder="Author et al., Journal Year" /></div>
      <p className="hint">All changes are recorded in the audit trail.</p>
    </Modal>
  );
}

function DeleteModal({ e, onClose, onDone }: { e: Evidence; onClose(): void; onDone(): void }) {
  const [reason, setReason] = useState('');
  const del = useMutation({ mutationFn: () => api.del(`/evidence/${e.id}`, { reason }), onSuccess: onDone });
  return (
    <Modal title="Delete evidence" onClose={onClose} actions={<><button onClick={onClose}>Cancel</button><button className="danger" disabled={reason.trim().length < 3 || del.isPending} onClick={() => del.mutate()}>Delete</button></>}>
      <p className="small">{e.source} {e.sourceId}: {e.summary.slice(0, 160)}</p>
      <ErrorBox error={del.error} />
      <label>Reason (required, kept in the audit trail)</label>
      <textarea value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Not relevant to this tumour type; duplicate of CIViC assertion" />
      <p className="hint">Deleted evidence is hidden from the report but can be restored.</p>
    </Modal>
  );
}

function OverrideModal({ v, sampleType, onClose, onSave }: { v: Variant; sampleType: string; onClose(): void; onSave(b: any): Promise<void> }) {
  const [germline, setGermline] = useState(v.override?.germline ?? '');
  const [somatic, setSomatic] = useState(v.override?.somatic ?? '');
  const [reason, setReason] = useState(v.override?.reason ?? '');
  const [err, setErr] = useState<unknown>(null);
  return (
    <Modal
      title="Override classification"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={reason.trim().length < 5 || (!germline && !somatic)} onClick={() => onSave({ germline: germline || undefined, somatic: somatic || undefined, reason }).catch(setErr)}>Save override</button>
        </>
      }
    >
      <ErrorBox error={err} />
      <div className="grid2">
        {sampleType !== 'germline' && <div><label>Somatic tier</label><select value={somatic} onChange={(e) => setSomatic(e.target.value)}><option value="">(keep rule result)</option>{SOMATIC.map((x) => <option key={x}>{x}</option>)}</select></div>}
        {sampleType !== 'tumor' && <div><label>Germline classification</label><select value={germline} onChange={(e) => setGermline(e.target.value)}><option value="">(keep rule result)</option>{GERMLINE.map((x) => <option key={x}>{x}</option>)}</select></div>}
      </div>
      <div style={{ marginTop: '0.6rem' }}>
        <label>Justification (required)</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cite the criteria / evidence supporting the change" />
      </div>
    </Modal>
  );
}
