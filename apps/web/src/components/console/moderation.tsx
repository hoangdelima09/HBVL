'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Badge } from '@/components/ui/misc';
import { ApiError, post } from '@/lib/client';
import { useSession } from '@/lib/session';
import { DataTable, fmt, PageHeader, Pager, Panel, QueryBoundary, useQuery } from './kit';

interface Paged<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}

export const REASON_LABEL: Record<string, string> = {
  SPAM: 'Spam / quảng cáo',
  ABUSE: 'Xúc phạm, quấy rối',
  HATE: 'Thù ghét, phân biệt',
  MISINFO: 'Thông tin sai lệch',
  OTHER: 'Lý do khác',
};
const RESOLUTION_LABEL: Record<string, string> = {
  DISMISS: 'Bỏ qua tố cáo',
  REMOVE_COMMENT: 'Đã gỡ bình luận',
  REMOVE_AND_RESTRICT: 'Gỡ bình luận + hạn chế tài khoản',
  REMOVE_AND_BLOCK: 'Gỡ bình luận + khóa tài khoản',
};
const ROLE: Record<string, string> = { ADMIN: 'Quản trị viên', COLLABORATOR: 'Cộng tác viên', MEMBER: 'Thành viên' };

const DAY_OPTIONS = [
  { v: '1', l: '1 ngày' },
  { v: '3', l: '3 ngày' },
  { v: '7', l: '7 ngày' },
  { v: '30', l: '30 ngày' },
  { v: '90', l: '90 ngày' },
  { v: '', l: 'Cho đến khi gỡ' },
];

// ───────────────────────── reports queue ─────────────────────────
interface ReportItem {
  commentId: string;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';
  reportCount: number;
  reasons: Record<string, number>;
  firstReportedAt: string;
  assignedTo: { id: string; displayName: string } | null;
  handledBy: { id: string; displayName: string } | null;
  handledAt: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  comment: { body: string; status: string; authorId: string | null; authorName: string; authorRole: string | null; post: { id: string; title: string; slug: string } } | null;
  reports: { id: string; reason: string; note: string | null; at: string; reporter: { username: string; displayName: string } | null }[];
}
type Pending = { item: ReportItem; action: 'REMOVE_COMMENT' | 'REMOVE_AND_RESTRICT' | 'REMOVE_AND_BLOCK' | 'DISMISS' } | null;

/**
 * Comment reports. Everyone on the staff gets the notification; whoever acts first handles it: "Nhận xử lý" marks it as theirs and the
 * others see who; a second person acting on a closed or claimed item is told who already did. The list refreshes itself.
 */
