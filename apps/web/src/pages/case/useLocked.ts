import { useQuery } from '@tanstack/react-query';
import { api, ReportView } from '../../api';

/** Evidence/variant edits are locked while the latest report is in review or signed. */
export function useReportState(caseId: string) {
  const q = useQuery({ queryKey: ['report', caseId], queryFn: () => api.get<{ report: ReportView | null; versions: any[] }>(`/cases/${caseId}/report`) });
  const status = q.data?.report?.report.status;
  return { query: q, status, locked: status === 'IN_REVIEW' || status === 'SIGNED' };
}
