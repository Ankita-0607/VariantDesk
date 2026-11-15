import { useQuery } from '@tanstack/react-query';
import { api, AiRun, AuditEvent } from '../../api';
import { AiRunsTable, AuditTable } from '../Audit';

export function CaseAuditTab({ caseId }: { caseId: string }) {
  const events = useQuery({ queryKey: ['case-audit', caseId], queryFn: () => api.get<AuditEvent[]>(`/audit?caseId=${caseId}`) });
  const runs = useQuery({ queryKey: ['case-ai', caseId], queryFn: () => api.get<AiRun[]>(`/audit/ai-runs?caseId=${caseId}`) });
  return (
    <div className="stack">
      <div className="card">
        <h3>AI decisions ({runs.data?.length ?? 0})</h3>
        <p className="muted small">Every model call: the input sent (after PHI checks), raw output, guardrail results, and the human decision.</p>
        <AiRunsTable runs={runs.data ?? []} />
      </div>
      <div className="card">
        <h3>Activity</h3>
        <AuditTable events={events.data ?? []} />
      </div>
    </div>
  );
}
