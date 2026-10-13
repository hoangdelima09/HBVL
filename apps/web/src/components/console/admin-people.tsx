'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { adminCreateUserSchema } from '@hbvl/contracts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Alert, Badge } from '@/components/ui/misc';
import { ApiError, del, patch, post } from '@/lib/client';
import { DataTable, fmt, PageHeader, Pager, QueryBoundary, useQuery } from './kit';
import { RestrictDialog } from './moderation';

interface Paged<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}
const ROLE: Record<string, string> = { ADMIN: 'Quản trị viên', COLLABORATOR: 'Cộng tác viên', MEMBER: 'Thành viên' };
const USTATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  ACTIVE: { label: 'Hoạt động', tone: 'ok' },
  SUSPENDED: { label: 'Đã khóa', tone: 'danger' },
  PENDING_RESET: { label: 'Chờ kích hoạt', tone: 'warn' },
  DELETED: { label: 'Đã xóa', tone: 'neutral' },
};

interface UserRow {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  emailVerifiedAt: string | null;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  restrictedAt: string | null;
  restrictedUntil: string | null;
  restrictionReason: string | null;
}
const isRestricted = (r: { restrictedAt: string | null; restrictedUntil: string | null }) =>
  !!r.restrictedAt && (!r.restrictedUntil || new Date(r.restrictedUntil).getTime() > Date.now());

