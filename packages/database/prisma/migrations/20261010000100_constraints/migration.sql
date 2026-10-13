-- Constraints Prisma cannot express. Keep in sync with docs/DATABASE.md.

-- ─── Users ───
ALTER TABLE users
  ADD CONSTRAINT users_username_len CHECK (char_length(username) BETWEEN 3 AND 60),
  ADD CONSTRAINT users_failed_login_nonneg CHECK ("failedLoginCount" >= 0),
  ADD CONSTRAINT users_active_has_password CHECK (status <> 'ACTIVE' OR "passwordHash" IS NOT NULL),
  ADD CONSTRAINT users_pending_no_password CHECK (status <> 'PENDING_RESET' OR "passwordHash" IS NULL);

-- ─── Posts ───
ALTER TABLE posts
  ADD CONSTRAINT posts_title_len CHECK (char_length(title) BETWEEN 1 AND 300),
  ADD CONSTRAINT posts_version_pos CHECK (version >= 1),
  ADD CONSTRAINT posts_likes_nonneg CHECK ("likeCount" >= 0 AND "legacyLikeCount" >= 0),
  -- Only articles use the submission workflow; events/programs are admin-managed.
  ADD CONSTRAINT posts_workflow_only_for_posts CHECK (
    kind = 'POST' OR status IN ('DRAFT', 'PUBLISHED', 'SCHEDULED', 'PRIVATE', 'TRASHED')
  ),
  ADD CONSTRAINT posts_published_has_date CHECK (status <> 'PUBLISHED' OR "publishedAt" IS NOT NULL),
  ADD CONSTRAINT posts_scheduled_has_date CHECK (status <> 'SCHEDULED' OR "scheduledAt" IS NOT NULL),
  ADD CONSTRAINT posts_trashed_has_deleted CHECK (status <> 'TRASHED' OR "deletedAt" IS NOT NULL);

ALTER TABLE pages
  ADD CONSTRAINT pages_version_pos CHECK (version >= 1),
  ADD CONSTRAINT pages_status_allowed CHECK (status IN ('DRAFT', 'PUBLISHED', 'SCHEDULED', 'PRIVATE', 'TRASHED'));

-- A post has at most one primary category.
CREATE UNIQUE INDEX post_categories_one_primary ON post_categories ("postId") WHERE "isPrimary";
-- Page slugs are unique among root pages too (NULL parent is distinct in a plain unique index).
CREATE UNIQUE INDEX pages_root_slug_unique ON pages (slug) WHERE "parentId" IS NULL;

-- ─── Review history ───
ALTER TABLE review_events
  ADD CONSTRAINT review_reason_len CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 2000),
  -- A reason is mandatory for these transitions.
  ADD CONSTRAINT review_reason_required CHECK (
    action NOT IN ('REQUEST_CHANGES', 'REJECT') OR (reason IS NOT NULL AND btrim(reason) <> '')
  );

-- ─── Comments ───
ALTER TABLE comments
  ADD CONSTRAINT comments_depth_range CHECK (depth BETWEEN 0 AND 4),
  ADD CONSTRAINT comments_body_len CHECK (char_length(body) BETWEEN 1 AND 5000),
  ADD CONSTRAINT comments_root_depth CHECK ((("parentId" IS NULL) AND depth = 0) OR (("parentId" IS NOT NULL) AND depth > 0));

-- ─── Inboxes (limits from legacy theme) ───
ALTER TABLE feedbacks
  ADD CONSTRAINT feedback_subject_len CHECK (char_length(subject) BETWEEN 1 AND 160),
  ADD CONSTRAINT feedback_message_len CHECK (char_length(message) BETWEEN 1 AND 5000);
ALTER TABLE feedback_status_history
  ADD CONSTRAINT feedback_note_len CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000);
ALTER TABLE contact_messages
  ADD CONSTRAINT contact_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
  ADD CONSTRAINT contact_email_len CHECK (char_length(email) BETWEEN 3 AND 254),
  ADD CONSTRAINT contact_subject_len CHECK (char_length(subject) BETWEEN 0 AND 200),
  ADD CONSTRAINT contact_message_len CHECK (char_length(message) BETWEEN 1 AND 5000);

-- ─── Media ───
ALTER TABLE media_assets
  ADD CONSTRAINT media_size_pos CHECK ("byteSize" >= 0),
  ADD CONSTRAINT media_sha_hex CHECK ("checksumSha256" ~ '^[0-9a-f]{64}$');

