'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LIMITS } from '@hbvl/contracts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Skeleton } from '@/components/ui/misc';
import { RichEditor } from '@/components/site/rich-editor';
import { ApiError, del, get, patch, post } from '@/lib/client';
import type { CategoryNode } from '@/lib/types';
import { fmt, Panel, PageHeader, StatusBadge } from './kit';

interface Detail {
  id: string;
  status: string;
  version: number;
  title: string;
  contentHtml: string;
  categoryId: string | null;
  slug: string | null;
  featured: { id: string; card: string } | null;
  author: { id: string; displayName: string } | null;
  submittedAt: string | null;
  publishedAt: string | null;
  needsReview: boolean;
  history: {
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    postVersion: number;
    createdAt: string;
    actor: { displayName: string; role: string } | null;
  }[];
}
const ACTION: Record<string, string> = {
  CREATE: 'Tạo bài',
  SAVE_DRAFT: 'Lưu nháp',
  SUBMIT: 'Gửi duyệt',
  STAFF_EDIT: 'Biên tập',
  REQUEST_CHANGES: 'Yêu cầu sửa',
  REJECT: 'Từ chối',
  PUBLISH: 'Xuất bản',
  UNPUBLISH: 'Thu hồi',
  ADMIN_EDIT: 'Quản trị sửa',
  DELETE: 'Xóa',
  RESTORE: 'Khôi phục',
};

