# AI governance

VariantDesk is AI-native: an LLM drafts and prioritises wherever it saves analyst time. It is also built so a lab can show an inspector exactly what the AI did, what checks it passed, and which person approved it.

## Principles

1. **AI suggests; people decide.** Every AI output starts as a suggestion (`humanDecision = PENDING`). Reports cannot be submitted while any AI-drafted section is pending.
2. **AI never classifies variants.** ACMG/AMP and AMP/ASCO/CAP calls come from deterministic rules ([`src/interpret/rules.ts`](../apps/api/src/interpret/rules.ts)). Overrides are human-only and require a justification.
3. **Grounded or nothing.** The model only sees the evidence for the case (as short aliases `E1…En`). Outputs citing unknown aliases, naming drugs absent from the evidence, or quoting trial criteria that don't exist are rejected.
4. **Minimum necessary data.** Only allow-listed, de-identified fields are sent. A PHI scan runs before every call, and a hit blocks the call (nothing is sent).
5. **Always a fallback.** If the provider is off, errors, or fails guardrails twice, a deterministic template is used and labelled as such.
6. **Everything is recorded.** `AiRun` stores the task, prompt version, prompt hash, the exact (redacted) input, raw output, parsed output, every guardrail verdict, attempts, latency, tokens, and the human decision with who and when.

## Pipeline for each AI call ([`src/ai/ai.service.ts`](../apps/api/src/ai/ai.service.ts))

```
input ─► PHI guard (patient text: all identifiers; whole prompt: high-risk identifiers)
           │ blocked → fallback, status BLOCKED (nothing sent)
           ▼
       provider call with JSON-schema-constrained output
           ▼
       schema check + task guardrails ── fail → one retry with the failure reasons
           │                                     │ still failing → fallback, status FALLBACK
           ▼
       accepted (status PASSED, humanDecision PENDING) ─► UI shows an "AI draft" badge ─► accept / edit / reject
```

## Guardrails

| Guardrail | Tasks |
|---|---|
| `input.no_phi_in_patient_context` | all |
| `input.no_high_risk_identifiers` | all |
| `output.schema_valid` | all |
| `output.citations_grounded`, `output.has_citation` | narrative, summary |
| `output.drugs_supported_by_evidence` | narrative, summary |
| `output.no_treatment_directives`, `output.no_unsourced_dosing` | narrative, summary |
| `output.length` | narrative, summary |
| `output.aliases_grounded` | evidence triage |
| `output.criteria_quotes_verbatim`, `output.verdict_consistent` | trial pre-screen |
| `output.no_identifiers` | all free-text outputs |

Prompts are versioned (`promptVersion`, e.g. `variant.narrative@1`). Change the version whenever a prompt changes, so audit records stay interpretable.

## Prompt injection

Knowledge-base text (CIViC descriptions, trial criteria) is untrusted. It is wrapped in `<data>` with an instruction to treat it as data. The guardrails limit the impact regardless: the model cannot add drugs, citations or criteria that are not in the input, and every output is reviewed by a person.

## Choosing a provider

- `anthropic`: Claude via the official SDK, with structured outputs and server-side refusal fallback. De-identified data is sent to Anthropic, so check your institution's data-processing agreement.
- `openai_compatible`: a local model (Ollama, vLLM). No data leaves your network. Quality varies by model; guardrails and fallbacks still apply.
- `none`: fully deterministic.
