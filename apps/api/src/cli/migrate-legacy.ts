import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createPrismaClient } from '@hbvl/database';
import { loadEnv } from '../config/env';
import { MediaService } from '../media/media.service';
import { StorageService } from '../media/storage.service';
import { renderMarkdown } from '../migration/report';
import { PHASE_NAMES, runLegacyMigration } from '../migration/runner';
import { loadSnapshotFromMysql } from '../migration/snapshot';

const HELP = `WordPress → HBVL migration

  pnpm migrate:legacy inventory                 count what the source contains (no writes)
  pnpm migrate:legacy dry-run [options]         run everything inside a transaction that is rolled back; writes only a run record + report
  pnpm migrate:legacy apply   [options]         import (idempotent; safe to run again)
  pnpm migrate:legacy resume  [options]         apply, continuing the unfinished run of the same source
  pnpm migrate:legacy report  [--run <id>]      print the stored summary of a run

Options (flags or environment; paths are resolved from where you ran the command):
  --mysql-url <url>            LEGACY_MYSQL_URL        temporary MariaDB restored from the dump (see scripts/migration/restore-legacy.mjs)
  --uploads-dir <dir>          LEGACY_UPLOADS_DIR      wp-content/uploads
  --members-file <file>        LEGACY_MEMBERS_FILE     .xlsx | .csv | .json (name + province only)
  --directory-file <file>      derived from LEGACY_THEME_DIR/data/province-directory.json
  --province-images-dir <dir>  derived from LEGACY_THEME_DIR/assets/img/provinces
  --only <a,b,...>             phases: ${PHASE_NAMES.join(', ')}
  --link-existing-by-email     map a WordPress user to an existing account with the same e-mail (default: report a conflict)
  --report-dir <dir>           default ./reports/migration (git-ignored)
  --json                       machine-readable output`;

const base = process.env.INIT_CWD ?? process.cwd();
const abs = (p?: string) => (p ? resolve(base, p) : undefined);

async function main() {
  const { positionals, values: v } = parseArgs({
    allowPositionals: true,
    options: {
      'mysql-url': { type: 'string' },
      'uploads-dir': { type: 'string' },
      'members-file': { type: 'string' },
      'directory-file': { type: 'string' },
      'province-images-dir': { type: 'string' },
      only: { type: 'string' },
      'link-existing-by-email': { type: 'boolean' },
      'report-dir': { type: 'string' },
      json: { type: 'boolean' },
      run: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const cmd = positionals[0];
  if (!cmd || v.help || !['inventory', 'dry-run', 'apply', 'resume', 'report'].includes(cmd)) {
    console.log(HELP);
    process.exit(cmd ? 2 : 0);
  }

  const env = loadEnv();
  const prisma = createPrismaClient({ connectionString: process.env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL, poolMax: 4 });
  try {
    if (cmd === 'report') {
      const run = v.run ? await prisma.migrationRun.findUnique({ where: { id: v.run } }) : await prisma.migrationRun.findFirst({ orderBy: { startedAt: 'desc' } });
      if (!run) {
        console.error('No migration run found.');
        process.exit(1);
      }
      console.log(JSON.stringify({ id: run.id, mode: run.mode, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, stats: run.stats }, null, 2));
      return;
    }

    const url = v['mysql-url'] ?? process.env.LEGACY_MYSQL_URL;
    if (!url) throw new Error('LEGACY_MYSQL_URL (or --mysql-url) is required: restore the dump first with scripts/migration/restore-legacy.mjs');
    const snap = await loadSnapshotFromMysql({ url });

    if (cmd === 'inventory') {
      const byType = new Map<string, number>();
      for (const p of snap.posts) byType.set(`${p.post_type}/${p.post_status}`, (byType.get(`${p.post_type}/${p.post_status}`) ?? 0) + 1);
      const out = {
        tablePrefix: snap.prefix,
        fingerprint: snap.fingerprint,
        users: snap.users.length,
        posts: Object.fromEntries([...byType].sort()),
        comments: snap.comments.length,
        terms: snap.terms.length,
        termRelationships: snap.relationships.length,
        options: snap.options.size,
      };
      console.log(
        v.json
          ? JSON.stringify(out, null, 2)
          : Object.entries(out)
              .map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : x}`)
              .join('\n'),
      );
      return;
    }

    const theme = process.env.LEGACY_THEME_DIR;
    const mode = cmd === 'dry-run' ? 'DRY_RUN' : 'APPLY';
    const storage = new StorageService(env);
    if (mode === 'APPLY') await storage.ensureBucket();
    const media = new MediaService(prisma, storage);
    const summary = await runLegacyMigration(prisma, snap, media, {
      mode,
      resume: cmd === 'resume',
      uploadsDir: abs(v['uploads-dir'] ?? process.env.LEGACY_UPLOADS_DIR),
      membersFile: abs(v['members-file'] ?? process.env.LEGACY_MEMBERS_FILE ?? process.env.LEGACY_MEMBERS_XLSX),
      directoryFile: abs(v['directory-file'] ?? (theme ? resolve(theme, 'data/province-directory.json') : undefined)),
      provinceImagesDir: abs(v['province-images-dir'] ?? (theme ? resolve(theme, 'assets/img/provinces') : undefined)),
      linkExistingByEmail: v['link-existing-by-email'],
      only: v.only
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      log: (l) => {
        if (!v.json) console.error(l);
      },
    });

    const dir = abs(v['report-dir']) ?? resolve(base, 'reports/migration');
    mkdirSync(dir, { recursive: true });
    const stem = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${mode.toLowerCase()}_${summary.runId.slice(0, 8)}`);
    writeFileSync(`${stem}.json`, JSON.stringify(summary, null, 2));
    writeFileSync(`${stem}.md`, renderMarkdown(summary));
    if (v.json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(renderMarkdown(summary));
      console.log(`Report files: ${stem}.{md,json}`);
    }
    if (summary.status === 'FAILED') process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
