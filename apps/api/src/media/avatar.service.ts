import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, type MediaAsset, type Role } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import { E } from '../common/errors';
import { avatarUrl } from './media-url';
import { MediaService } from './media.service';

type Tx = Prisma.TransactionClient;

/**
 * One profile picture per account. The image goes through the same decoder/re-encoder as every upload (format sniffed, EXIF dropped,
 * pixel bomb guard), is cropped to squares and is public at once (it is shown next to the person's comments).
 * Replacing or removing it deletes the previous files: no orphaned avatars stay in storage.
 */
@Injectable()
export class AvatarService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  async set(user: { id: string; role: Role }, file: { buffer: Buffer; originalname?: string }): Promise<{ avatarUrl: string }> {
    const asset = await this.media.uploadImage(user, file, 'AVATAR', { status: 'ACTIVE', visibility: 'PUBLIC' });
    let previous: MediaAsset | null;
    try {
      previous = await this.prisma.$transaction(async (tx) => {
        const old = await this.lockCurrent(tx, user.id);
        await tx.user.update({ where: { id: user.id }, data: { avatarAssetId: asset.id } });
        await tx.mediaAsset.update({ where: { id: asset.id }, data: { attachedAt: new Date() } });
        await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'user.avatar_set', resourceType: 'user', resourceId: user.id }, tx);
        return old ? this.retire(tx, old) : null;
      });
    } catch (e) {
      await this.media.deleteObjects(asset);
      await this.prisma.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
      throw e;
    }
    if (previous) await this.media.deleteObjects(previous);
    return { avatarUrl: avatarUrl(asset.id)! };
  }

  /** The owner removes their picture. Idempotent. */
  async removeOwn(user: { id: string; role: Role }): Promise<void> {
    const previous = await this.prisma.$transaction(async (tx) => {
      const old = await this.lockCurrent(tx, user.id);
      if (!old) return null;
      await tx.user.update({ where: { id: user.id }, data: { avatarAssetId: null } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'user.avatar_remove', resourceType: 'user', resourceId: user.id }, tx);
      return this.retire(tx, old);
    });
    if (previous) await this.media.deleteObjects(previous);
  }

  /**
   * Staff take an inappropriate picture down (scope checked by the caller inside `tx`). The owner is told why.
   * Returns the retired asset so the caller deletes the files after the transaction commits.
   */
  async removeByStaffIn(tx: Tx, actor: { id: string; role: Role }, userId: string, reason: string): Promise<MediaAsset> {
    const old = await this.lockCurrent(tx, userId);
    if (!old) throw E.conflict('Tài khoản này không có ảnh đại diện.');
    await tx.user.update({ where: { id: userId }, data: { avatarAssetId: null } });
    await tx.notification.create({
      data: { userId, type: 'account.avatar_removed', title: 'Ảnh đại diện của bạn đã bị gỡ', body: reason, data: {} },
    });
    await this.audit.log(
      { actorId: actor.id, actorRole: actor.role, action: 'user.avatar_remove', resourceType: 'user', resourceId: userId, metadata: { by: 'staff', reason } },
      tx,
    );
    return this.retire(tx, old);
  }

  /** Account anonymisation: the picture is personal data and goes with the rest (no notice, no audit of its own). */
  async clearIn(tx: Tx, userId: string): Promise<MediaAsset | null> {
    const old = await this.lockCurrent(tx, userId);
    if (!old) return null;
    await tx.user.update({ where: { id: userId }, data: { avatarAssetId: null } });
    return this.retire(tx, old);
  }

  deleteFiles(asset: MediaAsset): Promise<void> {
    return this.media.deleteObjects(asset);
  }

  /** Row lock on the user: two uploads at the same time cannot both keep a picture (the loser's previous one is still retired). */
  private async lockCurrent(tx: Tx, userId: string): Promise<string | null> {
    const rows = await tx.$queryRaw<{ avatarAssetId: string | null }[]>`SELECT "avatarAssetId" FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!rows.length) throw E.notFound();
    return rows[0]!.avatarAssetId;
  }

  private retire(tx: Tx, assetId: string): Promise<MediaAsset> {
    return tx.mediaAsset.update({ where: { id: assetId }, data: { status: 'DELETED', deletedAt: new Date() } });
  }
}
