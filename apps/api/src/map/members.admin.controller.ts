import { Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LIMITS } from '@hbvl/contracts';
import { z } from 'zod';
import { Auth, CurrentAuth } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { body, query } from '../common/zod';
import { MembersAdminService } from './members.admin.service';

const slug = z.string().regex(/^[a-z0-9-]+$/);
const filterQuery = z.object({
  q: z.string().trim().max(100).optional(),
  province: slug.optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  visibility: z.enum(['public', 'hidden']).optional(),
});
const listQuery = filterQuery.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(25),
});
const previewSchema = z.strictObject({
  rows: z
    .array(z.strictObject({ name: z.string().max(200), province: z.string().max(100), distinct: z.boolean().optional() }))
    .min(1)
    .max(5000),
  /** The file becomes the whole list: every current member is deleted when the preview is committed. */
  replace: z.boolean().optional(),
});
const commitSchema = z.strictObject({ token: z.uuid(), confirmAmbiguous: z.array(z.number().int().min(1)).max(5000).default([]) });
const createSchema = z.strictObject({ name: z.string().trim().min(1).max(120), provinceSlug: z.string().regex(/^[a-z0-9-]+$/), distinct: z.boolean().optional() });
const updateSchema = z.strictObject({
  fullName: z.string().trim().min(1).max(120).optional(),
  provinceSlug: slug.optional(),
  /** Confirms that a namesake (same or other province) is a different person. */
  distinct: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  isPublic: z.boolean().optional(),
  userId: z.uuid().nullable().optional(),
});
const bulkSchema = z
  .strictObject({
    ids: z.array(z.uuid()).min(1).max(500),
    action: z.enum(['hide', 'show', 'archive', 'restore', 'delete', 'move']),
    provinceSlug: slug.optional(),
  })
  .refine((v) => v.action !== 'move' || !!v.provinceSlug, { path: ['provinceSlug'], message: 'Chọn tỉnh cần chuyển tới.' });
const verifySchema = z.strictObject({ verification: z.enum(['UNVERIFIED_SAMPLE', 'VERIFIED', 'HIDDEN']) });

@ApiTags('admin-members')
@Controller('admin')
@Auth({ roles: ['ADMIN'], mfa: true })
export class MembersAdminController {
  constructor(private readonly svc: MembersAdminService) {}

  @Get('members') list(@query(listQuery) q: z.infer<typeof listQuery>) {
    return this.svc.list(q);
  }
  @Post('members') create(@body(createSchema) dto: z.infer<typeof createSchema>, @CurrentAuth() a: AuthContext) {
    return this.svc.create(a, dto);
  }
  @Get('members/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="hoc-vien.csv"')
  @Header('Cache-Control', 'no-store')
  export(@query(filterQuery) q: z.infer<typeof filterQuery>) {
    return this.svc.exportCsv(q);
  }
  @Post('members/bulk') @HttpCode(200) bulk(@body(bulkSchema) dto: z.infer<typeof bulkSchema>, @CurrentAuth() a: AuthContext) {
    return this.svc.bulk(a, [...new Set(dto.ids)], dto.action, dto.provinceSlug);
  }
  @Post('members/import/preview') @HttpCode(200) preview(@body(previewSchema) dto: z.infer<typeof previewSchema>) {
    return this.svc.preview(dto.rows, dto.replace ?? false);
  }
  @Post('members/import/commit') @HttpCode(200) commit(@body(commitSchema) dto: z.infer<typeof commitSchema>, @CurrentAuth() a: AuthContext) {
    return this.svc.commit(a, dto.token, dto.confirmAmbiguous);
  }
  @Patch('members/:id') update(@Param('id', new ParseUUIDPipe()) id: string, @body(updateSchema) dto: z.infer<typeof updateSchema>, @CurrentAuth() a: AuthContext) {
    return this.svc.update(a, id, dto);
  }
  @Delete('members/:id') @HttpCode(204) async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    await this.svc.remove(a, id);
  }

  @Get('directory') directory(@Query('province') province?: string) {
    return this.svc.directory(province && /^[a-z0-9-]+$/.test(province) ? province : undefined);
  }
  @Patch('directory/:id') verify(@Param('id', new ParseUUIDPipe()) id: string, @body(verifySchema) dto: z.infer<typeof verifySchema>, @CurrentAuth() a: AuthContext) {
    return this.svc.setVerification(a, id, dto.verification);
  }
}
