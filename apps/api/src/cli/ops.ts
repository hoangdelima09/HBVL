import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import { loadEnv } from '../config/env';

/**
 * Backup / restore / verify / drill for the two stateful stores: PostgreSQL (pg_dump custom format) and the S3 bucket (every object + SHA-256).
 *   pnpm ops backup  --out <dir>
 *   pnpm ops restore --from <backup dir> --db <new database> --bucket <new bucket>
 *   pnpm ops verify  --from <backup dir> --db <database> --bucket <bucket>
 *   pnpm ops drill   [--out <dir>]      backup → restore into <db>_drill / <bucket>-drill → verify → remove the drill copies, printing timings
 * Redis holds only sessions/cache/queues (rebuildable) and is deliberately NOT part of the backup. Backups contain personal data: store them encrypted
 * and access-controlled (see docs/OPERATIONS.md); this tool never prints their contents.
 */
const base = process.env.INIT_CWD ?? process.cwd();
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const sha256File = (p: string) => sha256(readFileSync(p));

interface Manifest {
  createdAt: string;
  database: { name: string; bytes: number; sha256: string };
  tables: Record<string, number>;
  objects: { key: string; bytes: number; sha256: string }[];
  appVersion: string;
}

const env = loadEnv();
const dbUrl = new URL(process.env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL);
const adminPw = process.env.POSTGRES_ADMIN_PASSWORD;
const dbNameOf = (u: URL) => u.pathname.replace(/^\//, '');
const withDb = (u: URL, name: string, user?: { name: string; pw?: string }) => {
  const c = new URL(u);
  c.pathname = `/${name}`;
  if (user) {
    c.username = user.name;
    c.password = encodeURIComponent(user.pw ?? '');
  }
  return c;
};
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});

function run(cmd: string, args: string[], pw: string | undefined, input?: Buffer) {
  const r = spawnSync(cmd, args, { env: { ...process.env, PGPASSWORD: pw ?? '' }, input, maxBuffer: 1 << 30, encoding: 'buffer' });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}): ${r.stderr.toString().slice(0, 400)}`);
  return r.stdout;
}
const pgArgs = (u: URL) => ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username)];

async function tableCounts(url: URL): Promise<Record<string, number>> {
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    const tables = (
      await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1`)
    ).rows as { table_name: string }[];
    const out: Record<string, number> = {};
    for (const t of tables) out[t.table_name] = Number((await c.query(`SELECT count(*)::int AS n FROM "${t.table_name}"`)).rows[0].n);
    return out;
  } finally {
    await c.end();
  }
}

async function listKeys(bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    keys.push(...(r.Contents ?? []).map((o) => o.Key!));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys.sort();
}
async function getObject(bucket: string, key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

export async function backup(outDir: string, source = { db: dbNameOf(dbUrl), bucket: env.S3_BUCKET_PRIVATE }): Promise<{ dir: string; manifest: Manifest }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(outDir, `hbvl-${stamp}`);
  mkdirSync(resolve(dir, 'objects'), { recursive: true, mode: 0o700 });
  const url = withDb(dbUrl, source.db);
  const dump = run('pg_dump', [...pgArgs(url), '-d', source.db, '-Fc', '--no-owner'], decodeURIComponent(url.password));
  writeFileSync(resolve(dir, 'db.dump'), dump, { mode: 0o600 });
  const tables = await tableCounts(url);
  const objects: Manifest['objects'] = [];
  for (const key of await listKeys(source.bucket)) {
    const body = await getObject(source.bucket, key);
    const file = resolve(dir, 'objects', key);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, body, { mode: 0o600 });
    objects.push({ key, bytes: body.length, sha256: sha256(body) });
  }
  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    database: { name: source.db, bytes: dump.length, sha256: sha256(dump) },
    tables,
    objects,
    appVersion: process.env.npm_package_version ?? '0.1.0',
  };
  writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return { dir, manifest };
}

export async function restore(dir: string, target: { db: string; bucket: string }): Promise<void> {
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as Manifest;
  if (sha256File(resolve(dir, 'db.dump')) !== manifest.database.sha256) throw new Error('db.dump does not match its recorded checksum — refusing to restore a damaged backup');
  if (!adminPw) throw new Error('POSTGRES_ADMIN_PASSWORD is required to create the target database');
  const adminUrl = withDb(dbUrl, 'postgres', { name: 'postgres', pw: adminPw });
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const migrator = decodeURIComponent(dbUrl.username);
  if ((await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [target.db])).rowCount)
    throw new Error(`database "${target.db}" already exists — restore only into an empty, new database`);
  await admin.query(`CREATE DATABASE "${target.db}" OWNER "${migrator}"`);
  await admin.end();
  const tdb = new pg.Client({ connectionString: withDb(adminUrl, target.db).toString() });
  await tdb.connect();
  await tdb.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await tdb.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await tdb.end();
  // Owner and ACLs come from the dump (roles already exist cluster-wide), so the append-only audit-log privileges are restored exactly.
  // Extensions were created above (as superuser); skip their TOC entries so the restore can run under the migrator role.
  const toc = run('pg_restore', ['-l', resolve(dir, 'db.dump')], undefined)
    .toString()
    .split('\n')
    .filter((l) => !/\bEXTENSION\b/.test(l))
    .join('\n');
  const tocFile = resolve(dir, '.restore.toc');
  writeFileSync(tocFile, toc, { mode: 0o600 });
  try {
    run(
      'pg_restore',
      [...pgArgs(withDb(adminUrl, target.db)), '-d', target.db, '--no-owner', '--role', migrator, '--exit-on-error', '-L', tocFile, resolve(dir, 'db.dump')],
      adminPw,
    );
  } finally {
    rmSync(tocFile, { force: true });
  }
  try {
    await s3.send(new CreateBucketCommand({ Bucket: target.bucket }));
  } catch {
    /* exists */
  }
  for (const o of manifest.objects) await s3.send(new PutObjectCommand({ Bucket: target.bucket, Key: o.key, Body: readFileSync(resolve(dir, 'objects', o.key)) }));
}

