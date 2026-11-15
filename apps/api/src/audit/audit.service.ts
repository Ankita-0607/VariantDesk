import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { sha256, stableStringify } from '../common/hash';
import { AuthUser } from '../auth/roles';

export interface AuditInput {
  actor?: AuthUser | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  caseId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

const GENESIS = '0'.repeat(64);

/**
 * Append-only audit log. Each row stores the hash of the previous row, so any
 * edit or deletion in the database breaks the chain and is detectable via verify().
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput) {
    // Serialise appends so the chain is linear (advisory lock inside a transaction).
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(424242)');
      const last = await tx.auditEvent.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
      const prevHash = last?.hash ?? GENESIS;
      const at = new Date();
      const body = {
        at: at.toISOString(),
        actorId: input.actor?.id ?? null,
        actorEmail: input.actor?.email ?? null,
        actorRole: input.actor?.role ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        caseId: input.caseId ?? null,
        before: toJson(input.before),
        after: toJson(input.after),
        reason: input.reason ?? null,
      };
      const hash = sha256(prevHash + stableStringify(body));
      return tx.auditEvent.create({
        data: {
          ...body,
          at,
          before: body.before ?? Prisma.JsonNull,
          after: body.after ?? Prisma.JsonNull,
          prevHash,
          hash,
        },
      });
    });
  }

  /** Recomputes the whole chain. Returns the first broken sequence number, if any. */
  async verify(): Promise<{ ok: boolean; checked: number; brokenAt?: number }> {
    const rows = await this.prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } });
    let prev = GENESIS;
    for (const r of rows) {
      const body = {
        at: r.at.toISOString(),
        actorId: r.actorId,
        actorEmail: r.actorEmail,
        actorRole: r.actorRole,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        caseId: r.caseId,
        before: r.before ?? null,
        after: r.after ?? null,
        reason: r.reason,
      };
      if (r.prevHash !== prev || sha256(prev + stableStringify(body)) !== r.hash) {
        return { ok: false, checked: rows.length, brokenAt: r.seq };
      }
      prev = r.hash;
    }
    return { ok: true, checked: rows.length };
  }
}

function toJson(v: unknown): Prisma.InputJsonValue | null {
  if (v === undefined || v === null) return null;
  return JSON.parse(JSON.stringify(v));
}
