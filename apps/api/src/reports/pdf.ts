import { Theme } from './template.defaults';
import type { AssembledReport } from './reports.service';

// pdfmake 0.2 (server-side, standard PDF fonts → no font files to ship)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter = require('pdfmake');

const FONTS = {
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
  Times: { normal: 'Times-Roman', bold: 'Times-Bold', italics: 'Times-Italic', bolditalics: 'Times-BoldItalic' },
  Courier: { normal: 'Courier', bold: 'Courier-Bold', italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique' },
};
const printer = new PdfPrinter(FONTS);

/** Standard PDF fonts only support WinAnsi; map common symbols and strip the rest. */
export function pdfText(s: unknown): string {
  return String(s ?? '')
    .replace(/★/g, '*')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/→/g, '->')
    .replace(/µ/g, 'u')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•…]/g, '');
}

/** Replace [E3] citation aliases with numbered references [n]. */
function cite(text: string, citations: Record<string, string>, refIndex: Map<string, number>) {
  return pdfText(
    text.replace(/\[(E\d+)\]/g, (_, a) => {
      const id = citations[a];
      const n = id ? refIndex.get(id) : undefined;
      return n ? `[${n}]` : '';
    }).replace(/(\[\d+\])(?:\s*\1)+/g, '$1'),
  );
}

