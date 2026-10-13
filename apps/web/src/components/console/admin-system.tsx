'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Badge } from '@/components/ui/misc';
import { ApiError, del, patch, post, put } from '@/lib/client';
import { DataTable, fmt, PageHeader, Pager, Panel, QueryBoundary, useQuery } from './kit';

interface Paged<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}

// ───────────────────────── members + import ─────────────────────────
interface MRow {
  id: string;
  fullName: string;
  status: string;
  isPublic: boolean;
  legacyProvince: { slug: string; nameVi: string };
}
interface PreviewRow {
  row: number;
  name: string;
  province: string;
  status: string;
  message?: string;
  provinceSlug?: string;
}
const PSTATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  OK: { label: 'Hợp lệ', tone: 'ok' },
  DUPLICATE_IN_FILE: { label: 'Trùng trong tệp', tone: 'warn' },
  ALREADY_EXISTS: { label: 'Đã có', tone: 'neutral' },
  UNKNOWN_PROVINCE: { label: 'Không nhận diện tỉnh', tone: 'danger' },
  AMBIGUOUS_SAME_NAME: { label: 'Trùng tên người khác tỉnh', tone: 'warn' },
  INVALID: { label: 'Không hợp lệ', tone: 'danger' },
};

/** Minimal RFC-4180 CSV reader (quotes, commas, newlines) — workbook → "Save as CSV (UTF-8)" with columns name, province. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export function MembersAdmin() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const query = useQuery<Paged<MRow>>(`/admin/members?page=${page}&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const [preview, setPreview] = useState<{ token: string; rows: PreviewRow[]; counts: Record<string, number> } | null>(null);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [one, setOne] = useState({ name: '', province: '' });

  const onFile = async (file: File) => {
    setErr(undefined);
    setPreview(null);
    try {
      const text = await file.text();
      let rows: { name: string; province: string }[];
      if (file.name.toLowerCase().endsWith('.json')) {
        const j = JSON.parse(text) as { members?: { name: string; oldProvince?: string; province?: string }[] } | { name: string; province: string }[];
        const arr = Array.isArray(j) ? j : (j.members ?? []);
        rows = arr.map((m) => ({ name: String(m.name), province: String((m as { province?: string }).province ?? (m as { oldProvince?: string }).oldProvince ?? '') }));
      } else {
        const t = parseCsv(text);
        const head = t[0]!.map((h) => h.trim().toLowerCase());
        const hasHead = head.includes('name') || head.includes('họ tên') || head.includes('ho ten');
        const ni = hasHead
          ? Math.max(
              0,
              head.findIndex((h) => ['name', 'họ tên', 'ho ten'].includes(h)),
            )
          : 0;
        const pi = hasHead
          ? Math.max(
              1,
              head.findIndex((h) => ['province', 'tỉnh', 'tinh', 'quê quán', 'que quan'].includes(h)),
            )
          : 1;
        rows = (hasHead ? t.slice(1) : t).map((r) => ({ name: r[ni] ?? '', province: r[pi] ?? '' }));
      }
      setBusy(true);
      const r = await post<{ token: string; rows: PreviewRow[]; counts: Record<string, number> }>('/admin/members/import/preview', { rows });
      setPreview(r);
      setConfirmed(new Set());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không đọc được tệp. Dùng CSV UTF-8 (cột name, province) hoặc JSON.');
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const r = await post<{ created: number; skipped: number }>('/admin/members/import/commit', { token: preview!.token, confirmAmbiguous: [...confirmed] });
      toast.success(`Đã thêm ${r.created} học viên, bỏ qua ${r.skipped} dòng.`);
      setPreview(null);
      void query.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không nhập được.');
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    try {
      await post('/admin/members', { name: one.name.trim(), provinceSlug: one.province });
      toast.success('Đã thêm học viên.');
      setOne({ name: '', province: '' });
      void query.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không thêm được.');
    }
  };
  const provinces = useQuery<{ provinces: { slug: string; nameVi: string }[] }>('/map/summary?system=63');

  return (
    <>
      <PageHeader
        title="Học viên & bản đồ"
        description="Danh sách học viên theo quê quán (63 đơn vị trước sắp xếp) — nguồn duy nhất cho bản đồ, trang tỉnh và thống kê. Học viên không phải tài khoản đăng nhập; không ghép theo tên."
      />
      <Panel title="Nhập danh sách (CSV/JSON) — xem trước trước khi lưu">
        <p className="text-sm text-muted">
          Tệp CSV UTF-8 có cột <code>name</code>, <code>province</code> (xuất từ Excel). Hệ thống chuẩn hoá địa danh (ví dụ “TP. THỦ ĐỨC” → TP. Hồ Chí Minh, “ĐẮC LẮK” → Đắk Lắk) và
          báo lỗi theo từng dòng; hai người trùng họ tên + tỉnh không bị tự gộp.
        </p>
        <input
          type="file"
          accept=".csv,.json,text/csv,application/json"
          className="mt-3 block text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onFile(f);
          }}
          data-testid="import-file"
          aria-label="Chọn tệp CSV hoặc JSON"
        />
        {err && (
          <Alert kind="error" className="mt-3">
            {err}
          </Alert>
        )}
        {preview && (
          <div className="mt-4 space-y-3" data-testid="import-preview">
            <p className="flex flex-wrap gap-2 text-sm">
              {Object.entries(preview.counts).map(([k, n]) => (
                <Badge key={k} tone={PSTATUS[k]?.tone}>
                  {PSTATUS[k]?.label}: {n}
                </Badge>
              ))}
            </p>
            <DataTable
              caption="Xem trước nhập"
              rowKey={(r) => String(r.row)}
              rows={preview.rows.filter((r) => r.status !== 'OK').slice(0, 200)}
              columns={[
                { key: 'r', header: 'Dòng', cell: (r) => r.row },
                { key: 'n', header: 'Họ tên', cell: (r) => r.name },
                { key: 'p', header: 'Tỉnh (nguồn)', cell: (r) => r.province },
                {
                  key: 's',
                  header: 'Kết quả',
                  cell: (r) => (
                    <>
                      <Badge tone={PSTATUS[r.status]?.tone}>{PSTATUS[r.status]?.label}</Badge>
                      <p className="mt-1 text-xs text-muted">{r.message}</p>
                    </>
                  ),
                },
                {
                  key: 'c',
                  header: 'Xác nhận',
                  cell: (r) =>
                    r.status === 'AMBIGUOUS_SAME_NAME' ? (
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={confirmed.has(r.row)}
                          onChange={(e) =>
                            setConfirmed((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(r.row);
                              else n.delete(r.row);
                              return n;
                            })
                          }
                        />
                        Là người khác
                      </label>
                    ) : null,
                },
              ]}
            />
            <div className="flex gap-2">
              <Button loading={busy} onClick={() => void commit()} disabled={(preview.counts.OK ?? 0) + confirmed.size === 0}>
                Nhập {(preview.counts.OK ?? 0) + confirmed.size} dòng hợp lệ
              </Button>
              <Button variant="outline" onClick={() => setPreview(null)}>
                Hủy
              </Button>
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Thêm một học viên">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Họ tên" className="w-64">
            {(p) => <Input {...p} value={one.name} maxLength={120} onChange={(e) => setOne({ ...one, name: e.target.value })} />}
          </Field>
          <Field label="Quê quán (63 đơn vị)" className="w-64">
            {(p) => (
              <Select {...p} value={one.province} onChange={(e) => setOne({ ...one, province: e.target.value })}>
                <option value="">— Chọn —</option>
                {provinces.data?.provinces.map((x) => (
                  <option key={x.slug} value={x.slug}>
                    {x.nameVi}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button disabled={!one.name.trim() || !one.province} onClick={() => void add()}>
            Thêm
          </Button>
        </div>
      </Panel>
      <Field label="Tìm học viên" className="w-72">
        {(p) => (
          <Input
            {...p}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Có hoặc không dấu"
          />
        )}
      </Field>
      <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <DataTable
              caption="Học viên"
              rows={d.items}
              columns={[
                { key: 'n', header: 'Họ tên', cell: (m) => m.fullName },
                { key: 'p', header: 'Quê quán', cell: (m) => m.legacyProvince.nameVi },
                {
                  key: 's',
                  header: 'Trạng thái',
                  cell: (m) => (
                    <span className="flex gap-1.5">
                      <Badge tone={m.status === 'ACTIVE' ? 'ok' : 'neutral'}>{m.status === 'ACTIVE' ? 'Hoạt động' : 'Lưu trữ'}</Badge>
                      {!m.isPublic && <Badge tone="warn">Ẩn</Badge>}
                    </span>
                  ),
                },
                {
                  key: 'a',
                  header: '',
                  cell: (m) => (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await patch(`/admin/members/${m.id}`, { isPublic: !m.isPublic });
                          void query.reload();
                        }}
                      >
                        {m.isPublic ? 'Ẩn' : 'Hiện'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await patch(`/admin/members/${m.id}`, { status: m.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' });
                          void query.reload();
                        }}
                      >
                        {m.status === 'ACTIVE' ? 'Lưu trữ' : 'Khôi phục'}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
            <Pager page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
    </>
  );
}

// ───────────────────────── directory ─────────────────────────
interface DRow {
  id: string;
  name: string;
  role: string;
  verification: string;
  source: string;
  province: { slug: string; nameVi: string };
}
const VER: Record<string, { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  UNVERIFIED_SAMPLE: { label: 'Chưa xác minh (dữ liệu mẫu)', tone: 'warn' },
  VERIFIED: { label: 'Đã xác minh — hiển thị công khai', tone: 'ok' },
  HIDDEN: { label: 'Ẩn', tone: 'neutral' },
};
export function DirectoryAdmin() {
  const [province, setProvince] = useState('');
  const query = useQuery<DRow[]>(`/admin/directory${province ? `?province=${province}` : ''}`);
  const provinces = useQuery<{ provinces: { slug: string; nameVi: string }[] }>('/map/summary?system=63');
  return (
    <>
      <PageHeader
        title="Danh bạ tỉnh"
        description="Dữ liệu danh bạ nhập từ website cũ có dấu hiệu là dữ liệu mẫu (tên lặp giữa các tỉnh). Mặc định KHÔNG hiển thị công khai; chỉ mục “Đã xác minh” xuất hiện trên trang /tinh/…"
      />
      <Field label="Lọc theo tỉnh" className="w-64">
        {(p) => (
          <Select {...p} value={province} onChange={(e) => setProvince(e.target.value)}>
            <option value="">Tất cả</option>
            {provinces.data?.provinces.map((x) => (
              <option key={x.slug} value={x.slug}>
                {x.nameVi}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <QueryBoundary q={query} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption="Danh bạ"
            rows={rows}
            columns={[
              { key: 'p', header: 'Tỉnh', cell: (r) => r.province.nameVi },
              { key: 'n', header: 'Tên', cell: (r) => r.name },
              { key: 'r', header: 'Vai trò', cell: (r) => r.role },
              {
                key: 'v',
                header: 'Xác minh',
                cell: (r) => (
                  <Select
                    aria-label={`Xác minh ${r.name}`}
                    className="h-9 w-72 py-1 text-sm"
                    value={r.verification}
                    onChange={async (e) => {
                      try {
                        await patch(`/admin/directory/${r.id}`, { verification: e.target.value });
                        toast.success('Đã cập nhật.');
                        void query.reload();
                      } catch (x) {
                        toast.error(x instanceof ApiError ? x.message : 'Thất bại.');
                      }
                    }}
                  >
                    {Object.entries(VER).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                ),
              },
            ]}
          />
        )}
      </QueryBoundary>
    </>
  );
}

// ───────────────────────── settings ─────────────────────────
type FieldDef = { path: string; label: string; kind?: 'text' | 'area' | 'lines'; hint?: string };
const GROUPS: { key: 'brand' | 'contact' | 'home' | 'social'; title: string; fields: FieldDef[] }[] = [
  {
    key: 'contact',
    title: 'Thông tin liên hệ',
    fields: [
      { path: 'addressVi', label: 'Địa chỉ (VI)' },
      { path: 'addressEn', label: 'Address (EN)' },
      { path: 'phone', label: 'Điện thoại' },
      { path: 'phoneNoteVi', label: 'Ghi chú điện thoại (VI)' },
      { path: 'phoneNoteEn', label: 'Phone note (EN)' },
      { path: 'email', label: 'Email liên hệ' },
      { path: 'hoursVi', label: 'Giờ làm việc (VI) — mỗi dòng một mục', kind: 'lines' },
      { path: 'hoursEn', label: 'Office hours (EN) — one per line', kind: 'lines' },
      { path: 'mapUrl', label: 'Liên kết bản đồ (https)' },
    ],
  },
  {
    key: 'social',
    title: 'Mạng xã hội',
    fields: [
      { path: 'facebook', label: 'Facebook (URL)' },
      { path: 'youtube', label: 'YouTube (URL)' },
      { path: 'tiktok', label: 'TikTok (URL)' },
    ],
  },
  {
    key: 'brand',
    title: 'Thương hiệu',
    fields: [
      { path: 'siteNameVi', label: 'Tên ngắn (VI)' },
      { path: 'siteNameEn', label: 'Short name (EN)' },
      { path: 'fullNameVi', label: 'Tên đầy đủ (VI)' },
      { path: 'fullNameEn', label: 'Full name (EN)' },
      { path: 'orgVi', label: 'Tổ chức (VI)' },
      { path: 'orgEn', label: 'Organisation (EN)' },
      { path: 'sloganVi', label: 'Khẩu hiệu (VI)' },
      { path: 'sloganEn', label: 'Slogan (EN)' },
      { path: 'locationVi', label: 'Vị trí thanh trên (VI)' },
      { path: 'locationEn', label: 'Top-bar location (EN)' },
    ],
  },
  {
    key: 'home',
    title: 'Trang chủ — phần đầu (hero) & sứ mệnh',
    fields: [
      { path: 'hero.badgeVi', label: 'Huy hiệu (VI)' },
      { path: 'hero.badgeEn', label: 'Badge (EN)' },
      { path: 'hero.titleLeadVi', label: 'Tiêu đề — phần đầu (VI)' },
      { path: 'hero.titleHighlightVi', label: 'Tiêu đề — phần nhấn (VI)' },
      { path: 'hero.titleLeadEn', label: 'Title lead (EN)' },
      { path: 'hero.titleHighlightEn', label: 'Title highlight (EN)' },
      { path: 'hero.descVi', label: 'Mô tả (VI)', kind: 'area' },
      { path: 'hero.descEn', label: 'Description (EN)', kind: 'area' },
      {
        path: 'hero.stats.2.value',
        label: 'Số liệu “Năm khuyến học” (cần xác nhận nguồn)',
        hint: 'Giá trị gốc “20+” chưa có nguồn dữ liệu; hai số còn lại tự tính từ cơ sở dữ liệu.',
      },
      { path: 'mission.titleVi', label: 'Sứ mệnh — tiêu đề (VI)' },
      { path: 'mission.titleEn', label: 'Mission title (EN)' },
      { path: 'mission.descVi', label: 'Sứ mệnh — mô tả (VI)', kind: 'area' },
      { path: 'mission.descEn', label: 'Mission description (EN)', kind: 'area' },
    ],
  },
];
const getPath = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((a, k) => (a == null ? a : (a as Record<string, unknown>)[k]), o);
const setPath = (o: Record<string, unknown>, path: string, v: unknown): Record<string, unknown> => {
  const clone = structuredClone(o);
  const keys = path.split('.');
  let cur: Record<string, unknown> = clone;
  keys.slice(0, -1).forEach((k) => {
    cur = (cur[k] ??= {}) as Record<string, unknown>;
  });
  cur[keys[keys.length - 1]!] = v;
  return clone;
};

export function SettingsAdmin() {
  const query = useQuery<Record<string, Record<string, unknown>>>('/settings/public');
  return (
    <>
      <PageHeader
        title="Cài đặt & nội dung trang chủ"
        description="Chỉ các khóa được phép (thương hiệu, liên hệ, trang chủ, mạng xã hội). Thay đổi có hiệu lực ngay trên website."
      />
      <QueryBoundary q={query}>
        {(data) => (
          <>
            {GROUPS.map((g) => (
              <SettingsGroup key={g.key} g={g} initial={data[g.key] ?? {}} />
            ))}
          </>
        )}
      </QueryBoundary>
    </>
  );
}
function SettingsGroup({ g, initial }: { g: (typeof GROUPS)[number]; initial: Record<string, unknown> }) {
  const [v, setV] = useState<Record<string, unknown>>(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await put(`/admin/settings/${g.key}`, { value: v });
      toast.success(`Đã lưu: ${g.title}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title={g.title}
      actions={
        <Button size="sm" loading={busy} onClick={() => void save()}>
          Lưu
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {g.fields.map((f) => {
          const raw = getPath(v, f.path);
          const text = Array.isArray(raw) ? (raw as string[]).join('\n') : String(raw ?? '');
          return (
            <Field key={f.path} label={f.label} hint={f.hint} className={f.kind === 'area' || f.kind === 'lines' ? 'md:col-span-2' : ''}>
              {(p) =>
                f.kind === 'area' || f.kind === 'lines' ? (
                  <Textarea
                    {...p}
                    rows={f.kind === 'lines' ? 3 : 3}
                    value={text}
                    onChange={(e) =>
                      setV(
                        setPath(
                          v,
                          f.path,
                          f.kind === 'lines'
                            ? e.target.value
                                .split('\n')
                                .map((s) => s.trim())
                                .filter(Boolean)
                            : e.target.value,
                        ),
                      )
                    }
                  />
                ) : (
                  <Input {...p} value={text} onChange={(e) => setV(setPath(v, f.path, g.key === 'social' && !e.target.value ? null : e.target.value))} />
                )
              }
            </Field>
          );
        })}
      </div>
    </Panel>
  );
}

// ───────────────────────── redirects / audit / migration ─────────────────────────
interface RRow {
  id: string;
  fromPath: string;
  fromQuery: string | null;
  toPath: string;
  statusCode: number;
  source: string;
  createdAt: string;
}
export function RedirectsAdmin() {
  const [page, setPage] = useState(1);
  const query = useQuery<Paged<RRow>>(`/admin/redirects?page=${page}&pageSize=25`);
  const [f, setF] = useState({ fromPath: '', toPath: '', statusCode: '301' });
  const [err, setErr] = useState<string>();
  const add = async () => {
    setErr(undefined);
    try {
      await post('/admin/redirects', { fromPath: f.fromPath, toPath: f.toPath, statusCode: Number(f.statusCode) });
      setF({ fromPath: '', toPath: '', statusCode: '301' });
      void query.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message) : 'Không tạo được.');
    }
  };
  return (
    <>
      <PageHeader
        title="Chuyển hướng URL cũ"
        description="Chỉ chấp nhận đường dẫn nội bộ; chặn vòng lặp và chuyển hướng ra ngoài. Phần lớn bản ghi được tạo tự động từ dữ liệu WordPress khi di chuyển."
      />
      <Panel title="Thêm chuyển hướng">
        {err && (
          <Alert kind="error" className="mb-3">
            {err}
          </Alert>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Từ (đường dẫn cũ)" className="w-64">
            {(p) => <Input {...p} placeholder="/duong-dan-cu" value={f.fromPath} onChange={(e) => setF({ ...f, fromPath: e.target.value })} />}
          </Field>
          <Field label="Đến (đường dẫn mới)" className="w-64">
            {(p) => <Input {...p} placeholder="/bai-viet/slug-moi" value={f.toPath} onChange={(e) => setF({ ...f, toPath: e.target.value })} />}
          </Field>
          <Field label="Mã" className="w-28">
            {(p) => (
              <Select {...p} value={f.statusCode} onChange={(e) => setF({ ...f, statusCode: e.target.value })}>
                <option>301</option>
                <option>302</option>
                <option>307</option>
                <option>308</option>
              </Select>
            )}
          </Field>
          <Button disabled={!f.fromPath || !f.toPath} onClick={() => void add()}>
            Thêm
          </Button>
        </div>
      </Panel>
      <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <DataTable
              caption="Chuyển hướng"
              rows={d.items}
              columns={[
                {
                  key: 'f',
                  header: 'Từ',
                  cell: (r) => (
                    <code className="text-xs">
                      {r.fromPath}
                      {r.fromQuery ? `?${r.fromQuery}` : ''}
                    </code>
                  ),
                },
                { key: 't', header: 'Đến', cell: (r) => <code className="text-xs">{r.toPath}</code> },
                { key: 's', header: 'Mã', cell: (r) => r.statusCode },
                { key: 'o', header: 'Nguồn', cell: (r) => <Badge>{r.source === 'LEGACY_MIGRATION' ? 'Di chuyển WP' : 'Quản trị'}</Badge> },
                {
                  key: 'a',
                  header: '',
                  cell: (r) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await del(`/admin/redirects/${r.id}`);
                        void query.reload();
                      }}
                    >
                      Xóa
                    </Button>
                  ),
                },
              ]}
            />
            <Pager page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
    </>
  );
}

interface ARow {
  id: string;
  at: string;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  requestId: string | null;
}
export function AuditAdmin() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const query = useQuery<Paged<ARow>>(`/admin/audit?page=${page}&pageSize=30${action ? `&action=${encodeURIComponent(action)}` : ''}`);
  return (
    <>
      <PageHeader title="Nhật ký hệ thống" description="Chỉ thêm, không sửa/xóa qua ứng dụng (cơ sở dữ liệu chặn UPDATE/DELETE). Không chứa mật khẩu, token hay nội dung thư." />
      <Field label="Lọc theo hành động (tiền tố)" className="w-72">
        {(p) => (
          <Input
            {...p}
            placeholder="vd. post. hoặc auth.login"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          />
        )}
      </Field>
      <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <DataTable
              caption="Nhật ký"
              rows={d.items}
              columns={[
                { key: 'a', header: 'Thời gian', cell: (r) => fmt(r.at) },
                { key: 'ac', header: 'Hành động', cell: (r) => <strong>{r.action}</strong> },
                { key: 'r', header: 'Vai trò', cell: (r) => r.actorRole ?? '—' },
                {
                  key: 'res',
                  header: 'Đối tượng',
                  cell: (r) => (
                    <code className="text-xs">
                      {r.resourceType}
                      {r.resourceId ? `:${r.resourceId.slice(0, 8)}` : ''}
                    </code>
                  ),
                },
                { key: 's', header: 'Kết quả', cell: (r) => <Badge tone={r.result === 'SUCCESS' ? 'ok' : r.result === 'DENIED' ? 'warn' : 'danger'}>{r.result}</Badge> },
                { key: 'q', header: 'Request', cell: (r) => <code className="text-xs">{r.requestId?.slice(0, 8) ?? ''}</code> },
              ]}
            />
            <Pager page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
    </>
  );
}

export function MigrationAdmin() {
  const query = useQuery<{
    runs: { id: string; mode: string; status: string; startedAt: string; finishedAt: string | null; stats: Record<string, unknown> }[];
    issues: { runId: string; severity: string; code: string; count: number }[];
  }>('/admin/migration');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (query.data?.runs[0]) setOpen(query.data.runs[0].id);
  }, [query.data]);
  return (
    <>
      <PageHeader
        title="Báo cáo di chuyển WordPress"
        description="Các lần chạy dry-run/apply và các vấn đề phát hiện (dữ liệu thiếu, xung đột, nội dung bị loại…). Không có bản ghi nào bị bỏ âm thầm."
      />
      <QueryBoundary q={query} empty={(d) => d.runs.length === 0}>
        {(d) => (
          <>
            <DataTable
              caption="Lần chạy di chuyển"
              rows={d.runs}
              columns={[
                {
                  key: 'i',
                  header: 'Lần chạy',
                  cell: (r) => (
                    <button className="font-mono text-brand-700 hover:underline" onClick={() => setOpen(r.id)}>
                      {r.id.slice(0, 8)}
                    </button>
                  ),
                },
                { key: 'm', header: 'Chế độ', cell: (r) => r.mode },
                { key: 's', header: 'Trạng thái', cell: (r) => <Badge tone={r.status === 'COMPLETED' ? 'ok' : r.status === 'FAILED' ? 'danger' : 'warn'}>{r.status}</Badge> },
                { key: 'a', header: 'Bắt đầu', cell: (r) => fmt(r.startedAt) },
                { key: 'st', header: 'Thống kê', cell: (r) => <code className="text-xs">{JSON.stringify(r.stats).slice(0, 140)}</code> },
              ]}
            />
            {open && (
              <Panel title={`Vấn đề của lần chạy ${open.slice(0, 8)}`}>
                <DataTable
                  caption="Vấn đề"
                  rowKey={(r) => r.code + r.severity}
                  rows={d.issues.filter((i) => i.runId === open) as { runId: string; severity: string; code: string; count: number; id?: string }[]}
                  columns={[
                    {
                      key: 'sev',
                      header: 'Mức',
                      cell: (r) => <Badge tone={r.severity === 'ERROR' ? 'danger' : r.severity === 'WARNING' ? 'warn' : 'neutral'}>{r.severity}</Badge>,
                    },
                    { key: 'c', header: 'Mã', cell: (r) => <code className="text-xs">{r.code}</code> },
                    { key: 'n', header: 'Số bản ghi', cell: (r) => r.count },
                  ]}
                />
              </Panel>
            )}
          </>
        )}
      </QueryBoundary>
    </>
  );
}
