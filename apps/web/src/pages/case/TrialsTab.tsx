import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, CaseDetail, Trial } from '../../api';
import { useAiEnabled, useAuth } from '../../auth';
import { Badge, ErrorBox, Spinner } from '../../components/ui';

const VERDICT: Record<string, { tone: any; label: string }> = {
  LIKELY_ELIGIBLE: { tone: 'ok', label: 'Likely eligible' },
  UNCERTAIN: { tone: 'warn', label: 'Uncertain' },
  LIKELY_INELIGIBLE: { tone: 'danger', label: 'Likely ineligible' },
};

export function TrialsTab({ caseDetail }: { caseDetail: CaseDetail }) {
  const caseId = caseDetail.id;
  const { can } = useAuth();
  const qc = useQueryClient();
  const [sort, setSort] = useState<'distance' | 'relevance'>(caseDetail.location ? 'distance' : 'relevance');
  const [showHidden, setShowHidden] = useState(false);
  const trials = useQuery({ queryKey: ['trials', caseId, sort, showHidden], queryFn: () => api.get<Trial[]>(`/cases/${caseId}/trials?sort=${sort}${showHidden ? '&hidden=1' : ''}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['trials', caseId] }); qc.invalidateQueries({ queryKey: ['report', caseId] }); };
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: any }) => api.patch(`/trials/${id}`, body), onSuccess: refresh });

  if (trials.isLoading) return <div className="empty"><Spinner /></div>;
  const rows = sort === 'relevance' ? [...(trials.data ?? [])].sort((a, b) => b.matchedTerms.length - a.matchedTerms.length) : trials.data ?? [];
  return (
    <div className="stack">
      <div className="spread">
        <div className="muted small">
          Recruiting trials from ClinicalTrials.gov{caseDetail.location ? <> · distances from <strong>{caseDetail.location.label}</strong> (approximate)</> : ' · add a location to sort by distance'}
        </div>
        <div className="row">
          <label className="check small"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> show hidden</label>
          <select value={sort} onChange={(e) => setSort(e.target.value as any)} style={{ width: 'auto' }} aria-label="Sort trials">
            <option value="distance" disabled={!caseDetail.location}>Nearest first</option>
            <option value="relevance">Most matched terms</option>
          </select>
        </div>
      </div>
      {rows.length === 0 && <div className="card empty">No recruiting trials found for this tumour type and these genes.</div>}
      {rows.map((t) => <TrialCard key={t.id} t={t} editable={can('ANALYST')} onPatch={(body) => patch.mutate({ id: t.id, body })} onRefresh={refresh} />)}
    </div>
  );
}

function TrialCard({ t, editable, onPatch, onRefresh }: { t: Trial; editable: boolean; onPatch(b: any): void; onRefresh(): void }) {
  const [sites, setSites] = useState(false);
  const aiOn = useAiEnabled();
  const screen = useMutation({ mutationFn: () => api.post(`/trials/${t.id}/screen`), onSuccess: onRefresh });
  const decide = useMutation({ mutationFn: (decision: string) => api.post(`/trials/${t.id}/ai-decision`, { decision }), onSuccess: onRefresh });
  const v = t.aiScreen ? VERDICT[t.aiScreen.verdict] : null;
  const n = t.nearestSite;
  return (
    <div className="card" style={t.hidden ? { opacity: 0.6 } : undefined}>
      <div className="spread">
        <div className="row">
          <a href={`https://clinicaltrials.gov/study/${t.nctId}`} target="_blank" rel="noreferrer" className="mono"><strong>{t.nctId}</strong></a>
          {t.phase && <Badge>{t.phase}</Badge>}
          <Badge tone="outline">{t.status?.replace(/_/g, ' ').toLowerCase()}</Badge>
          {t.distanceKm != null && <Badge tone="info">~{t.distanceKm.toLocaleString()} km</Badge>}
        </div>
        {editable && (
          <div className="row">
            <label className="check small"><input type="checkbox" checked={t.includeInReport} onChange={(e) => onPatch({ includeInReport: e.target.checked })} /> in report</label>
            <button className="small ghost" onClick={() => onPatch({ hidden: !t.hidden })}>{t.hidden ? 'Unhide' : 'Hide'}</button>
          </div>
        )}
      </div>
      <div style={{ margin: '0.35rem 0' }}><strong>{t.title}</strong></div>
      <div className="small">
        {n ? <>Nearest recruiting site: {[n.facility, n.city, n.state, n.country].filter(Boolean).join(', ')}</> : <span className="muted">No site coordinates listed</span>}
        {t.sites.length > 1 && <button className="small ghost" onClick={() => setSites((x) => !x)}>{sites ? 'hide' : `+${t.sites.length - 1} more sites`}</button>}
      </div>
      {sites && <ul className="small muted">{t.sites.slice(1, 15).map((s, i) => <li key={i}>{[s.facility, s.city, s.state, s.country].filter(Boolean).join(', ')}{s.distanceKm != null && ` (~${s.distanceKm} km)`}</li>)}</ul>}
      <div className="row small" style={{ marginTop: '0.3rem' }}>
        {t.matchedTerms.map((m) => <Badge key={m} tone="ok">{m}</Badge>)}
        <span className="muted">{t.conditions.slice(0, 3).join(' · ')}</span>
        <span className="muted">· ages {t.minAge ?? 'any'}–{t.maxAge ?? 'any'}{t.sex && t.sex !== 'ALL' ? ` · ${t.sex.toLowerCase()} only` : ''}</span>
      </div>
      {t.interventions.length > 0 && <div className="small muted">Interventions: {t.interventions.slice(0, 5).join(', ')}</div>}

      <div className="ai-note" style={{ marginTop: '0.6rem' }}>
        {t.aiScreen ? (
          <>
            <div className="spread">
              <span className="row">
                <Badge tone={v?.tone}>{v?.label}</Badge>
                <span className="small">{t.aiScreen.method === 'ai' ? '✦ AI eligibility pre-screen' : 'Deterministic age/sex check'}{t.aiScreen.decision && t.aiScreen.decision !== 'PENDING' && ` · ${t.aiScreen.decision.toLowerCase()}`}</span>
              </span>
              {editable && t.aiScreen.method === 'ai' && t.aiScreen.decision === 'PENDING' && (
                <span className="row"><button className="small" onClick={() => decide.mutate('ACCEPTED')}>Accept</button><button className="small" onClick={() => decide.mutate('REJECTED')}>Reject</button></span>
              )}
            </div>
            <ul className="small" style={{ margin: '0.3rem 0 0' }}>
              {t.aiScreen.reasons.map((r, i) => (
                <li key={i}><Badge tone={r.assessment === 'MET' ? 'ok' : r.assessment === 'NOT_MET' ? 'danger' : 'outline'}>{r.assessment.replace('_', ' ')}</Badge> “{r.criterionQuote}” {r.note && <span className="muted">— {r.note}</span>}</li>
              ))}
            </ul>
          </>
        ) : (
          <div className="spread small">
            <span className="muted">Not pre-screened. Eligibility is decided by the trial team.</span>
            {editable && aiOn && <button className="small ai" disabled={screen.isPending} onClick={() => screen.mutate()}>{screen.isPending ? 'Screening…' : '✦ AI pre-screen'}</button>}
          </div>
        )}
        <ErrorBox error={screen.error} />
      </div>
    </div>
  );
}
