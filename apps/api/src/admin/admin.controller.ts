import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { adminCreateUserSchema, adminUpdateUserSchema, LIMITS, LOCALES, type LocaleName } from '@hbvl/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { Auth, CurrentAuth } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { E } from '../common/errors';
import { parseIfMatch } from '../common/http';
import { body, query } from '../common/zod';
import { ContentAdminService } from './content.admin.service';
import { DashboardService } from './dashboard.service';
import { UsersAdminService } from './users.admin.service';

const pg = { page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(25) };
const usersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['ADMIN', 'COLLABORATOR', 'MEMBER']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING_RESET', 'DELETED']).optional(),
  ...pg,
});
const auditQuery = z.object({ action: z.string().max(60).optional(), resourceType: z.string().max(60).optional(), ...pg });
const pageQuery = z.object(pg);
// null must be tried FIRST: z.coerce.date() would turn null into 1970-01-01 (an invented date).
const dateOrNull = z.union([z.null(), z.coerce.date()]).optional();
const contentSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
  slug: z.string().trim().max(200).optional(),
  excerpt: z.string().trim().max(1000).nullable().optional(),
  contentHtml: z.string().max(400_000).default(''),
  featuredAssetId: z.uuid().nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'PRIVATE']).default('DRAFT'),
  event: z.strictObject({ startsAt: dateOrNull, endsAt: dateOrNull, locationText: z.string().trim().max(300).nullable().optional() }).optional(),
  program: z
    .strictObject({
      openFrom: dateOrNull,
      openUntil: dateOrNull,
      applyUrl: z
        .url({ protocol: /^https?$/ })
        .max(500)
        .nullable()
        .optional(),
    })
    .optional(),
});
const translationSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
  excerpt: z.string().trim().max(1000).nullable().optional(),
  contentHtml: z.string().max(400_000).default(''),
});
const pageSchema = z.strictObject({
  parentId: z.uuid().nullable().optional(),
  slug: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  contentHtml: z.string().max(400_000).default(''),
  status: z.enum(['DRAFT', 'PUBLISHED', 'PRIVATE']).default('DRAFT'),
  template: z.enum(['DEFAULT', 'CONTACT', 'ANNOUNCEMENTS', 'ABOUT']).optional(),
});
const pageUpdateSchema = pageSchema
  .pick({ title: true, contentHtml: true, status: true })
  .partial()
  .extend({ sortOrder: z.number().int().min(0).max(10_000).optional() });
const catTr = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  summary: z.string().trim().max(500).nullable().optional(),
  navLabel: z.string().trim().max(60).nullable().optional(),
});
const catUpdate = z.strictObject({
  sortOrder: z.number().int().min(0).max(1000).optional(),
  cardType: z.enum(['CARD', 'PROFILE', 'SONG', 'TIP']).optional(),
  translations: z.strictObject({ vi: catTr.optional(), en: catTr.optional(), ja: catTr.optional() }).optional(),
});
const catCreate = z.strictObject({
  slug: z.string().trim().min(2).max(100),
  parentId: z.uuid(),
  nameVi: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
});
const kindParam = z.enum(['events', 'programs']);

@ApiTags('admin')
@Controller('admin')
@Auth({ roles: ['ADMIN'], mfa: true })
export class AdminController {
  constructor(
    private readonly users: UsersAdminService,
    private readonly dash: DashboardService,
    private readonly content: ContentAdminService,
  ) {}

  @Get('dashboard') dashboard(@CurrentAuth() a: AuthContext) {
    return this.dash.admin(a);
  }
  @Get('audit') audit(@query(auditQuery) q: z.infer<typeof auditQuery>) {
    return this.dash.audit(q);
  }

