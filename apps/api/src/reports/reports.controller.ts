import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../auth/roles';
import { ZodPipe } from '../common/zod.pipe';
import { ReportsService, serialise } from './reports.service';

const SectionEdit = z.object({ section: z.string().min(1).max(80), text: z.string().max(20000) });

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('cases/:id/report')
  latest(@Param('id') caseId: string) {
    return this.reports.latest(caseId);
  }

  @Get('reports/:id')
  async get(@Param('id') id: string) {
    return serialise(await this.reports.assemble(id));
  }

  @Roles('ANALYST')
  @Patch('reports/:id/content')
  edit(@Param('id') id: string, @Body(new ZodPipe(SectionEdit)) body: z.infer<typeof SectionEdit>, @CurrentUser() user: AuthUser) {
    return this.reports.editSection(id, user, body.section, body.text);
  }

  @Roles('ANALYST')
  @Post('reports/:id/ai-decision')
  decide(@Param('id') id: string, @Body(new ZodPipe(z.object({ section: z.string(), decision: z.enum(['ACCEPTED', 'REJECTED']), note: z.string().max(500).optional() }))) body: { section: string; decision: 'ACCEPTED' | 'REJECTED'; note?: string }, @CurrentUser() user: AuthUser) {
    return this.reports.decideAi(id, user, body.section, body.decision, body.note);
  }

  @Roles('ANALYST')
  @Post('reports/:id/regenerate')
  regenerate(@Param('id') id: string, @Body(new ZodPipe(z.object({ target: z.string() }))) body: { target: string }, @CurrentUser() user: AuthUser) {
    return this.reports.regenerate(id, user, body.target);
  }

  @Roles('ANALYST')
  @Patch('reports/:id/template')
  setTemplate(@Param('id') id: string, @Body(new ZodPipe(z.object({ templateId: z.string() }))) body: { templateId: string }, @CurrentUser() user: AuthUser) {
    return this.reports.setTemplate(id, user, body.templateId);
  }

  @Roles('ANALYST')
  @Post('reports/:id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reports.submit(id, user);
  }

  @Roles('LAB_DIRECTOR')
  @Post('reports/:id/return')
  returnToAnalyst(@Param('id') id: string, @Body(new ZodPipe(z.object({ comment: z.string().min(3).max(2000) }))) body: { comment: string }, @CurrentUser() user: AuthUser) {
    return this.reports.returnToAnalyst(id, user, body.comment);
  }

  @Roles('LAB_DIRECTOR')
  @Post('reports/:id/sign')
  sign(@Param('id') id: string, @Body(new ZodPipe(z.object({ attestation: z.string().min(10).max(1000) }))) body: { attestation: string }, @CurrentUser() user: AuthUser) {
    return this.reports.sign(id, user, body.attestation);
  }

  @Roles('LAB_DIRECTOR')
  @Post('reports/:id/amend')
  amend(@Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().min(3).max(1000) }))) body: { reason: string }, @CurrentUser() user: AuthUser) {
    return this.reports.amend(id, user, body.reason);
  }

  @Get('reports/:id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { pdf, name } = await this.reports.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.send(pdf);
  }
}
