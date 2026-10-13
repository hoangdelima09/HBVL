import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import { LIMITS } from '@hbvl/contracts';
import { AppError } from '../common/errors';
import type { Ctx, Db } from './context';
import { originalUploadPath } from './content';
import { checksumOf } from './mappers';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const DERIVED = /-(?:scaled|\d{1,5}x\d{1,5})\.[A-Za-z0-9]+$/;

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue; // never follow links out of the uploads tree
      if (e.isDirectory()) visit(p);
      else if (e.isFile()) out.push(relative(root, p).split(sep).join('/'));
    }
  };
  visit(root);
  return out.sort();
}

/**
 * Media library. Every recoverable image becomes a PRIVATE, ORPHAN asset (decoded and re-encoded by the normal upload pipeline, EXIF dropped);
 * the posts phase attaches the ones that are used and makes them public only together with a PUBLISHED post. Identical bytes are stored once.
 * Runs per file (no big transaction) because objects are written to S3 as a side effect — a retry must not duplicate them.
 */
export async function mediaPhase(ctx: Ctx, db: Db): Promise<void> {
  const { snap, rep, opts } = ctx;
  const files = new Set<string>();
  if (opts.uploadsDir && existsSync(opts.uploadsDir)) for (const f of walk(opts.uploadsDir)) files.add(f);
  else
    rep.add(
      'WARNING',
      'UPLOADS_DIR_MISSING',
      undefined,
      undefined,
      opts.uploadsDir ? 'Thư mục uploads không tồn tại; không khôi phục được tệp ảnh.' : 'Không cung cấp --uploads-dir; bỏ qua tệp ảnh.',
    );

  const attachmentRows = snap.posts.filter((p) => p.post_type === 'attachment');
  const attachmentByPath = new Map<string, string>();
  for (const a of attachmentRows) {
    const rel = snap.postmeta.get(a.ID)?.get('_wp_attached_file');
    if (rel) attachmentByPath.set(rel, a.ID);
  }

  const byChecksum = new Map<string, string>(); // source-bytes sha256 → asset id (dedupe)
  for (const [, row] of ctx.idMap.entities('file')) byChecksum.set(row.sourceChecksum, row.entityId);

  const process = async (rel: string, origin: 'attachment' | 'orphan'): Promise<void> => {
    const ext = extname(rel).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      rep.bump('media', 'skipped:unsupported-type');
      rep.add('WARNING', 'MEDIA_UNSUPPORTED_TYPE', 'file', rel, `Tệp ${ext || '(không có đuôi)'} không phải JPEG/PNG/WebP nên không nhập.`);
      return;
    }
    const abs = join(opts.uploadsDir!, ...rel.split('/'));
    const size = statSync(abs).size;
    if (size > LIMITS.imageMaxBytes) {
      rep.bump('media', 'skipped:too-large');
      rep.add('WARNING', 'MEDIA_TOO_LARGE', 'file', rel, `Ảnh ${(size / 1048576).toFixed(1)} MB vượt giới hạn ${LIMITS.imageMaxBytes / 1048576} MB.`);
      return;
    }
    const buffer = readFileSync(abs);
    const sourceChecksum = createHash('sha256').update(buffer).digest('hex');

    const prior = ctx.idMap.get('file', rel);
    if (prior && prior.sourceChecksum === sourceChecksum) {
      ctx.uploads.set(rel, prior.entityId);
      rep.bump('media', 'unchanged');
      return;
    }

    let assetId = byChecksum.get(sourceChecksum);
    if (assetId) {
      rep.bump('media', 'deduplicated');
      rep.add('INFO', 'MEDIA_DUPLICATE', 'file', rel, 'Tệp trùng nội dung với một ảnh đã nhập; dùng chung một bản.');
    } else {
      try {
        const asset = await ctx.media.uploadImage(null, { buffer, originalname: basename(rel) }, 'LEGACY_IMPORT', {
          status: 'ORPHAN',
          visibility: 'PRIVATE',
          db: ctx.dry ? db : undefined,
          skipStorage: ctx.dry,
        });
        assetId = asset.id;
        byChecksum.set(sourceChecksum, assetId);
        rep.bump('media', 'created');
      } catch (e) {
        if (!(e instanceof AppError)) throw e; // storage/database outage: abort the run (resumable) instead of silently skipping files
        const detail = e.message;
        rep.bump('media', 'skipped:unreadable');
        rep.add('WARNING', 'MEDIA_UNREADABLE', 'file', rel, `Không giải mã được ảnh (${detail}).`);
        return;
      }
    }
    ctx.uploads.set(rel, assetId);
    await ctx.idMap.put(db, 'file', rel, { entityType: 'media_asset', entityId: assetId, sourceChecksum, importedChecksum: sourceChecksum });
    if (origin === 'orphan') rep.add('INFO', 'MEDIA_ORPHAN_FILE', 'file', rel, 'Tệp ảnh không có bản ghi attachment trong CSDL; nhập ở trạng thái riêng tư, chưa gắn vào bài nào.');
  };

  // Files that have an attachment row, then the rest. Derived sizes (-300x200) are skipped when the original exists.
  const handled = new Set<string>();
  for (const rel of [...files].sort()) {
    if (DERIVED.test(rel) && files.has(originalUploadPath(rel))) {
      rep.bump('media', 'skipped:derived-size');
      handled.add(rel);
      continue;
    }
    await process(rel, attachmentByPath.has(rel) ? 'attachment' : 'orphan');
    handled.add(rel);
  }

  for (const a of attachmentRows) {
    const rel = snap.postmeta.get(a.ID)?.get('_wp_attached_file');
    const sourceChecksum = checksumOf({ id: a.ID, rel, title: a.post_title });
    const assetId = rel ? ctx.uploads.get(rel) : undefined;
    if (snap.postmeta.get(a.ID)?.get('_wp_attachment_context') === 'site-icon')
      rep.add('INFO', 'MEDIA_SITE_ICON', 'attachment', a.ID, 'Icon site của WordPress; thay bằng logo của hệ thống mới.');
    if (!rel || !assetId) {
      rep.bump('attachments', 'missingFile');
      rep.add('WARNING', 'MEDIA_FILE_MISSING', 'attachment', a.ID, 'Bản ghi attachment không có tệp ảnh tương ứng trong thư mục uploads.', { path: rel ?? null });
      continue;
    }
    ctx.attachments.set(a.ID, assetId);
    if (!ctx.idMap.get('attachment', a.ID)) {
      await ctx.idMap.put(db, 'attachment', a.ID, { entityType: 'media_asset', entityId: assetId, sourceChecksum, importedChecksum: sourceChecksum });
      rep.bump('attachments', 'linked');
    } else rep.bump('attachments', 'unchanged');
  }
  // rebuild lookup for already-migrated runs
  for (const [rel, row] of ctx.idMap.entities('file')) if (!ctx.uploads.has(rel)) ctx.uploads.set(rel, row.entityId);
  for (const [id, row] of ctx.idMap.entities('attachment')) if (!ctx.attachments.has(id)) ctx.attachments.set(id, row.entityId);
}
