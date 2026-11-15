import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/roles';
import { ZodPipe } from '../common/zod.pipe';
import { TrialsService } from './trials.service';
import { PatientProfile } from '../deid/patient.schema';

@Controller()
export class TrialsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly trials: TrialsService,
  ) {}

  @Get('cases/:id/trials')
  list(@Param('id') caseId: string, @Query('sort') sort = 'distance', @Query('hidden') hidden?: string) {
    return this.prisma.trialMatch.findMany({
      where: { caseId, ...(hidden === '1' ? {} : { hidden: false }) },
      orderBy: sort === 'relevance' ? [{ includeInReport: 'desc' }, { createdAt: 'asc' }] : [{ distanceKm: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
  }

  @Roles('ANALYST')
  @Patch('trials/:id')
  async patch(@Param('id') id: string, @Body(new ZodPipe(z.object({ includeInReport: z.boolean().optional(), hidden: z.boolean().optional() }).strict())) body: { includeInReport?: boolean; hidden?: boolean }, @CurrentUser() user: AuthUser) {
    const t = await this.prisma.trialMatch.findUniqueOrThrow({ where: { id } });
    const updated = await this.prisma.trialMatch.update({ where: { id }, data: body });
    await this.audit.record({ actor: user, action: 'trial.updated', entityType: 'TrialMatch', entityId: id, caseId: t.caseId, before: { includeInReport: t.includeInReport, hidden: t.hidden }, after: body });
    return updated;
  }

  @Roles('ANALYST')
  @Post('trials/:id/screen')
  async screen(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const t = await this.prisma.trialMatch.findUniqueOrThrow({ where: { id }, include: { case: true } });
    const variants = await this.prisma.variant.findMany({ where: { caseId: t.caseId, reportable: true } });
    await this.trials.screen(t.caseId, [id], {
      patient: t.case.patient as unknown as PatientProfile,
      tumorLabel: (t.case.diagnosis as any)?.label ?? 'Unknown',
      variants: variants.map((v) => `${v.gene} ${v.proteinShort ?? v.hgvsc ?? ''}`.trim()),
    });
    await this.audit.record({ actor: user, action: 'ai.trial_screen_requested', entityType: 'TrialMatch', entityId: id, caseId: t.caseId });
    return this.prisma.trialMatch.findUnique({ where: { id } });
  }

  @Roles('ANALYST')
  @Post('trials/:id/ai-decision')
  async decide(@Param('id') id: string, @Body(new ZodPipe(z.object({ decision: z.enum(['ACCEPTED', 'REJECTED']) }))) body: { decision: 'ACCEPTED' | 'REJECTED' }, @CurrentUser() user: AuthUser) {
    const t = await this.prisma.trialMatch.findUniqueOrThrow({ where: { id } });
    const s = t.aiScreen as any;
    if (!s?.aiRunId) return { ok: false };
    await this.prisma.trialMatch.update({ where: { id }, data: { aiScreen: { ...s, decision: body.decision } as Prisma.InputJsonValue } });
    await this.prisma.aiRun.update({ where: { id: s.aiRunId }, data: { humanDecision: body.decision, decidedById: user.id, decidedAt: new Date() } });
    await this.audit.record({ actor: user, action: `ai.trial_screen_${body.decision.toLowerCase()}`, entityType: 'TrialMatch', entityId: id, caseId: t.caseId, after: { verdict: s.verdict } });
    return { ok: true };
  }
}
