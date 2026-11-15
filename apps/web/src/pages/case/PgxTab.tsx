import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Pgx } from '../../api';
import { useAuth } from '../../auth';
import { Badge, Spinner } from '../../components/ui';
import { useReportState } from './useLocked';

export function PgxTab({ caseId }: { caseId: string }) {
  const { can } = useAuth();
  const { locked } = useReportState(caseId);
  const qc = useQueryClient();
  const pgx = useQuery({ queryKey: ['pgx', caseId], queryFn: () => api.get<Pgx[]>(`/cases/${caseId}/pgx`) });
  const toggle = useMutation({
    mutationFn: (p: Pgx) => api.patch(`/pgx/${p.id}`, { includeInReport: !p.includeInReport }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pgx', caseId] }); qc.invalidateQueries({ queryKey: ['report', caseId] }); },
  });
  if (pgx.isLoading) return <div className="empty"><Spinner /></div>;
  return (
    <div className="stack">
      <div className="alert info small">
        Diplotypes are inferred from key CPIC-defined variants. Alleles not present in the VCF are assumed reference. CYP2D6, HLA, UGT1A1*28 and CYP2B6 are not assessed
        (they need copy-number / haplotype-aware tools such as PharmCAT).
      </div>
      {pgx.data?.map((p) => {
        const actionable = p.phenotype && !/^normal/i.test(p.phenotype);
        return (
          <div className="card" key={p.id}>
            <div className="spread">
              <div className="row">
                <h3 style={{ margin: 0 }}>{p.gene}</h3>
                <span className="mono">{p.diplotype ?? 'Indeterminate'}</span>
                {p.phenotype && <Badge tone={actionable ? 'warn' : 'ok'}>{p.phenotype}</Badge>}
                {p.activityScore && <span className="muted small">activity score {p.activityScore}</span>}
              </div>
              {can('ANALYST') && !locked && (
                <label className="check small"><input type="checkbox" checked={p.includeInReport} onChange={() => toggle.mutate(p)} /> in report</label>
              )}
            </div>
            {p.calledVariants.length > 0 && <div className="small" style={{ marginTop: '0.3rem' }}>Detected: {p.calledVariants.map((c) => `${c.allele} (${c.rsId}, ${c.copies === 2 ? 'hom' : 'het'})`).join('; ')}</div>}
            {p.recommendations.length > 0 && (
              <details style={{ marginTop: '0.5rem' }} open={!!actionable}>
                <summary className="small">{p.recommendations.length} CPIC recommendation(s)</summary>
                <div className="table-wrap">
                  <table className="small">
                    <thead><tr><th>Drug</th><th>Recommendation</th><th>Strength</th><th>Population</th></tr></thead>
                    <tbody>
                      {p.recommendations.map((r, i) => (
                        <tr key={i}>
                          <td><strong>{r.drug}</strong></td>
                          <td>{r.recommendation}{r.guidelineUrl && <> <a href={r.guidelineUrl} target="_blank" rel="noreferrer">guideline</a></>}</td>
                          <td>{r.classification}</td>
                          <td className="muted">{r.population}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            <ul className="hint">{p.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        );
      })}
    </div>
  );
}
