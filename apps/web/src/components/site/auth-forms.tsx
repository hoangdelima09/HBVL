'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { type z } from 'zod';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordCodeSchema, resetPasswordSchema, safeReturnTo } from '@hbvl/contracts';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/misc';
import { ApiError, post } from '@/lib/client';
import { applyApiErrors } from '@/lib/forms';
import { localePath, tr, type Locale } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Portal = 'ADMIN' | 'COLLABORATOR' | 'MEMBER';
const PORTAL_INFO: Record<Portal, { vi: string; en: string; descVi: string; descEn: string; path: string }> = {
  ADMIN: {
    vi: 'Quản trị viên',
    en: 'Administrator',
    descVi: 'Toàn quyền quản trị website. Bắt buộc xác thực hai lớp (MFA).',
    descEn: 'Full website administration. Two-factor authentication (MFA) is required.',
    path: '/dang-nhap-quan-tri',
  },
  COLLABORATOR: {
    vi: 'Cộng tác viên',
    en: 'Collaborator',
    descVi: 'Duyệt, đăng và quản lý bài viết và bình luận; xử lý tố cáo, hạn chế hoặc khóa thành viên (trừ nội dung của quản trị viên).',
    descEn: 'Review, publish and manage posts and comments; handle reports and restrict or block members (except administrators’ content).',
    path: '/dang-nhap-cong-tac-vien',
  },
  MEMBER: {
    vi: 'Thành viên',
    en: 'Member',
    descVi: 'Bình luận bài viết, gửi bài và gửi ý kiến cho ban biên tập.',
    descEn: 'Comment on posts, submit stories and send feedback to the editorial team.',
    path: '/dang-nhap-thanh-vien',
  },
};

