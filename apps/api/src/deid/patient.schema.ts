import { z } from 'zod';

/** De-identified patient profile accepted at intake. No names, MRNs, DOBs, full ZIP/PIN. */
export const PatientProfileSchema = z.object({
  /** Age in years. Ages ≥ 90 are stored as 90 (HIPAA Safe Harbor). */
  ageYears: z.number().int().min(0).max(120).optional(),
  sex: z.enum(['female', 'male', 'other', 'unknown']).default('unknown'),
  /** Free-text primary diagnosis, e.g. "metastatic lung adenocarcinoma". */
  diagnosis: z.string().max(300).default(''),
  stage: z.string().max(50).optional(),
  indication: z.string().max(500).optional(),
  priorTherapies: z.array(z.string().max(120)).max(30).default([]),
  currentMedications: z.array(z.string().max(120)).max(50).default([]),
  ecog: z.number().int().min(0).max(4).optional(),
  familyHistory: z.string().max(500).optional(),
  /** Self-reported ancestry, used only to pick the relevant gnomAD population. */
  ancestry: z
    .enum(['south_asian', 'european', 'african', 'east_asian', 'latino', 'ashkenazi', 'middle_eastern', 'other', 'unknown'])
    .default('unknown'),
});
export type PatientProfile = z.infer<typeof PatientProfileSchema>;

export const LocationInputSchema = z
  .object({
    country: z.enum(['US', 'IN']),
    kind: z.enum(['zip3', 'pin3', 'city']),
    value: z.string().trim().min(2).max(80),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'zip3' && (v.country !== 'US' || !/^\d{3}$/.test(v.value)))
      ctx.addIssue({ code: 'custom', message: 'zip3 must be the first 3 digits of a US ZIP code' });
    if (v.kind === 'pin3' && (v.country !== 'IN' || !/^[1-9]\d{2}$/.test(v.value)))
      ctx.addIssue({ code: 'custom', message: 'pin3 must be the first 3 digits of an Indian PIN code' });
    if (v.kind === 'city' && /\d/.test(v.value))
      ctx.addIssue({ code: 'custom', message: 'city must be a city name only (no street or postal code)' });
  });
export type LocationInput = z.infer<typeof LocationInputSchema>;

export const CaseIntakeSchema = z.object({
  caseCode: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use a lab accession code (letters, digits, . _ -), never a patient name'),
  sampleType: z.enum(['tumor', 'germline', 'tumor_normal']),
  genomeBuild: z.enum(['GRCh38', 'GRCh37']).default('GRCh38'),
  assay: z.string().max(120).optional(),
  patient: PatientProfileSchema,
  location: LocationInputSchema.optional(),
});
export type CaseIntake = z.infer<typeof CaseIntakeSchema>;

/** US 3-digit ZIP prefixes covering < 20,000 people must be replaced with 000 (HIPAA Safe Harbor). */
export const RESTRICTED_ZIP3 = new Set([
  '036', '059', '102', '203', '205', '369', '556', '692', '790', '821', '823', '878', '879', '884', '890', '893',
]);
