import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Redis } from 'ioredis';
import { foldVietnamese } from '@hbvl/contracts';
import { createPrismaClient } from '@hbvl/database';
import { loadEnv } from '../config/env';
import { classifyMemberRows } from '../map/members.admin.service';
import { readMembersFile } from '../migration/members-source';

const HELP = `Nhập danh sách học viên lên bản đồ (chỉ đọc họ tên + tỉnh, các cột khác bị bỏ qua)

  pnpm import:members <tệp.xlsx|.csv|.json>            xem trước, KHÔNG ghi gì
  pnpm import:members <tệp> --commit                   ghi vào cơ sở dữ liệu (chạy lại an toàn, không tạo trùng)
  pnpm import:members <tệp> --commit --replace         xóa toàn bộ danh sách học viên hiện có rồi nhập lại từ tệp`;

const base = process.env.INIT_CWD ?? process.cwd();

async function main() {
  const { positionals, values: v } = parseArgs({
    allowPositionals: true,
    options: { commit: { type: 'boolean' }, replace: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  const file = positionals[0];
  if (!file || v.help) {
    console.log(HELP);
    process.exit(file ? 0 : 2);
  }
  const rows = readMembersFile(resolve(base, file));
  const env = loadEnv();
  const prisma = createPrismaClient({ connectionString: env.DATABASE_URL, poolMax: 2 });
  try {
    const provinces = await prisma.province.findMany({ where: { system: 'LEGACY_63' }, select: { id: true, code: true, slug: true, nameVi: true, nameEn: true } });
    const existing =
      v.replace && v.commit
        ? []
        : (await prisma.scholarshipMember.findMany({ select: { normalizedName: true, sourceIdentity: true, legacyProvince: { select: { slug: true } } } })).map((e) => ({
            normalizedName: e.normalizedName,
            sourceIdentity: e.sourceIdentity,
            provinceSlug: e.legacyProvince.slug,
          }));
    const out = classifyMemberRows(rows, provinces, existing);

    const counts: Record<string, number> = {};
    for (const r of out) counts[r.status] = (counts[r.status] ?? 0) + 1;
    console.log(`Đọc ${rows.length} dòng từ ${file}`);
    for (const r of out) {
      const tag = r.status === 'OK' ? 'OK ' : r.status;
      console.log(
        `  ${String(r.row).padStart(3)}  ${tag.padEnd(18)} ${r.name.padEnd(28)} ${r.province.padEnd(24)} → ${r.provinceSlug ?? '—'}${r.message ? `   (${r.message})` : ''}`,
      );
    }
    console.log('Tổng kết:', counts);

    if (!v.commit) {
      console.log('\nChế độ xem trước: chưa ghi gì. Thêm --commit để nhập.');
      return;
    }
    // Same-name people are only imported when they are unambiguous; ambiguous rows need a human (use the admin screen).
    const apply = out.filter((r) => r.status === 'OK');
    const bySlug = new Map(provinces.map((p) => [p.slug, p.id]));
    const importRunId = randomUUID();
    let created = 0;
    await prisma.$transaction(async (tx) => {
      if (v.replace) await tx.scholarshipMember.deleteMany({});
      for (const r of apply) {
        const res = await tx.scholarshipMember.createMany({
          data: [{ fullName: r.name, normalizedName: foldVietnamese(r.name), legacyProvinceId: bySlug.get(r.provinceSlug!)!, sourceIdentity: r.identity!, importRunId }],
          skipDuplicates: true,
        });
        created += res.count;
      }
      await tx.auditLog.create({
        data: {
          actorRole: 'ADMIN',
          action: 'members.import',
          resourceType: 'members',
          resourceId: importRunId,
          metadata: { source: 'cli', rows: rows.length, applied: apply.length, created, replaced: Boolean(v.replace) },
        },
      });
    });
    // Public read models are cached: bump the namespace so the map shows the new list immediately.
    const redis = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });
    try {
      await redis.incr('cache:ns:public');
    } finally {
      redis.disconnect();
    }
    console.log(`\nĐã nhập ${created} học viên (bỏ qua ${rows.length - apply.length} dòng).`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
