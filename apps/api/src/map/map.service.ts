import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { foldVietnamese } from '@hbvl/contracts';
import { PrismaClient } from '@hbvl/database';
import { CacheService } from '../cache/cache.service';
import { E } from '../common/errors';
import { mediaUrl } from '../media/media.service';

export type System = '34' | '63';
const SYSTEM = { '34': 'CURRENT_34', '63': 'LEGACY_63' } as const;

interface Geometry {
  type: string;
  modes: Record<string, { type: string; properties: { name: string }; geometry: { type: string; coordinates: unknown } }[]>;
  islands: unknown[];
}

let geometryCache: { json: string; etag: string; data: Geometry } | undefined;

/** Geometry is a versioned static asset (checksum ⇒ immutable URL), validated at load. Source/licence notes: docs/SOURCE_AUDIT.md §5. */
export function loadGeometry() {
  if (geometryCache) return geometryCache;
  const dir = dirname(require.resolve('@hbvl/database/package.json'));
  const json = readFileSync(resolve(dir, 'data/geometry/vietnam-provinces.json'), 'utf8');
  const data = JSON.parse(json) as Geometry;
  const bad = (['34', '63'] as const).some((k) => !data.modes[k]?.every((f) => f.type === 'Feature' && ['Polygon', 'MultiPolygon'].includes(f.geometry.type)));
  if (bad || data.modes['34']?.length !== 34 || data.modes['63']?.length !== 63 || data.islands.length !== 17) throw new Error('Invalid map geometry data');
  geometryCache = { json, data, etag: createHash('sha256').update(json).digest('hex').slice(0, 16) };
  return geometryCache;
}

