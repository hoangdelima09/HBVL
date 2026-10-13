import { Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { LIMITS } from '@hbvl/contracts';
import { PrismaClient } from '@hbvl/database';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Auth, CurrentAuth, MaybeAuth } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { E } from '../common/errors';
import { RateLimit } from '../common/rate-limit';
import { MediaService, mediaUrl, VARIANTS, type Variant } from './media.service';

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly prisma: PrismaClient,
  ) {}

  /** Stage an image for a post. Returns variant URLs; nothing is public until the post is published. */
  @Post('images')
  @Auth()
  @RateLimit({ name: 'upload', limit: 30, windowSeconds: 3600, scope: 'actor' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: LIMITS.imageMaxBytes + 1024, files: 1, fields: 4, parts: 6 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentAuth() ctx: AuthContext) {
    const asset = await this.media.uploadImage(ctx.user, { buffer: file?.buffer ?? Buffer.alloc(0), originalname: file?.originalname }, 'POST_FEATURED');
    return {
      id: asset.id,
      width: asset.width,
      height: asset.height,
      status: asset.status,
      urls: Object.fromEntries(VARIANTS.map((v) => [v, mediaUrl(asset.id, v)])),
    };
  }

  @Get(':id/:variant')
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Param('variant') variant: string, @MaybeAuth() auth: AuthContext | undefined, @Res() res: Response) {
    if (!(VARIANTS as readonly string[]).includes(variant)) throw E.notFound();
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, deletedAt: null, status: { not: 'DELETED' } },
      include: { featuredFor: { select: { id: true, status: true, authorId: true } } },
    });
    if (!asset) throw E.notFound();

    const isPublic = asset.visibility === 'PUBLIC';
    if (!isPublic) {
      // Private: owner, authors of posts that use it, staff for posts under review, admin. Everyone else gets 404 (no existence oracle).
      const u = auth?.user;
      const allowed =
        !!u &&
        (u.role === 'ADMIN' ||
          asset.ownerId === u.id ||
          asset.featuredFor.some((p) => p.authorId === u.id) ||
          (u.role === 'COLLABORATOR' && asset.featuredFor.some((p) => p.status === 'PENDING_REVIEW')));
      if (!allowed) throw E.notFound();
    }
    const obj = await this.media.open(asset, variant as Variant);
    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', isPublic ? 'public, max-age=31536000, immutable' : 'private, no-store');
    if (obj.length) res.setHeader('Content-Length', String(obj.length));
    obj.stream.on('error', () => res.destroy());
    obj.stream.pipe(res);
  }
}
