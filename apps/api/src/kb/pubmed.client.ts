import { Injectable } from '@nestjs/common';
import { config } from '../common/config';
import { KbHttpService } from './http.service';
import { EvidenceDraft } from './types';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/** PubMed literature for a variant (gene + protein change), most relevant first. */
@Injectable()
export class PubMedClient {
  constructor(private readonly http: KbHttpService) {}

  async search(gene: string, change: string, max = 5): Promise<EvidenceDraft[]> {
    const key = config.kb.ncbiApiKey ? `&api_key=${config.kb.ncbiApiKey}` : '';
    const term = encodeURIComponent(`${gene}[tiab] AND "${change}"[tiab]`);
    const s = await this.http.json<any>('PUBMED', `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${max}&term=${term}${key}`);
    const ids: string[] = s.data?.esearchresult?.idlist ?? [];
    if (!ids.length) return [];
    const sum = await this.http.json<any>('PUBMED', `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}${key}`);
    return ids
      .map((id) => sum.data?.result?.[id])
      .filter(Boolean)
      .map((r: any) => {
        const first = r.authors?.[0]?.name ?? 'Unknown';
        return {
          source: 'PUBMED' as const,
          sourceId: `PMID:${r.uid}`,
          url: `https://pubmed.ncbi.nlm.nih.gov/${r.uid}/`,
          category: 'LITERATURE' as const,
          summary: r.title,
          citation: `${first}${r.authors?.length > 1 ? ' et al.' : ''}, ${r.source} ${r.pubdate?.slice(0, 4) ?? ''}`.trim(),
          retrievedAt: sum.fetchedAt,
          sourceVersion: 'PubMed (live E-utilities)',
          meta: { pmid: r.uid },
        };
      });
  }
}
