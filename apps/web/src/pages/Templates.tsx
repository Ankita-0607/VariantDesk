import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Template } from '../api';
import { useAuth } from '../auth';
import { Badge, ErrorBox, Spinner, useDebounced } from '../components/ui';

type Draft = Pick<Template, 'name' | 'theme' | 'sections'>;

export function TemplatesPage() {
  const { can } = useAuth();
  const isAdmin = can();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/templates') });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState<unknown>(null);
  const selected = list.data?.find((t) => t.id === selectedId) ?? list.data?.[0];

  useEffect(() => {
    if (selected) setDraft({ name: selected.name, theme: { ...selected.theme }, sections: selected.sections.map((s) => ({ ...s })) });
  }, [selected?.id, selected?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const debounced = useDebounced(draft, 600);
  useEffect(() => {
    if (!debounced) return;
    let url: string | null = null;
    api.pdfUrl('/templates/preview', { theme: debounced.theme, sections: debounced.sections })
      .then((u) => { url = u; setPreview(u); setPreviewErr(null); })
      .catch(setPreviewErr);
    return () => { if (url) setTimeout(() => URL.revokeObjectURL(url!), 5000); };
  }, [debounced]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['templates'] });
  const save = useMutation({ mutationFn: () => api.patch(`/templates/${selected!.id}`, draft), onSuccess: refresh });
  const create = useMutation({
    mutationFn: () => api.post<Template>('/templates', { ...draft!, name: `${draft!.name} copy ${Date.now() % 1000}` }),
    onSuccess: (t) => { refresh(); setSelectedId(t.id); },
  });
  const makeDefault = useMutation({ mutationFn: () => api.post(`/templates/${selected!.id}/default`), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api.del(`/templates/${selected!.id}`), onSuccess: () => { setSelectedId(null); refresh(); } });

  if (list.isLoading || !draft || !selected) return <div className="empty"><Spinner /></div>;
  const t = draft.theme;
  const setTheme = (patch: Partial<Template['theme']>) => setDraft((d) => d && { ...d, theme: { ...d.theme, ...patch } });
  const moveSection = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const s = [...d.sections];
      const j = i + dir;
      if (j < 0 || j >= s.length) return d;
      [s[i], s[j]] = [s[j], s[i]];
      return { ...d, sections: s };
    });

  function onLogo(file?: File) {
    if (!file) return;
    if (file.size > 500_000) return alert('Logo must be under 500 KB');
    const reader = new FileReader();
    reader.onload = () => setTheme({ logoDataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <div className="stack">
      <div className="spread">
        <h1>Report templates</h1>
        <div className="row">
          <select value={selected.id} onChange={(e) => setSelectedId(e.target.value)} style={{ width: 'auto' }} aria-label="Template">
            {list.data!.map((x) => <option key={x.id} value={x.id}>{x.name}{x.isDefault ? ' (default)' : ''}</option>)}
          </select>
          {isAdmin && <button onClick={() => create.mutate()}>Duplicate</button>}
          {isAdmin && !selected.isDefault && <button onClick={() => makeDefault.mutate()}>Make default</button>}
          {isAdmin && !selected.isDefault && <button className="danger" onClick={() => confirm('Delete this template?') && remove.mutate()}>Delete</button>}
          {isAdmin && <button className="primary" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save template'}</button>}
        </div>
      </div>
      {!isAdmin && <div className="alert info">Only admins can change templates.</div>}
      <ErrorBox error={save.error ?? create.error ?? remove.error ?? makeDefault.error} />
      {save.isSuccess && <div className="alert ok">Saved. New and draft reports using this template will use the changes; signed reports are unaffected.</div>}

      <div className="workspace" style={{ gridTemplateColumns: 'minmax(320px, 460px) 1fr' }}>
        <fieldset disabled={!isAdmin} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="card">
            <h3>Branding</h3>
            <div className="stack">
              <div><label>Template name</label><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
              <div><label>Laboratory name</label><input value={t.labName} onChange={(e) => setTheme({ labName: e.target.value })} /></div>
              <div><label>Address</label><input value={t.labAddress} onChange={(e) => setTheme({ labAddress: e.target.value })} /></div>
              <div><label>Accreditation</label><input value={t.accreditation} onChange={(e) => setTheme({ accreditation: e.target.value })} placeholder="e.g. CLIA #12D3456789 · CAP · NABL MC-1234" /></div>
              <div><label>Header title</label><input value={t.headerText} onChange={(e) => setTheme({ headerText: e.target.value })} /></div>
              <div><label>Footer text</label><input value={t.footerText} onChange={(e) => setTheme({ footerText: e.target.value })} /></div>
              <div>
                <label>Logo (PNG/JPEG, &lt; 500 KB)</label>
                <div className="row">
                  {t.logoDataUrl && <img src={t.logoDataUrl} alt="Logo" style={{ maxHeight: 36, maxWidth: 140 }} />}
                  <input type="file" accept="image/png,image/jpeg" onChange={(e) => onLogo(e.target.files?.[0])} style={{ width: 'auto' }} />
                  {t.logoDataUrl && <button className="small" onClick={() => setTheme({ logoDataUrl: '' })}>Remove</button>}
                </div>
              </div>
            </div>
          </div>
          <div className="card">
            <h3>Theme</h3>
            <div className="grid2">
              <div><label>Primary colour</label><input type="color" value={t.primaryColor} onChange={(e) => setTheme({ primaryColor: e.target.value })} /></div>
              <div><label>Accent colour</label><input type="color" value={t.accentColor} onChange={(e) => setTheme({ accentColor: e.target.value })} /></div>
              <div><label>Text colour</label><input type="color" value={t.textColor} onChange={(e) => setTheme({ textColor: e.target.value })} /></div>
              <div><label>Font</label><select value={t.fontFamily} onChange={(e) => setTheme({ fontFamily: e.target.value as any })}><option>Helvetica</option><option>Times</option><option>Courier</option></select></div>
              <div><label>Base font size: {t.fontSize}pt</label><input type="range" min={7} max={12} step={0.5} value={t.fontSize} onChange={(e) => setTheme({ fontSize: Number(e.target.value) })} /></div>
              <div><label className="check" style={{ marginTop: '1.4rem' }}><input type="checkbox" checked={t.draftWatermark} onChange={(e) => setTheme({ draftWatermark: e.target.checked })} /> “DRAFT” watermark on unsigned reports</label></div>
            </div>
          </div>
          <div className="card">
            <h3>Sections</h3>
            <p className="hint">Order, rename or hide report sections. Empty sections are skipped automatically.</p>
            {draft.sections.map((s, i) => (
              <div key={s.key} className="row" style={{ padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>
                <input type="checkbox" checked={s.enabled} aria-label={`Show ${s.title}`} onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} />
                <input value={s.title} onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} style={{ flex: 1, minWidth: 120 }} />
                <Badge tone="outline">{s.key}</Badge>
                <button className="small ghost" onClick={() => moveSection(i, -1)} aria-label="Move up">↑</button>
                <button className="small ghost" onClick={() => moveSection(i, 1)} aria-label="Move down">↓</button>
              </div>
            ))}
          </div>
        </fieldset>
        <div className="card" style={{ position: 'sticky', top: 70 }}>
          <div className="spread"><h3 style={{ margin: 0 }}>Live preview</h3><span className="muted small">sample data</span></div>
          <ErrorBox error={previewErr} />
          {preview ? <iframe title="Template preview" className="preview-frame" src={preview} style={{ marginTop: '0.6rem' }} /> : <div className="empty"><Spinner /></div>}
        </div>
      </div>
    </div>
  );
}
