import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LIMITS, LOCALES } from '@hbvl/contracts';
import type { Prisma } from '@hbvl/database';
import type { Response } from 'express';
import { z } from 'zod';
import { Auth, CurrentAuth } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { E } from '../common/errors';
import { publicCache } from '../common/http';
import { body, query } from '../common/zod';
import { SETTING_KEYS, SiteService, type SettingKey } from './site.service';

const pathQuery = z.object({ path: z.string().min(1).max(500), locale: z.enum(LOCALES).default('vi') });
const resolveQuery = z.object({ path: z.string().min(1).max(500), query: z.string().max(200).default('') });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(50) });
const redirectSchema = z.strictObject({
  fromPath: z.string().min(1).max(500),
  fromQuery: z.string().max(200).optional(),
  toPath: z.string().min(1).max(500),
  statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
});
const settingSchema = z.object({ value: z.record(z.string(), z.unknown()) });

@ApiTags('site')
@Controller()
export class SiteController {
  constructor(private readonly site: SiteService) {}

  @Get('settings/public')
  async settings(@Res({ passthrough: true }) res: Response) {
    publicCache(res, 60, 300);
    return this.site.publicSettings();
  }

  @Get('pages/by-path')
  async page(@query(pathQuery) q: z.infer<typeof pathQuery>, @Res({ passthrough: true }) res: Response) {
    publicCache(res, 60, 300);
    return this.site.pageByPath(q.path, q.locale);
  }

  @Get('seo/sitemap')
  async sitemap(@Res({ passthrough: true }) res: Response) {
    publicCache(res, 300, 600);
    return this.site.sitemap();
  }

  /** Used by the web app when a route is not found: legacy-URL redirects from real migrated data (never "everything → home"). */
  @Get('redirects/resolve')
  async resolve(@query(resolveQuery) q: z.infer<typeof resolveQuery>, @Res({ passthrough: true }) res: Response) {
    publicCache(res, 60, 300);
    return this.site.resolveRedirect(q.path, q.query);
  }

  @Get('me/notifications')
  @Auth()
  notifications(@CurrentAuth() a: AuthContext) {
    return this.site.notifications(a.user.id);
  }

  @Post('me/notifications/:id/read')
  @HttpCode(204)
  @Auth()
  async readOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    await this.site.markOneRead(a.user.id, id);
  }

  @Post('me/notifications/read')
  @HttpCode(204)
  @Auth()
  async read(@CurrentAuth() a: AuthContext) {
    await this.site.markRead(a.user.id);
  }

  // ───── admin ─────
  @Put('admin/settings/:key')
  @Auth({ roles: ['ADMIN'], mfa: true })
  put(@Param('key') key: string, @body(settingSchema) dto: z.infer<typeof settingSchema>, @CurrentAuth() a: AuthContext) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) throw E.notFound();
    return this.site.setSetting(a, key as SettingKey, dto.value as Prisma.InputJsonValue);
  }

  @Get('admin/redirects')
  @Auth({ roles: ['ADMIN'], mfa: true })
  redirects(@query(pageQuery) q: z.infer<typeof pageQuery>) {
    return this.site.listRedirects(q.page, q.pageSize);
  }

  @Post('admin/redirects')
  @Auth({ roles: ['ADMIN'], mfa: true })
  createRedirect(@body(redirectSchema) dto: z.infer<typeof redirectSchema>, @CurrentAuth() a: AuthContext) {
    return this.site.createRedirect(a, dto);
  }

  @Delete('admin/redirects/:id')
  @HttpCode(204)
  @Auth({ roles: ['ADMIN'], mfa: true })
  async deleteRedirect(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    await this.site.deleteRedirect(a, id);
  }
}