/** Shared review screen. Collaborators and admins have the same controls; the server refuses a collaborator anything that belongs to an administrator. */
export function PostReview({ id, area }: { id: string; area: 'admin' | 'staff' }) {
  const router = useRouter();
  const [post, setPost] = useState<Detail | null>(null);
  const [error, setError] = useState<string>();
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [html, setHtml] = useState('');
  const [key, setKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'error' | 'warning' | 'success'; text: string }>();
  const [dialog, setDialog] = useState<null | 'changes' | 'reject' | 'publish' | 'unpublish' | 'delete'>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();

  const base = area === 'admin' ? '/admin/posts' : '/staff/posts';
  const load = useCallback(async () => {
    try {
      const p = await get<Detail>(`${base}/${id}`);
      setPost(p);
      setTitle(p.title);
      setCategoryId(p.categoryId ?? '');
      setHtml(p.contentHtml);
      setKey((k) => k + 1);
      setBanner(undefined);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'Không tìm thấy bài viết hoặc bạn không có quyền xem.' : 'Không tải được bài viết.');
    }
  }, [base, id]);
  useEffect(() => {
    void load();
    get<{ items: CategoryNode[] }>('/categories?locale=vi')
      .then((r) => setTree(r.items))
      .catch(() => undefined);
  }, [load]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!post) return <Skeleton className="h-96 w-full" />;
  const pending = post.status === 'PENDING_REVIEW';
  const canEdit = post.status !== 'TRASHED';
  const ifm = { 'If-Match': `"${post.version}"` };
  const back = area === 'admin' ? '/admin/bai-viet' : '/cong-tac-vien/bai-viet';

  const run = async (name: string, fn: () => Promise<Detail | void>, ok: string, after?: () => void) => {
    setBusy(name);
    setBanner(undefined);
    try {
      const r = await fn();
      toast.success(ok);
      if (r) {
        setPost((p) => ({ ...(p as Detail), ...r, history: (r as Detail).history ?? p!.history }));
        await load();
      }
      after?.();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT')
        setBanner({ kind: 'warning', text: 'Bài viết vừa được người khác cập nhật. Hãy tải lại phiên bản mới nhất; thay đổi chưa lưu của bạn vẫn đang hiển thị.' });
      else if (e instanceof ApiError && e.code === 'STATE_LOCKED') {
        setBanner({ kind: 'warning', text: 'Trạng thái bài viết đã thay đổi nên thao tác không còn hợp lệ.' });
        await load();
      } else setBanner({ kind: 'error', text: e instanceof ApiError ? e.message : 'Thao tác thất bại.' });
    } finally {
      setBusy(null);
    }
  };
  const save = () => run('save', () => patch<Detail>(`${base}/${id}`, { title, categoryId: categoryId || undefined, contentHtml: html }, { headers: ifm }), 'Đã lưu chỉnh sửa.');
  const needReason = (): boolean => {
    const r = reason.trim();
    if (!r || r.length > LIMITS.reasonMax) {
      setReasonError(`Nhập lý do từ 1 đến ${LIMITS.reasonMax.toLocaleString('vi-VN')} ký tự.`);
      return false;
    }
    setReasonError(undefined);
    return true;
  };

  return (
    <>
      <PageHeader
        title={post.title || '(chưa có tiêu đề)'}
        description={`Người gửi: ${post.author?.displayName ?? '—'} · Gửi lúc ${fmt(post.submittedAt)} · phiên bản ${post.version}`}
        actions={
          <>
            <StatusBadge status={post.status} />
            <Button asChild variant="outline" size="sm">
              <Link href={back}>← Quay lại</Link>
            </Button>
          </>
        }
      />
      {post.needsReview && <Alert kind="warning">Nội dung nhập từ website cũ — chưa được rà soát.</Alert>}
      {banner && (
        <Alert kind={banner.kind}>
          {banner.text}{' '}
          {banner.kind === 'warning' && (
            <button className="font-semibold underline" onClick={() => void load()}>
              Tải lại
            </button>
          )}
        </Alert>
      )}
      <Panel title="Nội dung">
        <div className="space-y-4">
          <Field label="Tiêu đề">{(p) => <Input {...p} value={title} disabled={!canEdit} maxLength={LIMITS.postTitleMax} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Chuyên mục">
            {(p) => (
              <Select {...p} value={categoryId} disabled={!canEdit} onChange={(e) => setCategoryId(e.target.value)}>
                {tree.map((g) => (
                  <optgroup key={g.slug} label={g.name}>
                    {g.children.map((c) => (
                      <option key={c.slug} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Nội dung bài viết</p>
            <RichEditor key={key} value={html} onChange={setHtml} disabled={!canEdit} label="Nội dung bài viết" placeholder="" />
          </div>
          {post.featured && <img src={post.featured.card} alt="Ảnh đại diện" className="h-32 w-56 rounded-md object-cover" />}
          {canEdit && (
            <Button onClick={() => void save()} loading={busy === 'save'} data-testid="save-edit">
              Lưu chỉnh sửa
            </Button>
          )}
        </div>
      </Panel>
      <Panel title="Quyết định">
        <div className="flex flex-wrap gap-3">
          {pending && (
            <Button
              variant="accent"
              onClick={() => {
                setReason('');
                setDialog('changes');
              }}
              data-testid="request-changes"
            >
              Yêu cầu người gửi sửa
            </Button>
          )}
          {pending && (
            <Button onClick={() => setDialog('publish')} data-testid="publish">
              Xuất bản
            </Button>
          )}
          {pending && (
            <Button
              variant="danger"
              onClick={() => {
                setReason('');
                setDialog('reject');
              }}
              data-testid="reject"
            >
              Từ chối
            </Button>
          )}
          {post.status === 'PRIVATE' && <Button onClick={() => setDialog('publish')}>Xuất bản lại</Button>}
          {post.status === 'PUBLISHED' && (
            <Button variant="outline" onClick={() => setDialog('unpublish')}>
              Thu hồi bài
            </Button>
          )}
          {post.status !== 'TRASHED' && (
            <Button variant="ghost" onClick={() => setDialog('delete')}>
              Xóa bài
            </Button>
          )}
          {post.status === 'TRASHED' && (
            <Button variant="outline" loading={busy === 'restore'} onClick={() => void run('restore', () => post_(`${base}/${id}/restore`, ifm), 'Đã khôi phục về nháp.')}>
              Khôi phục
            </Button>
          )}
          {post.status === 'PUBLISHED' && post.slug && (
            <Button asChild variant="secondary">
              <Link href={`/bai-viet/${post.slug}`} target="_blank">
                Xem trên website
              </Link>
            </Button>
          )}
        </div>
      </Panel>
      <Panel title="Lịch sử xử lý">
        <ol className="space-y-3 text-sm">
          {post.history.map((h) => (
            <li key={h.id} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{ACTION[h.action] ?? h.action}</strong>
                <span className="text-muted">
                  {h.actor?.displayName ?? 'Hệ thống'} · {fmt(h.createdAt)} · v{h.postVersion}
                </span>
              </div>
              {h.reason && <p className="mt-1 whitespace-pre-wrap text-ink-2">{h.reason}</p>}
            </li>
          ))}
        </ol>
      </Panel>

      <ConfirmDialog
        open={dialog === 'changes' || dialog === 'reject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'reject' ? 'Từ chối bài viết' : 'Yêu cầu người gửi chỉnh sửa'}
        description="Lý do bắt buộc (1–2.000 ký tự) và sẽ hiển thị cho người gửi."
        confirmLabel={dialog === 'reject' ? 'Từ chối' : 'Gửi yêu cầu'}
        danger={dialog === 'reject'}
        loading={busy === 'decision'}
        onConfirm={() => {
          if (!needReason()) return;
          const d = dialog!;
          void run(
            'decision',
            () => post_(d === 'reject' ? `${base}/${id}/reject` : `${base}/${id}/request-changes`, ifm, { reason: reason.trim() }),
            d === 'reject' ? 'Đã từ chối bài.' : 'Đã gửi yêu cầu chỉnh sửa.',
            () => setDialog(null),
          );
        }}
      >
        <Field label="Lý do" required error={reasonError}>
          {(p) => <Textarea {...p} rows={5} maxLength={LIMITS.reasonMax} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reason" />}
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'publish'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Xuất bản bài viết?"
        description="Bài viết và ảnh đi kèm sẽ hiển thị công khai ngay."
        confirmLabel="Xuất bản"
        loading={busy === 'publish'}
        onConfirm={() =>
          void run(
            'publish',
            () => post_(`${base}/${id}/publish`, ifm),
            'Đã xuất bản.',
            () => setDialog(null),
          )
        }
      />
      <ConfirmDialog
        open={dialog === 'unpublish'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Thu hồi bài đã đăng?"
        description="Bài sẽ biến mất khỏi website và ảnh quay về riêng tư."
        confirmLabel="Thu hồi"
        danger
        loading={busy === 'unpublish'}
        onConfirm={() =>
          void run(
            'unpublish',
            () => post_(`${base}/${id}/unpublish`, ifm),
            'Đã thu hồi.',
            () => setDialog(null),
          )
        }
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Xóa bài viết?"
        description="Bài được chuyển vào thùng rác (có thể khôi phục) và không còn hiển thị."
        confirmLabel="Xóa"
        danger
        loading={busy === 'delete'}
        onConfirm={() =>
          void run(
            'delete',
            () => del<Detail>(`${base}/${id}`, { headers: ifm }),
            'Đã xóa.',
            () => {
              setDialog(null);
              router.push(back);
            },
          )
        }
      />
    </>
  );
}
const post_ = (path: string, headers: Record<string, string>, body?: unknown) => post<Detail>(path, body, { headers });