export function LoginPortal({ portal, locale, returnTo }: { portal: Portal; locale: Locale; returnTo?: string }) {
  const t = tr(locale);
  const router = useRouter();
  const { refresh } = useSession();
  const [mfa, setMfa] = useState<{ redirectTo: string } | null>(null);
  const [error, setError] = useState<string>();
  const info = PORTAL_INFO[portal];

  const form = useForm<z.input<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { portal, identifier: '', password: '', rememberMe: false } });
  const mfaForm = useForm<{ code: string }>({ defaultValues: { code: '' } });

  const finish = async (to: string) => {
    await refresh();
    router.push(portalTarget(to, locale));
    router.refresh();
  };

  const onSubmit = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      const r = await post<{ redirectTo: string; mfaRequired: boolean }>('/auth/login', { ...v, returnTo: (returnTo ? safeReturnTo(returnTo, '') : '') || undefined });
      if (r.mfaRequired) setMfa({ redirectTo: r.redirectTo });
      else await finish(r.redirectTo);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Không thể đăng nhập. Vui lòng thử lại.', 'Sign-in failed. Please try again.'));
    }
  });
  const onMfa = mfaForm.handleSubmit(async (v) => {
    setError(undefined);
    try {
      await post('/auth/mfa/verify', { code: v.code });
      await finish(mfa!.redirectTo);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Mã không đúng.', 'Invalid code.'));
      mfaForm.reset({ code: '' });
    }
  });

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
      <section>
        <p className="text-xs font-bold uppercase tracking-wider text-leaf-700">{t('Khu vực bảo mật', 'Secure area')}</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold">{t(info.vi, info.en)}</h1>
        <p className="mt-3 text-lg text-ink-2">{t(info.descVi, info.descEn)}</p>
        <nav aria-label={t('Chọn cổng đăng nhập', 'Choose sign-in portal')} className="mt-6 flex flex-wrap gap-2">
          {(Object.keys(PORTAL_INFO) as Portal[]).map((k) => (
            <Link
              key={k}
              href={localePath(locale, PORTAL_INFO[k].path)}
              aria-current={k === portal ? 'page' : undefined}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${k === portal ? 'bg-brand-600 text-white' : 'border border-line bg-white text-ink-2 hover:bg-brand-50'}`}
            >
              {t(PORTAL_INFO[k].vi, PORTAL_INFO[k].en)}
            </Link>
          ))}
        </nav>
      </section>
      <section className="rounded-2xl bg-white p-6 shadow-card sm:p-8">
        {error && (
          <Alert kind="error" className="mb-5">
            {error}
          </Alert>
        )}
        {!mfa ? (
          <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label={t('Đăng nhập', 'Sign in')}>
            <h2 className="font-serif text-2xl font-semibold">{t('Đăng nhập', 'Sign in')}</h2>
            <input type="hidden" {...form.register('portal')} />
            <Field label={t('Tên đăng nhập hoặc email', 'Username or email')} required error={form.formState.errors.identifier?.message}>
              {(p) => <Input {...p} autoComplete="username" maxLength={254} {...form.register('identifier')} />}
            </Field>
            <Field label={t('Mật khẩu', 'Password')} required error={form.formState.errors.password?.message}>
              {(p) => <Input {...p} type="password" autoComplete="current-password" {...form.register('password')} />}
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" {...form.register('rememberMe')} />
              {t('Ghi nhớ đăng nhập', 'Remember me')}
            </label>
            <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
              {t('Đăng nhập', 'Sign in')}
            </Button>
            <p className="text-center text-sm">
              <Link href={localePath(locale, '/quen-mat-khau')} className="font-semibold text-brand-700 underline">
                {t('Quên mật khẩu?', 'Forgot password?')}
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={onMfa} noValidate className="space-y-4" aria-label={t('Xác thực hai lớp', 'Two-factor authentication')}>
            <h2 className="font-serif text-2xl font-semibold">{t('Xác thực hai lớp', 'Two-factor authentication')}</h2>
            <p className="text-ink-2">
              {t('Nhập mã 6 số từ ứng dụng xác thực, hoặc một mã khôi phục.', 'Enter the 6-digit code from your authenticator app, or a recovery code.')}
            </p>
            <Field label={t('Mã xác thực', 'Verification code')} required>
              {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" autoFocus {...mfaForm.register('code', { required: true })} />}
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={mfaForm.formState.isSubmitting}>
              {t('Xác nhận', 'Verify')}
            </Button>
          </form>
        )}
        {portal === 'MEMBER' && !mfa && <RegisterForm locale={locale} onDone={(to) => void finish(to)} />}
      </section>
    </div>
  );
}

function portalTarget(to: string, locale: Locale) {
  // Console areas are not localised; member/public targets keep the active locale.
  if (to.startsWith('/admin') || to.startsWith('/cong-tac-vien')) return to;
  return localePath(locale, to);
}

function RegisterForm({ locale, onDone }: { locale: Locale; onDone: (to: string) => void }) {
  const t = tr(locale);
  const [error, setError] = useState<string>();
  const form = useForm<z.input<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', username: '', email: '', password: '', passwordConfirm: '', website: '' },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      const r = await post<{ redirectTo: string }>('/auth/register', v);
      onDone(r.redirectTo);
    } catch (e) {
      setError(applyApiErrors(form, e, t('Không thể tạo tài khoản. Vui lòng thử lại.', 'Could not create the account. Please try again.')));
    }
  });
  const err = form.formState.errors;
  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4 border-t border-line pt-8" aria-label={t('Tạo tài khoản thành viên', 'Create member account')}>
      <h2 className="font-serif text-2xl font-semibold">{t('Tạo tài khoản thành viên', 'Create member account')}</h2>
      {error && <Alert kind="error">{error}</Alert>}
      <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" {...form.register('website')} />
      <Field label={t('Họ và tên', 'Full name')} required error={err.displayName?.message}>
        {(p) => <Input {...p} autoComplete="name" maxLength={100} {...form.register('displayName')} />}
      </Field>
      <Field
        label={t('Tên đăng nhập', 'Username')}
        required
        error={err.username?.message}
        hint={t('3–60 ký tự: chữ, số, dấu chấm, gạch dưới, gạch ngang.', '3–60 characters: letters, digits, dot, underscore, hyphen.')}
      >
        {(p) => <Input {...p} autoComplete="username" maxLength={60} {...form.register('username')} />}
      </Field>
      <Field label="Email" required error={err.email?.message}>
        {(p) => <Input {...p} type="email" autoComplete="email" maxLength={254} {...form.register('email')} />}
      </Field>
      <Field label={t('Mật khẩu (ít nhất 10 ký tự)', 'Password (at least 10 characters)')} required error={err.password?.message}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
      </Field>
      <Field label={t('Nhập lại mật khẩu', 'Confirm password')} required error={err.passwordConfirm?.message}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('passwordConfirm')} />}
      </Field>
      <Button type="submit" variant="secondary" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        {t('Đăng ký thành viên', 'Register')}
      </Button>
    </form>
  );
}

export function ForgotForm({ locale }: { locale: Locale }) {
  const t = tr(locale);
  const [sentTo, setSentTo] = useState<string>();
  const [error, setError] = useState<string>();
  const form = useForm<z.input<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      await post('/auth/forgot-password', v);
      setSentTo(v.email);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Không gửi được yêu cầu.', 'Could not send the request.'));
    }
  });
  if (sentTo) return <ResetWithCode locale={locale} email={sentTo} onResend={() => setSentTo(undefined)} />;
  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="font-serif text-4xl font-semibold">{t('Quên mật khẩu', 'Forgot password')}</h1>
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-2xl bg-white p-6 shadow-card">
        {error && <Alert kind="error">{error}</Alert>}
        <p className="text-ink-2">
          {t(
            'Nhập email của tài khoản, chúng tôi sẽ gửi mã 6 số để bạn đặt mật khẩu mới. Tài khoản được quản trị viên mời hoặc chuyển từ website cũ cũng dùng chức năng này để kích hoạt.',
            'Enter your account e-mail and we will send a 6-digit code so you can set a new password. Accounts invited by an admin or migrated from the old website also use this to activate.',
          )}
        </p>
        <Field label="Email" required error={form.formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          {t('Gửi mã về email', 'Send code to my e-mail')}
        </Button>
      </form>
    </div>
  );
}

/** Step 2: the e-mailed 6-digit code + new password. The server answers identically for unknown e-mails, wrong codes and expired codes. */
function ResetWithCode({ locale, email, onResend }: { locale: Locale; email: string; onResend: () => void }) {
  const t = tr(locale);
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const form = useForm<{ code: string; password: string; passwordConfirm: string }>({ defaultValues: { code: '', password: '', passwordConfirm: '' } });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(undefined);
    if (v.password !== v.passwordConfirm) {
      form.setError('passwordConfirm', { message: t('Hai mật khẩu không khớp.', 'Passwords do not match.') });
      return;
    }
    const parsed = resetPasswordCodeSchema.safeParse({ email, code: v.code, password: v.password });
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path[0]);
      if (paths.includes('code')) form.setError('code', { message: t('Nhập đủ 6 chữ số.', 'Enter all 6 digits.') });
      if (paths.includes('password')) form.setError('password', { message: t('Mật khẩu cần 10–128 ký tự.', 'Password must be 10–128 characters.') });
      return;
    }
    try {
      await post('/auth/reset-password-code', parsed.data);
      setDone(true);
      setTimeout(() => router.push(localePath(locale, '/dang-nhap-thanh-vien')), 1500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Không đặt lại được mật khẩu.', 'Could not reset the password.'));
    }
  });
  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="font-serif text-4xl font-semibold">{t('Nhập mã và đặt mật khẩu mới', 'Enter the code and set a new password')}</h1>
      {done ? (
        <Alert kind="success" className="mt-6">
          {t('Đã đặt mật khẩu. Đang chuyển tới trang đăng nhập…', 'Password set. Redirecting to sign-in…')}
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-2xl bg-white p-6 shadow-card">
          <Alert kind="success">
            {t('Nếu email thuộc về một tài khoản, chúng tôi đã gửi mã 6 số tới', 'If the e-mail belongs to an account, we have sent a 6-digit code to')} <strong>{email}</strong>.{' '}
            {t('Hãy kiểm tra hộp thư (kể cả thư rác). Mã có hiệu lực 60 phút.', 'Check your inbox (and spam). The code is valid for 60 minutes.')}
          </Alert>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label={t('Mã 6 số', '6-digit code')} required error={form.formState.errors.code?.message}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                className="font-mono text-xl tracking-[0.35em]"
                data-testid="reset-code"
                {...form.register('code', { onChange: (e) => form.setValue('code', e.target.value.replace(/\D/g, '').slice(0, 6)) })}
              />
            )}
          </Field>
          <Field label={t('Mật khẩu mới (ít nhất 10 ký tự)', 'New password (at least 10 characters)')} required error={form.formState.errors.password?.message}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
          </Field>
          <Field label={t('Nhập lại mật khẩu', 'Confirm password')} required error={form.formState.errors.passwordConfirm?.message}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('passwordConfirm')} />}
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            {t('Đặt mật khẩu', 'Set password')}
          </Button>
          <button type="button" onClick={onResend} className="w-full text-center text-sm font-semibold text-brand-700 underline">
            {t('Chưa nhận được mã? Gửi lại', "Didn't get the code? Send again")}
          </button>
        </form>
      )}
    </div>
  );
}

export function ResetForm({ locale, token }: { locale: Locale; token: string }) {
  const t = tr(locale);
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const form = useForm<{ password: string; passwordConfirm: string }>({ defaultValues: { password: '', passwordConfirm: '' } });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(undefined);
    if (v.password !== v.passwordConfirm) {
      form.setError('passwordConfirm', { message: t('Hai mật khẩu không khớp.', 'Passwords do not match.') });
      return;
    }
    const parsed = resetPasswordSchema.safeParse({ token, password: v.password });
    if (!parsed.success) {
      form.setError('password', { message: t('Mật khẩu cần 10–128 ký tự.', 'Password must be 10–128 characters.') });
      return;
    }
    try {
      await post('/auth/reset-password', parsed.data);
      setDone(true);
      setTimeout(() => router.push(localePath(locale, '/dang-nhap-thanh-vien')), 1500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Không đặt lại được mật khẩu.', 'Could not reset the password.'));
    }
  });
  if (!token)
    return (
      <div className="mx-auto max-w-lg px-4 py-14">
        <Alert kind="error">{t('Liên kết không hợp lệ.', 'Invalid link.')}</Alert>
      </div>
    );
  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="font-serif text-4xl font-semibold">{t('Đặt mật khẩu mới', 'Set a new password')}</h1>
      {done ? (
        <Alert kind="success" className="mt-6">
          {t('Đã đặt mật khẩu. Đang chuyển tới trang đăng nhập…', 'Password set. Redirecting to sign-in…')}
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-2xl bg-white p-6 shadow-card">
          {error && (
            <Alert kind="error">
              {error}{' '}
              <Link className="font-semibold underline" href={localePath(locale, '/quen-mat-khau')}>
                {t('Yêu cầu liên kết mới', 'Request a new link')}
              </Link>
            </Alert>
          )}
          <Field label={t('Mật khẩu mới (ít nhất 10 ký tự)', 'New password (at least 10 characters)')} required error={form.formState.errors.password?.message}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
          </Field>
          <Field label={t('Nhập lại mật khẩu', 'Confirm password')} required error={form.formState.errors.passwordConfirm?.message}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('passwordConfirm')} />}
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            {t('Lưu mật khẩu', 'Save password')}
          </Button>
        </form>
      )}
    </div>
  );
}

export function VerifyEmail({ locale, token }: { locale: Locale; token: string }) {
  const t = tr(locale);
  const { refresh } = useSession();
  const [state, setState] = useState<'working' | 'ok' | 'bad'>(token ? 'working' : 'bad');
  useEffect(() => {
    if (!token) return;
    let alive = true;
    post('/auth/verify-email', { token })
      .then(() => {
        if (alive) {
          setState('ok');
          void refresh();
        }
      })
      .catch(() => {
        if (alive) setState('bad');
      });
    return () => {
      alive = false;
    };
  }, [token, refresh]);
  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="font-serif text-4xl font-semibold">{t('Xác minh email', 'Verify e-mail')}</h1>
      <div className="mt-6" aria-live="polite">
        {state === 'working' && <p>{t('Đang xác minh…', 'Verifying…')}</p>}
        {state === 'ok' && (
          <Alert kind="success">
            {t('Email đã được xác minh. Bạn có thể gửi bài, bình luận và thích bài viết.', 'Your e-mail is verified. You can now submit stories, comment and like posts.')}{' '}
            <Link href={localePath(locale, '/tai-khoan')} className="font-semibold underline">
              {t('Tới tài khoản', 'Go to account')}
            </Link>
          </Alert>
        )}
        {state === 'bad' && (
          <Alert kind="error">
            {t(
              'Liên kết không hợp lệ hoặc đã hết hạn. Đăng nhập rồi chọn “Gửi lại email xác minh” trong Tài khoản.',
              'The link is invalid or expired. Sign in and choose “Resend verification e-mail” in Account.',
            )}
          </Alert>
        )}
      </div>
    </div>
  );
}
