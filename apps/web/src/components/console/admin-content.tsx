'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Badge } from '@/components/ui/misc';
import { RichEditor } from '@/components/site/rich-editor';
import { ApiError, del, get, patch, post, put } from '@/lib/client';
import { DataTable, fmt, PageHeader, Pager, QueryBoundary, useQuery } from './kit';

interface Paged<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}
const STATUS = { DRAFT: 'Nháp', PUBLISHED: 'Đã đăng', PRIVATE: 'Riêng tư' } as const;

// ───────────────────────── events / programs ─────────────────────────
interface CRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  version: number;
  publishedAt: string | null;
  updatedAt: string;
}
interface CDetail {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentHtml: string;
  status: string;
  version: number;
  eventDetail: { startsAt: string | null; endsAt: string | null; locationText: string | null } | null;
  programDetail: { openFrom: string | null; openUntil: string | null; applyUrl: string | null } | null;
  translations: { locale: string; title: string; excerpt: string | null; contentHtml: string }[];
}
const dt = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');

export function ContentAdmin({ kind }: { kind: 'events' | 'programs' }) {
  const label = kind === 'events' ? 'Sự kiện' : 'Chương trình học bổng';
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [removing, setRemoving] = useState<CRow | null>(null);
  const query = useQuery<Paged<CRow>>(`/admin/content/${kind}?page=${page}&pageSize=20`);
  return (
    <>
      <PageHeader
        title={label}
        description="Chỉ hiển thị thông tin thực sự được nhập: thời gian, địa điểm, hạn đăng ký… để trống thì website không hiển thị."
        actions={<Button onClick={() => setEditing('new')}>Thêm mới</Button>}
      />
      <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <DataTable
              caption={label}
              rows={d.items}
              columns={[
                {
                  key: 't',
                  header: 'Tiêu đề',
                  cell: (r) => (
                    <button className="text-left font-semibold text-brand-700 hover:underline" onClick={() => setEditing(r.id)}>
                      {r.title}
                    </button>
                  ),
                },
                {
                  key: 's',
                  header: 'Trạng thái',
                  cell: (r) => <Badge tone={r.status === 'PUBLISHED' ? 'ok' : 'neutral'}>{STATUS[r.status as keyof typeof STATUS] ?? r.status}</Badge>,
                },
                { key: 'u', header: 'Cập nhật', cell: (r) => fmt(r.updatedAt) },
                {
                  key: 'a',
                  header: '',
                  cell: (r) => (
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>
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
      {editing && (
        <ContentDialog
          kind={kind}
          id={editing === 'new' ? null : editing}
          onClose={(changed) => {
            setEditing(null);
            if (changed) void query.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        danger
        title="Xóa mục này?"
        description={removing?.title}
        confirmLabel="Xóa"
        onConfirm={async () => {
          try {
            await del(`/admin/content/item/${removing!.id}`);
            toast.success('Đã xóa.');
            setRemoving(null);
            void query.reload();
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : 'Thất bại.');
          }
        }}
      />
    </>
  );
}

function ContentDialog({ kind, id, onClose }: { kind: 'events' | 'programs'; id: string | null; onClose: (changed?: boolean) => void }) {
  const [loaded, setLoaded] = useState(!id);
  const [version, setVersion] = useState(1);
  const [f, setF] = useState({ title: '', excerpt: '', status: 'DRAFT', html: '', a: '', b: '', c: '' });
  const [en, setEn] = useState({ title: '', excerpt: '', html: '' });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!id) return;
    get<CDetail>(`/admin/content/item/${id}`)
      .then((d) => {
        setVersion(d.version);
        setF({
          title: d.title,
          excerpt: d.excerpt ?? '',
          status: d.status,
          html: d.contentHtml,
          a: dt(d.eventDetail?.startsAt ?? d.programDetail?.openFrom),
          b: dt(d.eventDetail?.endsAt ?? d.programDetail?.openUntil),
          c: d.eventDetail?.locationText ?? d.programDetail?.applyUrl ?? '',
        });
        const t = d.translations.find((x) => x.locale === 'en');
        if (t) setEn({ title: t.title, excerpt: t.excerpt ?? '', html: t.contentHtml });
        setLoaded(true);
      })
      .catch(() => setErr('Không tải được dữ liệu.'));
  }, [id]);
  const save = async () => {
    setBusy(true);
    setErr(undefined);
    const dates = (x: string) => (x ? new Date(x).toISOString() : null);
    const body = {
      title: f.title.trim(),
      excerpt: f.excerpt.trim() || null,
      contentHtml: f.html,
      status: f.status,
      ...(kind === 'events'
        ? { event: { startsAt: dates(f.a), endsAt: dates(f.b), locationText: f.c.trim() || null } }
        : { program: { openFrom: dates(f.a), openUntil: dates(f.b), applyUrl: f.c.trim() || null } }),
    };
    try {
      const saved = id
        ? await patch<{ id: string }>(`/admin/content/item/${id}`, body, { headers: { 'If-Match': `"${version}"` } })
        : await post<{ id: string }>(`/admin/content/${kind}`, body);
      if (en.title.trim()) await put(`/admin/posts/${saved.id}/translations/en`, { title: en.title.trim(), excerpt: en.excerpt.trim() || null, contentHtml: en.html });
      toast.success('Đã lưu.');
      onClose(true);
    } catch (e) {
      setErr(e instanceof ApiError ? (e.code === 'VERSION_CONFLICT' ? 'Mục này vừa được người khác cập nhật. Đóng và mở lại để tải bản mới.' : e.message) : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={id ? 'Sửa nội dung' : 'Thêm nội dung'}>
      {!loaded ? (
        <p>Đang tải…</p>
      ) : (
        <div className="space-y-4">
          {err && <Alert kind="error">{err}</Alert>}
          <Field label="Tiêu đề (VI)" required>
            {(p) => <Input {...p} value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} />}
          </Field>
          <Field label="Tóm tắt">{(p) => <Textarea {...p} rows={2} maxLength={1000} value={f.excerpt} onChange={(e) => setF({ ...f, excerpt: e.target.value })} />}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={kind === 'events' ? 'Bắt đầu (tuỳ chọn)' : 'Mở từ (tuỳ chọn)'}>
              {(p) => <Input {...p} type="datetime-local" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} />}
            </Field>
            <Field label={kind === 'events' ? 'Kết thúc (tuỳ chọn)' : 'Đến hết (tuỳ chọn)'}>
              {(p) => <Input {...p} type="datetime-local" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} />}
            </Field>
          </div>
          <Field label={kind === 'events' ? 'Địa điểm (tuỳ chọn)' : 'Liên kết đăng ký https (tuỳ chọn)'}>
            {(p) => <Input {...p} value={f.c} maxLength={500} onChange={(e) => setF({ ...f, c: e.target.value })} />}
          </Field>
          <Field label="Trạng thái">
            {(p) => (
              <Select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Nội dung</p>
            <RichEditor value={f.html} onChange={(h) => setF((x) => ({ ...x, html: h }))} label="Nội dung" placeholder="" />
          </div>
          <details className="rounded-md border border-line p-3">
            <summary className="cursor-pointer font-semibold">Bản tiếng Anh (tuỳ chọn)</summary>
            <div className="mt-3 space-y-3">
              <Field label="Title (EN)">{(p) => <Input {...p} value={en.title} onChange={(e) => setEn({ ...en, title: e.target.value })} />}</Field>
              <Field label="Excerpt (EN)">{(p) => <Textarea {...p} rows={2} value={en.excerpt} onChange={(e) => setEn({ ...en, excerpt: e.target.value })} />}</Field>
              <div>
                <p className="mb-1.5 text-sm font-semibold">Content (EN)</p>
                <RichEditor value={en.html} onChange={(h) => setEn((x) => ({ ...x, html: h }))} label="Content (EN)" placeholder="" />
              </div>
            </div>
          </details>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onClose()}>
              Hủy
            </Button>
            <Button loading={busy} disabled={!f.title.trim()} onClick={() => void save()}>
              Lưu
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ───────────────────────── static pages ─────────────────────────
interface PageRow {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  status: string;
  needsReview: boolean;
  updatedAt: string;
  version: number;
}
interface PageDetail extends PageRow {
  contentHtml: string;
  translations: { locale: string; title: string; contentHtml: string }[];
}
export function PagesAdmin() {
  const query = useQuery<PageRow[]>('/admin/pages');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [removing, setRemoving] = useState<PageRow | null>(null);
  return (
    <>
      <PageHeader
        title="Trang tĩnh"
        description="Trang giới thiệu, liên hệ… theo cây cha–con (URL: /trang-cha/trang-con). Trang nhập từ website cũ được gắn “Cần rà soát” cho tới khi bạn sửa."
        actions={<Button onClick={() => setEditing('new')}>Thêm trang</Button>}
      />
      <QueryBoundary q={query} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption="Trang tĩnh"
            rows={rows}
            columns={[
              {
                key: 't',
                header: 'Trang',
                cell: (r) => (
                  <button className="text-left font-semibold text-brand-700 hover:underline" onClick={() => setEditing(r.id)} style={{ paddingLeft: r.parentId ? '1.25rem' : 0 }}>
                    {r.title}
                  </button>
                ),
              },
              {
                key: 'slug',
                header: 'Đường dẫn',
                cell: (r) => <code className="text-xs">{(r.parentId ? `${rows.find((p) => p.id === r.parentId)?.slug ?? '…'}/` : '') + r.slug}</code>,
              },
              {
                key: 's',
                header: 'Trạng thái',
                cell: (r) => (
                  <span className="flex gap-1.5">
                    <Badge tone={r.status === 'PUBLISHED' ? 'ok' : 'neutral'}>{STATUS[r.status as keyof typeof STATUS] ?? r.status}</Badge>
                    {r.needsReview && <Badge tone="warn">Cần rà soát</Badge>}
                  </span>
                ),
              },
              {
                key: 'a',
                header: '',
                cell: (r) => (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>
                    Xóa
                  </Button>
                ),
              },
            ]}
          />
        )}
      </QueryBoundary>
      {editing && query.data && (
        <PageDialog
          id={editing === 'new' ? null : editing}
          pages={query.data}
          onClose={(c) => {
            setEditing(null);
            if (c) void query.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        danger
        title="Xóa trang?"
        description={removing?.title}
        confirmLabel="Xóa"
        onConfirm={async () => {
          try {
            await del(`/admin/pages/${removing!.id}`);
            toast.success('Đã xóa.');
            setRemoving(null);
            void query.reload();
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : 'Thất bại.');
          }
        }}
      />
    </>
  );
}
function PageDialog({ id, pages, onClose }: { id: string | null; pages: PageRow[]; onClose: (c?: boolean) => void }) {
  const [loaded, setLoaded] = useState(!id);
  const [version, setVersion] = useState(1);
  const [f, setF] = useState({ title: '', slug: '', parentId: '', status: 'DRAFT', html: '' });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (id)
      get<PageDetail>(`/admin/pages/${id}`)
        .then((d) => {
          setVersion(d.version);
          setF({ title: d.title, slug: d.slug, parentId: d.parentId ?? '', status: d.status, html: d.contentHtml });
          setLoaded(true);
        })
        .catch(() => setErr('Không tải được trang.'));
  }, [id]);
  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      if (id) await patch(`/admin/pages/${id}`, { title: f.title.trim(), contentHtml: f.html, status: f.status }, { headers: { 'If-Match': `"${version}"` } });
      else await post('/admin/pages', { title: f.title.trim(), slug: f.slug.trim(), parentId: f.parentId || null, contentHtml: f.html, status: f.status });
      toast.success('Đã lưu trang.');
      onClose(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={id ? 'Sửa trang' : 'Thêm trang'}>
      {!loaded ? (
        <p>Đang tải…</p>
      ) : (
        <div className="space-y-4">
          {err && <Alert kind="error">{err}</Alert>}
          <Field label="Tiêu đề" required>
            {(p) => <Input {...p} value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} />}
          </Field>
          {!id && (
            <>
              <Field label="Đường dẫn (slug)" required hint="Chữ thường không dấu, ví dụ gioi-thieu.">
                {(p) => <Input {...p} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />}
              </Field>
              <Field label="Trang cha">
                {(p) => (
                  <Select {...p} value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
                    <option value="">— Không có —</option>
                    {pages
                      .filter((x) => !x.parentId)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.title}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            </>
          )}
          <Field label="Trạng thái">
            {(p) => (
              <Select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Nội dung</p>
            <RichEditor value={f.html} onChange={(h) => setF((x) => ({ ...x, html: h }))} label="Nội dung trang" placeholder="" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onClose()}>
              Hủy
            </Button>
            <Button loading={busy} disabled={!f.title.trim() || (!id && !f.slug.trim())} onClick={() => void save()}>
              Lưu
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ───────────────────────── categories ─────────────────────────
interface Cat {
  id: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  cardType: string;
  isSystem: boolean;
  posts: number;
  translations: { locale: string; name: string; description?: string | null; summary?: string | null; navLabel?: string | null }[];
}
export function CategoriesAdmin() {
  const query = useQuery<{ items: Cat[] }>('/admin/categories');
  const [editing, setEditing] = useState<Cat | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        title="Chuyên mục"
        description="5 chuyên mục chính và 12 mục con là hệ thống (không xóa được); bạn sửa tên, mô tả (VI/EN), kiểu thẻ và thứ tự."
        actions={<Button onClick={() => setAdding(true)}>Thêm mục con</Button>}
      />
      <QueryBoundary q={query}>
        {(d) => (
          <DataTable
            caption="Chuyên mục"
            rows={d.items}
            columns={[
              {
                key: 'n',
                header: 'Tên (VI / EN)',
                cell: (c) => (
                  <button className="text-left font-semibold text-brand-700 hover:underline" style={{ paddingLeft: c.parentId ? '1.25rem' : 0 }} onClick={() => setEditing(c)}>
                    {c.translations.find((t) => t.locale === 'vi')?.name} <span className="font-normal text-muted">/ {c.translations.find((t) => t.locale === 'en')?.name}</span>
                  </button>
                ),
              },
              { key: 's', header: 'Slug', cell: (c) => <code className="text-xs">{c.slug}</code> },
              { key: 'k', header: 'Kiểu thẻ', cell: (c) => c.cardType },
              { key: 'p', header: 'Bài', cell: (c) => c.posts },
              {
                key: 'a',
                header: '',
                cell: (c) =>
                  c.isSystem ? (
                    <Badge>Hệ thống</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await del(`/admin/categories/${c.id}`);
                          toast.success('Đã xóa.');
                          void query.reload();
                        } catch (e) {
                          toast.error(e instanceof ApiError ? e.message : 'Thất bại.');
                        }
                      }}
                    >
                      Xóa
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </QueryBoundary>
      {editing && (
        <CategoryDialog
          cat={editing}
          onClose={(c) => {
            setEditing(null);
            if (c) void query.reload();
          }}
        />
      )}
      {adding && query.data && (
        <NewCategory
          parents={query.data.items.filter((c) => !c.parentId)}
          onClose={(c) => {
            setAdding(false);
            if (c) void query.reload();
          }}
        />
      )}
    </>
  );
}
function CategoryDialog({ cat, onClose }: { cat: Cat; onClose: (c?: boolean) => void }) {
  const tr = (l: string) => cat.translations.find((t) => t.locale === l);
  const [f, setF] = useState({
    viName: tr('vi')?.name ?? '',
    viDesc: tr('vi')?.description ?? '',
    enName: tr('en')?.name ?? '',
    enDesc: tr('en')?.description ?? '',
    cardType: cat.cardType,
    sortOrder: String(cat.sortOrder),
  });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await patch(`/admin/categories/${cat.id}`, {
        cardType: f.cardType,
        sortOrder: Number(f.sortOrder) || 0,
        translations: { vi: { name: f.viName.trim(), description: f.viDesc.trim() || null }, en: { name: f.enName.trim(), description: f.enDesc.trim() || null } },
      });
      toast.success('Đã lưu chuyên mục.');
      onClose(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Chuyên mục: ${cat.slug}`}>
      <div className="space-y-3">
        {err && <Alert kind="error">{err}</Alert>}
        <Field label="Tên (VI)" required>
          {(p) => <Input {...p} value={f.viName} onChange={(e) => setF({ ...f, viName: e.target.value })} />}
        </Field>
        <Field label="Mô tả (VI)">{(p) => <Textarea {...p} rows={2} value={f.viDesc} onChange={(e) => setF({ ...f, viDesc: e.target.value })} />}</Field>
        <Field label="Name (EN)" required>
          {(p) => <Input {...p} value={f.enName} onChange={(e) => setF({ ...f, enName: e.target.value })} />}
        </Field>
        <Field label="Description (EN)">{(p) => <Textarea {...p} rows={2} value={f.enDesc} onChange={(e) => setF({ ...f, enDesc: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kiểu thẻ bài">
            {(p) => (
              <Select {...p} value={f.cardType} onChange={(e) => setF({ ...f, cardType: e.target.value })}>
                <option value="CARD">Thẻ thường</option>
                <option value="PROFILE">Hồ sơ</option>
                <option value="SONG">Bài hát</option>
                <option value="TIP">Bí kíp</option>
              </Select>
            )}
          </Field>
          <Field label="Thứ tự">{(p) => <Input {...p} type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} />}</Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onClose()}>
            Hủy
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Lưu
          </Button>
        </div>
      </div>
    </Modal>
  );
}
function NewCategory({ parents, onClose }: { parents: Cat[]; onClose: (c?: boolean) => void }) {
  const [f, setF] = useState({ slug: '', parentId: parents[0]?.id ?? '', nameVi: '', nameEn: '' });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post('/admin/categories', f);
      toast.success('Đã tạo.');
      onClose(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không tạo được.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Thêm mục con">
      <div className="space-y-3">
        {err && <Alert kind="error">{err}</Alert>}
        <Field label="Chuyên mục chính">
          {(p) => (
            <Select {...p} value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
              {parents.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.translations.find((t) => t.locale === 'vi')?.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Slug" required>
          {(p) => <Input {...p} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />}
        </Field>
        <Field label="Tên (VI)" required>
          {(p) => <Input {...p} value={f.nameVi} onChange={(e) => setF({ ...f, nameVi: e.target.value })} />}
        </Field>
        <Field label="Name (EN)" required>
          {(p) => <Input {...p} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onClose()}>
            Hủy
          </Button>
          <Button loading={busy} disabled={!f.slug || !f.nameVi || !f.nameEn} onClick={() => void save()}>
            Tạo
          </Button>
        </div>
      </div>
    </Modal>
  );
}
