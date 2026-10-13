import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaClient } from './generated/client';

const dataDir = resolve(__dirname, '../data');
const readJson = <T>(file: string): T => JSON.parse(readFileSync(resolve(dataDir, file), 'utf8')) as T;

interface ContentGroups {
  groups: {
    slug: string;
    nameVi: string;
    nameEn: string;
    navEn: string;
    summaryVi: string;
    summaryEn: string;
    items: { slug: string; nameVi: string; nameEn: string; descriptionVi: string; descriptionEn: string; cardType: 'CARD' | 'PROFILE' | 'SONG' | 'TIP' }[];
  }[];
}
interface ProvinceFile {
  current34: { code: string; nameVi: string; nameEn: string; slug: string; officialCode: string | null; kind: 'PROVINCE' | 'CITY'; sortOrder: number }[];
  legacy63: { code: string; nameVi: string; nameEn: string; slug: string; kind: 'PROVINCE' | 'CITY'; currentNameVi: string; sortOrder: number }[];
}

/** Production-safe reference data. Idempotent; never overwrites rows edited by admins. */
export async function seedReferenceData(prisma: PrismaClient): Promise<{ categories: number; provinces: number; settings: number }> {
  const { groups } = readJson<ContentGroups>('content-groups.json');
  let categories = 0;
  const icons: Record<string, string> = { 'tin-tuc': 'newspaper', 'dong-du-ky': 'map', 'so-tay-kien-thuc': 'book-open', 'goc-sach-hay': 'bookmark', 'sinh-hoat': 'users' };

  await prisma.$transaction(async (tx) => {
    for (const [gi, g] of groups.entries()) {
      const parent = await tx.category.upsert({
        where: { slug: g.slug },
        update: {},
        create: {
          slug: g.slug,
          sortOrder: gi,
          isSystem: true,
          iconKey: icons[g.slug] ?? null,
          translations: {
            create: [
              { locale: 'vi', name: g.nameVi, navLabel: g.nameVi, summary: g.summaryVi, description: g.summaryVi },
              { locale: 'en', name: g.nameEn, navLabel: g.navEn, summary: g.summaryEn, description: g.summaryEn },
            ],
          },
        },
      });
      categories++;
      for (const [ii, it] of g.items.entries()) {
        await tx.category.upsert({
          where: { slug: it.slug },
          update: {},
          create: {
            slug: it.slug,
            parentId: parent.id,
            sortOrder: ii,
            isSystem: true,
            cardType: it.cardType,
            translations: {
              create: [
                { locale: 'vi', name: it.nameVi, description: it.descriptionVi },
                { locale: 'en', name: it.nameEn, description: it.descriptionEn },
              ],
            },
          },
        });
        categories++;
      }
    }
  });

  // Japanese names. Created only when missing: a translation edited by an administrator is never overwritten.
  const ja = readJson<Record<string, { name: string; navLabel?: string; summary?: string; description?: string }>>('content-groups.ja.json');
  for (const [slug, t] of Object.entries(ja)) {
    const c = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
    if (!c) continue;
    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: c.id, locale: 'ja' } },
      update: {},
      create: { categoryId: c.id, locale: 'ja', name: t.name, navLabel: t.navLabel ?? null, summary: t.summary ?? null, description: t.description ?? t.summary ?? null },
    });
  }

  // Provinces: 34 current + 63 legacy + mapping.
  const pf = readJson<ProvinceFile>('provinces.json');
  const currentIdByName = new Map<string, string>();
  let provinces = 0;
  await prisma.$transaction(async (tx) => {
    for (const p of pf.current34) {
      const row = await tx.province.upsert({
        where: { system_code: { system: 'CURRENT_34', code: p.code } },
        update: {},
        create: { system: 'CURRENT_34', code: p.code, officialCode: p.officialCode, nameVi: p.nameVi, nameEn: p.nameEn, slug: p.slug, kind: p.kind, sortOrder: p.sortOrder },
      });
      currentIdByName.set(p.nameVi, row.id);
      provinces++;
    }
    for (const p of pf.legacy63) {
      const row = await tx.province.upsert({
        where: { system_code: { system: 'LEGACY_63', code: p.code } },
        update: {},
        create: { system: 'LEGACY_63', code: p.code, officialCode: null, nameVi: p.nameVi, nameEn: p.nameEn, slug: p.slug, kind: p.kind, sortOrder: p.sortOrder },
      });
      const currentId = currentIdByName.get(p.currentNameVi);
      if (!currentId) throw new Error(`Missing current province for ${p.nameVi}`);
      await tx.provinceMapping.upsert({
        where: { legacyProvinceId: row.id },
        update: {},
        create: { legacyProvinceId: row.id, currentProvinceId: currentId },
      });
      provinces++;
    }
  });

  // Site settings (create-only so admin edits survive re-seeding).
  const settings = readJson<Record<string, unknown>>('site-settings.json');
  let settingCount = 0;
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith('_')) continue;
    await prisma.siteSetting.upsert({ where: { key }, update: {}, create: { key, value: value as object } });
    settingCount++;
  }
  return { categories, provinces, settings: settingCount };
}
