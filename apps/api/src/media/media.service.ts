import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { LIMITS } from '@hbvl/contracts';
import { Prisma, PrismaClient, type MediaAsset, type MediaPurpose, type MediaStatus } from '@hbvl/database';
import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { AppError, E } from '../common/errors';
import { StorageService } from './storage.service';

export const VARIANTS = ['thumb', 'card', 'large', 'original'] as const;
export type Variant = (typeof VARIANTS)[number];
type VariantMeta = Record<string, { key: string; width: number; height: number; mime: string }>;

const FORMAT_MIME: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const FORMAT_EXT: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

export const mediaUrl = (id: string, variant: Variant = 'large') => `/api/v1/media/${id}/${variant}`;

/** Options used by trusted importers (WordPress migration); user uploads never pass these. */
export interface UploadOptions {
  status?: MediaStatus;
  visibility?: 'PUBLIC' | 'PRIVATE';
  isPlaceholder?: boolean;
  /** Run the insert inside a caller's transaction (dry-run rolls it back). */
  db?: Prisma.TransactionClient;
  /** Decode and re-encode but write nothing to object storage (dry-run). */
  skipStorage?: boolean;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageService,
  ) {}

  /**
   * Accepts only what we can DECODE as JPEG/PNG/WebP. The client's filename and Content-Type are ignored entirely:
   * the real format comes from the decoder, pixels are bounded (decompression-bomb guard), metadata (EXIF/GPS) is dropped by re-encoding,
   * and object keys are server-generated.
   */
  async uploadImage(
    owner: { id: string } | null,
    file: { buffer: Buffer; originalname?: string },
    purpose: MediaPurpose = 'POST_FEATURED',
    opts: UploadOptions = {},
  ): Promise<MediaAsset> {
    if (!file?.buffer?.length) throw E.validation([{ path: 'file', message: 'Chưa chọn ảnh.' }], 'Chưa chọn ảnh.');
    if (file.buffer.length > LIMITS.imageMaxBytes) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Ảnh vượt quá 5 MB.');

    const input = () => sharp(file.buffer, { failOn: 'error', limitInputPixels: LIMITS.imageMaxPixels, sequentialRead: true });
    let meta: Metadata;
    try {
      meta = await input().metadata();
    } catch {
      throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Ảnh không hợp lệ. Chọn JPEG, PNG hoặc WebP tối đa 5 MB.');
    }
    const format = meta.format ?? '';
    if (!FORMAT_MIME[format]) throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Chỉ chấp nhận JPEG, PNG hoặc WebP.');
    if (!meta.width || !meta.height || meta.width > LIMITS.imageMaxSide || meta.height > LIMITS.imageMaxSide) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Kích thước ảnh không hợp lệ.');
    }

    let original: { data: Buffer; info: OutputInfo };
    let large: { data: Buffer; info: OutputInfo };
    let card: { data: Buffer; info: OutputInfo };
    let thumb: { data: Buffer; info: OutputInfo };
    try {
      // Full decode + re-encode (rotate() applies EXIF orientation, then metadata is not carried over).
      original = await input()
        .rotate()
        .toFormat(format as 'jpeg' | 'png' | 'webp', { quality: 88 })
        .toBuffer({ resolveWithObject: true });
      large = await input().rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
      card = await input().rotate().resize(800, 450, { fit: 'cover' }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      thumb = await input().rotate().resize(400, 300, { fit: 'cover' }).webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
    } catch {
      throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Không đọc được ảnh (tệp hỏng hoặc không đúng định dạng).');
    }

    const id = randomUUID();
    const prefix = `media/${new Date().getUTCFullYear()}/${id}`;
    const variants: VariantMeta = {
      original: { key: `${prefix}/original.${FORMAT_EXT[format]}`, width: original.info.width, height: original.info.height, mime: FORMAT_MIME[format]! },
      large: { key: `${prefix}/large.webp`, width: large.info.width, height: large.info.height, mime: 'image/webp' },
      card: { key: `${prefix}/card.webp`, width: card.info.width, height: card.info.height, mime: 'image/webp' },
      thumb: { key: `${prefix}/thumb.webp`, width: thumb.info.width, height: thumb.info.height, mime: 'image/webp' },
    };
    const bufs: Record<string, Buffer> = { original: original.data, large: large.data, card: card.data, thumb: thumb.data };

    const written: string[] = [];
    try {
      for (const [name, v] of Object.entries(variants)) {
        if (!opts.skipStorage) await this.storage.put(v.key, bufs[name]!, v.mime);
        written.push(v.key);
      }
      return await (opts.db ?? this.prisma).mediaAsset.create({
        data: {
          id,
          ownerId: owner?.id ?? null,
          status: opts.status ?? 'STAGED',
          visibility: opts.visibility ?? 'PRIVATE',
          purpose,
          isPlaceholder: opts.isPlaceholder ?? false,
          bucket: this.storage.bucket,
          objectKey: variants.original!.key,
          mime: FORMAT_MIME[format]!,
          byteSize: original.data.length,
          width: original.info.width,
          height: original.info.height,
          checksumSha256: createHash('sha256').update(original.data).digest('hex'),
          originalName: sanitizeFilename(file.originalname),
          variants: variants as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      // Compensation: never leave half-written objects behind when the database insert (or an upload) fails.
      if (!opts.skipStorage) await Promise.allSettled(written.map((k) => this.storage.delete(k)));
      throw e;
    }
  }

  /** Streams one variant. Authorisation is decided by the caller (controller) from the asset row. */
  async open(asset: MediaAsset, variant: Variant) {
    const meta = (asset.variants as unknown as VariantMeta)[variant];
    if (!meta) throw E.notFound();
    const obj = await this.storage.get(meta.key);
    return { ...obj, contentType: meta.mime };
  }

  async deleteObjects(asset: MediaAsset): Promise<void> {
    const v = asset.variants as unknown as VariantMeta;
    await Promise.allSettled(Object.values(v ?? {}).map((x) => this.storage.delete(x.key)));
  }

  async setVisibility(tx: Prisma.TransactionClient, ids: string[], visibility: 'PUBLIC' | 'PRIVATE'): Promise<void> {
    if (!ids.length) return;
    await tx.mediaAsset.updateMany({
      where: { id: { in: ids }, status: { in: ['ACTIVE', 'STAGED', 'ORPHAN'] } },
      data: { visibility, ...(visibility === 'PUBLIC' ? { status: 'ACTIVE', attachedAt: new Date() } : {}) },
    });
  }
}

/** Metadata-only: path separators and control characters removed, length capped. Never used to build a storage key. */
export function sanitizeFilename(name?: string): string | null {
  if (!name) return null;

  const base = name
    .replace(/[\\/]+/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.\.+/g, '.')
    .trim();
  return base ? base.slice(0, 200) : null;
}
