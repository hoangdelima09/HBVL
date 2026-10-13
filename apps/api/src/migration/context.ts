import type { Prisma, PrismaClient } from '@hbvl/database';
import type { MediaService } from '../media/media.service';
import type { LegacySnapshot } from './snapshot';

export type Db = Prisma.TransactionClient;

export interface RunOptions {
  mode: 'DRY_RUN' | 'APPLY';
  /** Continue the latest unfinished APPLY run of the same source instead of starting a fresh one. */
  resume?: boolean;
  /** Directory holding the legacy `wp-content/uploads` tree (outside this repository). */
  uploadsDir?: string;
  /** Optional member list (.xlsx / .csv / .json). */
  membersFile?: string;
  /** Optional theme `province-directory.json` (sample contacts → UNVERIFIED_SAMPLE). */
  directoryFile?: string;
  /** Optional directory of `<province-slug>.jpg` theme photos. */
  provinceImagesDir?: string;
  /** Map a WordPress user onto an existing account with the same e-mail instead of reporting a conflict (never matches by name). */
  linkExistingByEmail?: boolean;
  /** Restrict the run to some phases (comma list in the CLI). */
  only?: string[];
  log?: (line: string) => void;
}

export type IssueSeverity = 'INFO' | 'WARNING' | 'ERROR';
export interface IssueRec {
  severity: IssueSeverity;
  code: string;
  legacyType?: string;
  legacyId?: string;
  message: string;
  detail: Record<string, unknown>;
}

const MAX_STORED_PER_CODE = 300;

/** Collects counters and issues. Issues never carry e-mail addresses, passwords or message bodies — only legacy ids and counts. */
export class Reporter {
  readonly issues: IssueRec[] = [];
  private flushed = 0;
  readonly totalsByCode = new Map<string, { severity: IssueSeverity; count: number }>();
  readonly stats: Record<string, Record<string, number>> = {};
  /** `code|type|id` already reported in this run — a resumed run re-evaluates records and must not report them twice. */
  private readonly seen = new Set<string>();

  preload(keys: Iterable<{ code: string; legacyType: string | null; legacyId: string | null }>): void {
    for (const k of keys) this.seen.add(`${k.code}|${k.legacyType ?? ''}|${k.legacyId ?? ''}`);
  }

  add(severity: IssueSeverity, code: string, legacyType: string | undefined, legacyId: string | undefined, message: string, detail: Record<string, unknown> = {}): void {
    const key = `${code}|${legacyType ?? ''}|${legacyId ?? ''}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const t = this.totalsByCode.get(code) ?? { severity, count: 0 };
    t.count++;
    if (severity === 'ERROR') t.severity = 'ERROR';
    this.totalsByCode.set(code, t);
    if (t.count <= MAX_STORED_PER_CODE) this.issues.push({ severity, code, legacyType, legacyId, message: message.slice(0, 500), detail });
  }
  bump(entity: string, key: string, n = 1): void {
    const e = (this.stats[entity] ??= {});
    e[key] = (e[key] ?? 0) + n;
  }
  /** Writes issues not yet persisted. */
  async flush(db: Db, runId: string): Promise<void> {
    const fresh = this.issues.slice(this.flushed);
    if (!fresh.length) return;
    await db.migrationIssue.createMany({
      data: fresh.map((i) => ({
        runId,
        severity: i.severity,
        code: i.code,
        legacyType: i.legacyType ?? null,
        legacyId: i.legacyId ?? null,
        message: i.message,
        detail: i.detail as Prisma.InputJsonValue,
      })),
    });
    this.flushed = this.issues.length;
  }
  get errorCount(): number {
    return [...this.totalsByCode.values()].filter((t) => t.severity === 'ERROR').reduce((n, t) => n + t.count, 0);
  }
}

export interface MapRow {
  entityType: string;
  entityId: string;
  sourceChecksum: string;
  importedChecksum: string;
}

/** In-memory image of `legacy_id_map` for source "wp" (the table is the durable record; this is a read cache refreshed per phase). */
export class IdMap {
  private readonly rows = new Map<string, MapRow>();
  async load(db: Db): Promise<void> {
    this.rows.clear();
    for (const r of await db.legacyIdMap.findMany({
      where: { source: 'wp' },
      select: { legacyType: true, legacyId: true, entityType: true, entityId: true, sourceChecksum: true, importedChecksum: true },
    })) {
      this.rows.set(`${r.legacyType}:${r.legacyId}`, r);
    }
  }
  get(type: string, id: string): MapRow | undefined {
    return this.rows.get(`${type}:${id}`);
  }
  entities(type: string): [string, MapRow][] {
    return [...this.rows].filter(([k]) => k.startsWith(`${type}:`)).map(([k, v]) => [k.slice(type.length + 1), v]);
  }
  async put(db: Db, type: string, id: string, row: MapRow): Promise<void> {
    await db.legacyIdMap.upsert({
      where: { source_legacyType_legacyId: { source: 'wp', legacyType: type, legacyId: id } },
      create: { source: 'wp', legacyType: type, legacyId: id, ...row },
      update: { entityType: row.entityType, entityId: row.entityId, sourceChecksum: row.sourceChecksum, importedChecksum: row.importedChecksum, migratedAt: new Date() },
    });
    this.rows.set(`${type}:${id}`, row);
  }
}

export interface PostPlan {
  kind: 'POST' | 'EVENT' | 'PROGRAM';
  slug: string;
  slugChanged?: boolean;
}

export interface Ctx {
  snap: LegacySnapshot;
  opts: RunOptions;
  prisma: PrismaClient;
  media: MediaService;
  rep: Reporter;
  runId: string;
  idMap: IdMap;
  dry: boolean;
  timeZone: string;
  /** `siteurl` / `home` of the legacy site, used to relativise links and build prefixed redirect sources. */
  siteUrls: string[];
  /** system category slug → id (+ parent slug) */
  categories: Map<string, { id: string; parentSlug: string | null }>;
  /** WordPress `category` term id → new category id (null = no equivalent) */
  wpCategory: Map<string, string | null>;
  /** WordPress `post_tag` term id → Tag id */
  wpTag: Map<string, string>;
  /** uploads-relative path → asset id */
  uploads: Map<string, string>;
  /** WordPress attachment ID → asset id */
  attachments: Map<string, string>;
  /** planned URL parts, computed before content is written so that links between migrated items can be rewritten */
  planPosts: Map<string, PostPlan>;
  planPagePaths: Map<string, string>;
  /** WordPress user id → new user id */
  users: Map<string, string>;
  /** WordPress post id → new post id (kind post/event/program) */
  posts: Map<string, { id: string; kind: 'POST' | 'EVENT' | 'PROGRAM'; status: string }>;
  /** final status of each migrated page (WP id → { id, status }) */
  pages: Map<string, { id: string; status: string }>;
}

export const meta = (snap: LegacySnapshot, postId: string, key: string): string | undefined => snap.postmeta.get(postId)?.get(key);
