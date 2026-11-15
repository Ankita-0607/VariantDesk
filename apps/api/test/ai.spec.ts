import { AiService } from '../src/ai/ai.service';
import { LlmProvider, LlmRequest, LlmResponse } from '../src/ai/providers';
import { narrativeTask, NarrativeInput, trialScreenTask, diagnosisTask } from '../src/ai/tasks';
import { guardDrugs, guardTone, guardQuotes, guardCitations } from '../src/ai/guardrails';

class FakeProvider implements LlmProvider {
  name = 'fake';
  model = 'fake-1';
  calls: string[] = [];
  constructor(private readonly replies: unknown[]) {}
  async complete<T>(req: LlmRequest<T>): Promise<LlmResponse> {
    this.calls.push(req.user);
    const next = this.replies.shift();
    if (next instanceof Error) throw next;
    return { text: JSON.stringify(next), json: next, model: this.model, tokensIn: 10, tokensOut: 5 };
  }
}

function fakePrisma() {
  const runs: any[] = [];
  return {
    runs,
    aiRun: {
      create: async ({ data }: any) => {
        const r = { id: `run${runs.length + 1}`, ...data };
        runs.push(r);
        return r;
      },
      update: async ({ where, data }: any) => Object.assign(runs.find((r) => r.id === where.id), data),
    },
  };
}

const input: NarrativeInput = {
  tumorType: 'Non-small cell lung cancer',
  sampleType: 'tumor',
  variant: { gene: 'EGFR', hgvsc: 'ENST1:c.2573T>G', hgvsp: 'ENSP1:p.Leu858Arg', consequence: 'missense_variant', vaf: 0.34 },
  classification: { somatic: 'Tier I (Level A)' },
  evidence: [
    { alias: 'E1', source: 'CIVIC', category: 'THERAPEUTIC', level: 'A', disease: 'Lung Non-small Cell Carcinoma', therapies: ['Osimertinib'], summary: 'FLAURA trial' },
    { alias: 'E2', source: 'CLINVAR', category: 'ONCOGENICITY', significance: 'Oncogenic', summary: 'ClinVar' },
  ],
};

