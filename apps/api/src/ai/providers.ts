import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { config } from '../common/config';

export interface LlmRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface LlmResponse {
  text: string;
  json: unknown;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete<T>(req: LlmRequest<T>): Promise<LlmResponse>;
}

export class LlmRefusalError extends Error {}

/** Claude via the official Anthropic SDK, with structured (schema-constrained) output. */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client = new Anthropic();
  constructor(readonly model: string) {}

  async complete<T>(req: LlmRequest<T>): Promise<LlmResponse> {
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      // Server-side fallback keeps the pipeline running if the primary model declines a request.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: { format: betaZodOutputFormat(req.schema), effort: req.effort ?? 'medium' },
    });
    if (res.stop_reason === 'refusal') throw new LlmRefusalError('Model declined the request');
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return {
      text,
      json: res.parsed_output ?? safeJson(text),
      model: res.model,
      tokensIn: res.usage?.input_tokens,
      tokensOut: res.usage?.output_tokens,
    };
  }
}

/**
 * Any OpenAI-compatible chat endpoint — e.g. a local Ollama or vLLM server — so labs can
 * run fully offline without sending data to a cloud provider.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai_compatible';
  constructor(
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async complete<T>(req: LlmRequest<T>): Promise<LlmResponse> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: req.maxTokens ?? 4000,
        response_format: { type: 'json_schema', json_schema: { name: 'output', schema: z.toJSONSchema(req.schema), strict: true } },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`LLM endpoint HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    return { text, json: safeJson(text), model: data.model ?? this.model, tokensIn: data.usage?.prompt_tokens, tokensOut: data.usage?.completion_tokens };
  }
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
    return undefined;
  }
}

export function createProvider(): LlmProvider | null {
  if (config.ai.provider === 'anthropic') return new AnthropicProvider(config.ai.model);
  if (config.ai.provider === 'openai_compatible')
    return new OpenAiCompatibleProvider(config.ai.openaiModel, config.ai.openaiBaseUrl, config.ai.openaiApiKey);
  return null;
}