  // users
  @Get('users') listUsers(@query(usersQuery) q: z.infer<typeof usersQuery>) {
    return this.users.list(q);
  }
  @Get('users/:id') getUser(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.get(id);
  }
  @Post('users') createUser(@body(adminCreateUserSchema) dto: z.infer<typeof adminCreateUserSchema>, @CurrentAuth() a: AuthContext) {
    return this.users.create(a, dto);
  }
  @Patch('users/:id') updateUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @body(adminUpdateUserSchema) dto: z.infer<typeof adminUpdateUserSchema>,
    @CurrentAuth() a: AuthContext,
  ) {
    return this.users.update(a, id, dto);
  }
  @Post('users/:id/resend-activation') @HttpCode(200) resend(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    return this.users.resendActivation(a, id);
  }
  @Post('users/:id/reset-password') @HttpCode(200) resetPassword(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    return this.users.resetPassword(a, id);
  }
  @Delete('users/:id') @HttpCode(200) anonymize(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    return this.users.anonymize(a, id);
  }

  // events & programs
  @Get('content/:kind')
  listContent(@Param('kind') kind: string, @query(pageQuery) q: z.infer<typeof pageQuery>) {
    return this.content.list(this.kind(kind), q.page, q.pageSize);
  }
  @Get('content/item/:id') getContent(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.content.get(id);
  }
  @Post('content/:kind')
  createContent(@Param('kind') kind: string, @body(contentSchema) dto: z.infer<typeof contentSchema>, @CurrentAuth() a: AuthContext) {
    return this.content.create(a, this.kind(kind), dto);
  }
  @Patch('content/item/:id')
  updateContent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @body(contentSchema.partial()) dto: Partial<z.infer<typeof contentSchema>>,
    @Req() req: Request,
    @CurrentAuth() a: AuthContext,
  ) {
    return this.content.update(a, id, parseIfMatch(req), dto);
  }
  @Delete('content/item/:id') @HttpCode(204) async removeContent(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    await this.content.remove(a, id);
  }
  @Put('posts/:id/translations/:locale')
  translate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('locale') locale: string,
    @body(translationSchema) dto: z.infer<typeof translationSchema>,
    @CurrentAuth() a: AuthContext,
  ) {
    if (!(LOCALES as readonly string[]).includes(locale)) throw E.notFound();
    return this.content.upsertTranslation(a, id, locale as LocaleName, dto);
  }

  // pages
  @Get('pages') pages() {
    return this.content.listPages();
  }
  @Get('pages/:id') page(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.content.getPage(id);
  }
  @Post('pages') createPage(@body(pageSchema) dto: z.infer<typeof pageSchema>, @CurrentAuth() a: AuthContext) {
    return this.content.createPage(a, dto);
  }
  @Patch('pages/:id') updatePage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @body(pageUpdateSchema) dto: z.infer<typeof pageUpdateSchema>,
    @Req() req: Request,
    @CurrentAuth() a: AuthContext,
  ) {
    return this.content.updatePage(a, id, parseIfMatch(req), dto);
  }
  @Delete('pages/:id') @HttpCode(204) async removePage(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    await this.content.removePage(a, id);
  }

  // categories
  @Get('categories') categories() {
    return this.content.categories();
  }
  @Post('categories') createCategory(@body(catCreate) dto: z.infer<typeof catCreate>, @CurrentAuth() a: AuthContext) {
    return this.content.createCategory(a, dto);
  }
  @Patch('categories/:id') updateCategory(@Param('id', new ParseUUIDPipe()) id: string, @body(catUpdate) dto: z.infer<typeof catUpdate>, @CurrentAuth() a: AuthContext) {
    return this.content.updateCategory(a, id, dto);
  }
  @Delete('categories/:id') @HttpCode(204) async deleteCategory(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext) {
    await this.content.deleteCategory(a, id);
  }

  private kind(k: string): 'EVENT' | 'PROGRAM' {
    const parsed = kindParam.safeParse(k);
    if (!parsed.success) throw E.notFound();
    return parsed.data === 'events' ? 'EVENT' : 'PROGRAM';
  }
}

@ApiTags('staff')
@Controller('staff')
@Auth({ roles: ['COLLABORATOR', 'ADMIN'] })
export class StaffDashboardController {
  constructor(private readonly dash: DashboardService) {}
  @Get('dashboard') dashboard(@CurrentAuth() a: AuthContext) {
    return this.dash.staff(a);
  }
}
