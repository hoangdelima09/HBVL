'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { changePasswordSchema, LIMITS } from '@hbvl/contracts';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { PasswordInput } from '@/components/ui/password-input';
import { Alert, Badge, Skeleton } from '@/components/ui/misc';
import { ApiError, del, get, patch, post } from '@/lib/client';
import { formatDate, LOCALE_INFO, LANG_COOKIE, localePath, LOCALES, tr, type Locale } from '@/lib/i18n';
import { RestrictionNotice } from './restriction-notice';
import { useSession } from '@/lib/session';
import { applyApiErrors } from '@/lib/forms';

const card = 'rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8 transition-shadow';

export function AccountPage({ locale }: { locale: Locale }) {
  const t = tr(locale);
  const { user, loading, refresh } = useSession();
  if (loading)
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <Skeleton className="h-72 w-full" />
      </div>
    );
  if (!user)
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Alert kind="info">
          {t('Vui lòng đăng nhập.', 'Please sign in.')}{' '}
          <Link className="font-semibold underline" href={localePath(locale, '/dang-nhap-thanh-vien')}>
            {t('Đăng nhập', 'Sign in')}
          </Link>
        </Alert>
      </div>
    );
  const home = user.role === 'ADMIN' ? '/admin' : user.role === 'COLLABORATOR' ? '/cong-tac-vien' : null;
  if (user.mustChangePassword) return <MustChangePassword locale={locale} onChanged={refresh} />;
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6">
      <header>
        <div className="flex items-center gap-4">
          <Avatar src={user.avatarUrl} name={user.displayName} size={64} />
          <div>
            <h1 className="font-serif text-4xl font-semibold">{t('Tài khoản của bạn', 'Your account')}</h1>
            <p className="mt-1 text-ink-2">
              {t('Xin chào', 'Hello')}, <strong>{user.displayName}</strong> ·{' '}
              <Badge tone="brand">
                {user.role === 'ADMIN' ? t('Quản trị viên', 'Administrator') : user.role === 'COLLABORATOR' ? t('Cộng tác viên', 'Collaborator') : t('Thành viên', 'Member')}
              </Badge>
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild variant="secondary">
            <Link href={localePath(locale, '/gui-bai')}>{t('Gửi bài', 'Submit a story')}</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={localePath(locale, '/bai-cua-toi')}>{t('Bài của tôi', 'My posts')}</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={localePath(locale, '/gui-y-kien')}>{t('Gửi ý kiến', 'Send feedback')}</Link>
          </Button>
          {home && (
            <Button asChild>
              <Link href={home}>{t('Vào trang quản lý', 'Open dashboard')}</Link>
            </Button>
          )}
        </div>
      </header>
      {user.restriction && <RestrictionNotice locale={locale} restriction={user.restriction} />}
      <NotificationsCard locale={locale} />
      <EmailStatus locale={locale} verified={user.emailVerified} email={user.email} onVerified={refresh} />
      <AvatarCard locale={locale} onChanged={refresh} />
      <ProfileCard locale={locale} onSaved={refresh} />
      <PasswordCard locale={locale} />
      <MfaCard locale={locale} enabled={user.mfaEnabled} onChanged={refresh} />
      <SessionsCard locale={locale} />
    </div>
  );
}

