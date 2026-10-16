import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { foldVietnamese } from '@hbvl/contracts';
import { Prisma, PrismaClient } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { CacheService } from '../cache/cache.service';
import { E } from '../common/errors';
import { RedisService } from '../redis/redis.service';

/** Province aliases seen in source spreadsheets (folded). Anything else must match a legacy-63 name/slug exactly (after folding). */
const ALIASES: Record<string, string> = {
  'thua thien hue': 'hue',
  'tp hue': 'hue',
  'tp ho chi minh': 'ho-chi-minh',
  tphcm: 'ho-chi-minh',
  'ho chi minh': 'ho-chi-minh',
  'tp thu duc': 'ho-chi-minh',
  'thanh pho thu duc': 'ho-chi-minh',
  'thu duc': 'ho-chi-minh',
  'dac lak': 'dak-lak',
  'dak lak': 'dak-lak',
  'tp da nang': 'da-nang',
  'tp hai phong': 'hai-phong',
  'tp can tho': 'can-tho',
  'ba ria vung tau': 'ba-ria-vung-tau',
  brvt: 'ba-ria-vung-tau',
};

export type RowStatus = 'OK' | 'DUPLICATE_IN_FILE' | 'ALREADY_EXISTS' | 'UNKNOWN_PROVINCE' | 'AMBIGUOUS_SAME_NAME' | 'INVALID';
export interface PreviewRow {
  row: number;
  name: string;
  province: string;
  status: RowStatus;
  provinceSlug?: string;
  message?: string;
  identity?: string;
  existingProvince?: string;
}

/**
 * A trailing "(… cũ)" note names the member's ORIGINAL province, e.g. "ĐẮC LẮK (Phú Yên cũ)" → "Phú Yên".
 * The map is keyed by the legacy-63 provinces, so the note is the value that must be matched, not the merged province in front of it.
 */
export function originalProvinceOf(raw: string): string {
  const m = /^.*?\(\s*(.+?)\s+cũ\s*\)\s*$/iu.exec(raw.trim());
  return m?.[1] ? m[1] : raw;
}

export const identityOf = (normalizedName: string, provinceCode: string, disambiguator = '') =>
  createHash('sha256').update(`manual|${normalizedName}|${provinceCode}|${disambiguator}`).digest('hex');

export interface ProvinceRef {
  id: string;
  code: string;
  slug: string;
  nameVi: string;
  nameEn: string;
}

/** Folded name/alias → legacy-63 province. */
export function buildProvinceIndex<T extends ProvinceRef>(provinces: T[]): Map<string, T> {
  const idx = new Map<string, T>();
  for (const p of provinces) {
    idx.set(foldVietnamese(p.nameVi), p);
    idx.set(foldVietnamese(p.nameEn), p);
    idx.set(p.slug.replace(/-/g, ' '), p);
  }
  for (const [alias, slug] of Object.entries(ALIASES)) {
    const p = provinces.find((x) => x.slug === slug);
    if (p) idx.set(alias, p);
  }
  return idx;
}

/** Pure row classification shared by the admin import preview and the WordPress migration (same rules, same identity hash). */
export function classifyMemberRows(
  rows: { name: string; province: string; distinct?: boolean }[],
  provinces: ProvinceRef[],
  existing: { normalizedName: string; sourceIdentity: string; provinceSlug: string }[],
  identity: (normalizedName: string, provinceCode: string, disambiguator?: string) => string = identityOf,
): PreviewRow[] {
  const idx = buildProvinceIndex(provinces);
  const existingIdentity = new Set(existing.map((e) => e.sourceIdentity));
  const existingByName = new Map<string, string[]>();
  for (const e of existing) existingByName.set(e.normalizedName, [...(existingByName.get(e.normalizedName) ?? []), e.provinceSlug]);
  const seen = new Set<string>();
  return rows.map((r, i) => {
    const row = i + 1;
    const name = r.name.replace(/\s+/g, ' ').trim();
    if (!name || name.length > 120) return { row, name, province: r.province, status: 'INVALID' as const, message: 'Họ tên trống hoặc quá dài (>120).' };
    const normalizedName = foldVietnamese(name);
    const p = idx.get(foldVietnamese(originalProvinceOf(r.province)));
    if (!p) return { row, name, province: r.province, status: 'UNKNOWN_PROVINCE' as const, message: `Không nhận diện được địa danh "${r.province}".` };
    const id = identity(normalizedName, p.code, r.distinct ? `d${row}` : '');
    const base = { row, name, province: r.province, provinceSlug: p.slug, identity: id };
    if (seen.has(id))
      return { ...base, status: 'DUPLICATE_IN_FILE' as const, message: 'Trùng họ tên + tỉnh với một dòng phía trên (đánh dấu "khác người" nếu thực sự là hai người).' };
    seen.add(id);
    if (existingIdentity.has(id)) return { ...base, status: 'ALREADY_EXISTS' as const, message: 'Đã có trong danh sách.' };
    const sameName = (existingByName.get(normalizedName) ?? []).filter((s) => s !== p.slug);
    if (sameName.length)
      return { ...base, status: 'AMBIGUOUS_SAME_NAME' as const, existingProvince: sameName[0], message: `Đã có người cùng tên ở "${sameName[0]}" — cần xác nhận là người khác.` };
    return { ...base, status: 'OK' as const };
  });
}