-- ─── Map ───
ALTER TABLE province_mappings
  ADD CONSTRAINT province_mapping_not_self CHECK ("legacyProvinceId" <> "currentProvinceId");
-- Mapping direction is enforced by trigger: legacy side must be LEGACY_63 and current side CURRENT_34.
CREATE FUNCTION province_mapping_check() RETURNS trigger AS $$
BEGIN
  IF (SELECT system FROM provinces WHERE id = NEW."legacyProvinceId") <> 'LEGACY_63' THEN
    RAISE EXCEPTION 'province_mappings.legacyProvinceId must reference a LEGACY_63 province';
  END IF;
  IF (SELECT system FROM provinces WHERE id = NEW."currentProvinceId") <> 'CURRENT_34' THEN
    RAISE EXCEPTION 'province_mappings.currentProvinceId must reference a CURRENT_34 province';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER province_mapping_check BEFORE INSERT OR UPDATE ON province_mappings
  FOR EACH ROW EXECUTE FUNCTION province_mapping_check();

-- Members originate from a LEGACY_63 province.
CREATE FUNCTION member_origin_check() RETURNS trigger AS $$
BEGIN
  IF (SELECT system FROM provinces WHERE id = NEW."legacyProvinceId") <> 'LEGACY_63' THEN
    RAISE EXCEPTION 'scholarship_members.legacyProvinceId must reference a LEGACY_63 province';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER member_origin_check BEFORE INSERT OR UPDATE OF "legacyProvinceId" ON scholarship_members
  FOR EACH ROW EXECUTE FUNCTION member_origin_check();

-- Directory contact link must be an internal route.
ALTER TABLE directory_contacts
  ADD CONSTRAINT directory_contact_path_internal CHECK ("contactPath" ~ '^/[^/\\]' OR "contactPath" = '/');

-- ─── Redirects: internal targets only, no loops ───
ALTER TABLE redirects
  ADD CONSTRAINT redirects_from_internal CHECK ("fromPath" ~ '^/([^/\\].*)?$'),
  ADD CONSTRAINT redirects_to_internal CHECK ("toPath" ~ '^/([^/\\].*)?$'),
  ADD CONSTRAINT redirects_no_self CHECK ("fromPath" <> "toPath"),
  ADD CONSTRAINT redirects_status CHECK ("statusCode" IN (301, 302, 307, 308));

-- ─── Idempotency ───
ALTER TABLE idempotency_records
  ADD CONSTRAINT idem_key_len CHECK (char_length(key) BETWEEN 8 AND 100),
  ADD CONSTRAINT idem_hash_hex CHECK ("requestHash" ~ '^[0-9a-f]{64}$');

-- ─── Search: trigram indexes on pre-folded text ───
CREATE INDEX posts_search_trgm ON posts USING gin ("searchText" gin_trgm_ops) WHERE status = 'PUBLISHED';
CREATE INDEX post_translations_search_trgm ON post_translations USING gin ("searchText" gin_trgm_ops);
CREATE INDEX pages_search_trgm ON pages USING gin ("searchText" gin_trgm_ops) WHERE status = 'PUBLISHED';
CREATE INDEX members_name_trgm ON scholarship_members USING gin ("normalizedName" gin_trgm_ops);
-- Feed query: newest published first, per kind.
CREATE INDEX posts_feed ON posts (kind, "publishedAt" DESC, id DESC) WHERE status = 'PUBLISHED';
-- Outbox claim query.
CREATE INDEX outbox_ready ON outbox_events ("availableAt") WHERE status IN ('PENDING', 'FAILED');

-- ─── Audit log is append-only for the application role (and for everyone via trigger) ───
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% not allowed)', TG_OP;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- Review events are append-only as well (history must not be rewritten).
CREATE TRIGGER review_events_no_update BEFORE UPDATE OR DELETE ON review_events
  FOR EACH ROW WHEN (current_setting('hbvl.allow_history_delete', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION audit_log_immutable();
-- (Deleting a post cascades its review events; the application sets hbvl.allow_history_delete only inside the admin hard-delete transaction.)

-- ─── Privileges for the runtime role: DML only; no DDL; audit_logs insert/select only ───
DO $$
BEGIN
  -- Default privileges were granted by infra/postgres/init/01-roles.sh; tighten audit_logs explicitly.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hbvl_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM hbvl_app;
  END IF;
END $$;
