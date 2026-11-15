import { parseVcf, guessBuild } from '../src/vcf/vcf.parser';

const HDR = '##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tPATIENT_NAME_X\n';

describe('VCF parser', () => {
  it('parses GT/AD/DP, normalises chr, computes VAF', () => {
    const r = parseVcf(HDR + 'chr7\t55191822\t.\tT\tG\t60\tPASS\tDP=455\tGT:AD:DP\t0/1:300,155:455\n');
    expect(r.variants).toEqual([expect.objectContaining({ chrom: '7', pos: 55191822, ref: 'T', alt: 'G', zygosity: 'heterozygous', vaf: 0.341, depth: 455 })]);
  });
  it('splits multi-allelic records and skips ALTs the sample does not carry', () => {
    const r = parseVcf(HDR + '1\t100\trs1\tA\tC,G\t50\tPASS\t.\tGT:AD\t1/1:0,20,0\n');
    expect(r.variants.map((v) => v.alt)).toEqual(['C']);
    expect(r.variants[0].zygosity).toBe('homozygous');
    expect(r.variants[0].rsId).toBe('rs1');
  });
  it('drops non-PASS, symbolic and reference calls', () => {
    const r = parseVcf(HDR + '1\t1\t.\tA\tC\t5\tLowQual\t.\tGT\t0/1\n1\t2\t.\tA\t<DEL>\t50\tPASS\t.\tGT\t0/1\n1\t3\t.\tA\t.\t50\tPASS\t.\tGT\t0/0\n');
    expect(r.variants).toHaveLength(0);
    expect(r.stats).toMatchObject({ skippedNonPass: 1, skippedSymbolic: 1, skippedRefCalls: 1 });
  });
  it('never exposes the sample column name', () => {
    expect(JSON.stringify(parseVcf(HDR + '1\t5\t.\tA\tC\t50\tPASS\t.\tGT\t0/1\n'))).not.toContain('PATIENT_NAME_X');
  });
  it('rejects files without a header', () => {
    expect(() => parseVcf('1\t5\t.\tA\tC\t50\tPASS\t.\n')).toThrow(/header/);
  });
  it('guesses build from ##reference', () => {
    expect(guessBuild('file:///ref/hg19.fa')).toBe('GRCh37');
    expect(guessBuild('GRCh38')).toBe('GRCh38');
  });
});
