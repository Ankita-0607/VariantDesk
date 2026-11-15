import { classifyGermline, classifySomatic, pointsToClass } from '../src/interpret/rules';
import { diseaseMatches, normalizeDiagnosisByRules } from '../src/interpret/tumor-types';
import { toProteinShort } from '../src/kb/protein';
import { matchesVariant, reviewStars } from '../src/kb/clinvar.client';
import { Annotation, EvidenceDraft } from '../src/kb/types';

const ann = (p: Partial<Annotation>): Annotation => ({ rsIds: [], popFreq: {}, pubmedIds: [], ...p });

describe('protein notation', () => {
  it.each([
    ['ENSP1.1:p.Val600Glu', 'V600E'],
    ['p.Glu746_Ala750del', 'E746_A750del'],
    ['p.Arg1443Ter', 'R1443*'],
    ['p.(Leu858Arg)', 'L858R'],
    ['p.Leu858%3D', undefined],
  ])('%s → %s', (i, o) => expect(toProteinShort(i)).toBe(o));
});

describe('germline ACMG points', () => {
  it('maps points per Tavtigian 2020', () => {
    expect([10, 6, 0, -1, -7].map(pointsToClass)).toEqual(['Pathogenic', 'Likely pathogenic', 'Uncertain significance', 'Likely benign', 'Benign']);
  });
  it('frameshift in BRCA1, absent from gnomAD → Likely pathogenic (PVS1 + PM2_Supporting)', () => {
    const g = classifyGermline(ann({ gene: 'BRCA1', consequence: 'frameshift_variant', consequences: ['frameshift_variant'], exon: '2/23' }), []);
    expect(g.criteria.map((c) => c.code)).toEqual(['PM2_Supporting', 'PVS1']);
    expect(g.classification).toBe('Likely pathogenic');
  });
  it('last-exon nonsense downgrades PVS1', () => {
    const g = classifyGermline(ann({ gene: 'BRCA1', consequence: 'stop_gained', consequences: ['stop_gained'], exon: '23/23' }), []);
    expect(g.criteria.map((c) => c.code)).toContain('PVS1_Moderate');
  });
  it('common variant is BA1 Benign regardless of other criteria', () => {
    const g = classifyGermline(ann({ gene: 'BRCA1', consequence: 'stop_gained', consequences: ['stop_gained'], popFreq: { gnomade_sas: 0.2 } }), []);
    expect(g.classification).toBe('Benign');
  });
  it('adopts ClinVar expert-panel classification and notes the difference', () => {
    const cv: EvidenceDraft = { source: 'CLINVAR', category: 'PATHOGENICITY', significance: 'Pathogenic', summary: '', meta: { stars: 3 } };
    const g = classifyGermline(ann({ gene: 'XYZ', consequence: 'missense_variant', consequences: ['missense_variant'] }), [cv]);
    expect(g.classification).toBe('Pathogenic');
    expect(g.notes.join(' ')).toMatch(/Adopted ClinVar 3★/);
  });
  it('flags (but does not adopt) a conflicting 2★ ClinVar call', () => {
    const cv: EvidenceDraft = { source: 'CLINVAR', category: 'PATHOGENICITY', significance: 'Benign', summary: '', meta: { stars: 2 } };
    const g = classifyGermline(ann({ gene: 'BRCA1', consequence: 'frameshift_variant', consequences: ['frameshift_variant'], exon: '2/23' }), [cv]);
    expect(g.classification).toBe('Likely pathogenic');
    expect(g.notes.join(' ')).toMatch(/analyst review required/);
  });
  it('notes high frequency in the patient ancestry (South Asian)', () => {
    const g = classifyGermline(ann({ gene: 'X', consequence: 'missense_variant', consequences: ['missense_variant'], popFreq: { gnomade_sas: 0.02, gnomade_nfe: 0.0 } }), [], 'south_asian');
    expect(g.criteria.map((c) => c.code)).toContain('BS1');
  });
});