export function UsersAdmin() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [invite, setInvite] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'suspend' | 'activate' | 'reset'; user: UserRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restrictUser, setRestrictUser] = useState<UserRow | null>(null);
  const query = useQuery<Paged<UserRow>>(
    `/admin/users?page=${page}&pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}${role ? `&role=${role}` : ''}${status ? `&status=${status}` : ''}`,
  );

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setConfirm(null);
      void query.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Người dùng & vai trò"
        description="Chỉ quản trị viên cấp vai trò Cộng tác viên/Quản trị viên. Đổi vai trò hoặc khóa tài khoản thu hồi mọi phiên đăng nhập ngay lập tức. Không thể hạ quyền quản trị viên hoạt động cuối cùng."
        actions={<Button onClick={() => setInvite(true)}>Mời người dùng</Button>}
      />
      <div className="flex flex-wrap gap-3">
        <Field label="Tìm kiếm" className="w-64">
          {(p) => (
            <Input
              {...p}
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Tên đăng nhập, email, tên…"
            />
          )}
        </Field>
        <Field label="Vai trò" className="w-48">
          {(p) => (
            <Select
              {...p}
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả</option>
              {Object.entries(ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
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
              <option value="">Tất cả</option>
              {Object.entries(USTATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <DataTable
              caption="Người dùng"
              rows={d.items}
              columns={[
                {
                  key: 'u',
                  header: 'Tài khoản',
                  cell: (r) => (
                    <>
                      <strong>{r.displayName}</strong>
                      <p className="text-xs text-muted">
                        {r.username} · {r.email}
                      </p>
                    </>
                  ),
                },
                {
                  key: 'r',
                  header: 'Vai trò',
                  cell: (r) =>
                    r.status === 'DELETED' ? (
                      ROLE[r.role]
                    ) : (
                      <Select
                        aria-label={`Vai trò của ${r.displayName}`}
                        className="h-9 w-40 py-1 text-sm"
                        value={r.role}
                        onChange={(e) => void act(() => patch(`/admin/users/${r.id}`, { role: e.target.value }), 'Đã đổi vai trò.')}
                      >
                        {Object.entries(ROLE).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </Select>
                    ),
                },
                {
                  key: 's',
                  header: 'Trạng thái',
                  cell: (r) => (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={USTATUS[r.status]?.tone}>{USTATUS[r.status]?.label}</Badge>
                      {r.emailVerifiedAt && <Badge tone="leaf">Email ✓</Badge>}
                      {r.mfaEnabled && <Badge tone="brand">MFA</Badge>}
                      {isRestricted(r) && <Badge tone="warn">Hạn chế{r.restrictedUntil ? ` đến ${fmt(r.restrictedUntil)}` : ''}</Badge>}
                    </span>
                  ),
                },
                { key: 'l', header: 'Đăng nhập cuối', cell: (r) => fmt(r.lastLoginAt) },
                {
                  key: 'a',
                  header: 'Thao tác',
                  cell: (r) =>
                    r.status === 'DELETED' ? null : (
                      <div className="flex flex-wrap gap-1.5">
                        {r.status === 'PENDING_RESET' && (
                          <Button size="sm" variant="outline" onClick={() => void act(() => post(`/admin/users/${r.id}/resend-activation`), 'Đã gửi lại email kích hoạt.')}>
                            Gửi lại kích hoạt
                          </Button>
                        )}
                        {r.status === 'ACTIVE' &&
                          (isRestricted(r) ? (
                            <Button size="sm" variant="outline" onClick={() => void act(() => post(`/staff/users/${r.id}/unrestrict`), 'Đã bỏ hạn chế.')}>
                              Bỏ hạn chế
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setRestrictUser(r)}>
                              Hạn chế
                            </Button>
                          ))}
                        {r.status === 'ACTIVE' && (
                          <Button size="sm" variant="outline" onClick={() => setConfirm({ kind: 'suspend', user: r })}>
                            Khóa
                          </Button>
                        )}
                        {r.status === 'SUSPENDED' && (
                          <Button size="sm" variant="outline" onClick={() => void act(() => patch(`/admin/users/${r.id}`, { status: 'ACTIVE' }), 'Đã mở khóa.')}>
                            Mở khóa
                          </Button>
                        )}
                        {r.role !== 'ADMIN' && r.status !== 'PENDING_RESET' && (
                          <Button size="sm" variant="outline" onClick={() => setConfirm({ kind: 'reset', user: r })} data-testid="reset-password">
                            Đặt lại mật khẩu
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'delete', user: r })}>
                          Xóa (ẩn danh)
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
      <RestrictDialog
        user={restrictUser}
        onClose={(changed) => {
          setRestrictUser(null);
          if (changed) void query.reload();
        }}
      />
      <InviteDialog
        open={invite}
        onClose={(created) => {
          setInvite(false);
          if (created) void query.reload();
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        danger
        loading={busy}
        title={confirm?.kind === 'delete' ? 'Xóa (ẩn danh hóa) người dùng?' : confirm?.kind === 'reset' ? `Đặt lại mật khẩu của ${confirm.user.displayName}?` : 'Khóa tài khoản?'}
        description={
          confirm?.kind === 'delete'
            ? 'Thông tin cá nhân bị xóa; bài viết và bình luận được giữ lại với tên “Người dùng đã xóa”. Không thể hoàn tác.'
            : confirm?.kind === 'reset'
              ? 'Mật khẩu được đặt về mật khẩu mặc định 123456789 và người này bị đăng xuất khỏi mọi thiết bị. Ở lần đăng nhập kế tiếp họ bắt buộc phải đổi sang mật khẩu mới. Hãy báo mật khẩu tạm thời cho họ qua kênh riêng.'
              : 'Người dùng sẽ bị đăng xuất khỏi mọi thiết bị.'
        }
        confirmLabel={confirm?.kind === 'delete' ? 'Xóa' : confirm?.kind === 'reset' ? 'Đặt lại mật khẩu' : 'Khóa'}
        onConfirm={() =>
          confirm &&
          void act(
            () =>
              confirm.kind === 'delete'
                ? del(`/admin/users/${confirm.user.id}`)
                : confirm.kind === 'reset'
                  ? post(`/admin/users/${confirm.user.id}/reset-password`)
                  : patch(`/admin/users/${confirm.user.id}`, { status: 'SUSPENDED' }),
            confirm.kind === 'delete' ? 'Đã ẩn danh hóa.' : confirm.kind === 'reset' ? 'Đã đặt lại mật khẩu về mặc định (bắt buộc đổi ở lần đăng nhập tới).' : 'Đã khóa.',
          )
        }
      />
    </>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: (created?: boolean) => void }) {
  const [v, setV] = useState({ username: '', email: '', displayName: '', role: 'COLLABORATOR' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const parsed = adminCreateUserSchema.safeParse(v);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await post('/admin/users', parsed.data);
      toast.success('Đã tạo tài khoản và gửi email kích hoạt.');
      setV({ username: '', email: '', displayName: '', role: 'COLLABORATOR' });
      onClose(true);
    } catch (e) {
      if (e instanceof ApiError) setErrors({ ...e.fieldErrors(), _: e.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Mời người dùng"
      description="Tài khoản được tạo không có mật khẩu; người được mời đặt mật khẩu qua email kích hoạt (đồng thời xác minh email)."
    >
      <div className="space-y-3">
        {errors._ && <Alert kind="error">{errors._}</Alert>}
        <Field label="Họ và tên" required error={errors.displayName}>
          {(p) => <Input {...p} value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />}
        </Field>
        <Field label="Tên đăng nhập" required error={errors.username}>
          {(p) => <Input {...p} value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} />}
        </Field>
        <Field label="Email" required error={errors.email}>
          {(p) => <Input {...p} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}
        </Field>
        <Field label="Vai trò" required>
          {(p) => (
            <Select {...p} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
              {Object.entries(ROLE).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onClose()}>
            Hủy
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Tạo & gửi lời mời
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────── contact inbox ─────────────────────────
interface ContactRow {
  id: string;
  receiptCode: string;
  name: string;
  email: string;
  subject: string;
  status: string;
  mailState: string;
  createdAt: string;
}
interface ContactDetail extends ContactRow {
  message: string;
  mailError: string | null;
}
const MAIL: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'brand' }> = {
  NONE: { label: '—', tone: 'neutral' },
  QUEUED: { label: 'Đang xếp hàng gửi', tone: 'warn' },
  SENT_TO_PROVIDER: { label: 'Máy chủ mail đã nhận', tone: 'brand' },
  DELIVERED: { label: 'Đã giao', tone: 'ok' },
  FAILED: { label: 'Gửi thông báo thất bại', tone: 'danger' },
  BOUNCED: { label: 'Bị trả lại', tone: 'danger' },
};
export function ContactAdmin() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery<Paged<ContactRow>>(`/admin/contact?page=${page}&pageSize=20${status ? `&status=${status}` : ''}`);
  return (
    <>
      <PageHeader
        title="Liên hệ"
        description="Hộp thư riêng tư chỉ dành cho quản trị viên. Tin nhắn luôn được lưu trước; cột “Email thông báo” cho biết trạng thái gửi thật (không đồng nghĩa với đã giao)."
      />
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
            <option value="NEW">Mới</option>
            <option value="DONE">Đã xử lý</option>
          </Select>
        )}
      </Field>
      <QueryBoundary q={query} empty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <DataTable
              caption="Liên hệ"
              rows={d.items}
              columns={[
                {
                  key: 'c',
                  header: 'Mã',
                  cell: (r) => (
                    <button className="font-mono text-brand-700 hover:underline" onClick={() => setOpen(r.id)}>
                      {r.receiptCode}
                    </button>
                  ),
                },
                {
                  key: 's',
                  header: 'Chủ đề',
                  cell: (r) => (
                    <>
                      <strong>{r.subject}</strong>
                      <p className="text-xs text-muted">
                        {r.name} · {r.email}
                      </p>
                    </>
                  ),
                },
                { key: 'st', header: 'Xử lý', cell: (r) => <Badge tone={r.status === 'DONE' ? 'ok' : 'brand'}>{r.status === 'DONE' ? 'Đã xử lý' : 'Mới'}</Badge> },
                { key: 'm', header: 'Email thông báo', cell: (r) => <Badge tone={MAIL[r.mailState]?.tone}>{MAIL[r.mailState]?.label}</Badge> },
                { key: 'd', header: 'Nhận lúc', cell: (r) => fmt(r.createdAt) },
              ]}
            />
            <Pager page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
      {open && (
        <ContactDialog
          id={open}
          onClose={() => {
            setOpen(null);
            void query.reload();
          }}
        />
      )}
    </>
  );
}
function ContactDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<ContactDetail>(`/admin/contact/${id}`);
  const d = q.data;
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await patch(`/admin/contact/${id}`, { status: d!.status === 'DONE' ? 'NEW' : 'DONE' });
      toast.success('Đã cập nhật.');
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Thất bại.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={d ? `${d.receiptCode} — ${d.subject}` : 'Liên hệ'} description={d ? `${d.name} <${d.email}>` : undefined}>
      {!d ? (
        <p>Đang tải…</p>
      ) : (
        <div className="space-y-4">
          <div className="whitespace-pre-wrap break-words rounded-md bg-paper p-3" data-testid="contact-message">
            {d.message}
          </div>
          <p className="text-sm">
            Email thông báo: <Badge tone={MAIL[d.mailState]?.tone}>{MAIL[d.mailState]?.label}</Badge>
            {d.mailError && <span className="ml-2 text-danger-600">{d.mailError}</span>}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button asChild variant="secondary">
              <a href={`mailto:${d.email}?subject=${encodeURIComponent(`Re: ${d.subject}`)}`}>Trả lời qua email</a>
            </Button>
            <Button loading={busy} onClick={() => void toggle()}>
              {d.status === 'DONE' ? 'Đánh dấu chưa xử lý' : 'Đánh dấu đã xử lý'}
            </Button>
          </div>
          <p className="text-xs text-muted">Nút “Trả lời qua email” chỉ mở ứng dụng email của bạn; website không có hội thoại hai chiều.</p>
        </div>
      )}
    </Modal>
  );
}
