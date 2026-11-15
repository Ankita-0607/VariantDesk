import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { config } from './common/config';
import { PrismaService } from './common/prisma.service';
import { AuditService } from './audit/audit.service';
import { AuditController } from './audit/audit.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AiService } from './ai/ai.service';
import { GeoService } from './geo/geo.service';
import { KbHttpService } from './kb/http.service';
import { VepClient } from './kb/vep.client';
import { ClinVarClient } from './kb/clinvar.client';
import { CivicClient } from './kb/civic.client';
import { PubMedClient } from './kb/pubmed.client';
import { CpicClient } from './kb/pgx';
import { CtGovClient } from './trials/ctgov.client';
import { TrialsService } from './trials/trials.service';
import { TrialsController } from './trials/trials.controller';
import { PipelineService } from './pipeline/pipeline.service';
import { ReportsService } from './reports/reports.service';
import { ReportsController } from './reports/reports.controller';
import { TemplatesController } from './reports/templates.controller';
import { CasesController } from './cases/cases.controller';
import { VariantsController } from './cases/variants.controller';

@Module({
  imports: [JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: '12h' } })],
  controllers: [AuthController, CasesController, VariantsController, TrialsController, ReportsController, TemplatesController, AuditController],
  providers: [
    PrismaService,
    AuditService,
    AiService,
    GeoService,
    KbHttpService,
    VepClient,
    ClinVarClient,
    CivicClient,
    PubMedClient,
    CpicClient,
    CtGovClient,
    TrialsService,
    PipelineService,
    ReportsService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
