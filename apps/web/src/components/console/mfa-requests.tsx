'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Alert, Badge } from '@/components/ui/misc';
import { ApiError, post } from '@/lib/client';
import { fmt, PageHeader, Pager, QueryBoundary, useQuery } from './kit';

interface Row {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
  decisionNote: string | null;
  user: { id: string; username: string; displayName: string; email: string; role: string; mfaEnabled: boolean; lastLoginAt: string | null };
  reviewer: { displayName: string } | null;
}
interface Paged<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}
const ROLE: Record<string, string> = { ADMIN: 'Quản trị viên', COLLABORATOR: 'Cộng tác viên', MEMBER: 'Thành viên' };
const STATUS: Record<Row['status'], { label: string; tone: 'warn' | 'ok' | 'neutral' }> = {
  PENDING: { label: 'Chờ xử lý', tone: 'warn' },
  APPROVED: { label: 'Đã gỡ xác thực', tone: 'ok' },
  REJECTED: { label: 'Đã từ chối', tone: 'neutral' },
};

/**
 * Collaborators and members who lost their authenticator. Each request was made after a correct password AND a code e-mailed to the
 * account address; the administrator still confirms the person through another channel before removing two-factor authentication.
 */
export function MfaRequestsAdmin() {
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING');
  const [page, setPage] = useState(1);
  const q = useQuery<Paged<Row>>(`/admin/mfa-requests?page=${page}&pageSize=20${status ? `&status=${status}` : ''}`);
  const [pending, setPending] = useState<{ row: Row; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const decide = async () => {
    if (!pending) return;
    if (!pending.approve && !note.trim()) {
      setErr('Hãy ghi lý do từ chối (người yêu cầu sẽ nhận qua email).');
      return;
    }
    setBusy(true);
    setErr(undefined);
    try {
      await post(`/admin/mfa-requests/${pending.row.id}/${pending.approve ? 'approve' : 'reject'}`, note.trim() ? { note: note.trim() } : {});
      toast.success(pending.approve ? 'Đã gỡ xác thực 2 lớp và gửi email cho người yêu cầu.' : 'Đã từ chối và gửi email cho người yêu cầu.');
      setPending(null);
      setNote('');
      void q.reload();
    } catch (e) {
      setPending(null);
      toast.error(e instanceof ApiError ? e.message : 'Thao tác thất bại.');
      void q.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Yêu cầu gỡ xác thực 2 lớp"
        description="Cộng tác viên / thành viên mất thiết bị xác thực. Người gửi đã nhập đúng mật khẩu và mã gửi tới email tài khoản. Hãy xác minh qua kênh khác (điện thoại, gặp trực tiếp) trước khi đồng ý."
      />
      <Field label="Trạng thái" className="w-52">
        {(p) => (
          <Select
            {...p}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="PENDING">Chờ xử lý</option>
            <option value="APPROVED">Đã gỡ</option>
            <option value="REJECTED">Đã từ chối</option>
            <option value="">Tất cả</option>
          </Select>
        )}
      </Field>
      <QueryBoundary q={q} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <ul className="space-y-4" data-testid="mfa-request-list">
              {d.items.map((r) => (
                <li key={r.id} className="rounded-xl border border-line bg-white p-5 shadow-card" data-testid="mfa-request">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    <Badge tone="brand">{ROLE[r.user.role] ?? r.user.role}</Badge>
                    {r.status === 'PENDING' && !r.user.mfaEnabled && <Badge tone="neutral">Đã không còn bật xác thực</Badge>}
                  </div>
                  <p className="mt-3 font-semibold">
                    {r.user.displayName}{' '}
                    <span className="font-normal text-muted">
                      · {r.user.username} · {r.user.email}
                    </span>
                  </p>
                  <p className="text-sm text-muted">
                    Gửi lúc {fmt(r.createdAt)} · đăng nhập gần nhất {fmt(r.user.lastLoginAt)}
                  </p>
                  {r.note && <p className="mt-2 whitespace-pre-wrap rounded-md bg-paper p-3 text-sm">{r.note}</p>}
                  {r.status === 'PENDING' ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setPending({ row: r, approve: true })} data-testid="mfa-approve">
                        Gỡ xác thực 2 lớp
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setPending({ row: r, approve: false })} data-testid="mfa-reject">
                        Từ chối
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted">
                      Xử lý bởi <strong>{r.reviewer?.displayName ?? '—'}</strong> lúc {fmt(r.reviewedAt)}
                      {r.decisionNote ? ` — ${r.decisionNote}` : ''}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <Pager page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => {
          if (!o) {
            setPending(null);
            setErr(undefined);
          }
        }}
        title={pending?.approve ? `Gỡ xác thực 2 lớp cho ${pending.row.user.displayName}?` : `Từ chối yêu cầu của ${pending?.row.user.displayName ?? ''}?`}
        description={
          pending?.approve
            ? 'Xác thực 2 lớp và mã khôi phục của tài khoản bị xóa, mọi phiên bị đăng xuất. Người này đăng nhập lại chỉ bằng mật khẩu và được nhắc bật lại. Họ nhận email thông báo.'
            : 'Xác thực 2 lớp giữ nguyên. Người yêu cầu nhận email kèm lý do.'
        }
        confirmLabel={pending?.approve ? 'Gỡ xác thực' : 'Từ chối'}
        danger={pending?.approve}
        loading={busy}
        onConfirm={() => void decide()}
      >
        <Field label={pending?.approve ? 'Ghi chú (tuỳ chọn, gửi kèm email)' : 'Lý do từ chối (bắt buộc, gửi kèm email)'} required={!pending?.approve}>
          {(p) => <Textarea {...p} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="mfa-decision-note" />}
        </Field>
        {err && (
          <Alert kind="error" className="mt-3">
            {err}
          </Alert>
        )}
      </ConfirmDialog>
    </>
  );
}