@Injectable()
export class MembersAdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  async list(q: { q?: string; province?: string; status?: 'ACTIVE' | 'ARCHIVED'; visibility?: 'public' | 'hidden'; page: number; pageSize: number }) {
    const where: Prisma.ScholarshipMemberWhereInput = {
      ...(q.q ? { normalizedName: { contains: foldVietnamese(q.q) } } : {}),
      ...(q.province ? { legacyProvince: { slug: q.province, system: 'LEGACY_63' } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.visibility ? { isPublic: q.visibility === 'public' } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.scholarshipMember.count({ where }),
      this.prisma.scholarshipMember.findMany({
        where,
        orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, fullName: true, status: true, isPublic: true, userId: true, legacyProvince: { select: { slug: true, nameVi: true } } },
      }),
    ]);
    return { items: rows, page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  /**
   * Validates every row and reports problems by row number. Nothing is written. Same-name people are never silently merged or dropped.
   * `replace`: the file becomes the whole list (current members are deleted on commit), so rows are checked against an empty list.
   */
  async preview(rows: { name: string; province: string; distinct?: boolean }[], replace = false) {
    if (rows.length === 0 || rows.length > 5000) throw E.validation([{ path: 'rows', message: 'Tệp cần có từ 1 đến 5.000 dòng.' }]);
    const provinces = await this.prisma.province.findMany({ where: { system: 'LEGACY_63' }, select: { id: true, code: true, slug: true, nameVi: true, nameEn: true } });
    const existing = replace
      ? []
      : await this.prisma.scholarshipMember.findMany({ select: { normalizedName: true, sourceIdentity: true, legacyProvince: { select: { slug: true } } } });
    const out = classifyMemberRows(
      rows,
      provinces,
      existing.map((e) => ({ normalizedName: e.normalizedName, sourceIdentity: e.sourceIdentity, provinceSlug: e.legacyProvince.slug })),
    );
    const token = randomUUID();
    await this.redis.client.set(`member-import:${token}`, JSON.stringify({ replace, rows: out }), 'EX', 3600);
    const counts = out.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
    const replacing = replace ? await this.prisma.scholarshipMember.count() : 0;
    return { token, counts, rows: out, replace, replacing };
  }

  /**
   * Applies a previewed import. Ambiguous rows are included only if the admin explicitly confirms them as different people.
   * A preview made in replace mode deletes every current member first (same transaction: all or nothing).
   */
  async commit(a: AuthContext, token: string, confirmAmbiguous: number[]) {
    const raw = await this.redis.client.get(`member-import:${token}`);
    if (!raw) throw E.notFound('Phiên xem trước đã hết hạn. Hãy tải lại tệp.');
    const { replace, rows } = JSON.parse(raw) as { replace: boolean; rows: PreviewRow[] };
    const confirm = new Set(confirmAmbiguous);
    const apply = rows.filter((r) => r.status === 'OK' || (r.status === 'AMBIGUOUS_SAME_NAME' && confirm.has(r.row)));
    const run = randomUUID();
    const provinces = await this.prisma.province.findMany({ where: { system: 'LEGACY_63' }, select: { id: true, slug: true } });
    const bySlug = new Map(provinces.map((p) => [p.slug, p.id]));
    let created = 0;
    let deleted = 0;
    await this.prisma.$transaction(async (tx) => {
      if (replace) deleted = (await tx.scholarshipMember.deleteMany({})).count;
      for (const r of apply) {
        const res = await tx.scholarshipMember.createMany({
          data: [{ fullName: r.name, normalizedName: foldVietnamese(r.name), legacyProvinceId: bySlug.get(r.provinceSlug!)!, sourceIdentity: r.identity!, importRunId: run }],
          skipDuplicates: true,
        });
        created += res.count;
      }
      await this.audit.log(
        {
          actorId: a.user.id,
          actorRole: a.user.role,
          action: 'members.import',
          resourceType: 'members',
          resourceId: run,
          metadata: { rows: rows.length, applied: apply.length, created, replace, deleted },
        },
        tx,
      );
    });
    await this.redis.client.del(`member-import:${token}`);
    await this.cache.invalidatePublic();
    return { importRunId: run, created, skipped: rows.length - apply.length, deleted };
  }

  async create(a: AuthContext, input: { name: string; provinceSlug: string; distinct?: boolean }) {
    const prev = await this.preview([{ name: input.name, province: input.provinceSlug.replace(/-/g, ' '), distinct: input.distinct }]);
    const row = prev.rows[0]!;
    if (!['OK', 'AMBIGUOUS_SAME_NAME'].includes(row.status) || (row.status === 'AMBIGUOUS_SAME_NAME' && !input.distinct)) {
      await this.redis.client.del(`member-import:${prev.token}`);
      throw E.conflict(row.message ?? 'Không thể thêm học viên.', 'CONFLICT', { status: row.status });
    }
    const r = await this.commit(a, prev.token, [1]);
    return { created: r.created };
  }

  /**
   * Edits one member. A new name or province recomputes the search name and the identity hash (so a later import still recognises them).
   * Another person with the same name (same or other province) needs `distinct` = the admin confirms they are different people.
   */
  async update(
    a: AuthContext,
    id: string,
    data: { fullName?: string; provinceSlug?: string; distinct?: boolean; status?: 'ACTIVE' | 'ARCHIVED'; isPublic?: boolean; userId?: string | null },
  ) {
    const cur = await this.prisma.scholarshipMember.findUnique({ where: { id }, select: { fullName: true, legacyProvince: { select: { id: true, code: true, slug: true } } } });
    if (!cur) throw E.notFound('Không tìm thấy học viên.');
    if (data.userId) {
      const u = await this.prisma.user.findUnique({ where: { id: data.userId }, select: { id: true } });
      if (!u) throw E.validation([{ path: 'userId', message: 'Tài khoản không tồn tại.' }]);
    }
    const patch: Prisma.ScholarshipMemberUncheckedUpdateInput = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.isPublic !== undefined) patch.isPublic = data.isPublic;
    if (data.userId !== undefined) patch.userId = data.userId;
    const fullName = data.fullName === undefined ? cur.fullName : data.fullName.replace(/\s+/g, ' ').trim();
    if (!fullName || fullName.length > 120) throw E.validation([{ path: 'fullName', message: 'Họ tên trống hoặc quá dài (>120).' }]);
    const moved = data.provinceSlug !== undefined && data.provinceSlug !== cur.legacyProvince.slug;
    if (fullName !== cur.fullName || moved) {
      const p = moved
        ? await this.prisma.province.findFirst({ where: { system: 'LEGACY_63', slug: data.provinceSlug }, select: { id: true, code: true, slug: true } })
        : cur.legacyProvince;
      if (!p) throw E.validation([{ path: 'provinceSlug', message: 'Tỉnh không hợp lệ (chọn một trong 63 đơn vị cũ).' }]);
      const normalizedName = foldVietnamese(fullName);
      const namesakes = await this.prisma.scholarshipMember.findMany({
        where: { normalizedName, id: { not: id } },
        select: { legacyProvince: { select: { slug: true, nameVi: true } } },
      });
      const sameProvince = namesakes.find((n) => n.legacyProvince.slug === p.slug);
      if (namesakes.length && !data.distinct) {
        const where = (sameProvince ?? namesakes[0]!).legacyProvince.nameVi;
        throw E.conflict(
          sameProvince ? `Đã có người cùng họ tên ở ${where}. Đánh dấu "là người khác" nếu đúng là hai người.` : `Đã có người cùng tên ở "${where}" — cần xác nhận là người khác.`,
          'CONFLICT',
          { status: sameProvince ? 'DUPLICATE' : 'AMBIGUOUS_SAME_NAME' },
        );
      }
      Object.assign(patch, {
        fullName,
        normalizedName,
        legacyProvinceId: p.id,
        sourceIdentity: identityOf(normalizedName, p.code, sameProvince ? `m${id}` : ''),
      });
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.scholarshipMember.update({ where: { id }, data: patch });
        await this.audit.log(
          {
            actorId: a.user.id,
            actorRole: a.user.role,
            action: 'member.update',
            resourceType: 'member',
            resourceId: id,
            metadata: { fields: Object.keys(patch), ...(patch.fullName ? { from: { name: cur.fullName, province: cur.legacyProvince.slug } } : {}) },
          },
          tx,
        );
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw E.conflict('Học viên này đã có trong danh sách.', 'CONFLICT', { status: 'DUPLICATE' });
      throw e;
    }
    await this.cache.invalidatePublic();
    return { id };
  }

