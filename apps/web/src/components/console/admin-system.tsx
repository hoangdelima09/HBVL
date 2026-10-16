'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
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
  status: 'ACTIVE' | 'ARCHIVED';
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

type MemberStatus = 'ACTIVE' | 'ARCHIVED';
type BulkAction = 'hide' | 'show' | 'archive' | 'restore' | 'delete' | 'move';
interface ProvinceOpt {
  slug: string;
  nameVi: string;
}
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
/** API conflict about a namesake (same name in the same or another province): the admin may confirm "different person". */
const isNamesake = (e: unknown) =>
  e instanceof ApiError && e.code === 'CONFLICT' && ['DUPLICATE', 'AMBIGUOUS_SAME_NAME'].includes((e.details as { status?: string } | undefined)?.status ?? '');

function ProvinceSelect({
  provinces,
  value,
  onChange,
  empty = '— Chọn —',
  ...p
}: {
  provinces: ProvinceOpt[];
  value: string;
  onChange: (v: string) => void;
  empty?: string;
  id?: string;
}) {
  return (
    <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {provinces.map((x) => (
        <option key={x.slug} value={x.slug}>
          {x.nameVi}
        </option>
      ))}
    </Select>
  );
}

/** Full control of the map's member list (administrators only): filter, edit name/province/visibility/status, delete, bulk actions, import, export. */
export function MembersAdmin() {
  const provincesQ = useQuery<{ provinces: ProvinceOpt[] }>('/map/summary?system=63');
  const provinces = useMemo(() => [...(provincesQ.data?.provinces ?? [])].sort((a, b) => a.nameVi.localeCompare(b.nameVi, 'vi')), [provincesQ.data]);
  const [filters, setFilters] = useState({ q: '', province: '', status: '', visibility: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filterQs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const query = useQuery<Paged<MRow>>(`/admin/members?page=${page}&pageSize=50${filterQs ? `&${filterQs}` : ''}`);
  const [editing, setEditing] = useState<MRow | null>(null);
  const [deleting, setDeleting] = useState<MRow | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);

  const changeFilter = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
    setSelected(new Set());
  };
  const reload = () => {
    setSelected(new Set());
    void query.reload();
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      reload();
    } catch (e) {
      toast.error(errMsg(e, 'Không thực hiện được.'));
    }
  };
  const runBulk = async (action: BulkAction, provinceSlug?: string) => {
    setBusy(true);
    try {
      const r = await post<{ done: number; failed: { id: string; message: string }[] }>('/admin/members/bulk', { ids: [...selected], action, provinceSlug });
      if (r.failed.length) toast.warning(`Đã xử lý ${r.done} học viên; ${r.failed.length} học viên không chuyển được (${r.failed[0]!.message}).`);
      else toast.success(`Đã xử lý ${r.done} học viên.`);
      setBulkDeleting(false);
      setMoveTo('');
      reload();
    } catch (e) {
      toast.error(errMsg(e, 'Không thực hiện được.'));
    } finally {
      setBusy(false);
    }
  };
  const items = query.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((m) => selected.has(m.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="Học viên & bản đồ"
        description="Danh sách học viên theo quê quán (63 đơn vị trước sắp xếp) — nguồn duy nhất cho bản đồ, trang tỉnh và thống kê. Học viên không phải tài khoản đăng nhập; không ghép theo tên."
        actions={
          <Button asChild variant="outline">
            <a href={`/api/v1/admin/members/export${filterQs ? `?${filterQs}` : ''}`} download data-testid="members-export">
              Xuất CSV (theo bộ lọc)
            </a>
          </Button>
        }
      />
      <MembersImport onDone={reload} />
      <AddMember provinces={provinces} onDone={reload} />

      <Panel title="Danh sách học viên">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Tìm theo tên">
            {(p) => <Input {...p} type="search" value={filters.q} onChange={(e) => changeFilter('q', e.target.value)} placeholder="Có hoặc không dấu" />}
          </Field>
          <Field label="Tỉnh (63 đơn vị)">
            {(p) => <ProvinceSelect {...p} provinces={provinces} value={filters.province} onChange={(v) => changeFilter('province', v)} empty="Tất cả tỉnh" />}
          </Field>
          <Field label="Trạng thái">
            {(p) => (
              <Select {...p} value={filters.status} onChange={(e) => changeFilter('status', e.target.value)}>
                <option value="">Tất cả</option>
                <option value="ACTIVE">Hoạt động</option>
                <option value="ARCHIVED">Lưu trữ</option>
              </Select>
            )}
          </Field>
          <Field label="Hiển thị trên bản đồ">
            {(p) => (
              <Select {...p} value={filters.visibility} onChange={(e) => changeFilter('visibility', e.target.value)}>
                <option value="">Tất cả</option>
                <option value="public">Đang hiện</option>
                <option value="hidden">Đang ẩn</option>
              </Select>
            )}
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-slate-50/70 px-3 py-2.5 text-sm" data-testid="members-bulk">
          <label className="flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={allOnPage}
              disabled={items.length === 0}
              onChange={(e) =>
                setSelected((s) => {
                  const n = new Set(s);
                  for (const m of items) {
                    if (e.target.checked) n.add(m.id);
                    else n.delete(m.id);
                  }
                  return n;
                })
              }
            />
            Chọn cả trang
          </label>
          <span className="text-muted">Đã chọn {selected.size}</span>
          {selected.size > 0 && (
            <>
              <span className="mx-1 h-5 w-px bg-line" aria-hidden />
              <Button size="sm" variant="outline" loading={busy} onClick={() => void runBulk('hide')}>
                Ẩn
              </Button>
              <Button size="sm" variant="outline" loading={busy} onClick={() => void runBulk('show')}>
                Hiện
              </Button>
              <Button size="sm" variant="outline" loading={busy} onClick={() => void runBulk('archive')}>
                Lưu trữ
              </Button>
              <Button size="sm" variant="outline" loading={busy} onClick={() => void runBulk('restore')}>
                Khôi phục
              </Button>
              <ProvinceSelect provinces={provinces} value={moveTo} onChange={setMoveTo} empty="Chuyển tới tỉnh…" />
              <Button size="sm" variant="outline" loading={busy} disabled={!moveTo} onClick={() => void runBulk('move', moveTo)}>
                Chuyển
              </Button>
              <Button size="sm" variant="danger" loading={busy} onClick={() => setBulkDeleting(true)}>
                Xóa
              </Button>
            </>
          )}
        </div>

        <div className="mt-3">
          <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
            {(d) => (
              <>
                <DataTable
                  caption="Học viên"
                  rows={d.items}
                  columns={[
                    {
                      key: 'sel',
                      header: '',
                      className: 'w-10',
                      cell: (m) => <input type="checkbox" aria-label={`Chọn ${m.fullName}`} checked={selected.has(m.id)} onChange={(e) => toggle(m.id, e.target.checked)} />,
                    },
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
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => setEditing(m)} data-testid="member-edit">
                            Sửa
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void act(() => patch(`/admin/members/${m.id}`, { isPublic: !m.isPublic }), m.isPublic ? 'Đã ẩn.' : 'Đã hiện.')}
                          >
                            {m.isPublic ? 'Ẩn' : 'Hiện'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void act(
                                () => patch(`/admin/members/${m.id}`, { status: m.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' }),
                                m.status === 'ACTIVE' ? 'Đã lưu trữ.' : 'Đã khôi phục.',
                              )
                            }
                          >
                            {m.status === 'ACTIVE' ? 'Lưu trữ' : 'Khôi phục'}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-danger-600" onClick={() => setDeleting(m)} data-testid="member-delete">
                            Xóa
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                />
                <Pager
                  page={d.page}
                  totalPages={d.totalPages}
                  total={d.total}
                  onPage={(p) => {
                    setPage(p);
                    setSelected(new Set());
                  }}
                />
              </>
            )}
          </QueryBoundary>
        </div>
      </Panel>

      {editing && (
        <MemberEditDialog
          key={editing.id}
          member={editing}
          provinces={provinces}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Xóa học viên?"
        description={
          deleting ? `Xóa vĩnh viễn "${deleting.fullName}" (${deleting.legacyProvince.nameVi}) khỏi danh sách và bản đồ. Muốn giữ lại hồ sơ thì dùng "Lưu trữ".` : undefined
        }
        confirmLabel="Xóa vĩnh viễn"
        danger
        onConfirm={() => {
          const m = deleting!;
          setDeleting(null);
          void act(() => del(`/admin/members/${m.id}`), 'Đã xóa học viên.');
        }}
      />
      <ConfirmDialog
        open={bulkDeleting}
        onOpenChange={setBulkDeleting}
        title={`Xóa ${selected.size} học viên?`}
        description="Xóa vĩnh viễn các học viên đã chọn khỏi danh sách và bản đồ. Không thể hoàn tác."
        confirmLabel="Xóa vĩnh viễn"
        danger
        loading={busy}
        onConfirm={() => void runBulk('delete')}
      />
    </>
  );
}

function MemberEditDialog({ member, provinces, onClose, onSaved }: { member: MRow; provinces: ProvinceOpt[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ fullName: member.fullName, provinceSlug: member.legacyProvince.slug, status: member.status, isPublic: member.isPublic });
  const [namesake, setNamesake] = useState<string>();
  const [distinct, setDistinct] = useState(false);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr(undefined);
    const body: Record<string, unknown> = {};
    const fullName = form.fullName.replace(/\s+/g, ' ').trim();
    if (fullName !== member.fullName) body.fullName = fullName;
    if (form.provinceSlug !== member.legacyProvince.slug) body.provinceSlug = form.provinceSlug;
    if (form.status !== member.status) body.status = form.status;
    if (form.isPublic !== member.isPublic) body.isPublic = form.isPublic;
    if (Object.keys(body).length === 0) return onClose();
    if (distinct) body.distinct = true;
    setBusy(true);
    try {
      await patch(`/admin/members/${member.id}`, body);
      toast.success('Đã lưu học viên.');
      onSaved();
    } catch (e) {
      if (isNamesake(e)) setNamesake((e as ApiError).message);
      else setErr(errMsg(e, 'Không lưu được.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Sửa học viên" description="Đổi họ tên, quê quán, trạng thái hoặc hiển thị trên bản đồ.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        data-testid="member-edit-form"
      >
        {err && <Alert kind="error">{err}</Alert>}
        <Field label="Họ tên" required>
          {(p) => <Input {...p} value={form.fullName} maxLength={120} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />}
        </Field>
        <Field label="Quê quán (63 đơn vị)" required>
          {(p) => <ProvinceSelect {...p} provinces={provinces} value={form.provinceSlug} onChange={(v) => setForm({ ...form, provinceSlug: v })} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Trạng thái">
            {(p) => (
              <Select {...p} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as MemberStatus })}>
                <option value="ACTIVE">Hoạt động</option>
                <option value="ARCHIVED">Lưu trữ</option>
              </Select>
            )}
          </Field>
          <Field label="Hiển thị trên bản đồ">
            {(p) => (
              <Select {...p} value={form.isPublic ? '1' : '0'} onChange={(e) => setForm({ ...form, isPublic: e.target.value === '1' })}>
                <option value="1">Hiện</option>
                <option value="0">Ẩn</option>
              </Select>
            )}
          </Field>
        </div>
        {namesake && (
          <Alert kind="warning">
            {namesake}
            <label className="mt-2 flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={distinct} onChange={(e) => setDistinct(e.target.checked)} data-testid="member-distinct" />
              Là người khác — vẫn lưu
            </label>
          </Alert>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" loading={busy} disabled={!form.fullName.trim() || !form.provinceSlug || (!!namesake && !distinct)}>
            Lưu
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AddMember({ provinces, onDone }: { provinces: ProvinceOpt[]; onDone: () => void }) {
  const [one, setOne] = useState({ name: '', province: '' });
  const [namesake, setNamesake] = useState<string>();
  const [distinct, setDistinct] = useState(false);
  const set = (v: Partial<typeof one>) => {
    setOne({ ...one, ...v });
    setNamesake(undefined);
    setDistinct(false);
  };
  const add = async () => {
    try {
      await post('/admin/members', { name: one.name.trim(), provinceSlug: one.province, ...(distinct ? { distinct: true } : {}) });
      toast.success('Đã thêm học viên.');
      set({ name: '', province: '' });
      onDone();
    } catch (e) {
      const status = e instanceof ApiError ? (e.details as { status?: string } | undefined)?.status : undefined;
      if (status === 'AMBIGUOUS_SAME_NAME') setNamesake((e as ApiError).message);
      else toast.error(errMsg(e, 'Không thêm được.'));
    }
  };
  return (
    <Panel title="Thêm một học viên">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Họ tên" className="w-64">
          {(p) => <Input {...p} value={one.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />}
        </Field>
        <Field label="Quê quán (63 đơn vị)" className="w-64">
          {(p) => <ProvinceSelect {...p} provinces={provinces} value={one.province} onChange={(v) => set({ province: v })} />}
        </Field>
        <Button disabled={!one.name.trim() || !one.province || (!!namesake && !distinct)} onClick={() => void add()}>
          Thêm
        </Button>
      </div>
      {namesake && (
        <Alert kind="warning" className="mt-3">
          {namesake}
          <label className="mt-2 flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={distinct} onChange={(e) => setDistinct(e.target.checked)} />
            Là người khác — vẫn thêm
          </label>
        </Alert>
      )}
    </Panel>
  );
}

function MembersImport({ onDone }: { onDone: () => void }) {
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<{ token: string; rows: PreviewRow[]; counts: Record<string, number>; replace: boolean; replacing: number } | null>(null);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

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
      const r = await post<NonNullable<typeof preview>>('/admin/members/import/preview', { rows, ...(replace ? { replace: true } : {}) });
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
      const r = await post<{ created: number; skipped: number; deleted: number }>('/admin/members/import/commit', { token: preview!.token, confirmAmbiguous: [...confirmed] });
      toast.success(`Đã thêm ${r.created} học viên, bỏ qua ${r.skipped} dòng${r.deleted ? ` (đã xóa ${r.deleted} học viên cũ)` : ''}.`);
      setPreview(null);
      setConfirmReplace(false);
      onDone();
    } catch (e) {
      setErr(errMsg(e, 'Không nhập được.'));
    } finally {
      setBusy(false);
    }
  };
  const applying = (preview?.counts.OK ?? 0) + confirmed.size;
  return (
    <Panel title="Nhập danh sách (CSV/JSON) — xem trước trước khi lưu">
      <p className="text-sm text-muted">
        Tệp CSV UTF-8 có cột <code>name</code>, <code>province</code> (xuất từ Excel). Hệ thống chuẩn hoá địa danh (ví dụ “TP. THỦ ĐỨC” → TP. Hồ Chí Minh, “ĐẮC LẮK” → Đắk Lắk) và
        báo lỗi theo từng dòng; hai người trùng họ tên + tỉnh không bị tự gộp.
      </p>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={replace}
          onChange={(e) => {
            setReplace(e.target.checked);
            setPreview(null);
          }}
          data-testid="import-replace"
        />
        <span>
          <strong>Thay toàn bộ danh sách</strong> bằng tệp này (xóa mọi học viên hiện có, kể cả đang ẩn/lưu trữ). Nên bấm “Xuất CSV” để sao lưu trước.
        </span>
      </label>
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
          {preview.replace && (
            <Alert kind="warning">
              Chế độ thay toàn bộ: khi nhập, <strong>{preview.replacing}</strong> học viên hiện có sẽ bị xóa và thay bằng {applying} dòng hợp lệ của tệp.
            </Alert>
          )}
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
            <Button
              loading={busy}
              variant={preview.replace ? 'danger' : 'primary'}
              onClick={() => (preview.replace ? setConfirmReplace(true) : void commit())}
              disabled={applying === 0}
            >
              {preview.replace ? `Thay toàn bộ bằng ${applying} dòng` : `Nhập ${applying} dòng hợp lệ`}
            </Button>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Hủy
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmReplace}
        onOpenChange={setConfirmReplace}
        title="Thay toàn bộ danh sách học viên?"
        description={preview ? `${preview.replacing} học viên hiện có sẽ bị xóa vĩnh viễn và thay bằng ${applying} học viên trong tệp. Không thể hoàn tác.` : undefined}
        confirmLabel="Xóa và nhập lại"
        danger
        loading={busy}
        onConfirm={() => void commit()}
      />
    </Panel>
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
      { path: 'mapUrl', label: 'Liên kết Google Maps riêng (để trống = tự tạo từ địa chỉ tiếng Việt)' },
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

// ───────────────────────── redirects / audit ─────────────────────────
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
