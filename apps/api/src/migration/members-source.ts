import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { unzipSync, strFromU8 } from 'fflate';

/**
 * Reads ONLY (full name, province of origin) from the member list. Other columns in the workbook (gender, study year, …) are personal data
 * the site never published, so they are never read into memory.
 */
export interface MemberRow {
  name: string;
  province: string;
}
export interface MemberFileOptions {
  nameColumn?: string;
  provinceColumn?: string;
  sheetIndex?: number;
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: false, processEntities: true });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (node: unknown): string => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const o = node as Record<string, unknown>;
  if ('#text' in o) return String(o['#text']);
  return [...arr(o.t as unknown), ...arr(o.r as unknown).map((r) => (r as Record<string, unknown>).t)].map(text).join('');
};

export function readMembersXlsx(buf: Uint8Array, opts: MemberFileOptions = {}): MemberRow[] {
  const nameCol = opts.nameColumn ?? 'B';
  const provCol = opts.provinceColumn ?? 'E';
  const files = unzipSync(buf, { filter: (f) => /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name) && f.originalSize < 20 * 1024 * 1024 });
  const sstXml = files['xl/sharedStrings.xml'];
  const shared: string[] = sstXml ? arr(xml.parse(strFromU8(sstXml)).sst?.si).map(text) : [];
  const sheetName = Object.keys(files)
    .filter((n) => n.startsWith('xl/worksheets/'))
    .sort()[opts.sheetIndex ?? 0];
  if (!sheetName) throw new Error('Workbook has no worksheet');
  const rows = arr(xml.parse(strFromU8(files[sheetName]!)).worksheet?.sheetData?.row as Record<string, unknown> | Record<string, unknown>[]);
  const out: MemberRow[] = [];
  for (const row of rows) {
    const cells: Record<string, string> = {};
    for (const c of arr(row.c as Record<string, unknown> | Record<string, unknown>[])) {
      const ref = String(c['@_r'] ?? '');
      const col = ref.replace(/\d/g, '');
      if (col !== nameCol && col !== provCol && col !== 'A') continue; // everything else is intentionally ignored
      const raw = c.v === undefined ? (c.is ? text(c.is) : '') : String(c.v);
      cells[col] = c['@_t'] === 's' ? (shared[Number(raw)] ?? '') : raw;
    }
    // A data row has a numeric sequence number in column A and a name; header/blank rows are skipped.
    if (/^\d+$/.test((cells.A ?? '').trim()) && cells[nameCol]?.trim()) out.push({ name: cells[nameCol]!.trim(), province: (cells[provCol] ?? '').trim() });
  }
  return out;
}

export function readMembersCsv(content: string): MemberRow[] {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const split = (l: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if ((ch === ',' || ch === ';') && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = split(lines[0] ?? '').map((h) => h.toLowerCase());
  const ni = head.findIndex((h) => /^(name|họ tên|ho ten|họ và tên|ho va ten)$/.test(h));
  const pi = head.findIndex((h) => /^(province|tỉnh|tinh|tỉnh\/thành|quê quán|que quan|oldprovince)$/.test(h));
  if (ni < 0 || pi < 0) throw new Error('CSV needs "name" and "province" columns');
  return lines
    .slice(1)
    .map(split)
    .filter((r) => r[ni])
    .map((r) => ({ name: r[ni]!, province: r[pi] ?? '' }));
}

export function readMembersJson(content: string): MemberRow[] {
  const data = JSON.parse(content) as { members?: { name?: string; oldProvince?: string; province?: string }[] } | { name?: string; province?: string }[];
  const list = Array.isArray(data) ? data : (data.members ?? []);
  return list
    .filter((m) => m.name)
    .map((m) => ({ name: String(m.name), province: String((m as { oldProvince?: string }).oldProvince ?? (m as { province?: string }).province ?? '') }));
}

export function readMembersFile(path: string, opts: MemberFileOptions = {}): MemberRow[] {
  const ext = extname(path).toLowerCase();
  if (ext === '.xlsx') return readMembersXlsx(readFileSync(path), opts);
  const content = readFileSync(path, 'utf8');
  if (ext === '.csv') return readMembersCsv(content);
  if (ext === '.json') return readMembersJson(content);
  throw new Error(`Unsupported member file type "${ext}" (use .xlsx, .csv or .json)`);
}
