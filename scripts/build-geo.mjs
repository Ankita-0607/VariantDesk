#!/usr/bin/env node
/**
 * Builds coarse location centroid tables from GeoNames postal data (CC BY 4.0, https://www.geonames.org/).
 *   data/geo/us_zip3.json   { "100": { lat, lon, label } }
 *   data/geo/in_pin3.json   { "110": { lat, lon, label } }
 *   data/geo/cities.json    { "US": { "boston|ma": {...} }, "IN": { "pune|maharashtra": {...} } }
 * Only 3-digit prefixes and city-level centroids are produced, so no precise location is ever stored.
 * Usage: node scripts/build-geo.mjs   (requires `unzip`)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = join(root, 'data/geo/raw');
mkdirSync(raw, { recursive: true });

async function fetchZip(cc) {
  const zipPath = join(raw, `${cc}.zip`);
  if (!existsSync(zipPath)) {
    const res = await fetch(`https://download.geonames.org/export/zip/${cc}.zip`);
    if (!res.ok) throw new Error(`GeoNames ${cc}: HTTP ${res.status}`);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync('unzip', ['-o', '-q', zipPath, `${cc}.txt`, '-d', raw]);
  return readFileSync(join(raw, `${cc}.txt`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const c = l.split('\t');
      // country, postal, place, admin1 name, admin1 code, admin2 name, admin2 code, admin3, admin3 code, lat, lon, accuracy
      return { postal: c[1], place: c[2], admin1: c[3], admin1Code: c[4], admin2: c[5], lat: Number(c[9]), lon: Number(c[10]) };
    })
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

function centroid(rows, keyFn, labelFn) {
  const acc = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    const a = acc.get(k) ?? { lat: 0, lon: 0, n: 0, labels: new Map() };
    a.lat += r.lat;
    a.lon += r.lon;
    a.n++;
    const lbl = labelFn(r);
    a.labels.set(lbl, (a.labels.get(lbl) ?? 0) + 1);
    acc.set(k, a);
  }
  const out = {};
  for (const [k, a] of [...acc.entries()].sort()) {
    const label = [...a.labels.entries()].sort((x, y) => y[1] - x[1])[0][0];
    out[k] = { lat: +(a.lat / a.n).toFixed(3), lon: +(a.lon / a.n).toFixed(3), label };
  }
  return out;
}

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

const us = await fetchZip('US');
const ind = await fetchZip('IN');

const usZip3 = centroid(us, (r) => r.postal.slice(0, 3), (r) => `${r.place}, ${r.admin1Code}`);
const inPin3 = centroid(ind, (r) => r.postal.slice(0, 3), (r) => `${r.admin2 || r.place}, ${r.admin1}`);
const cities = {
  US: centroid(us, (r) => `${norm(r.place)}|${r.admin1Code.toLowerCase()}`, (r) => `${r.place}, ${r.admin1Code}`),
  // In India, GeoNames "place" is a post-office name; district (admin2) is the practical "city" unit.
  IN: centroid(ind, (r) => (r.admin2 ? `${norm(r.admin2)}|${norm(r.admin1)}` : null), (r) => `${r.admin2}, ${r.admin1}`),
};

writeFileSync(join(root, 'data/geo/us_zip3.json'), JSON.stringify(usZip3));
writeFileSync(join(root, 'data/geo/in_pin3.json'), JSON.stringify(inPin3));
writeFileSync(join(root, 'data/geo/cities.json'), JSON.stringify(cities));
console.log(`zip3=${Object.keys(usZip3).length} pin3=${Object.keys(inPin3).length} usCities=${Object.keys(cities.US).length} inCities=${Object.keys(cities.IN).length}`);