@Injectable()
export class MapService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: CacheService,
  ) {}

  /** One source of truth for every count shown on the site (home, map, province page, admin). */
  async summary(system: System) {
    return this.cache.wrap(`map:summary:${system}`, 120, async () => {
      if (system === '63') {
        const rows = await this.prisma.$queryRaw<{ slug: string; nameVi: string; nameEn: string; kind: string; n: bigint }[]>`
          SELECT p.slug, p."nameVi", p."nameEn", p.kind::text AS kind, count(m.id) FILTER (WHERE m.status = 'ACTIVE' AND m."isPublic") AS n
          FROM provinces p LEFT JOIN scholarship_members m ON m."legacyProvinceId" = p.id
          WHERE p.system = 'LEGACY_63' GROUP BY p.id ORDER BY p."sortOrder", p."nameVi"`;
        const provinces = rows.map((r) => ({ slug: r.slug, nameVi: r.nameVi, nameEn: r.nameEn, kind: r.kind, count: Number(r.n) }));
        return this.wrap('63', provinces);
      }
      const rows = await this.prisma.$queryRaw<{ slug: string; nameVi: string; nameEn: string; kind: string; n: bigint }[]>`
        SELECT c.slug, c."nameVi", c."nameEn", c.kind::text AS kind, count(m.id) FILTER (WHERE m.status = 'ACTIVE' AND m."isPublic") AS n
        FROM provinces c
        LEFT JOIN province_mappings pm ON pm."currentProvinceId" = c.id
        LEFT JOIN scholarship_members m ON m."legacyProvinceId" = pm."legacyProvinceId"
        WHERE c.system = 'CURRENT_34' GROUP BY c.id ORDER BY c."sortOrder", c."nameVi"`;
      const cons = await this.prisma.$queryRaw<{ cur: string; slug: string; nameVi: string; nameEn: string; n: bigint }[]>`
        SELECT c.slug AS cur, l.slug, l."nameVi", l."nameEn", count(m.id) FILTER (WHERE m.status = 'ACTIVE' AND m."isPublic") AS n
        FROM province_mappings pm JOIN provinces c ON c.id = pm."currentProvinceId" JOIN provinces l ON l.id = pm."legacyProvinceId"
        LEFT JOIN scholarship_members m ON m."legacyProvinceId" = l.id GROUP BY c.slug, l.id ORDER BY l."sortOrder"`;
      const provinces = rows.map((r) => ({
        slug: r.slug,
        nameVi: r.nameVi,
        nameEn: r.nameEn,
        kind: r.kind,
        count: Number(r.n),
        constituents: cons.filter((c) => c.cur === r.slug).map((c) => ({ slug: c.slug, nameVi: c.nameVi, nameEn: c.nameEn, count: Number(c.n) })),
      }));
      return this.wrap('34', provinces);
    });
  }

  private wrap<T extends { count: number }>(system: System, provinces: T[]) {
    const members = provinces.reduce((s, p) => s + p.count, 0);
    return { system, totals: { members, units: provinces.length, unitsWithMembers: provinces.filter((p) => p.count > 0).length }, provinces };
  }

  async provinceMembers(system: System, slug: string) {
    return this.cache.wrap(`map:members:${system}:${slug}`, 120, async () => {
      const prov = await this.prisma.province.findUnique({ where: { system_slug: { system: SYSTEM[system], slug } }, select: { id: true } });
      if (!prov) throw E.notFound('Không tìm thấy tỉnh/thành.');
      const legacyIds =
        system === '63'
          ? [prov.id]
          : (await this.prisma.provinceMapping.findMany({ where: { currentProvinceId: prov.id }, select: { legacyProvinceId: true } })).map((m) => m.legacyProvinceId);
      const members = await this.prisma.scholarshipMember.findMany({
        where: { legacyProvinceId: { in: legacyIds }, status: 'ACTIVE', isPublic: true },
        select: { fullName: true, normalizedName: true },
        orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      });
      return { items: members.map((m) => ({ name: m.fullName })), total: members.length };
    });
  }

  /** Province / member search, diacritic-insensitive; returns at most 5 provinces + 5 members. */
  async search(system: System, q: string) {
    const folded = foldVietnamese(q);
    if (folded.length < 2) return { provinces: [], members: [] };
    const tokens = folded.split(' ').slice(0, 4);
    const summary = await this.summary(system);
    const provinces = summary.provinces
      .filter((p) => tokens.every((t) => foldVietnamese(p.nameVi).includes(t) || foldVietnamese(p.nameEn).includes(t)))
      .slice(0, 5)
      .map((p) => ({ slug: p.slug, nameVi: p.nameVi, nameEn: p.nameEn, count: p.count }));
    const rows = await this.prisma.scholarshipMember.findMany({
      where: { status: 'ACTIVE', isPublic: true, AND: tokens.map((t) => ({ normalizedName: { contains: t } })) },
      select: {
        fullName: true,
        legacyProvince: { select: { slug: true, nameVi: true, nameEn: true, mappingAsLegacy: { select: { current: { select: { slug: true, nameVi: true, nameEn: true } } } } } },
      },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      take: 5,
    });
    const members = rows.map((m) => {
      const lp = m.legacyProvince;
      const cur = lp.mappingAsLegacy?.current;
      const target = system === '63' ? lp : (cur ?? lp);
      return { name: m.fullName, provinceSlug: target.slug, provinceNameVi: target.nameVi, provinceNameEn: target.nameEn };
    });
    return { provinces, members };
  }

  /** `/tinh/{slug}`: the 63-unit page of the legacy site (slug from `province-directory.json`). */
  async provincePage(slug: string) {
    return this.cache.wrap(`province:${slug}`, 120, async () => {
      const p = await this.prisma.province.findUnique({
        where: { system_slug: { system: 'LEGACY_63', slug } },
        include: {
          photo: { select: { id: true, isPlaceholder: true, status: true } },
          mappingAsLegacy: { select: { current: { select: { slug: true, nameVi: true, nameEn: true } } } },
        },
      });
      if (!p) throw E.notFound('Không tìm thấy tỉnh/thành.');
      const [count, contacts] = await Promise.all([
        this.prisma.scholarshipMember.count({ where: { legacyProvinceId: p.id, status: 'ACTIVE', isPublic: true } }),
        // Only VERIFIED directory entries are public; UNVERIFIED_SAMPLE (imported placeholder data) stays hidden until an admin verifies it.
        this.prisma.directoryContact.findMany({
          where: { provinceId: p.id, verification: 'VERIFIED' },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { name: true, role: true, contactPath: true },
        }),
      ]);
      return {
        slug: p.slug,
        nameVi: p.nameVi,
        nameEn: p.nameEn,
        kind: p.kind,
        photo: p.photo && p.photo.status !== 'DELETED' ? { url: mediaUrl(p.photo.id, 'large'), placeholder: p.photo.isPlaceholder } : null,
        current: p.mappingAsLegacy?.current ?? null,
        memberCount: count,
        contacts,
      };
    });
  }
}
