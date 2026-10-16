import 'reflect-metadata';
import { createPrismaClient } from '@hbvl/database';
import { loadEnv } from '../config/env';
import { buildSearchText } from '../content/sanitize';

/**
 * Rebuilds the folded search text (title + body) of every post, translation and page. Safe to run any time; it only rewrites rows whose
 * value actually changes. Needed once for posts written before titles were indexed (they could not be found by title in search or by the
 * site assistant). `pnpm reindex:search`
 */
async function main() {
  const env = loadEnv();
  const prisma = createPrismaClient({ connectionString: process.env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL, poolMax: 2 });
  let changed = 0;
  try {
    for (const p of await prisma.post.findMany({ select: { id: true, title: true, contentText: true, searchText: true } })) {
      const next = buildSearchText(p.title, p.contentText);
      if (next !== p.searchText) changed += (await prisma.post.updateMany({ where: { id: p.id }, data: { searchText: next } })).count;
    }
    for (const t of await prisma.postTranslation.findMany({ select: { postId: true, locale: true, title: true, contentText: true, searchText: true } })) {
      const next = buildSearchText(t.title, t.contentText);
      if (next !== t.searchText) changed += (await prisma.postTranslation.updateMany({ where: { postId: t.postId, locale: t.locale }, data: { searchText: next } })).count;
    }
    for (const g of await prisma.page.findMany({ select: { id: true, title: true, contentText: true, searchText: true } })) {
      const next = buildSearchText(g.title, g.contentText);
      if (next !== g.searchText) changed += (await prisma.page.updateMany({ where: { id: g.id }, data: { searchText: next } })).count;
    }
    console.log(`Search text rebuilt: ${changed} row(s) updated.`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
