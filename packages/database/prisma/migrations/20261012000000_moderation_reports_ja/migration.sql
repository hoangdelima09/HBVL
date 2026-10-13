-- Japanese UI/content locale.
ALTER TYPE "Locale" ADD VALUE IF NOT EXISTS 'ja';

-- Account restriction (comment/like/submit disabled) — softer than SUSPENDED.
ALTER TABLE "users"
  ADD COLUMN "restrictedAt" TIMESTAMPTZ(6),
  ADD COLUMN "restrictedUntil" TIMESTAMPTZ(6),
  ADD COLUMN "restrictionReason" VARCHAR(300);

-- Comment reports.
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'ABUSE', 'HATE', 'MISINFO', 'OTHER');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

CREATE TABLE "comment_reports" (
    "id" UUID NOT NULL,
    "commentId" UUID NOT NULL,
    "reporterId" UUID,
    "reason" "ReportReason" NOT NULL,
    "note" VARCHAR(500),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" UUID,
    "claimedAt" TIMESTAMPTZ(6),
    "handledById" UUID,
    "handledAt" TIMESTAMPTZ(6),
    "resolution" VARCHAR(40),
    "resolutionNote" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "comment_reports_commentId_reporterId_key" ON "comment_reports"("commentId", "reporterId");
CREATE INDEX "comment_reports_status_createdAt_idx" ON "comment_reports"("status", "createdAt");
CREATE INDEX "comment_reports_commentId_status_idx" ON "comment_reports"("commentId", "status");

ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