describe('somatic AMP tiers', () => {
  const civ = (level: string, disease: string): EvidenceDraft => ({ source: 'CIVIC', sourceId: 'EID1', category: 'THERAPEUTIC', level, disease, summary: '', meta: { kind: 'evidence' } });
  it('level A in same tumour type → Tier I-A', () => {
    expect(classifySomatic(ann({ gene: 'EGFR' }), [civ('A', 'Lung Non-small Cell Carcinoma')], 'NSCLC')).toMatchObject({ tier: 'Tier I', level: 'A' });
  });
  it('level A in another tumour type → Tier II-C', () => {
    expect(classifySomatic(ann({ gene: 'BRAF' }), [civ('A', 'Melanoma')], 'NSCLC')).toMatchObject({ tier: 'Tier II', level: 'C' });
  });
  it('pan-cancer evidence counts as same tumour', () => {
    expect(classifySomatic(ann({ gene: 'NTRK1' }), [civ('A', 'Cancer')], 'COADREAD')).toMatchObject({ tier: 'Tier I' });
  });
  it('ignores "does not support" evidence', () => {
    const e = { ...civ('A', 'Lung Non-small Cell Carcinoma'), direction: 'Does not support' };
    expect(classifySomatic(ann({ gene: 'EGFR', consequences: ['missense_variant'] }), [e], 'NSCLC').tier).toBe('Tier III');
  });
  it('common polymorphism → Tier IV', () => {
    expect(classifySomatic(ann({ gene: 'TP53', consequences: ['missense_variant'], popFreq: { gnomade: 0.6 } }), [], 'NSCLC').tier).toBe('Tier IV');
  });
  it('AMP assertion level is used directly', () => {
    const a: EvidenceDraft = { source: 'CIVIC', sourceId: 'AID7', category: 'THERAPEUTIC', disease: 'Melanoma', level: 'Tier I Level A', summary: '', meta: { kind: 'assertion', ampLevel: 'TIER_I_LEVEL_A' } };
    expect(classifySomatic(ann({ gene: 'BRAF' }), [a], 'MEL')).toMatchObject({ tier: 'Tier I', level: 'A' });
  });
});

describe('tumour vocabulary', () => {
  it('prefers the diagnosis over the indication', () => {
    expect(normalizeDiagnosisByRules('Breast cancer, triple negative', 'hereditary risk; family history').code).toBe('BRCA');
    expect(normalizeDiagnosisByRules('', 'hereditary cancer risk').code).toBe('HEREDITARY');
  });
  it('distinguishes NSCLC from SCLC', () => {
    expect(normalizeDiagnosisByRules('metastatic lung adenocarcinoma').code).toBe('NSCLC');
    expect(normalizeDiagnosisByRules('extensive small cell lung cancer').code).toBe('SCLC');
    expect(diseaseMatches('Small Cell Lung Carcinoma', 'NSCLC')).toBe(false);
  });
  it('oral cavity cancer (common in India) maps to HNSC', () => {
    expect(normalizeDiagnosisByRules('Carcinoma of buccal mucosa').code).toBe('HNSC');
  });
});

describe('ClinVar helpers', () => {
  it('review stars', () => {
    expect(reviewStars('reviewed by expert panel')).toBe(3);
    expect(reviewStars('criteria provided, multiple submitters, no conflicts')).toBe(2);
    expect(reviewStars('no assertion criteria provided')).toBe(0);
  });
  it('matches SNVs by SPDI on GRCh38 and indels by HGVS', () => {
    const snv = { variation_set: [{ canonical_spdi: 'NC_000007.14:140753335:A:T' }] };
    expect(matchesVariant(snv, { chrom: '7', pos: 140753336, ref: 'A', alt: 'T', build: 'GRCh38' })).toBe(true);
    expect(matchesVariant(snv, { chrom: '7', pos: 140753336, ref: 'A', alt: 'G', build: 'GRCh38' })).toBe(false);
    const del = { variation_set: [{ variation_name: 'NM_007294.4(BRCA1):c.68_69del (p.Glu23fs)' }] };
    expect(matchesVariant(del, { chrom: '17', pos: 43124027, ref: 'ACT', alt: 'A', build: 'GRCh38' }, ann({ gene: 'BRCA1', hgvsc: 'ENST00000357654.9:c.68_69del' }))).toBe(true);
  });
});
