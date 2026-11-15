import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, CaseDetail } from '../api';
import { Badge, ErrorBox, Spinner, StatusBadge } from '../components/ui';
import { VariantsTab } from './case/VariantsTab';
import { PgxTab } from './case/PgxTab';
import { TrialsTab } from './case/TrialsTab';
import { ReportTab } from './case/ReportTab';
import { CaseAuditTab } from './case/CaseAuditTab';
import { useAuth } from '../auth';

const STEPS = ['diagnosis', 'annotation', 'evidence', 'classification', 'pgx', 'ai_triage', 'trials', 'ai_trials', 'report', 'done'];

export function CasePage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useLocation() as { state?: { warnings?: string[] } };
  const { can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'variants' | 'pgx' | 'trials' | 'report' | 'audit'>('variants');
  const kase = useQuery({
    queryKey: ['case', id],
    queryFn: () => api.get<CaseDetail>(`/cases/${id}`),
    refetchInterval: (q) => (q.state.data && ['QUEUED', 'PROCESSING'].includes(q.state.data.status) ? 2500 : false),
  });
  const c = kase.data;
  if (kase.isLoading) return <div className="empty"><Spinner /></div>;
  if (!c) return <ErrorBox error={kase.error} />;
  const p = c.patient ?? {};
  const busy = c.status === 'QUEUED' || c.status === 'PROCESSING';

  async function rerun() {
    if (!confirm('Re-run the full analysis? Draft report text will be regenerated; manual evidence is kept.')) return;
    await api.post(`/cases/${id}/rerun`);
    qc.invalidateQueries({ queryKey: ['case', id] });
  }

  return (
    <div>
      <div className="spread">
        <div>
          <h1 className="row">
            {c.caseCode} <StatusBadge status={c.status} />
          </h1>
          <div className="muted small row">
            <span>{c.sampleType.replace('_', '/')} · {c.genomeBuild}{c.assay ? ` · ${c.assay}` : ''}</span>
            <span>· {p.ageYears ?? '?'} y, {p.sex}</span>
            {c.location && <span>· 📍 {c.location.label} ({c.location.kind.toUpperCase()} {c.location.kind !== 'city' ? c.location.value : ''})</span>}
          </div>
        </div>
        {can('ANALYST') && !busy && <button onClick={rerun}>Re-run analysis</button>}
      </div>

      {state?.warnings?.length ? <div className="alert warn">{state.warnings.join(' ')}</div> : null}
      {c.vcfStats?.warnings?.length ? <div className="alert warn small">{c.vcfStats.warnings.join(' ')}</div> : null}

      <div className="card" style={{ marginTop: '0.75rem' }}>
        <div className="row">
          <strong>Diagnosis:</strong> {p.diagnosis || <span className="muted">not provided</span>}
          {c.diagnosis && (
            <>
              <span className="muted">→</span> <Badge tone="info">{c.diagnosis.label}</Badge>
              <Badge tone={c.diagnosis.method === 'ai' ? 'ai' : 'outline'} title={c.diagnosis.rationale}>
                {c.diagnosis.method === 'ai' ? `AI (${c.diagnosis.confidence})` : 'rule-based'}
              </Badge>
              {c.diagnosis.needsReview && <Badge tone="warn" title={`Rule-based match: ${c.diagnosis.ruleCode}`}>AI and rules disagree — please verify</Badge>}
            </>
          )}
          {p.stage && <span className="muted">· Stage {p.stage}</span>}
          {p.ecog != null && <span className="muted">· ECOG {p.ecog}</span>}
        </div>
      </div>

      {busy && (
        <div className="card" style={{ marginTop: '0.75rem' }}>
          <div className="row"><Spinner /> <strong>Analysis in progress</strong></div>
          <ul className="progress">
            {STEPS.map((s) => {
              const done = c.progress.find((x) => x.step === s);
              const last = c.progress[c.progress.length - 1]?.step === s;
              if (!done) return null;
              return <li key={s}>{last ? <Spinner /> : '✓'} {done.detail ?? s}</li>;
            })}
          </ul>
        </div>
      )}
      {c.status === 'FAILED' && <div className="alert danger" style={{ marginTop: '0.75rem' }}><strong>Analysis failed:</strong> {c.error}</div>}

      {c.status === 'READY' && (
        <>
          <div className="tabs" role="tablist">
            {([
              ['variants', `Variants & evidence (${c.counts.reportable}/${c.counts.variants})`],
              ['pgx', 'Pharmacogenomics'],
              ['trials', `Clinical trials (${c.counts.trials})`],
              ['report', 'Draft report'],
              ['audit', 'Audit trail'],
            ] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'variants' && <VariantsTab caseDetail={c} />}
          {tab === 'pgx' && <PgxTab caseId={c.id} />}
          {tab === 'trials' && <TrialsTab caseDetail={c} />}
          {tab === 'report' && <ReportTab caseDetail={c} />}
          {tab === 'audit' && <CaseAuditTab caseId={c.id} />}
        </>
      )}
    </div>
  );
}
