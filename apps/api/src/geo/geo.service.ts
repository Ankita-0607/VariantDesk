import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { LocationInput, RESTRICTED_ZIP3 } from '../deid/patient.schema';

export interface ResolvedLocation {
  country: 'US' | 'IN';
  kind: 'zip3' | 'pin3' | 'city';
  value: string;
  label: string;
  lat: number;
  lon: number;
}

type Table = Record<string, { lat: number; lon: number; label: string }>;

function findDataDir(): string {
  const candidates = [
    process.env.VARIANTDESK_DATA_DIR,
    join(process.cwd(), 'data'),
    join(process.cwd(), '../../data'),
    join(__dirname, '../../../../data'),
  ].filter(Boolean) as string[];
  return candidates.find((d) => existsSync(join(d, 'geo/us_zip3.json'))) ?? candidates[0];
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

/** Offline coarse geocoder: ZIP3 / PIN3 / city → centroid. No external calls, no precise locations. */
@Injectable()
export class GeoService {
  private zip3: Table = {};
  private pin3: Table = {};
  private cities: Record<'US' | 'IN', Table> = { US: {}, IN: {} };

  constructor() {
    const dir = findDataDir();
    const load = (f: string) => {
      const p = join(dir, 'geo', f);
      return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
    };
    this.zip3 = load('us_zip3.json');
    this.pin3 = load('in_pin3.json');
    const c = load('cities.json');
    this.cities = { US: c.US ?? {}, IN: c.IN ?? {} };
  }

  resolve(input: LocationInput): ResolvedLocation | null {
    if (input.kind === 'zip3') {
      if (RESTRICTED_ZIP3.has(input.value)) return null; // too small a population to be de-identified
      const hit = this.zip3[input.value];
      return hit ? { ...input, ...hit, country: 'US' } : null;
    }
    if (input.kind === 'pin3') {
      const hit = this.pin3[input.value];
      return hit ? { ...input, ...hit, country: 'IN' } : null;
    }
    const hits = this.searchCities(input.country, input.value, 1);
    return hits[0] ? { ...input, ...hits[0], value: hits[0].label } : null;
  }

  /** City autocomplete. Accepts "Pune" or "Pune, Maharashtra" / "Boston, MA". */
  searchCities(country: 'US' | 'IN', q: string, limit = 10) {
    const [cityPart, regionPart] = q.split(',').map((s) => norm(s ?? ''));
    if (!cityPart) return [];
    const table = this.cities[country];
    const exact: Array<{ key: string; lat: number; lon: number; label: string }> = [];
    const prefix: typeof exact = [];
    for (const [key, v] of Object.entries(table)) {
      const [city, region] = key.split('|');
      if (regionPart && !region.startsWith(regionPart)) continue;
      if (city === cityPart) exact.push({ key, ...v });
      else if (city.startsWith(cityPart)) prefix.push({ key, ...v });
      if (exact.length >= limit) break;
    }
    return [...exact, ...prefix].slice(0, limit);
  }
}

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
