import { z } from 'zod';

export const SECTION_KEYS = [
  'patient', 'summary', 'somatic', 'germline', 'pgx', 'trials', 'vus', 'recommendations',
  'methodology', 'limitations', 'references', 'ai_disclosure', 'signatures',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const DEFAULT_SECTIONS: Array<{ key: SectionKey; title: string; enabled: boolean }> = [
  { key: 'patient', title: 'Case information', enabled: true },
  { key: 'summary', title: 'Summary of results', enabled: true },
  { key: 'somatic', title: 'Somatic findings (AMP/ASCO/CAP)', enabled: true },
  { key: 'germline', title: 'Germline findings (ACMG/AMP)', enabled: true },
  { key: 'pgx', title: 'Pharmacogenomics (CPIC)', enabled: true },
  { key: 'trials', title: 'Potentially relevant clinical trials', enabled: true },
  { key: 'vus', title: 'Variants of uncertain significance', enabled: true },
  { key: 'recommendations', title: 'Comments', enabled: true },
  { key: 'methodology', title: 'Methodology', enabled: true },
  { key: 'limitations', title: 'Limitations', enabled: true },
  { key: 'references', title: 'References', enabled: true },
  { key: 'ai_disclosure', title: 'Use of AI', enabled: true },
  { key: 'signatures', title: 'Review and sign-off', enabled: true },
];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1f4e79');

export const ThemeSchema = z.object({
  primaryColor: hex.default('#1f4e79'),
  accentColor: hex.default('#2e86ab'),
  textColor: hex.default('#222222'),
  fontFamily: z.enum(['Helvetica', 'Times', 'Courier']).default('Helvetica'),
  fontSize: z.number().min(7).max(14).default(9),
  labName: z.string().max(120).default('Your Laboratory Name'),
  labAddress: z.string().max(300).default(''),
  accreditation: z.string().max(200).default(''),
  headerText: z.string().max(200).default('Genomic Testing Report'),
  footerText: z.string().max(300).default('For use by qualified healthcare professionals. Interpret in clinical context.'),
  logoDataUrl: z
    .string()
    .max(700_000)
    .regex(/^data:image\/(png|jpeg);base64,/, 'Logo must be a PNG or JPEG data URL')
    .or(z.literal(''))
    .default(''),
  draftWatermark: z.boolean().default(true),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const SectionsSchema = z
  .array(z.object({ key: z.enum(SECTION_KEYS), title: z.string().min(1).max(80), enabled: z.boolean() }))
  .refine((a) => new Set(a.map((s) => s.key)).size === a.length, 'Duplicate section');

export const TemplateSchema = z.object({
  name: z.string().min(1).max(80),
  theme: ThemeSchema,
  sections: SectionsSchema,
});

export const DEFAULT_THEME: Theme = ThemeSchema.parse({});
