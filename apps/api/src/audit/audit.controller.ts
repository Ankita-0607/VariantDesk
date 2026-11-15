import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Roles } from '../auth/roles';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query('caseId') caseId?: string, @Query('limit') limit = '200') {
    return this.prisma.auditEvent.findMany({
      where: caseId ? { caseId } : {},
      orderBy: { seq: 'desc' },
      take: Math.min(Number(limit) || 200, 1000),
    });
  }

  @Roles('ADMIN', 'LAB_DIRECTOR')
  @Get('verify')
  verify() {
    return this.audit.verify();
  }

  @Get('ai-runs')
  aiRuns(@Query('caseId') caseId?: string, @Query('limit') limit = '200') {
    return this.prisma.aiRun.findMany({
      where: caseId ? { caseId } : {},
      orderBy: { at: 'desc' },
      take: Math.min(Number(limit) || 200, 1000),
    });
  }
}
