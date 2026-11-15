import { FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { ErrorBox, useDebounced } from '../components/ui';

const ANCESTRY = [
  ['unknown', 'Unknown / not provided'], ['south_asian', 'South Asian'], ['european', 'European'], ['african', 'African / African American'],
  ['east_asian', 'East Asian'], ['latino', 'Latino / Admixed American'], ['ashkenazi', 'Ashkenazi Jewish'], ['middle_eastern', 'Middle Eastern'], ['other', 'Other'],
];

export function NewCasePage() {
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    caseCode: '', sampleType: 'tumor', genomeBuild: 'GRCh38', assay: '',
    ageYears: '', sex: 'unknown', diagnosis: '', stage: '', indication: '', priorTherapies: '', currentMedications: '', ecog: '', familyHistory: '', ancestry: 'unknown',
    country: 'US', locKind: 'zip3', locValue: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const issues = (error as ApiError)?.issues ?? [];
  const errFor = (path: string) => issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`)).map((i) => i.message).join('; ');

  const cityQ = useDebounced(f.locKind === 'city' ? f.locValue : '', 250);
  const cities = useQuery({
    queryKey: ['cities', f.country, cityQ],
    queryFn: () => api.get<Array<{ label: string }>>(`/geo/cities?country=${f.country}&q=${encodeURIComponent(cityQ)}`),
    enabled: cityQ.length >= 2,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setError(new ApiError(400, 'Please choose a VCF file'));
    setBusy(true);
    setError(null);
    const list = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    const data = {
      caseCode: f.caseCode.trim(),
      sampleType: f.sampleType,
      genomeBuild: f.genomeBuild,
      assay: f.assay || undefined,
      patient: {
        ageYears: f.ageYears ? Number(f.ageYears) : undefined,
        sex: f.sex,
        diagnosis: f.diagnosis,
        stage: f.stage || undefined,
        indication: f.indication || undefined,
        priorTherapies: list(f.priorTherapies),
        currentMedications: list(f.currentMedications),
        ecog: f.ecog !== '' ? Number(f.ecog) : undefined,
        familyHistory: f.familyHistory || undefined,
        ancestry: f.ancestry,
      },
      location: f.locValue.trim() ? { country: f.country, kind: f.locKind, value: f.locValue.trim() } : undefined,
    };
    const fd = new FormData();
    fd.append('vcf', file);
    fd.append('data', JSON.stringify(data));
    try {
      const r = await api.post<{ id: string; warnings: string[] }>('/cases', fd);
      nav(`/cases/${r.id}`, { state: { warnings: r.warnings } });
    } catch (err) {
      setError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 900 }}>
      <h1>New case</h1>
      <div className="alert info">
        Enter <strong>de-identified</strong> data only: no names, MRN/UHID, dates of birth, phone numbers, Aadhaar/SSN or full ZIP/PIN codes. The server rejects
        text that looks like an identifier.
      </div>
      <ErrorBox error={error} />

      <div className="card">
        <h2>Sample</h2>
        <div className="grid2">
          <div>
            <label htmlFor="cc">Case code / accession *</label>
            <input id="cc" value={f.caseCode} onChange={set('caseCode')} placeholder="e.g. LAB-2026-0142" required />
            {errFor('caseCode') && <div className="field-error">{errFor('caseCode')}</div>}
          </div>
          <div>
            <label htmlFor="st">Sample type *</label>
            <select id="st" value={f.sampleType} onChange={set('sampleType')}>
              <option value="tumor">Tumour only (somatic)</option>
              <option value="tumor_normal">Tumour / normal</option>
              <option value="germline">Germline (constitutional)</option>
            </select>
          </div>
          <div>
            <label htmlFor="gb">Genome build *</label>
            <select id="gb" value={f.genomeBuild} onChange={set('genomeBuild')}>
              <option>GRCh38</option>
              <option>GRCh37</option>
            </select>
          </div>
          <div>
            <label htmlFor="assay">Assay / panel</label>
            <input id="assay" value={f.assay} onChange={set('assay')} placeholder="e.g. 52-gene solid tumour panel" />
          </div>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <label>VCF file *</label>
          <div className={`dropzone ${file ? 'has-file' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files[0] ?? null); }} role="button" tabIndex={0}>
            {file ? <><strong>{file.name}</strong> <span className="muted">({(file.size / 1024).toFixed(0)} KB)</span></> : <span className="muted">Drop a .vcf file here or click to browse (PASS variants, panel/exome subset)</span>}
          </div>
          <input ref={fileRef} type="file" accept=".vcf,.txt" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>

      <div className="card">
        <h2>De-identified patient profile</h2>
        <div className="grid2">
          <div>
            <label htmlFor="age">Age (years)</label>
            <input id="age" type="number" min={0} max={120} value={f.ageYears} onChange={set('ageYears')} />
            <div className="hint">Ages ≥ 90 are stored as 90.</div>
          </div>
          <div>
            <label htmlFor="sex">Sex</label>
            <select id="sex" value={f.sex} onChange={set('sex')}>
              <option value="unknown">Unknown</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
            </select>
          </div>
          <div>
            <label htmlFor="anc">Ancestry (for population frequency)</label>
            <select id="anc" value={f.ancestry} onChange={set('ancestry')}>{ANCESTRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          <div>
            <label htmlFor="ecog">ECOG performance status</label>
            <select id="ecog" value={f.ecog} onChange={set('ecog')}>
              <option value="">Not provided</option>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div className="grid2" style={{ marginTop: '0.75rem' }}>
          <div>
            <label htmlFor="dx">Diagnosis</label>
            <input id="dx" value={f.diagnosis} onChange={set('diagnosis')} placeholder="e.g. metastatic lung adenocarcinoma" />
            {errFor('patient.diagnosis') && <div className="field-error">{errFor('patient.diagnosis')}</div>}
            <div className="hint">Normalised to a tumour type automatically (AI-assisted, cross-checked by rules).</div>
          </div>
          <div>
            <label htmlFor="stage">Stage</label>
            <input id="stage" value={f.stage} onChange={set('stage')} placeholder="e.g. IV" />
          </div>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="ind">Indication for testing</label>
          <input id="ind" value={f.indication} onChange={set('indication')} placeholder="e.g. therapy selection / hereditary risk assessment" />
          {errFor('patient.indication') && <div className="field-error">{errFor('patient.indication')}</div>}
        </div>
        <div className="grid2" style={{ marginTop: '0.75rem' }}>
          <div>
            <label htmlFor="pt">Prior therapies</label>
            <input id="pt" value={f.priorTherapies} onChange={set('priorTherapies')} placeholder="comma-separated" />
          </div>
          <div>
            <label htmlFor="meds">Current medications (for PGx)</label>
            <input id="meds" value={f.currentMedications} onChange={set('currentMedications')} placeholder="comma-separated" />
          </div>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="fh">Family history</label>
          <input id="fh" value={f.familyHistory} onChange={set('familyHistory')} placeholder="e.g. mother: breast cancer at 45" />
          {errFor('patient.familyHistory') && <div className="field-error">{errFor('patient.familyHistory')}</div>}
        </div>
      </div>

      <div className="card">
        <h2>Approximate location (optional)</h2>
        <p className="muted small">Used only to sort clinical trials by distance to the nearest recruiting site. Only a 3-digit postal prefix or a city is accepted.</p>
        <div className="grid2">
          <div>
            <label htmlFor="cty">Country</label>
            <select id="cty" value={f.country} onChange={(e) => setF((s) => ({ ...s, country: e.target.value, locKind: e.target.value === 'US' ? 'zip3' : 'pin3', locValue: '' }))}>
              <option value="US">United States</option>
              <option value="IN">India</option>
            </select>
          </div>
          <div>
            <label htmlFor="lk">Location type</label>
            <select id="lk" value={f.locKind} onChange={(e) => setF((s) => ({ ...s, locKind: e.target.value, locValue: '' }))}>
              {f.country === 'US' ? <option value="zip3">First 3 digits of ZIP</option> : <option value="pin3">First 3 digits of PIN code</option>}
              <option value="city">{f.country === 'US' ? 'City' : 'City / district'}</option>
            </select>
          </div>
          <div>
            <label htmlFor="lv">{f.locKind === 'city' ? 'City' : f.locKind === 'zip3' ? 'ZIP prefix' : 'PIN prefix'}</label>
            <input id="lv" value={f.locValue} onChange={set('locValue')} list="city-options" maxLength={f.locKind === 'city' ? 80 : 3} placeholder={f.locKind === 'zip3' ? 'e.g. 021' : f.locKind === 'pin3' ? 'e.g. 411' : f.country === 'US' ? 'e.g. Boston, MA' : 'e.g. Pune'} />
            <datalist id="city-options">{cities.data?.map((c) => <option key={c.label} value={c.label} />)}</datalist>
            {errFor('location') && <div className="field-error">{errFor('location')}</div>}
          </div>
        </div>
      </div>

      <div className="row">
        <button className="primary" disabled={busy}>{busy ? 'Uploading…' : 'Create case and start analysis'}</button>
        <button type="button" className="ghost" onClick={() => nav('/')}>Cancel</button>
      </div>
    </form>
  );
}
