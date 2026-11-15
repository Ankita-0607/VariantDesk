import { callDiplotypes, PgxInputVariant } from '../src/kb/pgx';

const v = (rsId: string, zygosity = 'heterozygous'): PgxInputVariant => ({ chrom: '0', pos: 0, ref: 'N', alt: 'N', rsIds: [rsId], zygosity });
const call = (vs: PgxInputVariant[], gene: string) => callDiplotypes(vs, 'GRCh38').find((c) => c.gene === gene)!;

describe('PGx diplotype caller', () => {
  it('defaults to *1/*1 with a coverage caveat', () => {
    const c = call([], 'CYP2C19');
    expect(c.diplotype).toBe('*1/*1');
    expect(c.caveats.join(' ')).toMatch(/assumed to be reference/);
  });
  it('CYP2C19 *2/*17 compound heterozygote', () => {
    expect(call([v('rs4244285'), v('rs12248560')], 'CYP2C19').diplotype).toBe('*2/*17');
  });
  it('homozygous call', () => {
    expect(call([v('rs4244285', 'homozygous')], 'CYP2C19').diplotype).toBe('*2/*2');
  });
  it('matches by GRCh38 position when the VCF has no rsID', () => {
    const c = callDiplotypes([{ chrom: '10', pos: 94781859, ref: 'G', alt: 'A', rsIds: [], zygosity: 'heterozygous' }], 'GRCh38').find((x) => x.gene === 'CYP2C19')!;
    expect(c.diplotype).toBe('*1/*2');
  });
  it('TPMT *3B + *3C → *1/*3A with phase caveat', () => {
    const c = call([v('rs1800460'), v('rs1142345')], 'TPMT');
    expect(c.diplotype).toBe('*1/*3A');
    expect(c.caveats.join(' ')).toMatch(/cis/);
  });
  it('DPYD activity score', () => {
    expect(call([v('rs67376798')], 'DPYD')).toMatchObject({ diplotype: 'c.2846A>T/Reference', activityScore: '1.5' });
    expect(call([v('rs3918290', 'homozygous')], 'DPYD').activityScore).toBe('0.0');
  });
  it('more than two alleles is indeterminate', () => {
    expect(call([v('rs4244285', 'homozygous'), v('rs12248560')], 'CYP2C19').diplotype).toBeUndefined();
  });
});
