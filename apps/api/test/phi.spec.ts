import { detectPhi, scanObject } from '../src/deid/phi';
import { CaseIntakeSchema } from '../src/deid/patient.schema';

describe('PHI detector', () => {
  it.each([
    ['email', 'contact a.b@example.org'],
    ['us_ssn', 'SSN 123-45-6789'],
    ['aadhaar', 'Aadhaar 2345 6789 0123'],
    ['pan', 'PAN ABCDE1234F'],
    ['phone_in', 'call 9876543210'],
    ['full_date', 'DOB 12/03/1980'],
    ['mrn', 'MRN: 00123456'],
    ['name_label', 'Patient name Priya'],
    ['zip5', 'lives in 02139'],
    ['pin6', 'PIN 411001'],
  ])('detects %s', (type, text) => {
    expect(detectPhi(text).map((f) => f.type)).toContain(type);
  });
  it('allows clinical free text', () => {
    expect(detectPhi('Metastatic lung adenocarcinoma, stage IV, ECOG 1, prior carboplatin/pemetrexed')).toEqual([]);
  });
  it('reports JSON paths', () => {
    expect(scanObject({ patient: { notes: ['ok', 'email x@y.com'] } })[0].path).toBe('$.patient.notes[1]');
  });
});

describe('intake schema', () => {
  const base = { caseCode: 'LAB-1', sampleType: 'tumor', patient: {} };
  it('accepts ZIP3 / PIN3 / city', () => {
    expect(CaseIntakeSchema.safeParse({ ...base, location: { country: 'US', kind: 'zip3', value: '021' } }).success).toBe(true);
    expect(CaseIntakeSchema.safeParse({ ...base, location: { country: 'IN', kind: 'pin3', value: '411' } }).success).toBe(true);
    expect(CaseIntakeSchema.safeParse({ ...base, location: { country: 'IN', kind: 'city', value: 'Pune' } }).success).toBe(true);
  });
  it('rejects full postal codes and mismatched countries', () => {
    expect(CaseIntakeSchema.safeParse({ ...base, location: { country: 'US', kind: 'zip3', value: '02139' } }).success).toBe(false);
    expect(CaseIntakeSchema.safeParse({ ...base, location: { country: 'US', kind: 'pin3', value: '411' } }).success).toBe(false);
    expect(CaseIntakeSchema.safeParse({ ...base, location: { country: 'IN', kind: 'city', value: '12 MG Road' } }).success).toBe(false);
  });
  it('rejects case codes with spaces (names)', () => {
    expect(CaseIntakeSchema.safeParse({ ...base, caseCode: 'Ramesh Kumar' }).success).toBe(false);
  });
});
