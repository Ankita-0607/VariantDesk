import { Body, ConflictException, Controller, Delete, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/roles';
import { ZodPipe } from '../common/zod.pipe';
import { renderPdf } from './pdf';
import { SectionsSchema, TemplateSchema, ThemeSchema } from './template.defaults';
import { sampleReport } from './sample-report';

@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.prisma.reportTemplate.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  }

  @Roles('ADMIN')
  @Post()
  async create(@Body(new ZodPipe(TemplateSchema)) body: z.infer<typeof TemplateSchema>, @CurrentUser() user: AuthUser) {
    const t = await this.prisma.reportTemplate.create({ data: { name: body.name, theme: body.theme as Prisma.InputJsonValue, sections: body.sections as Prisma.InputJsonValue, updatedById: user.id } });
    await this.audit.record({ actor: user, action: 'template.created', entityType: 'ReportTemplate', entityId: t.id, after: t });
    return t;
  }

  @Roles('ADMIN')
  @Patch(':id')
  async update(@Param('id') id: string, @Body(new ZodPipe(TemplateSchema.partial())) body: Partial<z.infer<typeof TemplateSchema>>, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.reportTemplate.findUniqueOrThrow({ where: { id } });
    const t = await this.prisma.reportTemplate.update({
      where: { id },
      data: { name: body.name, theme: body.theme as Prisma.InputJsonValue | undefined, sections: body.sections as Prisma.InputJsonValue | undefined, updatedById: user.id },
    });
    await this.audit.record({ actor: user, action: 'template.updated', entityType: 'ReportTemplate', entityId: id, before, after: t });
    return t;
  }

  @Roles('ADMIN')
  @Post(':id/default')
  async makeDefault(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.prisma.$transaction([
      this.prisma.reportTemplate.updateMany({ data: { isDefault: false } }),
      this.prisma.reportTemplate.update({ where: { id }, data: { isDefault: true } }),
    ]);
    await this.audit.record({ actor: user, action: 'template.set_default', entityType: 'ReportTemplate', entityId: id });
    return { ok: true };
  }

  @Roles('ADMIN')
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const t = await this.prisma.reportTemplate.findUniqueOrThrow({ where: { id } });
    if (t.isDefault) throw new ConflictException('Cannot delete the default template');
    await this.prisma.report.updateMany({ where: { templateId: id, status: { in: ['DRAFT', 'RETURNED'] } }, data: { templateId: null } });
    await this.prisma.reportTemplate.delete({ where: { id } });
    await this.audit.record({ actor: user, action: 'template.deleted', entityType: 'ReportTemplate', entityId: id, before: t });
    return { ok: true };
  }

  /** Renders a sample report with an unsaved theme/sections for live preview in the admin UI. */
  @Roles('ADMIN')
  @Post('preview')
  async preview(@Body(new ZodPipe(z.object({ theme: ThemeSchema, sections: SectionsSchema }))) body: { theme: z.infer<typeof ThemeSchema>; sections: z.infer<typeof SectionsSchema> }, @Res() res: Response) {
    const pdf = await renderPdf(sampleReport(), body.theme, body.sections);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }
}