export function ReportsQueue() {
  const { user } = useSession();
  const [scope, setScope] = useState<'open' | 'closed'>('open');
  const [page, setPage] = useState(1);
  const query = useQuery<Paged<ReportItem>>(`/staff/reports?scope=${scope}&page=${page}&pageSize=10`);
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState('');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (scope !== 'open') return;
    const t = setInterval(() => void query.reload(), 20_000); // someone else may have taken it meanwhile
    return () => clearInterval(t);
  }, [scope, query]);

  const fail = (e: unknown) => {
    toast.error(e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    void query.reload();
  };
  const claim = async (id: string) => {
    try {
      await post(`/staff/reports/${id}/claim`);
      toast.success('Bạn đang xử lý tố cáo này.');
      void query.reload();
    } catch (e) {
      fail(e);
    }
  };
  const resolve = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await post(`/staff/reports/${pending.item.commentId}/resolve`, {
        action: pending.action,
        ...(pending.action === 'REMOVE_AND_RESTRICT' && days ? { days: Number(days) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success('Đã xử lý tố cáo.');
      setPending(null);
      setNote('');
      void query.reload();
    } catch (e) {
      setPending(null);
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const canPunishAuthor = (i: ReportItem) => !!i.comment?.authorId && (user?.role === 'ADMIN' || i.comment.authorRole === 'MEMBER');

  const title: Record<string, string> = {
    DISMISS: 'Bỏ qua tố cáo?',
    REMOVE_COMMENT: 'Gỡ bình luận?',
    REMOVE_AND_RESTRICT: 'Gỡ bình luận và hạn chế tài khoản?',
    REMOVE_AND_BLOCK: 'Gỡ bình luận và khóa tài khoản?',
  };

  return (
    <>
      <PageHeader
        title="Bình luận bị tố cáo"
        description="Mọi cộng tác viên và quản trị viên đều nhận thông báo; ai xử lý trước thì tố cáo thuộc người đó. Tố cáo về bình luận của quản trị viên chỉ quản trị viên thấy."
      />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Trạng thái tố cáo">
        {(['open', 'closed'] as const).map((s) => (
          <Button
            key={s}
            role="tab"
            aria-selected={scope === s}
            size="sm"
            variant={scope === s ? 'primary' : 'outline'}
            onClick={() => {
              setScope(s);
              setPage(1);
            }}
          >
            {s === 'open' ? 'Chờ xử lý' : 'Đã xử lý'}
          </Button>
        ))}
      </div>
      <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <ul className="space-y-4" data-testid="report-list">
              {d.items.map((i) => {
                const mine = i.assignedTo?.id === user?.id;
                const claimedByOther = i.status === 'IN_REVIEW' && !mine;
                const closed = i.status === 'RESOLVED' || i.status === 'DISMISSED';
                return (
                  <li key={i.commentId} className="rounded-xl border border-line bg-white p-5 shadow-card" data-testid="report-item">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={closed ? 'neutral' : i.status === 'IN_REVIEW' ? 'warn' : 'danger'}>
                        {closed
                          ? (RESOLUTION_LABEL[i.resolution ?? ''] ?? 'Đã xử lý')
                          : i.status === 'IN_REVIEW'
                            ? `Đang xử lý: ${i.assignedTo?.displayName ?? ''}`
                            : 'Chưa ai xử lý'}
                      </Badge>
                      <Badge tone="brand">{i.reportCount} tố cáo</Badge>
                      {Object.entries(i.reasons).map(([k, n]) => (
                        <Badge key={k} tone="neutral">
                          {REASON_LABEL[k] ?? k}
                          {n > 1 ? ` ×${n}` : ''}
                        </Badge>
                      ))}
                    </div>
                    {i.comment ? (
                      <div className="mt-3 rounded-md bg-paper p-3">
                        <p className="whitespace-pre-wrap break-words" data-testid="report-comment">
                          {i.comment.body}
                        </p>
                        <p className="mt-2 text-xs text-muted">
                          {i.comment.authorName}
                          {i.comment.authorRole ? ` (${ROLE[i.comment.authorRole] ?? i.comment.authorRole})` : ''} · bài{' '}
                          <Link className="font-semibold text-brand-700 hover:underline" href={`/bai-viet/${i.comment.post.slug}`} target="_blank">
                            {i.comment.post.title}
                          </Link>{' '}
                          · báo lần đầu {fmt(i.firstReportedAt)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-muted">Bình luận không còn tồn tại.</p>
                    )}
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer font-semibold text-brand-700">Người tố cáo ({i.reports.length})</summary>
                      <ul className="mt-2 space-y-1 text-muted">
                        {i.reports.map((r) => (
                          <li key={r.id}>
                            {r.reporter?.displayName ?? 'Người dùng đã xóa'} — {REASON_LABEL[r.reason] ?? r.reason}
                            {r.note ? `: “${r.note}”` : ''} · {fmt(r.at)}
                          </li>
                        ))}
                      </ul>
                    </details>
                    {closed ? (
                      <p className="mt-3 text-sm text-muted">
                        Xử lý bởi <strong>{i.handledBy?.displayName ?? '—'}</strong> lúc {fmt(i.handledAt)}
                        {i.resolutionNote ? ` — ${i.resolutionNote}` : ''}
                      </p>
                    ) : (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {i.status === 'OPEN' && (
                          <Button size="sm" variant="outline" onClick={() => void claim(i.commentId)} data-testid="claim">
                            Nhận xử lý
                          </Button>
                        )}
                        {claimedByOther && user?.role !== 'ADMIN' ? (
                          <p className="text-sm text-muted">{i.assignedTo?.displayName} đang xử lý tố cáo này.</p>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setPending({ item: i, action: 'DISMISS' })} data-testid="dismiss">
                              Bỏ qua (tố cáo sai)
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => setPending({ item: i, action: 'REMOVE_COMMENT' })} data-testid="remove">
                              Gỡ bình luận
                            </Button>
                            {canPunishAuthor(i) && (
                              <>
                                <Button size="sm" variant="accent" onClick={() => setPending({ item: i, action: 'REMOVE_AND_RESTRICT' })} data-testid="remove-restrict">
                                  Gỡ + hạn chế
                                </Button>
                                <Button size="sm" variant="danger" onClick={() => setPending({ item: i, action: 'REMOVE_AND_BLOCK' })} data-testid="remove-block">
                                  Gỡ + khóa tài khoản
                                </Button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pager page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? title[pending.action]! : ''}
        description={
          pending?.action === 'DISMISS'
            ? 'Bình luận được giữ nguyên. Các tố cáo về bình luận này được đóng lại.'
            : 'Bình luận biến mất khỏi website (chuyển vào thùng rác) và mọi tố cáo về nó được đóng lại.'
        }
        confirmLabel="Xác nhận"
        danger={pending?.action !== 'DISMISS'}
        loading={busy}
        onConfirm={() => void resolve()}
      >
        <div className="space-y-3">
          {pending?.action === 'REMOVE_AND_RESTRICT' && (
            <Field label="Thời hạn hạn chế">
              {(p) => (
                <Select {...p} value={days} onChange={(e) => setDays(e.target.value)}>
                  {DAY_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label={pending?.action === 'DISMISS' ? 'Ghi chú nội bộ (tuỳ chọn)' : 'Lý do (người dùng sẽ thấy với hạn chế/khóa)'}>
            {(p) => <Textarea {...p} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="resolve-note" />}
          </Field>
        </div>
      </ConfirmDialog>
    </>
  );
}

// ───────────────────────── restrict dialog (shared) ─────────────────────────
export function RestrictDialog({ user, onClose }: { user: { id: string; displayName: string } | null; onClose: (changed: boolean) => void }) {
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const submit = async () => {
    if (!user) return;
    if (!reason.trim()) {
      setErr('Hãy nhập lý do (người dùng sẽ thấy).');
      return;
    }
    setBusy(true);
    setErr(undefined);
    try {
      await post(`/staff/users/${user.id}/restrict`, { reason: reason.trim(), ...(days ? { days: Number(days) } : {}) });
      toast.success('Đã hạn chế tài khoản.');
      setReason('');
      onClose(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không thực hiện được.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      open={!!user}
      onOpenChange={(o) => !o && onClose(false)}
      title={`Hạn chế ${user?.displayName ?? ''}?`}
      description="Người này vẫn đăng nhập và đọc được nhưng không thể bình luận, thích, gửi bài, gửi ý kiến hay liên hệ."
      confirmLabel="Hạn chế"
      loading={busy}
      onConfirm={() => void submit()}
    >
      <div className="space-y-3">
        <Field label="Thời hạn">
          {(p) => (
            <Select {...p} value={days} onChange={(e) => setDays(e.target.value)}>
              {DAY_OPTIONS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Lý do (hiển thị cho người dùng)" required>
          {(p) => <Input {...p} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="restrict-reason" />}
        </Field>
        {err && <Alert kind="error">{err}</Alert>}
      </div>
    </ConfirmDialog>
  );
}

// ───────────────────────── members moderation ─────────────────────────
interface MemberRow {
  id: string;
  username: string;
  displayName: string;
  status: string;
  commentCount: number;
  postCount: number;
  lastLoginAt: string | null;
  restricted: boolean;
  restrictedUntil: string | null;
  restrictionReason: string | null;
}

export function MembersModeration() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const query = useQuery<Paged<MemberRow>>(`/staff/members?page=${page}&pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}${state ? `&state=${state}` : ''}`);
  const [restrict, setRestrict] = useState<MemberRow | null>(null);
  const [block, setBlock] = useState<MemberRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      void query.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    }
  };
  return (
    <>
      <PageHeader
        title="Thành viên"
        description="Hạn chế (vẫn đọc được, không thể bình luận/thích/gửi bài) hoặc khóa (đăng xuất, không đăng nhập được). Cộng tác viên chỉ quản lý tài khoản thành viên."
      />
      <div className="flex flex-wrap gap-3">
        <Field label="Tìm tên / tên đăng nhập" className="w-64">
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
        <Field label="Tình trạng" className="w-48">
          {(p) => (
            <Select
              {...p}
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả</option>
              <option value="ACTIVE">Bình thường</option>
              <option value="RESTRICTED">Đang bị hạn chế</option>
              <option value="BLOCKED">Đã khóa</option>
            </Select>
          )}
        </Field>
      </div>
      <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <DataTable
              caption="Thành viên"
              rows={d.items}
              columns={[
                {
                  key: 'u',
                  header: 'Tài khoản',
                  cell: (r) => (
                    <>
                      <strong>{r.displayName}</strong>
                      <p className="text-xs text-muted">{r.username}</p>
                    </>
                  ),
                },
                {
                  key: 's',
                  header: 'Tình trạng',
                  cell: (r) => (
                    <span className="flex flex-col items-start gap-1">
                      {r.status === 'SUSPENDED' ? (
                        <Badge tone="danger">Đã khóa</Badge>
                      ) : r.restricted ? (
                        <Badge tone="warn">Hạn chế{r.restrictedUntil ? ` đến ${fmt(r.restrictedUntil)}` : ''}</Badge>
                      ) : (
                        <Badge tone="ok">Bình thường</Badge>
                      )}
                      {r.restrictionReason && (r.restricted || r.status === 'SUSPENDED') && <span className="text-xs text-muted">{r.restrictionReason}</span>}
                    </span>
                  ),
                },
                { key: 'c', header: 'Bình luận', cell: (r) => r.commentCount },
                { key: 'p', header: 'Bài viết', cell: (r) => r.postCount },
                { key: 'l', header: 'Đăng nhập cuối', cell: (r) => fmt(r.lastLoginAt) },
                {
                  key: 'a',
                  header: 'Thao tác',
                  cell: (r) => (
                    <div className="flex flex-wrap gap-1.5">
                      {r.status !== 'SUSPENDED' &&
                        (r.restricted ? (
                          <Button size="sm" variant="outline" onClick={() => void act(() => post(`/staff/users/${r.id}/unrestrict`), 'Đã bỏ hạn chế.')}>
                            Bỏ hạn chế
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setRestrict(r)} data-testid="restrict">
                            Hạn chế
                          </Button>
                        ))}
                      {r.status === 'SUSPENDED' ? (
                        <Button size="sm" variant="outline" onClick={() => void act(() => post(`/staff/users/${r.id}/unblock`), 'Đã mở khóa.')}>
                          Mở khóa
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            setReason('');
                            setBlock(r);
                          }}
                          data-testid="block"
                        >
                          Khóa
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
            <Pager page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
      <RestrictDialog
        user={restrict}
        onClose={(changed) => {
          setRestrict(null);
          if (changed) void query.reload();
        }}
      />
      <ConfirmDialog
        open={!!block}
        onOpenChange={(o) => !o && setBlock(null)}
        title={`Khóa ${block?.displayName ?? ''}?`}
        description="Người này bị đăng xuất khỏi mọi thiết bị và không đăng nhập được cho đến khi được mở khóa."
        confirmLabel="Khóa tài khoản"
        danger
        loading={busy}
        onConfirm={async () => {
          if (!block) return;
          if (!reason.trim()) {
            toast.error('Hãy nhập lý do.');
            return;
          }
          setBusy(true);
          await act(() => post(`/staff/users/${block.id}/block`, { reason: reason.trim() }), 'Đã khóa tài khoản.');
          setBusy(false);
          setBlock(null);
        }}
      >
        <Field label="Lý do (lưu trong nhật ký)" required>
          {(p) => <Input {...p} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="block-reason" />}
        </Field>
      </ConfirmDialog>
      <Panel>
        <p className="text-sm text-muted">Mọi thao tác hạn chế/khóa được ghi vào nhật ký hệ thống (ai, khi nào, với ai).</p>
      </Panel>
    </>
  );
}
