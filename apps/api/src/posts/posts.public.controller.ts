import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { MaybeAuth } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { E } from '../common/errors';
import { publicCache } from '../common/http';
import { query } from '../common/zod';
import { PostsPublicService } from './posts.public.service';
import { listQuery, localeOnly, searchQuery } from './posts.schemas';

const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

@ApiTags('public-content')
@Controller()
export class PostsPublicController {
  constructor(private readonly posts: PostsPublicService) {}

  @Get('categories')
  async categories(@query(localeOnly) q: z.infer<typeof localeOnly>, @Res({ passthrough: true }) res: Response) {
    publicCache(res, 120, 600);
    return { items: await this.posts.categoryTree(q.locale) };
  }

  @Get('posts')
  async list(@query(listQuery) q: z.infer<typeof listQuery>, @Res({ passthrough: true }) res: Response) {
    publicCache(res);
    return this.posts.list({ ...q, kind: 'POST' });
  }

  @Get('posts/featured')
  async featured(@query(localeOnly) q: z.infer<typeof localeOnly>, @Res({ passthrough: true }) res: Response) {
    publicCache(res);
    return this.posts.featured(q.locale, 5);
  }

  @Get('posts/home-blocks')
  async homeBlocks(@query(localeOnly) q: z.infer<typeof localeOnly>, @Res({ passthrough: true }) res: Response) {
    publicCache(res);
    const featured = await this.posts.featured(q.locale, 5);
    return this.posts.homeBlocks(
      q.locale,
      featured.items.map((i) => i.id),
    );
  }

  @Get('posts/:slug')
  async bySlug(@Param('slug') slug: string, @query(localeOnly) q: z.infer<typeof localeOnly>, @Res({ passthrough: true }) res: Response) {
    if (!SLUG.test(slug)) throw E.notFound('Không tìm thấy bài viết.');
    publicCache(res);
    return this.posts.bySlug('POST', slug, q.locale);
  }

  /** Per-user like state is fetched client-side so the page HTML itself stays cacheable and identical for everyone. */
  @Get('posts/:id/engagement')
  async engagement(@Param('id') id: string, @MaybeAuth() auth: AuthContext | undefined, @Res({ passthrough: true }) res: Response) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw E.notFound();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    return this.posts.engagement(id, auth?.user.id);
  }

  @Get('events')
  async events(@query(listQuery) q: z.infer<typeof listQuery>, @Res({ passthrough: true }) res: Response) {
    publicCache(res);
    return this.posts.list({ ...q, kind: 'EVENT', category: undefined });
  }

  @Get('events/:slug')
  async event(@Param('slug') slug: string, @query(localeOnly) q: z.infer<typeof localeOnly>, @Res({ passthrough: true }) res: Response) {
    if (!SLUG.test(slug)) throw E.notFound();
    publicCache(res);
    return this.posts.bySlug('EVENT', slug, q.locale);
  }

  @Get('programs')
  async programs(@query(listQuery) q: z.infer<typeof listQuery>, @Res({ passthrough: true }) res: Response) {
    publicCache(res);
    return this.posts.list({ ...q, kind: 'PROGRAM', category: undefined });
  }

  @Get('programs/:slug')
  async program(@Param('slug') slug: string, @query(localeOnly) q: z.infer<typeof localeOnly>, @Res({ passthrough: true }) res: Response) {
    if (!SLUG.test(slug)) throw E.notFound();
    publicCache(res);
    return this.posts.bySlug('PROGRAM', slug, q.locale);
  }

  @Get('search')
  async search(@query(searchQuery) q: z.infer<typeof searchQuery>, @Res({ passthrough: true }) res: Response, @Req() _req: Request) {
    publicCache(res, 15, 60);
    return this.posts.search(q.q, q.locale, q.page, q.pageSize);
  }
}
