import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { contactSchema, LIMITS } from '@hbvl/contracts';
import type { ContactStatus } from '@hbvl/database';
import { z } from 'zod';
import { Auth, CurrentAuth } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { RateLimit } from '../common/rate-limit';
import { body, query, ZodBody } from '../common/zod';
import { ContactService } from './contact.service';

const listQuery = z.object({
  status: z.enum(['NEW', 'DONE']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(20),
});
const statusSchema = z.strictObject({ status: z.enum(['NEW', 'DONE']) });

@ApiTags('contact')
@Controller()
export class ContactController {
  constructor(private readonly svc: ContactService) {}

  @Post('contact')
  @Auth({ verified: true })
  @RateLimit({ name: 'contact', limit: 10, windowSeconds: 3600, scope: 'both' })
  @ZodBody(contactSchema)
  submit(@body(contactSchema) dto: z.infer<typeof contactSchema>, @CurrentAuth() a: AuthContext) {
    return this.svc.submit(a, dto);
  }

  @Get('admin/contact')
  @Auth({ roles: ['ADMIN'], mfa: true })
  list(@query(listQuery) q: z.infer<typeof listQuery>) {
    return this.svc.list(q);
  }

  @Get('admin/contact/:id')
  @Auth({ roles: ['ADMIN'], mfa: true })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.get(id);
  }

  @Patch('admin/contact/:id')
  @HttpCode(200)
  @Auth({ roles: ['ADMIN'], mfa: true })
  @ZodBody(statusSchema)
  setStatus(@Param('id', new ParseUUIDPipe()) id: string, @body(statusSchema) dto: { status: ContactStatus }, @CurrentAuth() a: AuthContext) {
    return this.svc.setStatus(a, id, dto.status);
  }
}
