import { Injectable } from '@nestjs/common';
import { KbHttpService } from './http.service';
import { EvidenceDraft } from './types';

const CIVIC = 'https://civicdb.org/api/graphql';

const EVIDENCE_Q = `query($mp: Int!) {
  evidenceItems(molecularProfileId: $mp, status: ACCEPTED, first: 100) {
    nodes { id name evidenceLevel evidenceType evidenceDirection significance evidenceRating description
      disease { name doid } therapies { name } source { citationId sourceType citation sourceUrl } }
  }
  assertions(molecularProfileId: $mp, status: ACCEPTED, first: 50) {
    nodes { id name ampLevel assertionType assertionDirection significance summary
      disease { name doid } therapies { name } fdaCompanionTest regulatoryApproval nccnGuideline { name } }
  }
}`;

const CATEGORY: Record<string, EvidenceDraft['category']> = {
  PREDICTIVE: 'THERAPEUTIC',
  PROGNOSTIC: 'PROGNOSTIC',
  DIAGNOSTIC: 'DIAGNOSTIC',
  PREDISPOSING: 'PATHOGENICITY',
  ONCOGENIC: 'ONCOGENICITY',
  FUNCTIONAL: 'FUNCTIONAL',
};

const SIGNIFICANCE: Record<string, string> = {
  SENSITIVITYRESPONSE: 'Sensitivity/response',
  REDUCED_SENSITIVITY: 'Reduced sensitivity',
  ADVERSE_RESPONSE: 'Adverse response',
  LIKELY_ONCOGENIC: 'Likely oncogenic',
};
const pretty = (s?: string) =>
  s ? (SIGNIFICANCE[s] ?? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())) : undefined;

/** CIViC (CC0): curated somatic/germline cancer evidence and AMP-tier assertions. */
@Injectable()
export class CivicClient {
  constructor(private readonly http: KbHttpService) {}

  private gql<T>(query: string, variables: Record<string, unknown>) {
    return this.http.json<{ data: T; errors?: unknown }>('CIVIC', CIVIC, { method: 'POST', body: { query, variables } });
  }

  async lookup(gene: string, proteinShort: string): Promise<EvidenceDraft[]> {
    const name = `${gene} ${proteinShort}`;
    const mp = await this.gql<any>(
      `query($n: String!) { browseMolecularProfiles(molecularProfileName: $n, first: 10) { nodes { id name } } }`,
      { n: name },
    );
    const profile = mp.data.data?.browseMolecularProfiles?.nodes?.find((n: any) => n.name === name);
    if (!profile) return [];
    const res = await this.gql<any>(EVIDENCE_Q, { mp: profile.id });
    const d = res.data.data ?? {};
    const fetchedAt = res.fetchedAt;
    const out: EvidenceDraft[] = [];
    for (const a of d.assertions?.nodes ?? []) {
      out.push({
        source: 'CIVIC',
        sourceId: a.name,
        url: `https://civicdb.org/assertions/${a.id}/summary`,
        category: CATEGORY[a.assertionType] ?? 'OTHER',
        level: a.ampLevel ? a.ampLevel.replace(/_/g, ' ').replace('TIER ', 'Tier ').replace(' LEVEL ', ' Level ') : undefined,
        significance: pretty(a.significance),
        direction: pretty(a.assertionDirection),
        disease: a.disease?.name,
        therapies: (a.therapies ?? []).map((t: any) => t.name),
        summary: `CIViC assertion: ${a.summary}${a.fdaCompanionTest ? ' FDA companion diagnostic exists.' : ''}${a.nccnGuideline ? ` NCCN guideline: ${a.nccnGuideline.name}.` : ''}`,
        retrievedAt: fetchedAt,
        sourceVersion: 'CIViC (live GraphQL)',
        meta: { kind: 'assertion', ampLevel: a.ampLevel, doid: a.disease?.doid, molecularProfile: name, regulatoryApproval: a.regulatoryApproval },
      });
    }
    for (const e of d.evidenceItems?.nodes ?? []) {
      out.push({
        source: 'CIVIC',
        sourceId: e.name,
        url: `https://civicdb.org/evidence/${e.id}/summary`,
        category: CATEGORY[e.evidenceType] ?? 'OTHER',
        level: e.evidenceLevel,
        significance: pretty(e.significance),
        direction: pretty(e.evidenceDirection),
        disease: e.disease?.name,
        therapies: (e.therapies ?? []).map((t: any) => t.name),
        summary: e.description,
        citation: e.source?.citation ? `${e.source.citation}${e.source.sourceType === 'PUBMED' ? ` (PMID ${e.source.citationId})` : ''}` : undefined,
        retrievedAt: fetchedAt,
        sourceVersion: 'CIViC (live GraphQL)',
        meta: { kind: 'evidence', rating: e.evidenceRating, doid: e.disease?.doid, pmid: e.source?.sourceType === 'PUBMED' ? e.source.citationId : undefined, molecularProfile: name },
      });
    }
    return out;
  }
}
