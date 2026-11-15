import { Injectable } from '@nestjs/common';
import { KbHttpService } from '../kb/http.service';

const FIELDS = [
  'NCTId', 'BriefTitle', 'OverallStatus', 'Phase', 'Condition', 'Keyword', 'InterventionName', 'LocationFacility',
  'LocationCity', 'LocationState', 'LocationCountry', 'LocationGeoPoint', 'LocationStatus', 'EligibilityCriteria',
  'MinimumAge', 'MaximumAge', 'Sex',
].join(',');

export interface CtSite {
  facility?: string;
  city?: string;
  state?: string;
  country?: string;
  status?: string;
  lat?: number;
  lon?: number;
}

export interface CtStudy {
  nctId: string;
  title: string;
  status?: string;
  phase?: string;
  conditions: string[];
  keywords: string[];
  interventions: string[];
  eligibility?: string;
  minAge?: string;
  maxAge?: string;
  sex?: string;
  sites: CtSite[];
}

/** ClinicalTrials.gov API v2 — covers US and many Indian trial sites. */
@Injectable()
export class CtGovClient {
  constructor(private readonly http: KbHttpService) {}

  async search(params: { cond?: string; term?: string; country?: 'United States' | 'India'; max?: number }): Promise<CtStudy[]> {
    const out: CtStudy[] = [];
    let pageToken: string | undefined;
    const max = params.max ?? 150;
    do {
      const q = new URLSearchParams({
        'filter.overallStatus': 'RECRUITING,NOT_YET_RECRUITING',
        pageSize: '100',
        fields: FIELDS,
      });
      if (params.cond) q.set('query.cond', params.cond);
      if (params.term) q.set('query.term', params.term);
      if (params.country) q.set('query.locn', params.country);
      if (pageToken) q.set('pageToken', pageToken);
      const { data } = await this.http.json<any>('CTGOV', `https://clinicaltrials.gov/api/v2/studies?${q}`, { ttlHours: 24 });
      for (const s of data.studies ?? []) out.push(toStudy(s.protocolSection ?? {}));
      pageToken = data.nextPageToken;
    } while (pageToken && out.length < max);
    return out.slice(0, max);
  }
}

function toStudy(p: any): CtStudy {
  return {
    nctId: p.identificationModule?.nctId,
    title: p.identificationModule?.briefTitle ?? '',
    status: p.statusModule?.overallStatus,
    phase: (p.designModule?.phases ?? []).map((x: string) => x.replace('PHASE', 'Phase ').replace('EARLY_Phase 1', 'Early Phase 1')).join('/') || undefined,
    conditions: p.conditionsModule?.conditions ?? [],
    keywords: p.conditionsModule?.keywords ?? [],
    interventions: (p.armsInterventionsModule?.interventions ?? []).map((i: any) => i.name),
    eligibility: p.eligibilityModule?.eligibilityCriteria,
    minAge: p.eligibilityModule?.minimumAge,
    maxAge: p.eligibilityModule?.maximumAge,
    sex: p.eligibilityModule?.sex,
    sites: (p.contactsLocationsModule?.locations ?? []).map((l: any) => ({
      facility: l.facility,
      city: l.city,
      state: l.state,
      country: l.country,
      status: l.status,
      lat: l.geoPoint?.lat,
      lon: l.geoPoint?.lon,
    })),
  };
}

/** "18 Years" → 18; "6 Months" → 0.5 */
export function parseAge(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(Year|Month|Week|Day)/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit.startsWith('year') ? n : unit.startsWith('month') ? n / 12 : unit.startsWith('week') ? n / 52 : n / 365;
}
