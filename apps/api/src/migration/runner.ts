import { seedReferenceData, type Prisma, type PrismaClient } from '@hbvl/database';
import type { MediaService } from '../media/media.service';
import { IdMap, Reporter, type Ctx, type Db, type RunOptions } from './context';
import { commentsPhase, inboxesPhase, pagesPhase, planPhase, postsPhase } from './phase-content';
import { termsPhase, usersPhase } from './phase-identity';
import { mediaPhase } from './phase-media';
import { directoryPhase, membersPhase, provincePhotosPhase, redirectsPhase, settingsPhase } from './phase-site';
import type { LegacySnapshot } from './snapshot';

type PhaseFn = (ctx: Ctx, db: Db) => Promise<void>;
interface Phase {
  name: string;
  run: PhaseFn;
  /** Runs per record without a surrounding transaction (it writes to object storage; a rollback could not undo that). */ noTx?: boolean;
}

const PHASES: Phase[] = [
  { name: 'users', run: usersPhase },
  { name: 'terms', run: termsPhase },
  { name: 'media', run: mediaPhase, noTx: true },
  { name: 'plan', run: planPhase },
  { name: 'pages', run: pagesPhase },
  { name: 'posts', run: postsPhase },
  { name: 'comments', run: commentsPhase },
  { name: 'inboxes', run: inboxesPhase },
  { name: 'settings', run: settingsPhase },
  { name: 'redirects', run: redirectsPhase },
  { name: 'members', run: membersPhase },
  { name: 'province-photos', run: provincePhotosPhase, noTx: true },
  { name: 'directory', run: directoryPhase },
];
export const PHASE_NAMES = PHASES.map((p) => p.name);

class Rollback extends Error {}

export interface Reconciliation {
  /** Source rows by WordPress post type / table. */
  source: Record<string, number>;
  /** `legacy_id_map` rows by legacy type after the run (what the new system can trace back to WordPress). */
  mapped: Record<string, number>;
  /** Types whose mapped count does not equal "created + unchanged + linked" from this run's counters. */
  mismatches: { type: string; expected: number; actual: number }[];
}

export interface RunSummary {
  runId: string;
  mode: 'DRY_RUN' | 'APPLY';
  status: 'COMPLETED' | 'FAILED';
  fingerprint: string;
  resumed: boolean;
  phases: string[];
  stats: Record<string, Record<string, number>>;
  issues: { code: string; severity: string; count: number }[];
  errorCount: number;
  reconciliation: Reconciliation;
  durationMs: number;
}

const WP_TYPES_TRACKED = ['post', 'page', 'event', 'program', 'attachment', 'revision', 'riseup_feedback', 'riseup_contact'] as const;

