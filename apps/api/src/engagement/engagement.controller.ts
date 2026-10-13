import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { commentSchema, LIMITS } from '@hbvl/contracts';
import type { CommentStatus } from '@hbvl/database';
import { z } from 'zod';
import { Auth, CurrentAuth } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { RateLimit } from '../common/rate-limit';
import { body, query, ZodBody } from '../common/zod';
import { EngagementService } from './engagement.service';

const moderationQuery = z.object({
  status: z.enum(['APPROVED', 'PENDING', 'SPAM', 'TRASHED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(20),
});
const moderateSchema = z.strictObject({ status: z.enum(['APPROVED', 'PENDING', 'SPAM', 'TRASHED']) });

@ApiTags('engagement')
@Controller()
export class EngagementController {
  constructor(private readonly svc: EngagementService) {}

  @Put('posts/:id/like')
  @Auth({ verified: true })
  @RateLimit({ name: 'like', limit: 60, windowSeconds: 60, scope: 'actor' })
  like(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    return this.svc.like(a, id);
  }

  @Delete('posts/:id/like')
  @Auth({ verified: true })
  @RateLimit({ name: 'like', limit: 60, windowSeconds: 60, scope: 'actor' })
  unlike(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    return this.svc.unlike(a, id);
  }

  @Get('posts/:id/comments')
  comments(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.listPublic(id);
  }

  @Post('posts/:id/comments')
  @Auth({ verified: true })
  @RateLimit({ name: 'comment', limit: 10, windowSeconds: 60, scope: 'actor' }, { name: 'comment-hour', limit: 100, windowSeconds: 3600, scope: 'actor' })
  @ZodBody(commentSchema)
  create(@Param('id', new ParseUUIDPipe()) id: string, @body(commentSchema) dto: z.infer<typeof commentSchema>, @CurrentAuth() a: AuthContext) {
    return this.svc.create(a, id, dto);
  }

  @Get('staff/comments')
  @Auth({ roles: ['COLLABORATOR', 'ADMIN'] })
  list(@query(moderationQuery) q: z.infer<typeof moderationQuery>) {
    return this.svc.moderationList(q);
  }

  @Patch('staff/comments/:id')
  @HttpCode(200)
  @Auth({ roles: ['COLLABORATOR', 'ADMIN'] })
  @ZodBody(moderateSchema)
  moderate(@Param('id', new ParseUUIDPipe()) id: string, @body(moderateSchema) dto: { status: CommentStatus }, @CurrentAuth() a: AuthContext) {
    return this.svc.moderate(a, id, dto.status);
  }
}
