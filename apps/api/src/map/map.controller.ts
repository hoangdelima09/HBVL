import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { E } from '../common/errors';
import { publicCache } from '../common/http';
import { query } from '../common/zod';
import { loadGeometry, MapService, type System } from './map.service';

const SLUG = /^[a-z0-9-]{1,100}$/;
const systemQuery = z.object({ system: z.enum(['34', '63']).default('34') });
const searchQuery = systemQuery.extend({ q: z.string().trim().min(1).max(80) });

@ApiTags('map')
@Controller()
export class MapController {
  constructor(private readonly map: MapService) {}

  /** Static, versioned: the client requests `?v=<etag>` (from /map/summary) so the URL is immutable and cacheable for a year. */
  @Get('map/geometry')
  geometry(@Req() req: Request, @Res() res: Response) {
    const g = loadGeometry();
    res.setHeader('ETag', `"${g.etag}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', req.query.v === g.etag ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    if (req.header('if-none-match') === `"${g.etag}"`) return res.status(304).end();
    return res.send(g.json);
  }

  @Get('map/summary')
  async summary(@query(systemQuery) q: z.infer<typeof systemQuery>, @Res({ passthrough: true }) res: Response) {
    publicCache(res, 30, 120);
    return { ...(await this.map.summary(q.system)), geometryVersion: loadGeometry().etag };
  }

  @Get('map/provinces/:system/:slug/members')
  async members(@Param('system') system: string, @Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    if (!['34', '63'].includes(system) || !SLUG.test(slug)) throw E.notFound();
    publicCache(res, 30, 120);
    return this.map.provinceMembers(system as System, slug);
  }

  @Get('map/search')
  async search(@query(searchQuery) q: z.infer<typeof searchQuery>, @Res({ passthrough: true }) res: Response) {
    publicCache(res, 15, 60);
    return this.map.search(q.system, q.q);
  }

  @Get('provinces/:slug')
  async province(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    if (!SLUG.test(slug)) throw E.notFound('Không tìm thấy tỉnh/thành.');
    publicCache(res, 30, 120);
    return this.map.provincePage(slug);
  }
}
