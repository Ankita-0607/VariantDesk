/**
 * Minimal, dependency-free VCF 4.x parser.
 * - Splits multi-allelic records into one record per ALT.
 * - Reads GT / AD / DP / AF from the first sample column (or INFO AF/DP as fallback).
 * - Never retains header lines or sample names (they can contain identifiers).
 */
export interface ParsedVariant {
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  rsId?: string;
  filter?: string;
  genotype?: string;
  zygosity?: 'heterozygous' | 'homozygous' | 'hemizygous' | 'unknown';
  vaf?: number;
  depth?: number;
}

export interface VcfParseResult {
  variants: ParsedVariant[];
  stats: {
    fileFormat?: string;
    declaredReference?: string;
    sampleCount: number;
    recordLines: number;
    variantsParsed: number;
    skippedNonPass: number;
    skippedSymbolic: number;
    skippedRefCalls: number;
    warnings: string[];
  };
}

export function normalizeChrom(c: string): string {
  const s = c.replace(/^chr/i, '');
  return s === 'M' ? 'MT' : s;
}

export function parseVcf(text: string, opts: { passOnly?: boolean } = {}): VcfParseResult {
  const passOnly = opts.passOnly ?? true;
  const stats: VcfParseResult['stats'] = {
    sampleCount: 0,
    recordLines: 0,
    variantsParsed: 0,
    skippedNonPass: 0,
    skippedSymbolic: 0,
    skippedRefCalls: 0,
    warnings: [],
  };
  const variants: ParsedVariant[] = [];
  let sawHeader = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith('##')) {
      const m = line.match(/^##fileformat=(.+)$/);
      if (m) stats.fileFormat = m[1];
      const r = line.match(/^##reference=(.+)$/);
      if (r) stats.declaredReference = r[1].slice(0, 200);
      continue;
    }
    if (line.startsWith('#CHROM')) {
      sawHeader = true;
      stats.sampleCount = Math.max(0, line.split('\t').length - 9);
      continue;
    }
    if (!sawHeader) throw new Error('Invalid VCF: missing #CHROM header line');
    stats.recordLines++;
    const cols = line.split('\t');
    if (cols.length < 8) throw new Error(`Invalid VCF record (expected ≥ 8 columns) at record ${stats.recordLines}`);
    const [chrom, posStr, id, ref, altField, , filter, info, format, sample] = cols;
    const pos = Number(posStr);
    if (!Number.isInteger(pos) || pos < 1) throw new Error(`Invalid POS "${posStr}" at record ${stats.recordLines}`);
    if (passOnly && filter && filter !== 'PASS' && filter !== '.') {
      stats.skippedNonPass++;
      continue;
    }
    const alts = altField.split(',');
    const fmt = format ? format.split(':') : [];
    const smp = sample ? sample.split(':') : [];
    const field = (k: string) => {
      const i = fmt.indexOf(k);
      return i >= 0 ? smp[i] : undefined;
    };
    const infoMap = new Map<string, string>();
    for (const kv of (info ?? '').split(';')) {
      const [k, v] = kv.split('=');
      if (k) infoMap.set(k, v ?? 'true');
    }
    const gt = field('GT');
    const ad = field('AD')?.split(',').map(Number);
    const dp = Number(field('DP') ?? infoMap.get('DP'));
    const afFmt = field('AF')?.split(',').map(Number);
    const afInfo = infoMap.get('AF')?.split(',').map(Number);

    alts.forEach((alt, idx) => {
      if (alt === '.' || alt === '*' || alt === '<NON_REF>') {
        stats.skippedRefCalls++;
        return;
      }
      if (alt.startsWith('<') || /[\[\]]/.test(alt)) {
        stats.skippedSymbolic++;
        return;
      }
      const alleleNo = idx + 1;
      const gtAlleles = gt?.split(/[\/|]/) ?? [];
      if (gt && gtAlleles.length && !gtAlleles.includes(String(alleleNo))) {
        // Sample does not carry this ALT (e.g. multi-sample site) — skip.
        stats.skippedRefCalls++;
        return;
      }
      let vaf: number | undefined;
      if (ad && ad.length > alleleNo && ad.every((n) => Number.isFinite(n))) {
        const total = ad.reduce((a, b) => a + b, 0);
        if (total > 0) vaf = ad[alleleNo] / total;
      }
      vaf ??= afFmt?.[idx] ?? afInfo?.[idx];
      const carried = gtAlleles.filter((a) => a === String(alleleNo)).length;
      const zygosity: ParsedVariant['zygosity'] =
        gtAlleles.length === 1 ? 'hemizygous' : carried === 2 ? 'homozygous' : carried === 1 ? 'heterozygous' : 'unknown';
      variants.push({
        chrom: normalizeChrom(chrom),
        pos,
        ref: ref.toUpperCase(),
        alt: alt.toUpperCase(),
        rsId: id && id !== '.' ? id.split(';').find((x) => x.startsWith('rs')) : undefined,
        filter: filter || undefined,
        genotype: gt,
        zygosity: gt ? zygosity : 'unknown',
        vaf: vaf !== undefined && Number.isFinite(vaf) ? Math.round(vaf * 1000) / 1000 : undefined,
        depth: Number.isFinite(dp) ? dp : undefined,
      });
    });
  }
  if (!sawHeader) throw new Error('Invalid VCF: missing #CHROM header line');
  if (stats.sampleCount > 1) stats.warnings.push('Multiple samples found; only the first sample column is used.');
  stats.variantsParsed = variants.length;
  return { variants, stats };
}

/** Guess the genome build from header hints; returns undefined if unclear. */
export function guessBuild(declaredReference?: string): 'GRCh37' | 'GRCh38' | undefined {
  if (!declaredReference) return undefined;
  if (/grch38|hg38|GCA_000001405\.15/i.test(declaredReference)) return 'GRCh38';
  if (/grch37|hg19|b37|hs37d5/i.test(declaredReference)) return 'GRCh37';
  return undefined;
}
