import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';
import { sha256 } from '../common/hash';

export class KbUnavailableError extends Error {}

/**
 * HTTP client for public knowledge bases with:
 *  - persistent response cache (provenance + offline/air-gapped operation),
 *  - per-host rate limiting (NCBI allows 3 req/s without a key),
 *  - retries with backoff on 429/5xx.
 */
@Injectable()
export class KbHttpService {
  private readonly log = new Logger('KbHttp');
  private readonly nextSlot = new Map<string, number>();
  private readonly minIntervalMs: Record<string, number> = {
    'eutils.ncbi.nlm.nih.gov': config.kb.ncbiApiKey ? 110 : 350,
    'rest.ensembl.org': 70,
    'grch37.rest.ensembl.org': 70,
  };

  constructor(private readonly prisma: PrismaService) {}

  async json<T = any>(
    source: string,
    url: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; ttlHours?: number } = {},
  ): Promise<{ data: T; fetchedAt: Date; cached: boolean }> {
    const key = sha256(`${init.method ?? 'GET'} ${url} ${init.body ? JSON.stringify(init.body) : ''}`);
    const ttl = (init.ttlHours ?? config.kb.cacheTtlHours) * 3600_000;
    const hit = await this.prisma.kbCache.findUnique({ where: { key } });
    if (hit && (config.kb.offline || Date.now() - hit.fetchedAt.getTime() < ttl)) {
      return { data: hit.response as T, fetchedAt: hit.fetchedAt, cached: true };
    }
    if (config.kb.offline) throw new KbUnavailableError(`${source}: offline mode and no cached response`);

    const data = await this.fetchWithRetry<T>(url, init);
    const fetchedAt = new Date();
    await this.prisma.kbCache.upsert({
      where: { key },
      create: { key, source, response: data as Prisma.InputJsonValue, fetchedAt },
      update: { response: data as Prisma.InputJsonValue, fetchedAt },
    });
    return { data, fetchedAt, cached: false };
  }

  private async throttle(host: string) {
    const gap = this.minIntervalMs[host] ?? 50;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + gap);
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  }

  private async fetchWithRetry<T>(url: string, init: { method?: string; body?: unknown }): Promise<T> {
    const host = new URL(url).host;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.throttle(host);
      try {
        const res = await fetch(url, {
          method: init.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'VariantDesk/0.1 (open-source variant interpretation)',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: init.body ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(45_000),
        });
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
          lastErr = new Error(`HTTP ${res.status} from ${host}`);
          await new Promise((r) => setTimeout(r, Math.min(retryAfter, 20) * 1000));
          continue;
        }
        if (!res.ok) {
          const text = await res.text();
          throw new KbUnavailableError(`HTTP ${res.status} from ${host}: ${text.slice(0, 300)}`);
        }
        return (await res.json()) as T;
      } catch (e) {
        if (e instanceof KbUnavailableError) throw e;
        lastErr = e;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    this.log.warn(`Giving up on ${url}: ${String(lastErr)}`);
    throw new KbUnavailableError(String(lastErr));
  }
}
