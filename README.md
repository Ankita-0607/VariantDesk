<p align="center"><img src="apps/web/public/favicon.svg" width="64" alt=""></p>

# VariantDesk

**An open-source, AI-assisted variant interpretation and reporting workbench for small clinical genomics labs in the US and India.**

Upload a VCF and a de-identified patient profile. VariantDesk annotates the variants, matches evidence from public knowledge bases, applies guideline-based classification rules, finds recruiting clinical trials near the patient, and drafts a report. An **analyst** reviews and edits it, and a **lab director** signs it off.

> ⚠️ **Decision support only.** VariantDesk produces *draft* interpretations that must be reviewed by qualified laboratory professionals. It is not a medical device and is not FDA-cleared or CDSCO-approved. Labs remain responsible for validating it under CLIA/CAP or NABL (ISO 15189) before clinical use.

---

## What it does

| | |
|---|---|
| **Input** | VCF (GRCh38 or GRCh37) + de-identified patient profile (age, sex, diagnosis, stage, ECOG, prior therapies, medications, ancestry) + optional coarse location (US ZIP3, India PIN3, or city) |
| **Annotation** | Ensembl VEP: MANE Select transcript, HGVS, consequence, SIFT/PolyPhen, gnomAD v4 frequencies (including South Asian) |
| **Evidence** | ClinVar (germline, somatic oncogenicity, clinical impact), CIViC evidence and AMP assertions, PubMed, gnomAD, CPIC |
| **Classification** | Germline: ACMG/AMP points system (Tavtigian 2020, ClinGen SVI). Somatic: AMP/ASCO/CAP 2017 tiers. PGx: CPIC phenotypes and drug recommendations. **Deterministic rules; AI never assigns a classification.** |
| **Clinical trials** | ClinicalTrials.gov v2 (covers US and Indian sites), **nearest recruiting site first**, with age/sex checks and an optional AI eligibility pre-screen |
| **Review UI** | Draft report editor; **add / edit / delete / restore evidence** per variant; classification overrides with justification; accept or reject every AI suggestion |
| **Sign-off** | Analyst submits → Lab director returns or signs (separation of duties enforced) → frozen PDF with SHA-256 → amendments create new versions |
| **Templates** | Admins customise the PDF: colours, font, logo, lab name and accreditation (CLIA / CAP / NABL), header and footer, section order, titles and visibility, with a live preview |
| **Audit** | Hash-chained, tamper-evident audit log of every action. Every AI call is stored with its redacted input, raw output, guardrail verdicts and the human decision. |

## AI-native, with guardrails

The LLM is used wherever it helps, and is constrained everywhere:

| AI task | What it does | Guardrails |
|---|---|---|
| Diagnosis normalisation | Free text → tumour-type code | Must choose from a fixed vocabulary; cross-checked against keyword rules, and disagreement is flagged |
| Evidence triage | Ranks each evidence item's relevance for this patient | May only reference evidence IDs it was given |
| Variant narrative | Drafts the interpretation paragraph | Citations must exist; no drugs absent from the evidence; no treatment directives or doses; length limit |
| Report summary | Drafts the "Summary of results" | Same as above |
| Trial pre-screen | Checks eligibility criteria against the profile | Quoted criteria must appear verbatim in the trial text; verdict must be consistent |

Every call: **PHI check before sending** (blocked if identifiers are found), schema-constrained output, one corrective retry, then a **deterministic fallback**, so the lab can always produce a report with AI turned off. AI text is labelled in the UI, and **a report cannot be submitted until every AI-drafted section is accepted, edited or rejected**. See [docs/ai-governance.md](docs/ai-governance.md).

Supported providers: **Claude** (Anthropic API), any **OpenAI-compatible local server** (e.g. Ollama or vLLM, for fully offline labs), or **none**.

## Privacy by design (HIPAA and India's DPDP Act)

- Only de-identified data is accepted. Free text is scanned for names, MRN/UHID, dates, phone numbers, emails, SSN, Aadhaar, PAN, and full ZIP or PIN codes, and the upload is rejected if any are found.
- Location is limited to a **US 3-digit ZIP** (restricted low-population prefixes are refused, per HIPAA Safe Harbor), an **Indian 3-digit PIN prefix**, or a **city**. Trial distances use the centroid from offline GeoNames tables, so no geocoding service is called.
- Ages ≥ 90 are stored as 90. The raw VCF is never stored (only its SHA-256), and VCF sample names are discarded.
- Not intended for EU deployments (GDPR not addressed).

---

## Quick start (Docker)

```bash
git clone https://github.com/Ankita-0607/VariantDesk.git
```

```bash
cd VariantDesk && cp .env.example .env
```

Edit `.env`: set `JWT_SECRET`, change the passwords in `SEED_USERS`, and optionally set `AI_PROVIDER`. Then:

```bash
docker compose up -d
```

Open http://localhost:3000 and sign in with a seeded user (`admin@lab.local`, `analyst@lab.local` or `director@lab.local`; passwords come from `SEED_USERS`). Try the synthetic demo files in [`data/samples/`](data/samples).

### Enabling AI

```ini
# Claude
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-opus-5-5

# or a local model (no data leaves the server)
AI_PROVIDER=openai_compatible
OPENAI_COMPATIBLE_BASE_URL=http://host.docker.internal:11434/v1
OPENAI_COMPATIBLE_MODEL=llama3.1
```

## Development

Requirements: Node 22 and PostgreSQL 16.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
cd apps/api && npx prisma migrate deploy && npm run build && npm run db:seed
```

Then run the API (port 3000) and the web dev server (port 5173, proxies `/api`) in two terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Tests:

```bash
npm test
```

## Repository layout

```
apps/api      NestJS + Prisma backend
  src/kb          Knowledge-base connectors (VEP, ClinVar, CIViC, PubMed, CPIC) with a response cache
  src/interpret   Deterministic rules engine (ACMG/AMP, AMP/ASCO/CAP), tumour vocabulary
  src/ai          LLM providers, guardrails, versioned AI tasks, audited runner
  src/pipeline    Case processing pipeline and draft builder
  src/trials      ClinicalTrials.gov search and distance ranking
  src/reports     Report workflow, PDF rendering, templates
  src/deid        PHI detector and intake schema
  src/audit       Hash-chained audit log
apps/web      React + Vite UI
data/geo      ZIP3 / PIN3 / city centroids (GeoNames, CC BY 4.0)
data/samples  Synthetic demo VCFs and patient profiles
docs/         Architecture and AI governance
```

## Current limitations (MVP)

- Designed for panel or exome subsets (≤ 2,000 PASS variants by default) because annotation uses the Ensembl REST API. Local VEP for WGS is on the roadmap.
- CNVs, structural variants, fusions, TMB and MSI are not yet interpreted.
- PGx calling covers single-SNV-defined alleles in CYP2C19, CYP2C9, DPYD, TPMT, NUDT15, SLCO1B1, CYP3A5 and VKORC1 (genotype only). CYP2D6, HLA and UGT1A1*28 need PharmCAT integration.
- India's CTRI registry has no public API. Indian sites are found through ClinicalTrials.gov.
- User management is configured with `SEED_USERS` (a UI is planned for phase 2).

See [docs/architecture.md](docs/architecture.md) for the roadmap.

## Contributing

Contributions are welcome, especially from people working in clinical genomics labs. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache 2.0](LICENSE). Data attributions are in [NOTICE](NOTICE).
