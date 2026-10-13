-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'COLLABORATOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_RESET', 'DELETED');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('vi', 'en');

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD', 'ACTIVATE_ACCOUNT');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('CARD', 'PROFILE', 'SONG', 'TIP');

-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('POST', 'EVENT', 'PROGRAM');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'PUBLISHED', 'SCHEDULED', 'PRIVATE', 'TRASHED');

-- CreateEnum
CREATE TYPE "ContentOrigin" AS ENUM ('SITE', 'WORDPRESS', 'SEED_DEMO');

-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('CREATE', 'SAVE_DRAFT', 'SUBMIT', 'RESUBMIT', 'STAFF_EDIT', 'REQUEST_CHANGES', 'REJECT', 'PUBLISH', 'UNPUBLISH', 'ADMIN_EDIT', 'DELETE', 'RESTORE');

-- CreateEnum
CREATE TYPE "RevisionKind" AS ENUM ('SNAPSHOT', 'WP_REVISION');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('STAGED', 'ACTIVE', 'ORPHAN', 'DELETED');

-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('POST_FEATURED', 'POST_INLINE', 'PROVINCE_PHOTO', 'SITE', 'LEGACY_IMPORT');

-- CreateEnum
CREATE TYPE "PostMediaRole" AS ENUM ('FEATURED', 'INLINE');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('APPROVED', 'PENDING', 'SPAM', 'TRASHED');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('NEW', 'DONE');

-- CreateEnum
CREATE TYPE "MailState" AS ENUM ('NONE', 'QUEUED', 'SENT_TO_PROVIDER', 'DELIVERED', 'FAILED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "AdminSystem" AS ENUM ('CURRENT_34', 'LEGACY_63');

-- CreateEnum
CREATE TYPE "ProvinceKind" AS ENUM ('PROVINCE', 'CITY');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DirectoryVerification" AS ENUM ('UNVERIFIED_SAMPLE', 'VERIFIED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "PageTemplate" AS ENUM ('DEFAULT', 'CONTACT', 'ANNOUNCEMENTS', 'ABOUT');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateEnum
CREATE TYPE "RedirectSource" AS ENUM ('LEGACY_MIGRATION', 'ADMIN');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MigrationMode" AS ENUM ('DRY_RUN', 'APPLY');

-- CreateEnum
CREATE TYPE "MigrationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(60) NOT NULL,
    "usernameNormalized" VARCHAR(60) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "emailNormalized" VARCHAR(254) NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMPTZ(6),
    "locale" "Locale" NOT NULL DEFAULT 'vi',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEnc" TEXT,
    "lastLoginAt" TIMESTAMPTZ(6),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "userId" UUID NOT NULL,
    "bio" VARCHAR(500),
    "notificationPrefs" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "csrfSalt" CHAR(32) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "idleExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "rememberMe" BOOLEAN NOT NULL DEFAULT false,
    "mfaVerifiedAt" TIMESTAMPTZ(6),
    "ipHash" CHAR(16),
    "userAgent" VARCHAR(255),
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "parentId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "cardType" "CardType" NOT NULL DEFAULT 'CARD',
    "iconKey" VARCHAR(40),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_translations" (
    "categoryId" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "navLabel" VARCHAR(60),
    "summary" VARCHAR(500),
    "description" VARCHAR(1000),

    CONSTRAINT "category_translations_pkey" PRIMARY KEY ("categoryId","locale")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL,
    "kind" "PostKind" NOT NULL DEFAULT 'POST',
    "slug" VARCHAR(200) NOT NULL,
    "authorId" UUID,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(300) NOT NULL,
    "excerpt" VARCHAR(1000),
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "contentText" TEXT NOT NULL DEFAULT '',
    "searchText" TEXT NOT NULL DEFAULT '',
    "featuredAssetId" UUID,
    "publishedAt" TIMESTAMPTZ(6),
    "scheduledAt" TIMESTAMPTZ(6),
    "submittedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "commentsOpen" BOOLEAN NOT NULL DEFAULT true,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "legacyLikeCount" INTEGER NOT NULL DEFAULT 0,
    "origin" "ContentOrigin" NOT NULL DEFAULT 'SITE',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "originalLocale" "Locale" NOT NULL DEFAULT 'vi',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_translations" (
    "postId" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "excerpt" VARCHAR(1000),
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "contentText" TEXT NOT NULL DEFAULT '',
    "searchText" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "post_translations_pkey" PRIMARY KEY ("postId","locale")
);

