import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { blockUserSchema, reportCommentSchema, resolveReportSchema, restrictUserSchema, LIMITS } from '@hbvl/contracts';
import { z } from 'zod';
import { Auth, CurrentAuth } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { RateLimit } from '../common/rate-limit';
import { body, query, ZodBody } from '../common/zod';
import { ReportsService } from './reports.service';
import { UserModerationService } from './user-moderation.service';

const reportsQuery = z.object({
  scope: z.enum(['open', 'closed']).default('open'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(20),
});
const membersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  state: z.enum(['ACTIVE', 'RESTRICTED', 'BLOCKED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(20),
});

/** Member side: report a comment. */
@ApiTags('moderation')
@Controller()
export class CommentReportController {
  constructor(private readonly reports: ReportsService) {}

  @Post('comments/:id/report')
  @HttpCode(200)
  @Auth({ verified: true })
  @RateLimit({ name: 'report', limit: 5, windowSeconds: 60, scope: 'actor' }, { name: 'report-day', limit: 40, windowSeconds: 86_400, scope: 'actor' })
  @ZodBody(reportCommentSchema)
  report(@Param('id', new ParseUUIDPipe()) id: string, @body(reportCommentSchema) dto: z.infer<typeof reportCommentSchema>, @CurrentAuth() a: AuthContext) {
    return this.reports.report(a, id, dto);
  }
}

/**
 * Staff side (collaborator + admin). A collaborator handles everything except what belongs to an administrator:
 * reports about an admin's comments are hidden from them, and they can only moderate MEMBER accounts.
 */
@ApiTags('moderation')
@Controller('staff')
@Auth({ roles: ['COLLABORATOR', 'ADMIN'] })
export class StaffModerationController {
  constructor(
    private readonly reports: ReportsService,
    private readonly users: UserModerationService,
  ) {}

  @Get('reports')
  list(@query(reportsQuery) q: z.infer<typeof reportsQuery>, @CurrentAuth() a: AuthContext) {
    return this.reports.list(a, q);
  }

  @Get('reports/count')
  async count(@CurrentAuth() a: AuthContext) {
    return { open: await this.reports.openCount(a) };
  }

  @Post('reports/:commentId/claim')
  @HttpCode(200)
  claim(@Param('commentId', new ParseUUIDPipe()) commentId: string, @CurrentAuth() a: AuthContext) {
    return this.reports.claim(a, commentId);
  }

  @Post('reports/:commentId/resolve')
  @HttpCode(200)
  @ZodBody(resolveReportSchema)
  resolve(@Param('commentId', new ParseUUIDPipe()) commentId: string, @body(resolveReportSchema) dto: z.infer<typeof resolveReportSchema>, @CurrentAuth() a: AuthContext) {
    return this.reports.resolve(a, commentId, dto);
  }

  @Get('members')
  members(@query(membersQuery) q: z.infer<typeof membersQuery>) {
    return this.users.listMembers(q);
  }

  @Post('users/:id/restrict')
  @HttpCode(200)
  @ZodBody(restrictUserSchema)
  restrict(@Param('id', new ParseUUIDPipe()) id: string, @body(restrictUserSchema) dto: z.infer<typeof restrictUserSchema>, @CurrentAuth() a: AuthContext) {
    return this.users.restrict(a, id, dto);
  }

  @Post('users/:id/unrestrict')
  @HttpCode(200)
  unrestrict(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    return this.users.unrestrict(a, id);
  }

  @Post('users/:id/block')
  @HttpCode(200)
  @ZodBody(blockUserSchema)
  block(@Param('id', new ParseUUIDPipe()) id: string, @body(blockUserSchema) dto: z.infer<typeof blockUserSchema>, @CurrentAuth() a: AuthContext) {
    return this.users.block(a, id, dto);
  }

  @Post('users/:id/unblock')
  @HttpCode(200)
  unblock(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    return this.users.unblock(a, id);
  }
}
