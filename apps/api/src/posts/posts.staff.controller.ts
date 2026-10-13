import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { reasonSchema, staffEditSchema } from '@hbvl/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Auth, CurrentAuth } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { parseIfMatch, setEtag } from '../common/http';
import { body, query, ZodBody } from '../common/zod';
import { adminListQuery, mineQuery } from './posts.schemas';
import { PostWorkflowService } from './workflow.service';

/**
 * Editorial API for collaborators and admins. A collaborator handles everything except what belongs to an administrator
 * (posts written by an admin account); someone's private draft stays invisible until it is submitted.
 */
@ApiTags('staff-posts')
@Controller('staff')
@Auth({ roles: ['COLLABORATOR', 'ADMIN'] })
export class StaffPostsController {
  constructor(private readonly flow: PostWorkflowService) {}

  @Get('review-queue')
  queue(@query(mineQuery.pick({ page: true, pageSize: true })) q: { page: number; pageSize: number }, @CurrentAuth() a: AuthContext) {
    return this.flow.reviewQueue(a, q);
  }

  @Get('posts')
  list(@query(adminListQuery) q: z.infer<typeof adminListQuery>, @CurrentAuth() a: AuthContext) {
    return this.flow.staffList(a, q);
  }

  @Get('posts/:id')
  async get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    const p = await this.flow.getForStaff(a, id);
    setEtag(res, p.version);
    return p;
  }

  @Patch('posts/:id')
  @ZodBody(staffEditSchema)
  async edit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @body(staffEditSchema) dto: z.infer<typeof staffEditSchema>,
    @Req() req: Request,
    @CurrentAuth() a: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = await this.flow.staffEdit(a, id, dto, parseIfMatch(req));
    setEtag(res, p.version);
    return p;
  }

  @Post('posts/:id/publish')
  @HttpCode(200)
  async publish(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request, @CurrentAuth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    const p = await this.flow.publish(a, id, parseIfMatch(req));
    setEtag(res, p.version);
    return p;
  }

  @Post('posts/:id/request-changes')
  @HttpCode(200)
  @ZodBody(reasonSchema)
  async requestChanges(
    @Param('id', new ParseUUIDPipe()) id: string,
    @body(reasonSchema) dto: z.infer<typeof reasonSchema>,
    @Req() req: Request,
    @CurrentAuth() a: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = await this.flow.requestChanges(a, id, dto.reason, parseIfMatch(req));
    setEtag(res, p.version);
    return p;
  }

  @Post('posts/:id/reject')
  @HttpCode(200)
  @ZodBody(reasonSchema)
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @body(reasonSchema) dto: z.infer<typeof reasonSchema>,
    @Req() req: Request,
    @CurrentAuth() a: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = await this.flow.reject(a, id, dto.reason, parseIfMatch(req));
    setEtag(res, p.version);
    return p;
  }

  @Post('posts/:id/unpublish')
  @HttpCode(200)
  async unpublish(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request, @CurrentAuth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    const p = await this.flow.unpublish(a, id, parseIfMatch(req));
    setEtag(res, p.version);
    return p;
  }

  @Post('posts/:id/restore')
  @HttpCode(200)
  async restore(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request, @CurrentAuth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    const p = await this.flow.restore(a, id, parseIfMatch(req));
    setEtag(res, p.version);
    return p;
  }

  /** Soft delete (moves to the trash; restorable). Collaborators: any post that is not the administrator's. */
  @Delete('posts/:id')
  @HttpCode(200)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request, @CurrentAuth() a: AuthContext) {
    return this.flow.remove(a, id, parseIfMatch(req));
  }
}

/** Admin-only controls. MFA-verified session required. */
@ApiTags('admin-posts')
@Controller('admin/posts')
@Auth({ roles: ['ADMIN'], mfa: true })
export class AdminPostsController {
  constructor(private readonly flow: PostWorkflowService) {}

  @Get()
  list(@query(adminListQuery) q: z.infer<typeof adminListQuery>) {
    return this.flow.adminList(q);
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    const p = await this.flow.getForStaff(a, id);
    setEtag(res, p.version);
    return p;
  }

  @Post(':id/publish')
  @HttpCode(200)
  async publish(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request, @CurrentAuth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    const p = await this.flow.publish(a, id, parseIfMatch(req));
    setEtag(res, p.version);
    return p;
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ZodBody(reasonSchema)
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @body(reasonSchema) dto: z.infer<typeof reasonSchema>,
    @Req() req: Request,
    @CurrentAuth() a: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = await this.flow.reject(a, id, dto.reason, parseIfMatch(req));
    setEtag(res, p.version);
    return p;
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  async unpublish(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request, @CurrentAuth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    const p = await this.flow.unpublish(a, id, parseIfMatch(req));
    setEtag(res, p.version);
    return p;
  }

  @Patch(':id')
  @ZodBody(staffEditSchema)
  async edit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @body(staffEditSchema) dto: z.infer<typeof staffEditSchema>,
    @Req() req: Request,
    @CurrentAuth() a: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = await this.flow.adminEdit(a, id, dto, parseIfMatch(req));
    setEtag(res, p.version);
    return p;
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request, @CurrentAuth() a: AuthContext) {
    return this.flow.remove(a, id, parseIfMatch(req));
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request, @CurrentAuth() a: AuthContext) {
    return this.flow.restore(a, id, parseIfMatch(req));
  }
}
