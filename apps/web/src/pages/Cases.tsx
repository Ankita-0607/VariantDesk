import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { api, CaseRow } from '../api';
import { useAuth } from '../auth';
import { Badge, ErrorBox, Spinner, StatusBadge } from '../components/ui';

export function CasesPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const cases = useQuery({
    queryKey: ['cases'],
    queryFn: () => api.get<CaseRow[]>('/cases'),
    refetchInterval: (query) => (query.state.data?.some((c) => c.status === 'PROCESSING' || c.status === 'QUEUED') ? 4000 : false),
  });
  const rows = (cases.data ?? []).filter((c) => !q || `${c.caseCode} ${c.diagnosisText} ${c.diagnosis?.label ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const waitingOnMe = (c: CaseRow) =>
    (can('LAB_DIRECTOR') && c.report?.status === 'IN_REVIEW') || (can('ANALYST') && (c.report?.status === 'DRAFT' || c.report?.status === 'RETURNED'));

  return (
    <div className="stack">
      <div className="spread">
        <h1>Cases</h1>
        <div className="row">
          <input className="search grow" placeholder="Search case code or diagnosis" aria-label="Search cases" value={q} onChange={(e) => setQ(e.target.value)} />
          {can('ANALYST') && <button className="primary" onClick={() => nav('/cases/new')}>+ New case</button>}
        </div>
      </div>
      <ErrorBox error={cases.error} />
      <div className="card table-wrap" style={{ padding: 0 }}>
        {cases.isLoading ? (
          <div className="empty"><Spinner /></div>
        ) : rows.length === 0 ? (
          <div className="empty">No cases yet.{can('ANALYST') && <> <Link to="/cases/new">Create the first case</Link>.</>}</div>
        ) : (
          <table>
            <thead>
              <tr><th>Case</th><th>Diagnosis</th><th>Sample</th><th>Variants</th><th>Pipeline</th><th>Report</th><th>Created</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => nav(`/cases/${c.id}`)}>
                  <td>
                    <strong>{c.caseCode}</strong> {waitingOnMe(c) && <Badge tone="warn">Needs you</Badge>}
                  </td>
                  <td>{c.diagnosis?.label ?? c.diagnosisText ?? '—'}</td>
                  <td>{c.sampleType.replace('_', '/')}</td>
                  <td>{c.variantCount}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{c.report ? <><StatusBadge status={c.report.status} /> <span className="muted small">v{c.report.version}</span></> : '—'}</td>
                  <td className="small muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
