-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ANALYST', 'LAB_DIRECTOR');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'RETURNED', 'SIGNED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "caseCode" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "sampleType" TEXT NOT NULL,
    "genomeBuild" TEXT NOT NULL,
    "assay" TEXT,
    "patient" JSONB NOT NULL,
    "location" JSONB,
    "diagnosis" JSONB,
    "vcfFileName" TEXT NOT NULL,
    "vcfSha256" TEXT NOT NULL,
    "vcfStats" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "chrom" TEXT NOT NULL,
    "pos" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "rsId" TEXT,
    "filter" TEXT,
    "genotype" TEXT,
    "zygosity" TEXT,
    "vaf" DOUBLE PRECISION,
    "depth" INTEGER,
    "gene" TEXT,
    "transcript" TEXT,
    "hgvsc" TEXT,
    "hgvsp" TEXT,
    "proteinShort" TEXT,
    "consequence" TEXT,
    "impact" TEXT,
    "annotation" JSONB,
    "popFreq" JSONB,
    "classification" JSONB,
    "override" JSONB,
    "reportable" BOOLEAN NOT NULL DEFAULT false,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "variantId" TEXT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "url" TEXT,
    "category" TEXT NOT NULL,
    "level" TEXT,
    "significance" TEXT,
    "direction" TEXT,
    "disease" TEXT,
    "therapies" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL,
    "citation" TEXT,
    "sourceVersion" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "origin" TEXT NOT NULL DEFAULT 'AUTO',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "includeInReport" BOOLEAN NOT NULL DEFAULT true,
    "ai" JSONB,
    "deleteReason" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgxResult" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "gene" TEXT NOT NULL,
    "diplotype" TEXT,
    "phenotype" TEXT,
    "activityScore" TEXT,
    "calledVariants" JSONB NOT NULL DEFAULT '[]',
    "caveats" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "includeInReport" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgxResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialMatch" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "nctId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "phase" TEXT,
    "status" TEXT,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "interventions" JSONB NOT NULL DEFAULT '[]',
    "matchedTerms" JSONB NOT NULL DEFAULT '[]',
    "nearestSite" JSONB,
    "distanceKm" DOUBLE PRECISION,
    "sites" JSONB NOT NULL DEFAULT '[]',
    "eligibility" TEXT,
    "minAge" TEXT,
    "maxAge" TEXT,
    "sex" TEXT,
    "aiScreen" JSONB,
    "includeInReport" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "templateId" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "signedById" TEXT,
    "signedAt" TIMESTAMP(3),
    "snapshot" JSONB,
    "pdfSha256" TEXT,
    "pdf" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "theme" JSONB NOT NULL,
    "sections" JSONB NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "seq" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "caseId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caseId" TEXT,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "outputRaw" TEXT,
    "output" JSONB,
    "guardrails" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "error" TEXT,
    "latencyMs" INTEGER,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "humanDecision" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbCache" (
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Case_caseCode_key" ON "Case"("caseCode");

-- CreateIndex
CREATE INDEX "Variant_caseId_idx" ON "Variant"("caseId");

-- CreateIndex
CREATE INDEX "Evidence_caseId_idx" ON "Evidence"("caseId");

-- CreateIndex
CREATE INDEX "Evidence_variantId_idx" ON "Evidence"("variantId");

-- CreateIndex
CREATE INDEX "PgxResult_caseId_idx" ON "PgxResult"("caseId");

-- CreateIndex
CREATE INDEX "TrialMatch_caseId_idx" ON "TrialMatch"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "TrialMatch_caseId_nctId_key" ON "TrialMatch"("caseId", "nctId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_caseId_version_key" ON "Report"("caseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ReportTemplate_name_key" ON "ReportTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_hash_key" ON "AuditEvent"("hash");

-- CreateIndex
CREATE INDEX "AuditEvent_caseId_idx" ON "AuditEvent"("caseId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AiRun_caseId_idx" ON "AiRun"("caseId");

-- CreateIndex
CREATE INDEX "AiRun_task_idx" ON "AiRun"("task");

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgxResult" ADD CONSTRAINT "PgxResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrialMatch" ADD CONSTRAINT "TrialMatch_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
