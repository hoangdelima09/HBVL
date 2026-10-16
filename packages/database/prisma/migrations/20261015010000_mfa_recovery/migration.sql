-- Recovering from a lost authenticator: e-mailed code → admin approval (collaborators/members), e-mailed link (administrators).
ALTER TYPE "AuthTokenPurpose" ADD VALUE IF NOT EXISTS 'MFA_RECOVERY';
ALTER TYPE "AuthTokenPurpose" ADD VALUE IF NOT EXISTS 'MFA_RESET';

CREATE TYPE "MfaResetStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "mfa_reset_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "MfaResetStatus" NOT NULL DEFAULT 'PENDING',
    "note" VARCHAR(500),
    "reviewerId" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "decisionNote" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_reset_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "mfa_reset_requests_status_createdAt_idx" ON "mfa_reset_requests"("status", "createdAt");
CREATE INDEX "mfa_reset_requests_userId_idx" ON "mfa_reset_requests"("userId");
-- one open request per person, enforced by the database (no duplicate e-mails to administrators under concurrency)
CREATE UNIQUE INDEX "mfa_reset_requests_one_pending" ON "mfa_reset_requests"("userId") WHERE "status" = 'PENDING';
ALTER TABLE "mfa_reset_requests" ADD CONSTRAINT "mfa_reset_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mfa_reset_requests" ADD CONSTRAINT "mfa_reset_requests_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