function EmailStatus({ locale, verified, email, onVerified }: { locale: Locale; verified: boolean; email: string; onVerified: () => Promise<void> }) {
  const t = tr(locale);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const submitCode = async () => {
    setCodeError(undefined);
    if (!/^\d{6}$/.test(code.trim())) return setCodeError(t('Nhập đủ 6 chữ số.', 'Enter all 6 digits.'));
    setChecking(true);
    try {
      await post('/auth/verify-email-code', { code: code.trim() });
      toast.success(t('Đã xác minh email.', 'E-mail verified.'));
      await onVerified();
    } catch (e) {
      setCodeError(e instanceof ApiError ? e.message : t('Không xác minh được.', 'Could not verify.'));
    } finally {
      setChecking(false);
    }
  };
  if (verified)
    return (
      <Alert kind="success">
        {t('Email đã được xác minh:', 'E-mail verified:')} {email}
      </Alert>
    );
  return (
    <Alert kind="warning" title={t('Email chưa được xác minh', 'E-mail not verified')}>
      <p>
        {t(
          'Bạn có thể xem nội dung và lưu nháp. Cần xác minh email để gửi bài duyệt, bình luận, thích bài và gửi ý kiến/liên hệ.',
          'You can read content and save drafts. Verify your e-mail to submit for review, comment, like, and send feedback/contact messages.',
        )}
      </p>
      <p className="mt-3">
        {t('Chúng tôi đã gửi mã 6 số tới', 'We sent a 6-digit code to')} <strong>{email}</strong>. {t('Nhập mã để xác minh:', 'Enter it to verify:')}
      </p>
      <form
        className="mt-2 flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submitCode();
        }}
      >
        <div>
          <label htmlFor="verify-code" className="sr-only">
            {t('Mã xác minh 6 số', '6-digit verification code')}
          </label>
          <Input
            id="verify-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            aria-invalid={!!codeError}
            aria-describedby={codeError ? 'verify-code-error' : undefined}
            className="w-40 font-mono text-lg tracking-[0.3em]"
            data-testid="verify-code"
          />
          {codeError && (
            <p id="verify-code-error" role="alert" className="mt-1 text-sm text-danger-600">
              {codeError}
            </p>
          )}
        </div>
        <Button type="submit" size="sm" loading={checking} data-testid="verify-code-submit">
          {t('Xác minh', 'Verify')}
        </Button>
      </form>
      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        loading={busy}
        disabled={sent}
        onClick={async () => {
          setBusy(true);
          try {
            await post('/auth/resend-verification');
            setSent(true);
            toast.success(t('Đã gửi lại email xác minh.', 'Verification e-mail sent again.'));
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : t('Không gửi được.', 'Could not send.'));
          } finally {
            setBusy(false);
          }
        }}
      >
        {sent ? t('Đã gửi — kiểm tra hộp thư', 'Sent — check your inbox') : t('Gửi lại email xác minh', 'Resend verification e-mail')}
      </Button>
    </Alert>
  );
}

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Upload / replace / remove the profile picture. The server re-encodes and crops it to a square; the file never leaves as-is. */
function AvatarCard({ locale, onChanged }: { locale: Locale; onChanged: () => Promise<void> }) {
  const t = tr(locale);
  const { user } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [preview, setPreview] = useState<string>();
  if (!user) return null;
  // Same rule as commenting: the picture is public, so it needs a verified e-mail and an account that is not restricted.
  const blocked = !user.emailVerified
    ? t('Hãy xác minh email để đặt ảnh đại diện.', 'Verify your e-mail to set a profile picture.')
    : user.restriction
      ? t('Tài khoản đang bị hạn chế tương tác nên chưa đổi được ảnh đại diện.', 'Your account is restricted, so the profile picture cannot be changed.')
      : null;
  const upload = async (file: File) => {
    if (!AVATAR_TYPES.includes(file.type)) return void toast.error(t('Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.', 'Only JPEG, PNG or WebP images.'));
    if (file.size > LIMITS.imageMaxBytes) return void toast.error(t('Ảnh vượt quá 5 MB.', 'The image is larger than 5 MB.'));
    const local = URL.createObjectURL(file);
    setPreview(local);
    setBusy('upload');
    try {
      const form = new FormData();
      form.append('file', file);
      await post('/me/avatar', undefined, { form });
      await onChanged();
      toast.success(t('Đã cập nhật ảnh đại diện.', 'Profile picture updated.'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('Không tải ảnh lên được.', 'Could not upload the picture.'));
    } finally {
      setBusy(null);
      setPreview(undefined);
      URL.revokeObjectURL(local);
    }
  };
  const remove = async () => {
    setBusy('remove');
    try {
      await del('/me/avatar');
      await onChanged();
      toast.success(t('Đã gỡ ảnh đại diện.', 'Profile picture removed.'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('Không gỡ được ảnh.', 'Could not remove the picture.'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className={card} aria-labelledby="avatar-h" data-testid="avatar-card">
      <h2 id="avatar-h" className="font-serif text-2xl font-semibold">
        {t('Ảnh đại diện', 'Profile picture')}
      </h2>
      <div className="mt-4 flex flex-wrap items-center gap-5">
        <Avatar src={preview ?? user.avatarUrl} name={user.displayName} size={96} className={busy === 'upload' ? 'opacity-60' : undefined} />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-sm text-muted">
            {t(
              'JPEG, PNG hoặc WebP, tối đa 5 MB. Ảnh được cắt vuông và hiển thị công khai cạnh tên bạn (bình luận, thanh tài khoản).',
              'JPEG, PNG or WebP, up to 5 MB. It is cropped to a square and shown publicly next to your name (comments, account bar).',
            )}
          </p>
          {blocked ? (
            <Alert kind="info">{blocked}</Alert>
          ) : (
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept={AVATAR_TYPES.join(',')}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                data-testid="avatar-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void upload(f);
                }}
              />
              <Button type="button" loading={busy === 'upload'} disabled={!!busy} onClick={() => fileInput.current?.click()}>
                {user.avatarUrl ? t('Đổi ảnh', 'Change picture') : t('Tải ảnh lên', 'Upload picture')}
              </Button>
              {user.avatarUrl && (
                <Button type="button" variant="outline" loading={busy === 'remove'} disabled={!!busy} onClick={() => void remove()}>
                  {t('Gỡ ảnh', 'Remove')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ProfileCard({ locale, onSaved }: { locale: Locale; onSaved: () => Promise<void> }) {
  const t = tr(locale);
  const { user } = useSession();
  const form = useForm<{ displayName: string; bio: string; locale: Locale }>({
    defaultValues: { displayName: user?.displayName ?? '', bio: '', locale: user?.locale ?? 'vi' },
  });
  useEffect(() => {
    get<{ bio: string }>('/me')
      .then((r) => form.setValue('bio', r.bio ?? ''))
      .catch(() => undefined);
  }, [form]);
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await patch('/me', { displayName: v.displayName.trim(), bio: v.bio.trim(), locale: v.locale });
      document.cookie = `${LANG_COOKIE}=${v.locale}; Path=/; Max-Age=31536000; SameSite=Lax`; // the site opens in this language next time
      await onSaved();
      toast.success(t('Đã lưu hồ sơ.', 'Profile saved.'));
    } catch (e) {
      applyApiErrors(form, e, t('Không lưu được.', 'Could not save.'));
      toast.error(e instanceof ApiError ? e.message : t('Không lưu được.', 'Could not save.'));
    }
  });
  return (
    <section className={card} aria-labelledby="profile-h">
      <h2 id="profile-h" className="font-serif text-2xl font-semibold">
        {t('Thông tin cá nhân', 'Personal information')}
      </h2>
      <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
        <Field label={t('Họ và tên', 'Full name')} required error={form.formState.errors.displayName?.message}>
          {(p) => <Input {...p} maxLength={LIMITS.displayNameMax} {...form.register('displayName', { required: true })} />}
        </Field>
        <Field label={t('Giới thiệu ngắn', 'Short bio')} hint={t('Tối đa 500 ký tự.', 'Up to 500 characters.')}>
          {(p) => <Textarea {...p} rows={3} maxLength={500} {...form.register('bio')} />}
        </Field>
        <Field label={t('Ngôn ngữ ưa thích', 'Preferred language')}>
          {(p) => (
            <Select {...p} {...form.register('locale')}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_INFO[l].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="text-sm text-muted">
          {t('Tên đăng nhập và email là định danh tài khoản và không đổi tại đây.', 'Username and e-mail identify the account and cannot be changed here.')} ({user?.username} ·{' '}
          {user?.email})
        </p>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {t('Lưu hồ sơ', 'Save profile')}
        </Button>
      </form>
    </section>
  );
}

function PasswordCard({ locale, onChanged }: { locale: Locale; onChanged?: () => Promise<void> }) {
  const t = tr(locale);
  const form = useForm<{ currentPassword: string; newPassword: string; confirm: string }>({ defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const onSubmit = form.handleSubmit(async (v) => {
    if (v.newPassword !== v.confirm) {
      form.setError('confirm', { message: t('Hai mật khẩu không khớp.', 'Passwords do not match.') });
      return;
    }
    const parsed = changePasswordSchema.safeParse({ currentPassword: v.currentPassword, newPassword: v.newPassword });
    if (!parsed.success) {
      form.setError('newPassword', { message: t('Mật khẩu cần 10–128 ký tự.', 'Password must be 10–128 characters.') });
      return;
    }
    try {
      await post('/me/password', parsed.data);
      form.reset();
      toast.success(t('Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị thu hồi.', 'Password changed. Other sessions were signed out.'));
      await onChanged?.();
    } catch (e) {
      applyApiErrors(form, e, t('Không đổi được mật khẩu.', 'Could not change the password.'));
      toast.error(e instanceof ApiError ? e.message : t('Không đổi được mật khẩu.', 'Could not change the password.'));
    }
  });
  const e = form.formState.errors;
  return (
    <section className={card} aria-labelledby="pw-h">
      <h2 id="pw-h" className="font-serif text-2xl font-semibold">
        {t('Đổi mật khẩu', 'Change password')}
      </h2>
      <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
        <Field label={t('Mật khẩu hiện tại', 'Current password')} required error={e.currentPassword?.message}>
          {(p) => <PasswordInput {...p} locale={locale} autoComplete="current-password" {...form.register('currentPassword', { required: true })} />}
        </Field>
        <Field label={t('Mật khẩu mới (ít nhất 10 ký tự)', 'New password (at least 10 characters)')} required error={e.newPassword?.message}>
          {(p) => <PasswordInput {...p} locale={locale} autoComplete="new-password" {...form.register('newPassword', { required: true })} />}
        </Field>
        <Field label={t('Nhập lại mật khẩu mới', 'Confirm new password')} required error={e.confirm?.message}>
          {(p) => <PasswordInput {...p} locale={locale} autoComplete="new-password" {...form.register('confirm', { required: true })} />}
        </Field>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {t('Đổi mật khẩu', 'Change password')}
        </Button>
      </form>
    </section>
  );
}

/** After an administrator reset: nothing else on the site works until a new password is chosen. */
function MustChangePassword({ locale, onChanged }: { locale: Locale; onChanged: () => Promise<void> }) {
  const t = tr(locale);
  const { logout } = useSession();
  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-12 sm:px-6" data-testid="must-change">
      <Alert kind="warning" title={t('Bạn cần đổi mật khẩu', 'You need to change your password', 'パスワードの変更が必要です')}>
        {t(
          'Quản trị viên đã đặt lại mật khẩu của bạn về mật khẩu tạm thời. Nhập mật khẩu tạm thời làm “mật khẩu hiện tại”, rồi chọn mật khẩu mới để tiếp tục sử dụng website.',
          'An administrator reset your password to a temporary one. Enter it as the “current password”, then choose a new password to keep using the site.',
          '管理者がパスワードを仮のものにリセットしました。仮パスワードを「現在のパスワード」に入力し、新しいパスワードを設定してください。',
        )}
      </Alert>
      <PasswordCard locale={locale} onChanged={onChanged} />
      <Button variant="outline" onClick={() => void logout()}>
        {t('Đăng xuất', 'Sign out', 'ログアウト')}
      </Button>
    </div>
  );
}

function MfaCard({ locale, enabled, onChanged }: { locale: Locale; enabled: boolean; onChanged: () => Promise<void> }) {
  const t = tr(locale);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await post<{ secret: string; otpauthUri: string }>('/me/mfa/setup');
      setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUri, { margin: 1, width: 192 }) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Không bắt đầu được.', 'Could not start.'));
    } finally {
      setBusy(false);
    }
  };
  const enable = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await post<{ recoveryCodes: string[] }>('/me/mfa/enable', { code });
      setRecovery(r.recoveryCodes);
      setSetup(null);
      setCode('');
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Mã không đúng.', 'Invalid code.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={card} aria-labelledby="mfa-h">
      <h2 id="mfa-h" className="flex items-center gap-3 font-serif text-2xl font-semibold">
        {t('Xác thực hai lớp (TOTP)', 'Two-factor authentication (TOTP)')}{' '}
        <Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? t('Đang bật', 'Enabled') : t('Chưa bật', 'Off')}</Badge>
      </h2>
      <p className="mt-2 text-ink-2">
        {t(
          'Dùng ứng dụng xác thực (Google Authenticator, Aegis, 1Password…). Quản trị viên bắt buộc bật; cộng tác viên và thành viên nên bật.',
          'Use an authenticator app (Google Authenticator, Aegis, 1Password…). Required for administrators; recommended for collaborators and members.',
        )}
      </p>
      {error && (
        <Alert kind="error" className="mt-4">
          {error}
        </Alert>
      )}
      {recovery && (
        <Alert kind="warning" className="mt-4" title={t('Lưu mã khôi phục — chỉ hiển thị một lần', 'Save your recovery codes — shown only once')}>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm" data-testid="recovery-codes">
            {recovery.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Alert>
      )}
      {!enabled && !setup && (
        <Button className="mt-4" onClick={start} loading={busy}>
          {t('Bật xác thực hai lớp', 'Enable two-factor authentication')}
        </Button>
      )}
      {setup && (
        <div className="mt-4 flex flex-wrap items-start gap-6">
          {}
          <img src={setup.qr} alt={t('Mã QR cho ứng dụng xác thực', 'QR code for your authenticator app')} width={192} height={192} className="rounded-md border border-line" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm text-ink-2">
              {t('Quét mã QR hoặc nhập khóa:', 'Scan the QR code or enter the key:')}{' '}
              <code className="break-all rounded bg-paper-2 px-1.5 py-0.5 text-sm" data-testid="mfa-secret">
                {setup.secret}
              </code>
            </p>
            <Field label={t('Mã 6 số', '6-digit code')} required>
              {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
            </Field>
            <Button onClick={enable} loading={busy} disabled={code.length !== 6}>
              {t('Xác nhận và bật', 'Verify and enable')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SessionsCard({ locale }: { locale: Locale }) {
  const t = tr(locale);
  const [rows, setRows] = useState<{ id: string; createdAt: string; lastSeenAt: string; userAgent: string | null; current: boolean }[] | null>(null);
  const load = useCallback(() => {
    get<{ items: NonNullable<typeof rows> }>('/me/sessions')
      .then((r) => setRows(r.items))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  return (
    <section className={card} aria-labelledby="sess-h">
      <h2 id="sess-h" className="font-serif text-2xl font-semibold">
        {t('Phiên đăng nhập', 'Sign-in sessions')}
      </h2>
      {rows === null ? (
        <Skeleton className="mt-4 h-20 w-full" />
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {s.userAgent ?? t('Thiết bị không rõ', 'Unknown device')}{' '}
                  {s.current && (
                    <Badge tone="ok" className="ml-2">
                      {t('Phiên này', 'This session')}
                    </Badge>
                  )}
                </p>
                <p className="text-sm text-muted">
                  {t('Hoạt động gần nhất', 'Last active')}: {formatDate(locale, s.lastSeenAt, true)}
                </p>
              </div>
              {!s.current && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await del(`/me/sessions/${s.id}`);
                    load();
                  }}
                >
                  {t('Đăng xuất thiết bị', 'Sign out device')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface Notice {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Messages addressed to the signed-in user (post decisions, comment removals, restriction notices). */
function NotificationsCard({ locale }: { locale: Locale }) {
  const t = tr(locale);
  const [data, setData] = useState<{ unread: number; items: Notice[] } | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await get<{ unread: number; items: Notice[] }>('/me/notifications'));
    } catch {
      setData({ unread: 0, items: [] });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data || data.items.length === 0) return null;
  return (
    <section className={card} aria-labelledby="notif-h" id="thong-bao">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="notif-h" className="font-serif text-2xl font-semibold">
          {t('Thông báo', 'Notifications', 'お知らせ')} {data.unread > 0 && <Badge tone="brand">{data.unread}</Badge>}
        </h2>
        {data.unread > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await post('/me/notifications/read').catch(() => undefined);
              void load();
            }}
          >
            {t('Đánh dấu đã đọc', 'Mark all as read', 'すべて既読にする')}
          </Button>
        )}
      </div>
      <ul className="mt-4 divide-y divide-line">
        {data.items.slice(0, 10).map((n) => (
          <li key={n.id} className="py-3">
            <p className={n.readAt ? 'text-ink-2' : 'font-semibold'}>{n.title}</p>
            {n.body && <p className="text-sm text-muted">{n.body}</p>}
            <p className="text-xs text-muted">{formatDate(locale, n.createdAt, true)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
