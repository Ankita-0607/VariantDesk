import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { sha256 } from '../common/hash';
import { createProvider, LlmProvider } from './providers';
import { AiTask } from './tasks';
import { GuardResult, guardPatientContext, guardPromptPhi } from './guardrails';

export interface AiResult<O> {
  runId: string;
  output: O;
  /** PASSED = AI output accepted by all guardrails; otherwise the deterministic fallback was used */
  status: 'PASSED' | 'BLOCKED' | 'FALLBACK' | 'ERROR' | 'DISABLED';
  aiGenerated: boolean;
  guardrails: GuardResult[];
}

/**
 * Single entry point for every LLM call in VariantDesk.
 *  1. input guardrails (PHI) → block before anything leaves the server
 *  2. schema-constrained generation
 *  3. output guardrails (grounding, drugs, tone, quotes…) → one corrective retry
 *  4. deterministic fallback if still failing
 *  5. everything persisted to AiRun (redacted input, raw output, verdicts, tokens, latency)
 * AI output is always a suggestion: humanDecision starts as PENDING (or NOT_REQUIRED for
 * internal ranking tasks) and is resolved by an analyst/director in the UI.
 */
@Injectable()
export class AiService {
  private readonly log = new Logger('AI');
  private provider: LlmProvider | null = createProvider();

  constructor(private readonly prisma: PrismaService) {}

  /** test hook */
  setProvider(p: LlmProvider | null) {
    this.provider = p;
  }

  get enabled() {
    return !!this.provider;
  }

  get info() {
    return { enabled: this.enabled, provider: this.provider?.name ?? 'none', model: this.provider?.model ?? null };
  }

  async run<I, O>(task: AiTask<I, O>, input: I, opts: { caseId?: string; humanReview?: boolean } = {}): Promise<AiResult<O>> {
    const user = task.buildUser(input);
    const promptHash = sha256(`${task.promptVersion}\n${task.system}\n${user}`);
    const base = {
      caseId: opts.caseId,
      task: task.name,
      promptVersion: task.promptVersion,
      promptHash,
      input: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
      humanDecision: opts.humanReview === false ? 'NOT_REQUIRED' : 'PENDING',
    };

    if (!this.provider) {
      const output = task.fallback(input);
      const run = await this.prisma.aiRun.create({
        data: { ...base, provider: 'none', status: 'DISABLED', output: output as Prisma.InputJsonValue, humanDecision: 'NOT_REQUIRED' },
      });
      return { runId: run.id, output, status: 'DISABLED', aiGenerated: false, guardrails: [] };
    }

    const inputGuards = [guardPatientContext(task.patientText(input)), guardPromptPhi(user)];
    if (inputGuards.some((g) => !g.passed)) {
      const output = task.fallback(input);
      const run = await this.prisma.aiRun.create({
        data: { ...base, provider: this.provider.name, model: this.provider.model, status: 'BLOCKED', guardrails: inputGuards as unknown as Prisma.InputJsonValue, output: output as Prisma.InputJsonValue, error: 'Input guardrail blocked the request; nothing was sent to the model.' },
      });
      this.log.warn(`AI input blocked for ${task.name}: ${inputGuards.filter((g) => !g.passed).map((g) => g.detail).join('; ')}`);
      return { runId: run.id, output, status: 'BLOCKED', aiGenerated: false, guardrails: inputGuards };
    }

    const started = Date.now();
    let attempts = 0;
    let raw: string | undefined;
    let tokensIn = 0;
    let tokensOut = 0;
    let model = this.provider.model;
    let guards: GuardResult[] = [...inputGuards];
    let accepted: O | undefined;
    let error: string | undefined;
    let prompt = user;

    while (attempts < 2 && accepted === undefined) {
      attempts++;
      try {
        const res = await this.provider.complete({ system: task.system, user: prompt, schema: task.schema, maxTokens: task.maxTokens, effort: task.effort });
        raw = res.text;
        model = res.model;
        tokensIn += res.tokensIn ?? 0;
        tokensOut += res.tokensOut ?? 0;
        const parsed = task.schema.safeParse(res.json);
        const schemaGuard: GuardResult = { name: 'output.schema_valid', passed: parsed.success, detail: parsed.success ? undefined : parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
        const taskGuards = parsed.success ? task.guards(input, parsed.data) : [];
        guards = [...inputGuards, schemaGuard, ...taskGuards];
        const failed = guards.filter((g) => !g.passed);
        if (!failed.length && parsed.success) {
          accepted = parsed.data;
        } else {
          prompt = `${user}\n\nYour previous answer was rejected by automated safety checks:\n${failed.map((f) => `- ${f.name}: ${f.detail}`).join('\n')}\nProduce a corrected answer that passes all checks.`;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        this.log.warn(`AI call failed for ${task.name}: ${error}`);
        break;
      }
    }

    const status: AiResult<O>['status'] = accepted !== undefined ? 'PASSED' : error ? 'ERROR' : 'FALLBACK';
    const output = accepted ?? task.fallback(input);
    const run = await this.prisma.aiRun.create({
      data: {
        ...base,
        provider: this.provider.name,
        model,
        outputRaw: raw,
        output: output as Prisma.InputJsonValue,
        guardrails: guards as unknown as Prisma.InputJsonValue,
        status,
        error,
        attempts,
        latencyMs: Date.now() - started,
        tokensIn,
        tokensOut,
        humanDecision: accepted !== undefined ? base.humanDecision : 'NOT_REQUIRED',
      },
    });
    return { runId: run.id, output, status, aiGenerated: accepted !== undefined, guardrails: guards };
  }

  async decide(runId: string, decision: 'ACCEPTED' | 'REJECTED' | 'EDITED', userId: string, note?: string) {
    return this.prisma.aiRun.update({ where: { id: runId }, data: { humanDecision: decision, decidedById: userId, decidedAt: new Date(), decisionNote: note } });
  }
}