export async function verify(dir: string, target: { db: string; bucket: string }): Promise<{ ok: boolean; problems: string[] }> {
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as Manifest;
  const problems: string[] = [];
  const counts = await tableCounts(withDb(dbUrl, target.db));
  for (const [t, n] of Object.entries(manifest.tables)) if (counts[t] !== n) problems.push(`table ${t}: backup ${n} rows, restored ${counts[t] ?? 'missing'}`);
  const keys = new Set(await listKeys(target.bucket));
  for (const o of manifest.objects) {
    if (!keys.has(o.key)) {
      problems.push(`object ${o.key} missing`);
      continue;
    }
    if (sha256(await getObject(target.bucket, o.key)) !== o.sha256) problems.push(`object ${o.key} checksum differs`);
  }
  // the restored database must still enforce its safety nets
  const c = new pg.Client({ connectionString: withDb(dbUrl, target.db).toString() });
  await c.connect();
  try {
    const trg = await c.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('audit_log_no_update', 'audit_log_no_truncate', 'review_events_no_update')`);
    if (trg.rows[0].n !== 3) problems.push('append-only triggers are missing after restore');
  } finally {
    await c.end();
  }
  return { ok: problems.length === 0, problems };
}

async function dropCopy(db: string, bucket: string) {
  if (adminPw) {
    const admin = new pg.Client({ connectionString: withDb(dbUrl, 'postgres', { name: 'postgres', pw: adminPw }).toString() });
    await admin.connect();
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [db]);
    await admin.query(`DROP DATABASE IF EXISTS "${db}"`);
    await admin.end();
  }
  for (const k of await listKeys(bucket).catch(() => [])) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: k }));
}

async function main() {
  const { positionals, values: v } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' }, from: { type: 'string' }, db: { type: 'string' }, bucket: { type: 'string' }, 'keep-drill': { type: 'boolean' } },
  });
  const cmd = positionals[0];
  const outDir = resolve(base, v.out ?? 'backups');
  if (cmd === 'backup') {
    const t0 = Date.now();
    const { dir, manifest } = await backup(outDir);
    console.log(
      JSON.stringify(
        { backup: dir, seconds: (Date.now() - t0) / 1000, dumpBytes: manifest.database.bytes, tables: Object.keys(manifest.tables).length, objects: manifest.objects.length },
        null,
        2,
      ),
    );
  } else if (cmd === 'restore') {
    if (!v.from || !v.db || !v.bucket) throw new Error('usage: ops restore --from <dir> --db <new db> --bucket <new bucket>');
    const t0 = Date.now();
    await restore(resolve(base, v.from), { db: v.db, bucket: v.bucket });
    console.log(`restored into ${v.db} / ${v.bucket} in ${(Date.now() - t0) / 1000}s — now run: ops verify`);
  } else if (cmd === 'verify') {
    if (!v.from || !v.db || !v.bucket) throw new Error('usage: ops verify --from <dir> --db <db> --bucket <bucket>');
    const r = await verify(resolve(base, v.from), { db: v.db, bucket: v.bucket });
    console.log(r.ok ? 'VERIFY OK' : `VERIFY FAILED\n - ${r.problems.join('\n - ')}`);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === 'drill') {
    const src = { db: dbNameOf(dbUrl), bucket: env.S3_BUCKET_PRIVATE };
    const drill = { db: `${src.db}_drill`.slice(0, 60), bucket: `${src.bucket}-drill`.slice(0, 63) };
    await dropCopy(drill.db, drill.bucket);
    const t0 = Date.now();
    const { dir, manifest } = await backup(outDir, src);
    const t1 = Date.now();
    await restore(dir, drill);
    const t2 = Date.now();
    const r = await verify(dir, drill);
    const t3 = Date.now();
    const result = {
      source: src,
      restoredAs: drill,
      backupDir: dir,
      rows: Object.values(manifest.tables).reduce((a, b) => a + b, 0),
      tables: Object.keys(manifest.tables).length,
      objects: manifest.objects.length,
      dumpBytes: manifest.database.bytes,
      objectBytes: manifest.objects.reduce((a, o) => a + o.bytes, 0),
      seconds: { backup: (t1 - t0) / 1000, restore: (t2 - t1) / 1000, verify: (t3 - t2) / 1000 },
      verified: r.ok,
      problems: r.problems,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!v['keep-drill']) await dropCopy(drill.db, drill.bucket);
    if (!existsSync(dir) || statSync(dir).mode === 0) throw new Error('backup directory vanished');
    if (!v.out) rmSync(dir, { recursive: true, force: true }); // a drill without --out leaves nothing (personal data) behind
    process.exit(r.ok ? 0 : 1);
  } else {
    console.log('usage: ops backup|restore|verify|drill  (see file header)');
    process.exit(2);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