  /** Permanently removes one member (the map, province pages and statistics stop counting them). Use "Lưu trữ" to keep a record instead. */
  async remove(a: AuthContext, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.scholarshipMember.findUnique({ where: { id }, select: { fullName: true, legacyProvince: { select: { slug: true } } } });
      if (!m) throw E.notFound('Không tìm thấy học viên.');
      await tx.scholarshipMember.delete({ where: { id } });
      await this.audit.log(
        {
          actorId: a.user.id,
          actorRole: a.user.role,
          action: 'member.delete',
          resourceType: 'member',
          resourceId: id,
          metadata: { name: m.fullName, province: m.legacyProvince.slug },
        },
        tx,
      );
    });
    await this.cache.invalidatePublic();
  }

  /**
   * One action on many members. `move` goes through `update` row by row (identity + namesake rules); rows whose name already exists
   * in the target province are left where they are and reported.
   */
  async bulk(a: AuthContext, ids: string[], action: 'hide' | 'show' | 'archive' | 'restore' | 'delete' | 'move', provinceSlug?: string) {
    if (action === 'move') {
      if (!provinceSlug) throw E.validation([{ path: 'provinceSlug', message: 'Chọn tỉnh cần chuyển tới.' }]);
      let done = 0;
      const failed: { id: string; message: string }[] = [];
      for (const id of ids) {
        try {
          await this.update(a, id, { provinceSlug });
          done++;
        } catch (e) {
          failed.push({ id, message: e instanceof Error ? e.message : 'Lỗi' });
        }
      }
      return { action, done, failed };
    }
    const where = { id: { in: ids } };
    const data: Record<Exclude<typeof action, 'delete'>, Prisma.ScholarshipMemberUpdateManyMutationInput> = {
      hide: { isPublic: false },
      show: { isPublic: true },
      archive: { status: 'ARCHIVED' },
      restore: { status: 'ACTIVE' },
    };
    const done = await this.prisma.$transaction(async (tx) => {
      const n = action === 'delete' ? (await tx.scholarshipMember.deleteMany({ where })).count : (await tx.scholarshipMember.updateMany({ where, data: data[action] })).count;
      await this.audit.log(
        { actorId: a.user.id, actorRole: a.user.role, action: 'members.bulk', resourceType: 'members', metadata: { action, requested: ids.length, done: n, ids } },
        tx,
      );
      return n;
    });
    await this.cache.invalidatePublic();
    return { action, done, failed: [] };
  }

  /** CSV (UTF-8 with BOM, opens in Excel) of the filtered list; `name,province` re-imports as is. Cells are guarded against formula injection. */
  async exportCsv(q: { q?: string; province?: string; status?: 'ACTIVE' | 'ARCHIVED'; visibility?: 'public' | 'hidden' }): Promise<string> {
    const { items } = await this.list({ ...q, page: 1, pageSize: 100_000 });
    const cell = (v: string) => {
      const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = items.map((m) => [m.fullName, m.legacyProvince.nameVi, m.status === 'ACTIVE' ? 'Hoạt động' : 'Lưu trữ', m.isPublic ? 'Hiện' : 'Ẩn'].map(cell).join(','));
    return `\uFEFFname,province,trang_thai,hien_thi\r\n${lines.join('\r\n')}\r\n`;
  }

  // ───── directory contacts (province pages) ─────
  async directory(provinceSlug?: string) {
    return this.prisma.directoryContact.findMany({
      where: provinceSlug ? { province: { slug: provinceSlug, system: 'LEGACY_63' } } : {},
      orderBy: [{ provinceId: 'asc' }, { sortOrder: 'asc' }],
      take: 500,
      select: { id: true, name: true, role: true, contactPath: true, verification: true, source: true, province: { select: { slug: true, nameVi: true } } },
    });
  }

  async setVerification(a: AuthContext, id: string, verification: 'UNVERIFIED_SAMPLE' | 'VERIFIED' | 'HIDDEN') {
    await this.prisma.$transaction(async (tx) => {
      await tx.directoryContact.update({ where: { id }, data: { verification } });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'directory.verify', resourceType: 'directory', resourceId: id, metadata: { verification } }, tx);
    });
    await this.cache.invalidatePublic();
    return { id, verification };
  }
}
