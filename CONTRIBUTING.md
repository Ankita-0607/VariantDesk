# Contributing to VariantDesk

Thank you for helping make precision-medicine tooling accessible to small labs.

## Ground rules

- **Never commit real patient data**, including "de-identified" VCFs from real people. Use synthetic data (see `data/samples/`).
- Changes to classification rules (`apps/api/src/interpret/`) need a unit test and a reference to the guideline or ClinGen specification they implement.
- Changes to AI prompts must bump the task's `promptVersion` and keep or extend the guardrail tests in `apps/api/test/ai.spec.ts`.
- New knowledge sources must be openly licensed for clinical use, or optional and disabled by default (e.g. OncoKB, COSMIC: bring your own license).

## Workflow

1. Fork and create a branch.
2. `npm install`, then `npm test` and `npm run build`.
3. Open a pull request describing the change, its clinical rationale, and how you tested it.

## Good first areas

Local VEP support · PharmCAT integration · CNV/fusion input · Hindi and other Indian-language patient summaries · ontology mapping (OncoTree/MONDO) · accessibility improvements.
