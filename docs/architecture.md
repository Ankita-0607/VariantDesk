# Architecture

```
            ┌──────────── React UI (apps/web) ────────────┐
            │ cases · variants & evidence · PGx · trials   │
            │ draft report · audit · admin templates       │
            └───────────────┬──────────────────────────────┘
                            │ REST /api (JWT, roles)
┌───────────────────────────▼─────────────────────────────────────────┐
│ NestJS API (apps/api)                                                │
│                                                                      │
│  intake ──► de-id gate ──► VCF parser ──► Case + Variants (Postgres) │
│                                   │                                  │
│                         in-process pipeline queue                    │
│  1 diagnosis (AI ✓ rules)  2 VEP annotation  3 evidence matching     │
│  4 rules engine            5 PGx (CPIC)      6 AI evidence triage    │
│  7 trials (CT.gov + distance)  8 AI trial pre-screen  9 draft report │
│                                                                      │
│  AiService ── guardrails ── providers (Claude | OpenAI-compatible)   │
│  AuditService (hash chain)   KbHttpService (cache, rate limits)      │
│  ReportsService (submit / return / sign / amend, PDF snapshot)       │
└──────────────────────────────────────────────────────────────────────┘
```

## Key design decisions

| Decision | Why |
|---|---|
| **Rules classify, AI explains** | Classifications must be reproducible and defensible to inspectors. The LLM drafts text and prioritises evidence; it never assigns a tier or ACMG class. |
| **Deterministic fallback for every AI task** | Labs without AI, or with AI temporarily failing, can still sign out reports. |
| **Single container + Postgres, in-process queue** | Small labs often have one server and no DevOps staff. No Redis, Kafka or Kubernetes required. |
| **KB response cache (`KbCache`)** | Gives provenance (retrieval time), speeds up re-runs, and lets air-gapped labs run with `KB_OFFLINE=1` from a warmed cache. |
| **Evidence soft-delete with reason** | Deleting evidence must never erase history. |
| **Signed reports render from a frozen snapshot** | Later edits to evidence, templates or code can never change a released report. The PDF hash is stored. |
| **Hash-chained audit log** | Tampering with the database outside the app breaks the chain (`GET /api/audit/verify`). |
| **Coarse location only** | ZIP3 / PIN3 / city centroids (offline tables) are enough to rank trial sites and keep data de-identified. |

## Data model (simplified)

`Case` 1─* `Variant` 1─* `Evidence` · `Case` 1─* `PgxResult` · `Case` 1─* `TrialMatch` · `Case` 1─* `Report` (versions) · `ReportTemplate` · `AuditEvent` (append-only) · `AiRun` · `KbCache` · `User`

## Roles

| Role | Can |
|---|---|
| ANALYST | create cases, edit evidence and classifications, accept or reject AI suggestions, edit and submit reports |
| LAB_DIRECTOR | return or sign reports, create amendments, verify the audit chain (cannot sign a report they submitted) |
| ADMIN | everything, plus report templates |

## Roadmap

- **Phase 2:** user management UI, SSO/OIDC, password policy and MFA; local VEP (Docker) for exome/WGS; PharmCAT for CYP2D6/HLA/UGT1A1; CNV/SV/fusion/TMB/MSI input
- **Phase 3:** ClinGen gene–disease validity and VCEP specifications; OncoTree/MONDO ontologies; CTRI (India) integration when an API is available; HL7 FHIR Genomics export; LIS integration
- **Continuous:** evaluation set for AI tasks (precision of citations, unsupported-drug rate, trial-screen agreement with experts)
