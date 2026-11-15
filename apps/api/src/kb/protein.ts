const AA: Record<string, string> = {
  Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G', His: 'H', Ile: 'I',
  Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V',
  Ter: '*', Sec: 'U', Pyl: 'O', Xaa: 'X',
};

/**
 * "ENSP0000.1:p.Val600Glu" → "V600E"; "p.Glu746_Ala750del" → "E746_A750del";
 * "p.Arg1443Ter" → "R1443*". Returns undefined for synonymous/unknown changes.
 */
export function toProteinShort(hgvsp?: string): string | undefined {
  if (!hgvsp) return undefined;
  let p = decodeURIComponent(hgvsp);
  const idx = p.indexOf('p.');
  if (idx < 0) return undefined;
  p = p.slice(idx + 2).replace(/[()]/g, '');
  if (p.includes('=')) return undefined;
  const out = p.replace(/(Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val|Ter|Sec|Pyl|Xaa)/g, (m) => AA[m]);
  return out || undefined;
}
