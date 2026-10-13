import { Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { postDraftSchema } from '@hbvl/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Auth, CurrentAuth } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { parseIfMatch, setEtag } from '../common/http';
import { IdempotencyService } from '../common/idempotency.service';
import { RateLimit } from '../common/rate-limit';
import { body, query, ZodBody } from '../common/zod';
import { z as zod } from 'zod';
import { sanitizeRichText } from '../content/sanitize';
import { mineQuery } from './posts.schemas';

const previewSchema = zod.strictObject({ contentHtml: zod.string().max(200_000 * 2) });
import { PostWorkflowService } from './workflow.service';

/** Sender-side API: drafts, edits, submit, "Bài của tôi". Ownership is enforced inside the workflow service. */
@ApiTags('my-posts')
@Controller('me/posts')
@Auth()
export class MyPostsController {
  constructor(private readonly flow: PostWorkflowService) {}

  @Get()
  async list(@query(mineQuery) q: z.infer<typeof mineQuery>, @CurrentAuth() a: AuthContext) {
    return this.flow.listMine(a, q);
  }

  /** Server-side sanitised preview (what readers would see). Nothing is stored. */
  @Post('preview')
  @HttpCode(200)
  @RateLimit({ name: 'post-preview', limit: 120, windowSeconds: 3600, scope: 'actor' })
  preview(@body(previewSchema) dto: { contentHtml: string }) {
    const s = sanitizeRichText(dto.contentHtml);
    return { html: s.html, textLength: s.text.length };
  }

  @Post()
  @RateLimit({ name: 'post-create', limit: 30, windowSeconds: 3600, scope: 'actor' })
  @ZodBody(postDraftSchema)
  async create(
    @body(postDraftSchema) dto: z.infer<typeof postDraftSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentAuth() a: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.flow.createDraft(a, dto, IdempotencyService.validateKey(key));
    res.status(r.status);
    if (r.replayed) res.setHeader('Idempotency-Replayed', 'true');
    setEtag(res, (r.body as { version: number }).version);
    return r.body;
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    const p = await this.flow.getMine(a, id);
    setEtag(res, p.version);
    return p;
  }

  @Put(':id')
  @RateLimit({ name: 'post-save', limit: 120, windowSeconds: 3600, scope: 'actor' })
  @ZodBody(postDraftSchema)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @body(postDraftSchema) dto: z.infer<typeof postDraftSchema>,
    @Req() req: Request,
    @CurrentAuth() a: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = await this.flow.updateOwn(a, id, dto, parseIfMatch(req));
    setEtag(res, p.version);
    return p;
  }

  /** Requires a verified e-mail (see docs/PERMISSIONS.md §3). */
  @Post(':id/submit')
  @HttpCode(200)
  @Auth({ verified: true })
  @RateLimit({ name: 'post-submit', limit: 30, windowSeconds: 3600, scope: 'actor' })
  async submit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: Request,
    @CurrentAuth() a: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.flow.submit(a, id, parseIfMatch(req), IdempotencyService.validateKey(key));
    if (r.replayed) res.setHeader('Idempotency-Replayed', 'true');
    setEtag(res, (r.body as { version: number }).version);
    return r.body;
  }
}