-- CreateTable
CREATE TABLE "post_categories" (
    "postId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "post_categories_pkey" PRIMARY KEY ("postId","categoryId")
);

-- CreateTable
CREATE TABLE "post_tags" (
    "postId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "post_tags_pkey" PRIMARY KEY ("postId","tagId")
);

-- CreateTable
CREATE TABLE "event_details" (
    "postId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(6),
    "endsAt" TIMESTAMPTZ(6),
    "locationText" VARCHAR(300),

    CONSTRAINT "event_details_pkey" PRIMARY KEY ("postId")
);

-- CreateTable
CREATE TABLE "program_details" (
    "postId" UUID NOT NULL,
    "openFrom" TIMESTAMPTZ(6),
    "openUntil" TIMESTAMPTZ(6),
    "applyUrl" VARCHAR(500),

    CONSTRAINT "program_details_pkey" PRIMARY KEY ("postId")
);

-- CreateTable
CREATE TABLE "post_revisions" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "RevisionKind" NOT NULL DEFAULT 'SNAPSHOT',
    "actorId" UUID,
    "title" VARCHAR(300) NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "categoryIds" UUID[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_events" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "actorId" UUID,
    "action" "ReviewAction" NOT NULL,
    "fromStatus" "PostStatus",
    "toStatus" "PostStatus" NOT NULL,
    "reason" VARCHAR(2000),
    "postVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "slug" VARCHAR(200) NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "template" "PageTemplate" NOT NULL DEFAULT 'DEFAULT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "title" VARCHAR(300) NOT NULL,
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "contentText" TEXT NOT NULL DEFAULT '',
    "searchText" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "origin" "ContentOrigin" NOT NULL DEFAULT 'SITE',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_translations" (
    "pageId" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "contentText" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "page_translations_pkey" PRIMARY KEY ("pageId","locale")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "ownerId" UUID,
    "status" "MediaStatus" NOT NULL DEFAULT 'STAGED',
    "visibility" "MediaVisibility" NOT NULL DEFAULT 'PRIVATE',
    "purpose" "MediaPurpose" NOT NULL,
    "bucket" VARCHAR(63) NOT NULL,
    "objectKey" VARCHAR(400) NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksumSha256" CHAR(64) NOT NULL,
    "originalName" VARCHAR(200),
    "variants" JSONB NOT NULL DEFAULT '{}',
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_media" (
    "postId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "role" "PostMediaRole" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "post_media_pkey" PRIMARY KEY ("postId","assetId","role")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "authorId" UUID,
    "authorName" VARCHAR(100) NOT NULL,
    "parentId" UUID,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "body" VARCHAR(5000) NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'PENDING',
    "moderatedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_likes" (
    "userId" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateTable
CREATE TABLE "feedbacks" (
    "id" UUID NOT NULL,
    "authorId" UUID,
    "subject" VARCHAR(160) NOT NULL,
    "message" VARCHAR(5000) NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "origin" "ContentOrigin" NOT NULL DEFAULT 'SITE',

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_status_history" (
    "id" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "actorId" UUID,
    "fromStatus" "FeedbackStatus",
    "toStatus" "FeedbackStatus" NOT NULL,
    "note" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL,
    "receiptCode" VARCHAR(24) NOT NULL,
    "userId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "message" VARCHAR(5000) NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'NEW',
    "mailState" "MailState" NOT NULL DEFAULT 'NONE',
    "mailError" VARCHAR(500),
    "origin" "ContentOrigin" NOT NULL DEFAULT 'SITE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_status_history" (
    "id" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "actorId" UUID,
    "fromStatus" "ContactStatus",
    "toStatus" "ContactStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(1000),
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "aggregateType" VARCHAR(60) NOT NULL,
    "aggregateId" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" VARCHAR(200),
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(6),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_delivery_attempts" (
    "id" UUID NOT NULL,
    "outboxEventId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "state" "MailState" NOT NULL,
    "providerResponse" VARCHAR(500),
    "messageId" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "resourceId" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "actorRole" "Role",
    "action" VARCHAR(80) NOT NULL,
    "resourceType" VARCHAR(60) NOT NULL,
    "resourceId" VARCHAR(64),
    "result" "AuditResult" NOT NULL DEFAULT 'SUCCESS',
    "requestId" VARCHAR(64),
    "ipHash" CHAR(16),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "redirects" (
    "id" UUID NOT NULL,
    "fromPath" VARCHAR(500) NOT NULL,
    "fromQuery" VARCHAR(200),
    "toPath" VARCHAR(500) NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 301,
    "source" "RedirectSource" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provinces" (
    "id" UUID NOT NULL,
    "system" "AdminSystem" NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "officialCode" VARCHAR(10),
    "nameVi" VARCHAR(100) NOT NULL,
    "nameEn" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "kind" "ProvinceKind" NOT NULL DEFAULT 'PROVINCE',
    "photoAssetId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "provinces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "province_mappings" (
    "legacyProvinceId" UUID NOT NULL,
    "currentProvinceId" UUID NOT NULL,

    CONSTRAINT "province_mappings_pkey" PRIMARY KEY ("legacyProvinceId")
);

-- CreateTable
CREATE TABLE "scholarship_members" (
    "id" UUID NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "normalizedName" VARCHAR(120) NOT NULL,
    "legacyProvinceId" UUID NOT NULL,
    "sourceIdentity" CHAR(64) NOT NULL,
    "userId" UUID,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "importRunId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scholarship_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_contacts" (
    "id" UUID NOT NULL,
    "provinceId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "role" VARCHAR(80) NOT NULL,
    "contactPath" VARCHAR(200) NOT NULL DEFAULT '/lien-he',
    "verification" "DirectoryVerification" NOT NULL DEFAULT 'UNVERIFIED_SAMPLE',
    "source" VARCHAR(120) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "directory_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_id_map" (
    "id" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'wp',
    "legacyType" VARCHAR(30) NOT NULL,
    "legacyId" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" UUID NOT NULL,
    "sourceChecksum" CHAR(64) NOT NULL,
    "importedChecksum" CHAR(64) NOT NULL,
    "migratedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_id_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_runs" (
    "id" UUID NOT NULL,
    "mode" "MigrationMode" NOT NULL,
    "status" "MigrationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "fingerprint" CHAR(64) NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),
    "stats" JSONB NOT NULL DEFAULT '{}',
    "checkpoint" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "migration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_issues" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "legacyType" VARCHAR(30),
    "legacyId" VARCHAR(100),
    "message" VARCHAR(500) NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_usernameNormalized_key" ON "users"("usernameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "users_emailNormalized_key" ON "users"("emailNormalized");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_tokenHash_key" ON "auth_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_tokens_userId_purpose_idx" ON "auth_tokens"("userId", "purpose");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_userId_idx" ON "mfa_recovery_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parentId_sortOrder_idx" ON "categories"("parentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "posts_status_publishedAt_id_idx" ON "posts"("status", "publishedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "posts_authorId_status_updatedAt_idx" ON "posts"("authorId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "posts_kind_status_publishedAt_idx" ON "posts"("kind", "status", "publishedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "posts_kind_slug_key" ON "posts"("kind", "slug");

-- CreateIndex
CREATE INDEX "post_categories_categoryId_postId_idx" ON "post_categories"("categoryId", "postId");

-- CreateIndex
CREATE INDEX "post_tags_tagId_idx" ON "post_tags"("tagId");

-- CreateIndex
CREATE INDEX "post_revisions_postId_createdAt_idx" ON "post_revisions"("postId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "review_events_postId_createdAt_idx" ON "review_events"("postId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "pages_status_publishedAt_idx" ON "pages"("status", "publishedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pages_parentId_slug_key" ON "pages"("parentId", "slug");

-- CreateIndex
CREATE INDEX "media_assets_checksumSha256_idx" ON "media_assets"("checksumSha256");

-- CreateIndex
CREATE INDEX "media_assets_status_createdAt_idx" ON "media_assets"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_bucket_objectKey_key" ON "media_assets"("bucket", "objectKey");

-- CreateIndex
CREATE INDEX "post_media_assetId_idx" ON "post_media"("assetId");

-- CreateIndex
CREATE INDEX "comments_postId_status_createdAt_idx" ON "comments"("postId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "comments_status_createdAt_idx" ON "comments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "comments_authorId_idx" ON "comments"("authorId");

-- CreateIndex
CREATE INDEX "post_likes_postId_idx" ON "post_likes"("postId");

-- CreateIndex
CREATE INDEX "feedbacks_status_createdAt_idx" ON "feedbacks"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "feedbacks_authorId_createdAt_idx" ON "feedbacks"("authorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "feedback_status_history_feedbackId_createdAt_idx" ON "feedback_status_history"("feedbackId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "contact_messages_receiptCode_key" ON "contact_messages"("receiptCode");

-- CreateIndex
CREATE INDEX "contact_messages_status_createdAt_idx" ON "contact_messages"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "contact_messages_userId_createdAt_idx" ON "contact_messages"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "contact_status_history_contactId_createdAt_idx" ON "contact_status_history"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_dedupeKey_key" ON "outbox_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "outbox_events_status_availableAt_idx" ON "outbox_events"("status", "availableAt");

-- CreateIndex
CREATE INDEX "outbox_events_aggregateType_aggregateId_idx" ON "outbox_events"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "email_delivery_attempts_outboxEventId_attempt_idx" ON "email_delivery_attempts"("outboxEventId", "attempt");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_actorId_operation_key_key" ON "idempotency_records"("actorId", "operation", "key");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_at_idx" ON "audit_logs"("actorId", "at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "redirects_fromPath_key" ON "redirects"("fromPath");

-- CreateIndex
CREATE INDEX "redirects_fromPath_fromQuery_idx" ON "redirects"("fromPath", "fromQuery");

-- CreateIndex
CREATE UNIQUE INDEX "provinces_system_code_key" ON "provinces"("system", "code");

-- CreateIndex
CREATE UNIQUE INDEX "provinces_system_slug_key" ON "provinces"("system", "slug");

-- CreateIndex
CREATE INDEX "province_mappings_currentProvinceId_idx" ON "province_mappings"("currentProvinceId");

-- CreateIndex
CREATE UNIQUE INDEX "scholarship_members_sourceIdentity_key" ON "scholarship_members"("sourceIdentity");

-- CreateIndex
CREATE UNIQUE INDEX "scholarship_members_userId_key" ON "scholarship_members"("userId");

-- CreateIndex
CREATE INDEX "scholarship_members_legacyProvinceId_status_idx" ON "scholarship_members"("legacyProvinceId", "status");

-- CreateIndex
CREATE INDEX "scholarship_members_normalizedName_idx" ON "scholarship_members"("normalizedName");

-- CreateIndex
CREATE INDEX "directory_contacts_provinceId_verification_sortOrder_idx" ON "directory_contacts"("provinceId", "verification", "sortOrder");

-- CreateIndex
CREATE INDEX "legacy_id_map_entityType_entityId_idx" ON "legacy_id_map"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_id_map_source_legacyType_legacyId_key" ON "legacy_id_map"("source", "legacyType", "legacyId");

-- CreateIndex
CREATE INDEX "migration_issues_runId_severity_code_idx" ON "migration_issues"("runId", "severity", "code");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_featuredAssetId_fkey" FOREIGN KEY ("featuredAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_translations" ADD CONSTRAINT "post_translations_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_categories" ADD CONSTRAINT "post_categories_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_categories" ADD CONSTRAINT "post_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_details" ADD CONSTRAINT "event_details_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_details" ADD CONSTRAINT "program_details_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_translations" ADD CONSTRAINT "page_translations_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_status_history" ADD CONSTRAINT "feedback_status_history_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "feedbacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_status_history" ADD CONSTRAINT "contact_status_history_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_delivery_attempts" ADD CONSTRAINT "email_delivery_attempts_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "outbox_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provinces" ADD CONSTRAINT "provinces_photoAssetId_fkey" FOREIGN KEY ("photoAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "province_mappings" ADD CONSTRAINT "province_mappings_legacyProvinceId_fkey" FOREIGN KEY ("legacyProvinceId") REFERENCES "provinces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "province_mappings" ADD CONSTRAINT "province_mappings_currentProvinceId_fkey" FOREIGN KEY ("currentProvinceId") REFERENCES "provinces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_members" ADD CONSTRAINT "scholarship_members_legacyProvinceId_fkey" FOREIGN KEY ("legacyProvinceId") REFERENCES "provinces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_members" ADD CONSTRAINT "scholarship_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_contacts" ADD CONSTRAINT "directory_contacts_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "provinces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_issues" ADD CONSTRAINT "migration_issues_runId_fkey" FOREIGN KEY ("runId") REFERENCES "migration_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