export function renderPdf(r: AssembledReport, theme: Theme, sections: Array<{ key: string; title: string; enabled: boolean }>): Promise<Buffer> {
  const T = theme;
  const draft = r.report.status !== 'SIGNED';
  const heading = (title: string) => ({ text: pdfText(title), style: 'h2', margin: [0, 12, 0, 4] });
  const table = (headers: string[], rows: string[][], widths: Array<string | number>) => ({
    table: {
      headerRows: 1,
      widths,
      body: [headers.map((h) => ({ text: h, style: 'th' })), ...rows.map((row) => row.map((c) => ({ text: pdfText(c), fontSize: T.fontSize - 0.5 })))],
    },
    layout: {
      fillColor: (i: number) => (i === 0 ? T.primaryColor : i % 2 === 0 ? '#f3f6f9' : null),
      hLineColor: () => '#d0d7de',
      vLineColor: () => '#d0d7de',
    },
    margin: [0, 2, 0, 6],
  });
  const empty = (msg: string) => ({ text: msg, italics: true, color: '#666666' });

  // Reference numbering in order of first appearance.
  // Several evidence rows can come from one source record (e.g. ClinVar germline + somatic) → one reference.
  const refIndex = new Map<string, number>();
  const refByKey = new Map<string, number>();
  const firstIdOfRef = new Map<number, string>();
  const register = (citations: Record<string, string>, text: string) => {
    for (const m of text.matchAll(/\[(E\d+)\]/g)) {
      const id = citations[m[1]];
      if (!id || refIndex.has(id)) continue;
      const e = r.evidenceById.get(id);
      const key = e ? `${e.source}|${e.sourceId ?? e.id}` : id;
      let n = refByKey.get(key);
      if (!n) {
        n = refByKey.size + 1;
        refByKey.set(key, n);
        firstIdOfRef.set(n, id);
      }
      refIndex.set(id, n);
    }
  };
  register(r.content.summary.citations, r.content.summary.text);
  for (const f of [...r.somatic, ...r.germline]) if (f.narrative) register(f.narrative.citations, f.narrative.text);

  const content: any[] = [];
  const blocks: Record<string, () => any[]> = {
    patient: () => [
      {
        table: {
          widths: ['auto', '*', 'auto', '*'],
          body: [
            ['Case code', r.case.caseCode, 'Report version', `v${r.report.version} (${r.report.status})`],
            ['Age / sex', `${r.patient.ageYears ?? 'n/a'} / ${r.patient.sex}`, 'Sample type', r.case.sampleType.replace('_', '/')],
            ['Diagnosis', r.diagnosisLabel, 'Genome build', r.case.genomeBuild],
            ['Indication', r.patient.indication ?? '—', 'Assay', r.case.assay ?? '—'],
          ].map((row) => row.map((c, i) => ({ text: pdfText(c), bold: i % 2 === 0, fontSize: T.fontSize }))),
        },
        layout: 'lightHorizontalLines',
      },
    ],
    summary: () => [{ text: cite(r.content.summary.text || 'Summary not yet written.', r.content.summary.citations, refIndex), margin: [0, 0, 0, 4] }],
    somatic: () =>
      r.case.sampleType === 'germline'
        ? []
        : r.somatic.length
          ? r.somatic.flatMap((f) => [
              table(['Gene', 'Variant', 'VAF', 'Tier'], [[f.gene ?? '', f.change, f.vaf != null ? `${(f.vaf * 100).toFixed(1)}%` : '—', f.classification]], ['auto', '*', 'auto', 'auto']),
              ...(f.narrative ? [{ text: cite(f.narrative.text, f.narrative.citations, refIndex), margin: [0, 0, 0, 2] }] : []),
              ...(f.therapies.length ? [{ text: pdfText(`Therapies with associated evidence: ${f.therapies.join(', ')}`), italics: true, fontSize: T.fontSize - 0.5, margin: [0, 0, 0, 6] }] : []),
            ])
          : [empty('No Tier I/II somatic variants were identified.')],
    germline: () =>
      r.case.sampleType === 'tumor'
        ? []
        : r.germline.length
          ? r.germline.flatMap((f) => [
              table(['Gene', 'Variant', 'Zygosity', 'Classification'], [[f.gene ?? '', f.change, f.zygosity ?? '—', f.classification]], ['auto', '*', 'auto', 'auto']),
              ...(f.narrative ? [{ text: cite(f.narrative.text, f.narrative.citations, refIndex), margin: [0, 0, 0, 6] }] : []),
            ])
          : [empty('No pathogenic or likely pathogenic germline variants were identified.')],
    pgx: () =>
      r.pgx.length
        ? [
            table(['Gene', 'Diplotype', 'Phenotype'], r.pgx.map((p) => [p.gene, p.diplotype ?? 'Indeterminate', p.phenotype ?? '—']), ['auto', '*', '*']),
            ...r.pgx
              .filter((p) => p.recommendations.length)
              .map((p) => ({
                stack: [
                  { text: pdfText(`${p.gene} — ${p.phenotype}`), bold: true, margin: [0, 4, 0, 1] },
                  { ul: p.recommendations.slice(0, 8).map((x) => pdfText(`${x.drug}: ${x.recommendation}${x.classification ? ` (CPIC: ${x.classification})` : ''}`)), fontSize: T.fontSize - 0.5 },
                ],
              })),
            { text: pdfText(`Not assessed: ${r.pgxNotAssessed.join(', ')}.`), italics: true, fontSize: T.fontSize - 1, margin: [0, 4, 0, 0] },
          ]
        : [empty('No pharmacogenomic results selected for this report.')],
    trials: () =>
      r.trials.length
        ? [
            table(
              ['Trial', 'Title', 'Phase', 'Nearest recruiting site'],
              r.trials.map((t) => [t.nctId, t.title, t.phase ?? '—', t.nearest ? `${[t.nearest.facility, t.nearest.city, t.nearest.state, t.nearest.country].filter(Boolean).join(', ')}${t.distanceKm != null ? ` (~${t.distanceKm} km)` : ''}` : '—']),
              ['auto', '*', 'auto', '*'],
            ),
            { text: 'Trial matches are a screening aid; eligibility must be confirmed with the trial team. Distances are approximate (postal-prefix centroid).', italics: true, fontSize: T.fontSize - 1 },
          ]
        : [empty('No clinical trials selected for this report.')],
    vus: () =>
      r.vus.length ? [table(['Gene', 'Variant', 'Classification'], r.vus.map((v) => [v.gene ?? '', v.change, v.classification]), ['auto', '*', 'auto'])] : [],
    recommendations: () => (r.content.recommendations?.trim() ? [{ text: pdfText(r.content.recommendations) }] : []),
    methodology: () => [{ text: pdfText(r.content.methodology), fontSize: T.fontSize - 0.5 }],
    limitations: () => [{ text: pdfText(r.content.limitations), fontSize: T.fontSize - 0.5 }],
    references: () => {
      const refs = [...firstIdOfRef.entries()].map(([n, id]) => {
        const e = r.evidenceById.get(id);
        return e ? pdfText(`[${n}] ${e.source}${e.sourceId ? ` ${e.sourceId}` : ''}${e.citation ? ` — ${e.citation}` : ''}${e.url ? ` ${e.url}` : ''}`) : `[${n}]`;
      });
      return refs.length ? [{ stack: refs, fontSize: T.fontSize - 1 }] : [];
    },
    ai_disclosure: () => [
      {
        text: pdfText(
          r.ai.used
            ? `Parts of this report (summary, variant interpretations, evidence prioritisation, trial pre-screening) were drafted with AI assistance (${r.ai.model}). All AI output passed automated guardrails (PHI screening, citation grounding, drug and dosing checks) and was reviewed and accepted by laboratory staff. Variant classifications were produced by deterministic, guideline-based rules, not by AI. Full AI audit records are retained by the laboratory.`
            : 'No AI-generated text is included in this report.',
        ),
        fontSize: T.fontSize - 0.5,
      },
    ],
    signatures: () => [
      {
        columns: [
          { stack: [{ text: 'Analysed / submitted by', bold: true }, pdfText(r.submittedBy ?? '—'), pdfText(r.report.submittedAt ? new Date(r.report.submittedAt).toISOString().slice(0, 10) : '')] },
          { stack: [{ text: 'Reviewed and signed by (Laboratory Director)', bold: true }, pdfText(r.signedBy ?? (draft ? 'NOT SIGNED — DRAFT' : '—')), pdfText(r.report.signedAt ? new Date(r.report.signedAt).toISOString().slice(0, 10) : '')] },
        ],
        margin: [0, 4, 0, 0],
      },
    ],
  };

  for (const s of sections) {
    if (!s.enabled || !blocks[s.key]) continue;
    const body = blocks[s.key]();
    if (!body.length) continue;
    content.push(heading(s.title), ...body);
  }

  const doc = {
    pageSize: 'LETTER',
    pageMargins: [40, 80, 40, 50],
    defaultStyle: { font: T.fontFamily, fontSize: T.fontSize, color: T.textColor, lineHeight: 1.2 },
    styles: {
      h2: { fontSize: T.fontSize + 3, bold: true, color: T.primaryColor },
      th: { bold: true, color: '#ffffff', fontSize: T.fontSize - 0.5 },
    },
    watermark: draft && T.draftWatermark ? { text: 'DRAFT', color: T.accentColor, opacity: 0.08, bold: true } : undefined,
    header: () => ({
      margin: [40, 20, 40, 0],
      columns: [
        ...(T.logoDataUrl ? [{ image: T.logoDataUrl, fit: [110, 40], width: 120 }] : []),
        {
          stack: [
            { text: pdfText(T.labName), bold: true, fontSize: T.fontSize + 4, color: T.primaryColor },
            { text: pdfText([T.labAddress, T.accreditation].filter(Boolean).join(' · ')), fontSize: T.fontSize - 1.5, color: '#555555' },
          ],
        },
        { text: pdfText(T.headerText), alignment: 'right', bold: true, color: T.accentColor, fontSize: T.fontSize + 1, width: 180 },
      ],
    }),
    footer: (page: number, pages: number) => ({
      margin: [40, 10, 40, 0],
      columns: [
        { text: pdfText(`${T.footerText}  Case ${r.case.caseCode} · v${r.report.version}`), fontSize: T.fontSize - 2, color: '#666666' },
        { text: `Page ${page} of ${pages}`, alignment: 'right', fontSize: T.fontSize - 2, color: '#666666', width: 70 },
      ],
    }),
    content,
    info: { title: `VariantDesk report ${r.case.caseCode} v${r.report.version}`, creator: 'VariantDesk' },
  };

  return new Promise((resolve, reject) => {
    const pdf = printer.createPdfKitDocument(doc);
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}