export async function runLegacyMigration(prisma: PrismaClient, snap: LegacySnapshot, media: MediaService, opts: RunOptions): Promise<RunSummary> {
  const started = Date.now();
  const log = opts.log ?? (() => undefined);
  const dry = opts.mode === 'DRY_RUN';
  const rep = new Reporter();
  const chosen = PHASES.filter((p) => !opts.only?.length || opts.only.includes(p.name));
  if (opts.only?.length) {
    const unknown = opts.only.filter((n) => !PHASE_NAMES.includes(n));
    if (unknown.length) throw new Error(`Unknown phase(s): ${unknown.join(', ')}. Valid: ${PHASE_NAMES.join(', ')}`);
  }

  // A run row exists for every mode: DRY_RUN rows are kept as evidence, but their data changes are rolled back.
  let resumed = false;
  let runId: string;
  const completedBefore: string[] = [];
  const previous =
    !dry && opts.resume
      ? await prisma.migrationRun.findFirst({ where: { mode: 'APPLY', status: { in: ['RUNNING', 'FAILED'] }, fingerprint: snap.fingerprint }, orderBy: { startedAt: 'desc' } })
      : null;
  if (previous) {
    resumed = true;
    runId = previous.id;
    completedBefore.push(...Object.keys((previous.checkpoint as { phases?: Record<string, string> }).phases ?? {}));
    await prisma.migrationRun.update({ where: { id: runId }, data: { status: 'RUNNING', finishedAt: null } });
    rep.preload(await prisma.migrationIssue.findMany({ where: { runId }, select: { code: true, legacyType: true, legacyId: true } }));
    log(`Resuming run ${runId} (phases already completed: ${completedBefore.join(', ') || 'none'}). All phases are re-evaluated; unchanged records are skipped by checksum.`);
  } else {
    runId = (await prisma.migrationRun.create({ data: { mode: opts.mode, status: 'RUNNING', fingerprint: snap.fingerprint }, select: { id: true } })).id;
  }

  const tz = snap.options.get('timezone_string') || 'Asia/Ho_Chi_Minh';
  const ctx: Ctx = {
    snap,
    opts,
    prisma,
    media,
    rep,
    runId,
    idMap: new IdMap(),
    dry,
    timeZone: tz,
    siteUrls: [snap.options.get('home'), snap.options.get('siteurl')].filter((u): u is string => !!u).map((u) => u.replace(/\/+$/, '')),
    categories: new Map(),
    wpCategory: new Map(),
    wpTag: new Map(),
    uploads: new Map(),
    attachments: new Map(),
    planPosts: new Map(),
    planPagePaths: new Map(),
    users: new Map(),
    posts: new Map(),
    pages: new Map(),
  };

  const loadCategories = async (db: Db) => {
    ctx.categories.clear();
    for (const c of await db.category.findMany({ select: { id: true, slug: true, parent: { select: { slug: true } } } }))
      ctx.categories.set(c.slug, { id: c.id, parentSlug: c.parent?.slug ?? null });
  };

  const executed: string[] = [];
  let failure: unknown;
  try {
    if (!dry) await seedReferenceData(prisma); // idempotent; provinces/categories/settings are prerequisites, not migrated data

    if (dry) {
      await prisma
        .$transaction(
          async (tx) => {
            await loadCategories(tx);
            if (ctx.categories.size === 0)
              rep.add('ERROR', 'REFERENCE_DATA_MISSING', undefined, undefined, 'Chưa có dữ liệu tham chiếu (chuyên mục/tỉnh): chạy `pnpm db:seed` trước khi dry-run/apply.');
            for (const ph of chosen) {
              log(`[dry-run] ${ph.name}…`);
              await ctx.idMap.load(tx);
              await ph.run(ctx, tx);
              executed.push(ph.name);
            }
            throw new Rollback(); // nothing from the dry run is ever committed
          },
          { timeout: 30 * 60_000, maxWait: 60_000 },
        )
        .catch((e) => {
          if (!(e instanceof Rollback)) throw e;
        });
    } else {
      await loadCategories(prisma);
      for (const ph of chosen) {
        log(`[apply] ${ph.name}…`);
        const exec = async (db: Db) => {
          await ctx.idMap.load(db);
          await loadCategories(db);
          await ph.run(ctx, db);
        };
        if (ph.noTx) await exec(prisma);
        else await prisma.$transaction(exec, { timeout: 15 * 60_000, maxWait: 60_000 });
        executed.push(ph.name);
        const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: runId }, select: { checkpoint: true } });
        const phases = { ...((run.checkpoint as { phases?: Record<string, string> }).phases ?? {}), [ph.name]: new Date().toISOString() };
        await prisma.migrationRun.update({ where: { id: runId }, data: { checkpoint: { phases } as Prisma.InputJsonValue } });
        await rep.flush(prisma, runId);
      }
    }
  } catch (e) {
    failure = e;
    rep.add(
      'ERROR',
      'RUN_ABORTED',
      undefined,
      undefined,
      `Migration dừng ở phase "${chosen[executed.length]?.name ?? '?'}": ${e instanceof Error ? e.message.slice(0, 300) : 'lỗi không xác định'}`,
    );
  }

  const reconciliation = await reconcile(prisma, snap, rep, dry || !!opts.only?.length);
  for (const m of reconciliation.mismatches) rep.add('ERROR', 'RECONCILE_MISMATCH', m.type, undefined, `Số bản ghi truy vết được (${m.actual}) khác số mong đợi (${m.expected}).`);

  const status: 'COMPLETED' | 'FAILED' = failure ? 'FAILED' : 'COMPLETED';
  await rep.flush(prisma, runId);
  // A resumed run accumulates issues over several passes: the persisted rows are the cumulative truth, this pass's counters may be larger (storage cap per code).
  const totals = new Map([...rep.totalsByCode].map(([code, v]) => [code, { severity: v.severity as string, count: v.count }]));
  if (resumed) {
    for (const g of await prisma.migrationIssue.groupBy({ by: ['code', 'severity'], where: { runId }, _count: { _all: true } })) {
      const cur = totals.get(g.code);
      totals.set(g.code, { severity: g.severity, count: Math.max(cur?.count ?? 0, g._count._all) });
    }
  }
  const issues = [...totals].map(([code, v]) => ({ code, severity: v.severity, count: v.count })).sort((a, b) => a.severity.localeCompare(b.severity) || b.count - a.count);
  const prior = resumed ? (((await prisma.migrationRun.findUniqueOrThrow({ where: { id: runId }, select: { stats: true } })).stats as { passes?: unknown[] }).passes ?? []) : [];
  await prisma.migrationRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      stats: {
        counters: rep.stats,
        reconciliation,
        issues,
        phases: executed,
        dryRun: dry,
        passes: [...prior, { at: new Date().toISOString(), phases: executed, counters: rep.stats }],
      } as unknown as Prisma.InputJsonValue,
    },
  });
  if (!dry) {
    await prisma.auditLog
      .create({
        data: {
          actorRole: null,
          action: 'migration.apply',
          resourceType: 'migration_run',
          resourceId: runId,
          result: failure ? 'FAILURE' : 'SUCCESS',
          metadata: { counters: rep.stats } as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }
  if (failure) log(`FAILED: ${failure instanceof Error ? failure.message : String(failure)}`);
  const errorCount = issues.filter((i) => i.severity === 'ERROR').reduce((n, i) => n + i.count, 0);
  return {
    runId,
    mode: opts.mode,
    status,
    fingerprint: snap.fingerprint,
    resumed,
    phases: executed,
    stats: rep.stats,
    issues,
    errorCount,
    reconciliation,
    durationMs: Date.now() - started,
  };
}

/**
 * Compares what WordPress had with what the new system can trace back to. For APPLY the check is against the database; for DRY_RUN
 * the transaction is already rolled back (and a partial `--only` run is incomplete by design), so only the source side is meaningful.
 */
async function reconcile(prisma: PrismaClient, snap: LegacySnapshot, rep: Reporter, skipChecks: boolean): Promise<Reconciliation> {
  const source: Record<string, number> = { users: snap.users.length, comments: snap.comments.length, terms: snap.terms.length };
  for (const t of WP_TYPES_TRACKED)
    source[t === 'post' ? 'posts' : t === 'page' ? 'pages' : t] = snap.posts.filter((p) => p.post_type === t && p.post_status !== 'auto-draft').length;
  const grouped = await prisma.legacyIdMap.groupBy({ by: ['legacyType'], where: { source: 'wp' }, _count: { _all: true } });
  const mapped = Object.fromEntries(grouped.map((g) => [g.legacyType, g._count._all]));
  const mismatches: Reconciliation['mismatches'] = [];
  if (!skipChecks) {
    const traced = (entity: string, ...keys: string[]) => keys.reduce((n, k) => n + (rep.stats[entity]?.[k] ?? 0), 0);
    const checks: [string, string, number][] = [
      ['user', 'users', traced('users', 'created', 'unchanged', 'linkedExisting', 'sourceChanged')],
      ['page', 'pages', traced('pages', 'created', 'unchanged', 'updated', 'conflict')],
      ['comment', 'comments', traced('comments', 'created', 'unchanged', 'sourceChanged')],
    ];
    for (const [type, , expected] of checks) if ((mapped[type] ?? 0) !== expected && expected > 0) mismatches.push({ type, expected, actual: mapped[type] ?? 0 });
  }
  return { source, mapped, mismatches };
}
