import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { feedbackSchema, LIMITS } from '@hbvl/contracts';
import type { FeedbackStatus } from '@hbvl/database';
import { z } from 'zod';
import { Auth, CurrentAuth } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { RateLimit } from '../common/rate-limit';
import { body, query, ZodBody } from '../common/zod';
import { FeedbackService } from './feedback.service';

const listQuery = z.object({
  status: z.enum(['NEW', 'IN_PROGRESS', 'RESOLVED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(20),
});
const statusSchema = z.strictObject({ status: z.enum(['NEW', 'IN_PROGRESS', 'RESOLVED']), note: z.string().trim().min(1).max(2000).optional() });

@ApiTags('feedback')
@Controller()
export class FeedbackController {
  constructor(private readonly svc: FeedbackService) {}

  @Post('feedback')
  @Auth({ verified: true })
  @RateLimit({ name: 'feedback-ip', limit: 20, windowSeconds: 3600, scope: 'both' })
  @ZodBody(feedbackSchema)
  async submit(@body(feedbackSchema) dto: z.infer<typeof feedbackSchema>, @CurrentAuth() a: AuthContext) {
    return this.svc.submit(a, dto);
  }

  @Get('staff/feedback')
  @Auth({ roles: ['COLLABORATOR', 'ADMIN'] })
  list(@query(listQuery) q: z.infer<typeof listQuery>) {
    return this.svc.list(q);
  }

  @Get('staff/feedback/counts')
  @Auth({ roles: ['COLLABORATOR', 'ADMIN'] })
  counts() {
    return this.svc.counts();
  }

  @Get('staff/feedback/:id')
  @Auth({ roles: ['COLLABORATOR', 'ADMIN'] })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    return this.svc.get(a, id);
  }

  @Patch('staff/feedback/:id')
  @HttpCode(200)
  @Auth({ roles: ['COLLABORATOR', 'ADMIN'] })
  @ZodBody(statusSchema)
  setStatus(@Param('id', new ParseUUIDPipe()) id: string, @body(statusSchema) dto: { status: FeedbackStatus; note?: string }, @CurrentAuth() a: AuthContext) {
    return this.svc.setStatus(a, id, dto.status, dto.note);
  }
}