describe('AiService', () => {
  it('accepts grounded output and records the run as PENDING human review', async () => {
    const prisma = fakePrisma();
    const ai = new AiService(prisma as any);
    ai.setProvider(new FakeProvider([{ narrative: 'EGFR L858R is oncogenic [E2] and predicts sensitivity to osimertinib in NSCLC [E1].', citedEvidence: ['E1', 'E2'] }]));
    const r = await ai.run(narrativeTask, input, { caseId: 'c1' });
    expect(r.status).toBe('PASSED');
    expect(r.aiGenerated).toBe(true);
    expect(prisma.runs[0]).toMatchObject({ status: 'PASSED', humanDecision: 'PENDING', provider: 'fake', promptVersion: 'variant.narrative@1', attempts: 1 });
    expect(prisma.runs[0].promptHash).toHaveLength(64);
  });

  it('retries once with guardrail feedback, then accepts', async () => {
    const prisma = fakePrisma();
    const ai = new AiService(prisma as any);
    const fake = new FakeProvider([
      { narrative: 'Supports osimertinib [E9].', citedEvidence: ['E9'] },
      { narrative: 'Supports osimertinib [E1].', citedEvidence: ['E1'] },
    ]);
    ai.setProvider(fake);
    const r = await ai.run(narrativeTask, input);
    expect(r.status).toBe('PASSED');
    expect(fake.calls[1]).toMatch(/rejected by automated safety checks[\s\S]*Unknown evidence ids: E9/);
    expect(prisma.runs[0].attempts).toBe(2);
  });

  it('falls back to deterministic text when the model keeps hallucinating drugs', async () => {
    const prisma = fakePrisma();
    const ai = new AiService(prisma as any);
    const bad = { narrative: 'Consider gefitinib [E1].', citedEvidence: ['E1'] };
    ai.setProvider(new FakeProvider([bad, bad]));
    const r = await ai.run(narrativeTask, input);
    expect(r.status).toBe('FALLBACK');
    expect(r.aiGenerated).toBe(false);
    expect(r.output.narrative).toMatch(/EGFR c.2573T>G/);
    expect(prisma.runs[0].guardrails.find((g: any) => g.name === 'output.drugs_supported_by_evidence').passed).toBe(false);
    expect(prisma.runs[0].humanDecision).toBe('NOT_REQUIRED');
  });

  it('blocks the call before sending anything when patient context has PHI', async () => {
    const prisma = fakePrisma();
    const ai = new AiService(prisma as any);
    const fake = new FakeProvider([]);
    ai.setProvider(fake);
    const r = await ai.run(diagnosisTask, { diagnosis: 'lung cancer, MRN: 99887766' });
    expect(r.status).toBe('BLOCKED');
    expect(fake.calls).toHaveLength(0);
    expect(r.output.code).toBe('NSCLC');
  });

  it('records ERROR and falls back when the provider fails', async () => {
    const prisma = fakePrisma();
    const ai = new AiService(prisma as any);
    ai.setProvider(new FakeProvider([new Error('timeout')]));
    const r = await ai.run(diagnosisTask, { diagnosis: 'Melanoma' });
    expect(r.status).toBe('ERROR');
    expect(r.output.code).toBe('MEL');
  });

  it('is fully functional with AI disabled', async () => {
    const prisma = fakePrisma();
    const ai = new AiService(prisma as any);
    ai.setProvider(null);
    const r = await ai.run(diagnosisTask, { diagnosis: 'Colorectal adenocarcinoma' });
    expect(r).toMatchObject({ status: 'DISABLED', aiGenerated: false });
    expect(r.output.code).toBe('COADREAD');
  });

  it('trial screen rejects invented criteria and inconsistent verdicts', async () => {
    const prisma = fakePrisma();
    const ai = new AiService(prisma as any);
    const invented = { verdict: 'LIKELY_ELIGIBLE', reasons: [{ criterionQuote: 'Must have EGFR exon 19 deletion', assessment: 'NOT_MET', note: '' }] };
    ai.setProvider(new FakeProvider([invented, invented]));
    const r = await ai.run(trialScreenTask, {
      patient: { sex: 'female', tumorType: 'NSCLC', priorTherapies: [] },
      variants: ['EGFR L858R'],
      trial: { nctId: 'NCT1', title: 'T', eligibility: 'Inclusion Criteria:\n* Known EGFR L858R mutation\n* ECOG 0-1' },
    });
    expect(r.status).toBe('FALLBACK');
    const names = prisma.runs[0].guardrails.filter((g: any) => !g.passed).map((g: any) => g.name);
    expect(names).toEqual(expect.arrayContaining(['output.criteria_quotes_verbatim', 'output.verdict_consistent']));
  });
});

describe('guardrails', () => {
  it('drug guard allows evidence drugs and flags others', () => {
    expect(guardDrugs('osimertinib and erlotinib', ['Osimertinib']).passed).toBe(false);
    expect(guardDrugs('Osimertinib', ['osimertinib']).passed).toBe(true);
  });
  it('tone guard blocks directives and doses', () => {
    const [d, dose] = guardTone('The patient should start osimertinib 80 mg daily');
    expect(d.passed).toBe(false);
    expect(dose.passed).toBe(false);
    expect(guardTone('Osimertinib may be considered.').every((g) => g.passed)).toBe(true);
  });
  it('quote guard tolerates whitespace/case differences', () => {
    expect(guardQuotes(['ecog  performance status 0-1'], 'ECOG performance status 0-1\n').passed).toBe(true);
  });
  it('citation guard requires at least one citation when evidence exists', () => {
    const r = guardCitations('no cites', [], new Set(['E1']), true);
    expect(r.find((g) => g.name === 'output.has_citation')!.passed).toBe(false);
  });
});
