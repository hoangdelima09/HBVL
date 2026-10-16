'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Badge } from '@/components/ui/misc';
import { ApiError, patch } from '@/lib/client';
import { DataTable, fmt, PageHeader, Pager, Panel, POST_STATUS, QueryBoundary, Stat, StatusBadge, useQuery } from './kit';

interface Paged<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}

// ───────────────────────── posts ─────────────────────────
interface PostRow {
  id: string;
  title: string;
  status: string;
  author: { displayName: string } | null;
  updatedAt: string;
  submittedAt: string | null;
  needsReview: boolean;
}
export function PostsList({ area, queue }: { area: 'admin' | 'staff'; queue?: boolean }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const listBase = area === 'admin' ? '/admin/posts' : '/staff/posts';
  const path = queue
    ? `/staff/review-queue?page=${page}&pageSize=15`
    : `${listBase}?page=${page}&pageSize=15${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const query = useQuery<Paged<PostRow>>(path);
  const href = (id: string) => (area === 'admin' ? `/admin/bai-viet/${id}` : `/cong-tac-vien/bai/${id}`);
  return (
    <>
      <PageHeader
        title={queue ? 'Hàng chờ duyệt' : 'Bài viết'}
        description={
          queue
            ? 'Các bài đang chờ biên tập, theo thứ tự gửi (cũ nhất trước).'
            : area === 'admin'
              ? 'Tất cả bài viết, lọc theo trạng thái.'
              : 'Duyệt, đăng, thu hồi, từ chối, sửa và xóa bài (trừ bài của quản trị viên; nháp của người khác chưa gửi thì chưa hiển thị).'
        }
      />
      {!queue && (
        <div className="flex flex-wrap gap-3">
          <Field label="Trạng thái" className="w-48">
            {(p) => (
              <Select
                {...p}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Tất cả (trừ đã xóa{area === 'staff' ? ' và nháp' : ''})</option>
                {Object.entries(POST_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tìm theo tiêu đề" className="w-64">
            {(p) => (
              <Input
                {...p}
                type="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            )}
          </Field>
        </div>
      )}
      <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <DataTable
              caption="Danh sách bài viết"
              rows={d.items}
              columns={[
                {
                  key: 't',
                  header: 'Tiêu đề',
                  cell: (r) => (
                    <Link className="font-semibold text-brand-700 hover:underline" href={href(r.id)}>
                      {r.title || '(chưa có tiêu đề)'}
                    </Link>
                  ),
                },
                { key: 'a', header: 'Người gửi', cell: (r) => r.author?.displayName ?? '—' },
                {
                  key: 's',
                  header: 'Trạng thái',
                  cell: (r) => (
                    <span className="inline-flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.needsReview && <Badge tone="warn">Cần rà soát</Badge>}
                    </span>
                  ),
                },
                { key: 'u', header: queue ? 'Gửi lúc' : 'Cập nhật', cell: (r) => fmt(queue ? r.submittedAt : r.updatedAt) },
              ]}
            />
            <Pager page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
    </>
  );
}

// ───────────────────────── feedback inbox ─────────────────────────
interface FbRow {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  author: { displayName: string } | null;
  preview: string;
}
interface FbDetail {
  id: string;
  subject: string;
  message: string;
  status: string;
  author: { displayName: string; email: string } | null;
  history: { id: string; toStatus: string; note: string | null; createdAt: string }[];
}
const FB_STATUS: Record<string, string> = { NEW: 'Mới', IN_PROGRESS: 'Đang xử lý', RESOLVED: 'Đã xử lý' };

export function FeedbackInbox() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  // A notification links here with ?open=<id>: the feedback opens straight away (and that counts as reading it).
  const [openId, setOpenId] = useState<string | null>(useSearchParams().get('open'));
  const query = useQuery<Paged<FbRow>>(`/staff/feedback?page=${page}&pageSize=15${status ? `&status=${status}` : ''}`);
  return (
    <>
      <PageHeader title="Ý kiến thành viên" description="Hộp thư riêng tư: chỉ cộng tác viên và quản trị viên đọc được. Nội dung gốc của người gửi không bị sửa." />
      <Field label="Trạng thái" className="w-52">
        {(p) => (
          <Select
            {...p}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tất cả</option>
            {Object.entries(FB_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <DataTable
              caption="Ý kiến thành viên"
              rows={d.items}
              columns={[
                {
                  key: 's',
                  header: 'Chủ đề',
                  cell: (r) => (
                    <button className="text-left font-semibold text-brand-700 hover:underline" onClick={() => setOpenId(r.id)}>
                      {r.subject}
                    </button>
                  ),
                },
                { key: 'a', header: 'Người gửi', cell: (r) => r.author?.displayName ?? '—' },
                {
                  key: 'st',
                  header: 'Trạng thái',
                  cell: (r) => <Badge tone={r.status === 'NEW' ? 'brand' : r.status === 'RESOLVED' ? 'ok' : 'warn'}>{FB_STATUS[r.status]}</Badge>,
                },
                { key: 'd', header: 'Nhận lúc', cell: (r) => fmt(r.createdAt) },
              ]}
            />
            <Pager page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
      {openId && (
        <FeedbackDialog
          id={openId}
          onClose={() => {
            setOpenId(null);
            void query.reload();
          }}
        />
      )}
    </>
  );
}

function FeedbackDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<FbDetail>(`/staff/feedback/${id}`);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const d = q.data;
  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await patch(`/staff/feedback/${id}`, { status: status || d!.status, note: note.trim() || undefined });
      toast.success('Đã cập nhật.');
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={d?.subject ?? 'Ý kiến'} description={d?.author ? `Từ ${d.author.displayName}` : undefined}>
      {!d ? (
        <p>Đang tải…</p>
      ) : (
        <div className="space-y-4">
          <div className="whitespace-pre-wrap break-words rounded-md bg-paper p-3" data-testid="feedback-message">
            {d.message}
          </div>
          <Field label="Trạng thái xử lý">
            {(p) => (
              <Select {...p} value={status || d.status} onChange={(e) => setStatus(e.target.value)}>
                {Object.entries(FB_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Ghi chú nội bộ (không gửi cho người gửi)">
            {(p) => <Textarea {...p} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {err && <Alert kind="error">{err}</Alert>}
          <ul className="space-y-1 text-sm text-muted">
            {d.history.map((h) => (
              <li key={h.id}>
                {fmt(h.createdAt)} → {FB_STATUS[h.toStatus]}
                {h.note ? ` — ${h.note}` : ''}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Đóng
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              Lưu
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ───────────────────────── comments ─────────────────────────
interface CRow {
  id: string;
  body: string;
  status: string;
  authorName: string;
  authorRole: string | null;
  createdAt: string;
  post: { title: string; slug: string };
}
export function CommentModeration() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const query = useQuery<Paged<CRow>>(`/staff/comments?page=${page}&pageSize=20${status ? `&status=${status}` : ''}`);
  const act = async (id: string, s: string) => {
    try {
      await patch(`/staff/comments/${id}`, { status: s });
      toast.success('Đã cập nhật bình luận.');
      void query.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    }
  };
  return (
    <>
      <PageHeader title="Kiểm duyệt bình luận" description="Cộng tác viên kiểm duyệt bình luận thường; bình luận của quản trị viên chỉ quản trị viên được sửa/ẩn." />
      <Field label="Trạng thái" className="w-52">
        {(p) => (
          <Select
            {...p}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tất cả</option>
            <option value="APPROVED">Đã duyệt</option>
            <option value="PENDING">Chờ duyệt</option>
            <option value="SPAM">Spam</option>
            <option value="TRASHED">Thùng rác</option>
          </Select>
        )}
      </Field>
      <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <DataTable
              caption="Bình luận"
              rows={d.items}
              columns={[
                {
                  key: 'b',
                  header: 'Bình luận',
                  className: 'max-w-md',
                  cell: (r) => (
                    <>
                      <p className="whitespace-pre-wrap break-words">{r.body}</p>
                      <p className="mt-1 text-xs text-muted">
                        {r.authorName}
                        {r.authorRole === 'ADMIN' ? ' (quản trị)' : ''} · {fmt(r.createdAt)} · {r.post.title}
                      </p>
                    </>
                  ),
                },
                { key: 's', header: 'Trạng thái', cell: (r) => <Badge tone={r.status === 'APPROVED' ? 'ok' : r.status === 'SPAM' ? 'danger' : 'neutral'}>{r.status}</Badge> },
                {
                  key: 'a',
                  header: 'Thao tác',
                  cell: (r) => (
                    <div className="flex flex-wrap gap-1.5">
                      {['APPROVED', 'SPAM', 'TRASHED']
                        .filter((s) => s !== r.status)
                        .map((s) => (
                          <Button key={s} size="sm" variant="outline" onClick={() => void act(r.id, s)}>
                            {s === 'APPROVED' ? 'Duyệt' : s === 'SPAM' ? 'Spam' : 'Xóa'}
                          </Button>
                        ))}
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

// ───────────────────────── dashboards ─────────────────────────
export function StaffDashboard() {
  const q = useQuery<{
    pendingReview: number;
    feedbackNew: number;
    commentsPending: number;
    commentsSpam: number;
    reviewedByMe: number;
    openReports: number;
    oldestPendingSince: string | null;
  }>('/staff/dashboard');
  return (
    <>
      <PageHeader title="Bảng điều khiển cộng tác viên" description="Số liệu thời gian thực từ cơ sở dữ liệu." />
      <QueryBoundary q={q}>
        {(d) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="Bài chờ duyệt" value={d.pendingReview} href="/cong-tac-vien/hang-cho" tone={d.pendingReview ? 'warn' : undefined} />
            <Stat label="Ý kiến mới" value={d.feedbackNew} href="/cong-tac-vien/gop-y" />
            <Stat label="Bình luận bị tố cáo" value={d.openReports} href="/cong-tac-vien/to-cao" tone={d.openReports ? 'danger' : undefined} />
            <Stat label="Bình luận chờ duyệt" value={d.commentsPending} href="/cong-tac-vien/binh-luan" />
            <Stat label="Bình luận spam" value={d.commentsSpam} href="/cong-tac-vien/binh-luan" />
            <Stat label="Bài tôi đã xử lý" value={d.reviewedByMe} />
            <Stat label="Chờ lâu nhất từ" value={<span className="text-2xl">{fmt(d.oldestPendingSince)}</span>} />
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

export function AdminDashboard() {
  const q = useQuery<{
    users: Record<string, number>;
    posts: Record<string, number>;
    feedback: Record<string, number>;
    contact: Record<string, number>;
    comments: Record<string, number>;
    members: number;
    outbox: Record<string, number>;
    contactMailFailed: number;
    accountsAwaitingActivation: number;
    openReports: number;
    mfaRequests: number;
    recentAudit: { id: string; at: string; action: string; resourceType: string; result: string }[];
  }>('/admin/dashboard');
  return (
    <>
      <PageHeader title="Bảng điều khiển quản trị" description="Số liệu thời gian thực từ cơ sở dữ liệu." />
      <QueryBoundary q={q}>
        {(d) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Chờ duyệt" value={d.posts.PENDING_REVIEW ?? 0} href="/admin/bai-viet" tone={d.posts.PENDING_REVIEW ? 'warn' : undefined} />
              <Stat label="Đã đăng" value={d.posts.PUBLISHED ?? 0} />
              <Stat label="Ý kiến mới" value={d.feedback.NEW ?? 0} href="/admin/gop-y" />
              <Stat label="Liên hệ mới" value={d.contact.NEW ?? 0} href="/admin/lien-he" />
              <Stat label="Thành viên" value={d.users.MEMBER ?? 0} href="/admin/nguoi-dung" />
              <Stat label="Cộng tác viên" value={d.users.COLLABORATOR ?? 0} href="/admin/nguoi-dung" />
              <Stat label="Học viên trên bản đồ" value={d.members} href="/admin/hoc-vien" />
              <Stat label="Chờ kích hoạt" value={d.accountsAwaitingActivation} href="/admin/nguoi-dung" />
              <Stat label="Bình luận bị tố cáo" value={d.openReports} href="/admin/to-cao" tone={d.openReports ? 'danger' : undefined} />
              <Stat label="Yêu cầu gỡ xác thực" value={d.mfaRequests} href="/admin/yeu-cau-xac-thuc" tone={d.mfaRequests ? 'warn' : undefined} />
            </div>
            {(d.contactMailFailed > 0 || (d.outbox.DEAD ?? 0) > 0) && (
              <Alert kind="error" title="Email thông báo gặp lỗi">
                {d.contactMailFailed} liên hệ chưa gửi được thông báo; {d.outbox.DEAD ?? 0} email thất bại hẳn. Tin nhắn vẫn được lưu trong hộp thư Liên hệ.
              </Alert>
            )}
            <Panel title="Hoạt động gần đây">
              <ul className="divide-y divide-line text-sm">
                {d.recentAudit.map((a) => (
                  <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      <strong>{a.action}</strong> · {a.resourceType}
                    </span>
                    <span className="text-muted">
                      {fmt(a.at)} · {a.result}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </>
        )}
      </QueryBoundary>
    </>
  );
}
