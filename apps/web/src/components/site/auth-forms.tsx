'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { type z } from 'zod';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordCodeSchema, resetPasswordSchema, safeReturnTo } from '@hbvl/contracts';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { PasswordInput } from '@/components/ui/password-input';
import { Alert } from '@/components/ui/misc';
import { Turnstile } from '@/components/ui/turnstile';
import { ApiError, post } from '@/lib/client';
import { applyApiErrors } from '@/lib/forms';
import { localePath, tr, type Locale } from '@/lib/i18n';
import { PORTAL_LOGIN_PATH, PORTAL_SLUG, type Portal } from '@/lib/portal';
import { useSession } from '@/lib/session';

const PORTAL_INFO: Record<Portal, { vi: string; en: string; descVi: string; descEn: string; path: string }> = {
  ADMIN: {
    vi: 'Quản trị viên',
    en: 'Administrator',
    descVi: 'Toàn quyền quản trị website. Bắt buộc xác thực hai lớp (MFA).',
    descEn: 'Full website administration. Two-factor authentication (MFA) is required.',
    path: PORTAL_LOGIN_PATH.ADMIN,
  },
  COLLABORATOR: {
    vi: 'Cộng tác viên',
    en: 'Collaborator',
    descVi: 'Duyệt, đăng và quản lý bài viết và bình luận; xử lý tố cáo, hạn chế hoặc khóa thành viên (trừ nội dung của quản trị viên).',
    descEn: 'Review, publish and manage posts and comments; handle reports and restrict or block members (except administrators’ content).',
    path: PORTAL_LOGIN_PATH.COLLABORATOR,
  },
  MEMBER: {
    vi: 'Thành viên',
    en: 'Member',
    descVi: 'Bình luận bài viết, gửi bài và gửi ý kiến cho ban biên tập.',
    descEn: 'Comment on posts, submit stories and send feedback to the editorial team.',
    path: PORTAL_LOGIN_PATH.MEMBER,
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
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.15fr] items-start">
      <section className="space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-leaf-600/20 bg-leaf-50 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-leaf-700 shadow-subtle">
          <span className="h-1.5 w-1.5 rounded-full bg-leaf-600" aria-hidden />
          {t('Khu vực bảo mật', 'Secure area')}
        </span>
        <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-ink">{t(info.vi, info.en)}</h1>
        <p className="text-base sm:text-lg leading-relaxed text-ink-2">{t(info.descVi, info.descEn)}</p>
        <div className="pt-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted mb-2.5">{t('Chọn cổng đăng nhập', 'Choose sign-in portal')}</p>
          <nav aria-label={t('Chọn cổng đăng nhập', 'Choose sign-in portal')} className="flex flex-wrap gap-2">
            {(Object.keys(PORTAL_INFO) as Portal[]).map((k) => (
              <Link
                key={k}
                href={localePath(locale, PORTAL_INFO[k].path)}
                aria-current={k === portal ? 'page' : undefined}
                className={`rounded-full px-4 py-2 text-xs sm:text-sm font-semibold transition-all ${k === portal ? 'bg-brand-600 text-white shadow-card' : 'border border-line bg-white text-ink-2 hover:bg-brand-50 hover:text-brand-700 shadow-subtle'}`}
              >
                {t(PORTAL_INFO[k].vi, PORTAL_INFO[k].en)}
              </Link>
            ))}
          </nav>
        </div>
      </section>
      <section className="rounded-3xl border border-line bg-white p-6 shadow-card sm:p-9">
        {error && (
          <Alert kind="error" className="mb-5">
            {error}
          </Alert>
        )}
        {!mfa ? (
          <form onSubmit={onSubmit} noValidate className="space-y-4.5" aria-label={t('Đăng nhập', 'Sign in')}>
            <h2 className="font-serif text-2xl font-bold tracking-tight text-ink">{t('Đăng nhập', 'Sign in')}</h2>
            <input type="hidden" {...form.register('portal')} />
            <Field label={t('Tên đăng nhập hoặc email', 'Username or email')} required error={form.formState.errors.identifier?.message}>
              {(p) => <Input {...p} autoComplete="username" maxLength={254} {...form.register('identifier')} />}
            </Field>
            <Field label={t('Mật khẩu', 'Password')} required error={form.formState.errors.password?.message}>
              {(p) => <PasswordInput {...p} locale={locale} autoComplete="current-password" {...form.register('password')} />}
            </Field>
            <label className="flex items-center gap-2.5 text-sm text-ink-2 cursor-pointer select-none">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600" {...form.register('rememberMe')} />
              {t('Ghi nhớ đăng nhập', 'Remember me')}
            </label>
            <Button type="submit" size="lg" className="w-full shadow-lift" loading={form.formState.isSubmitting}>
              {t('Đăng nhập', 'Sign in')}
            </Button>
            <p className="text-center text-sm pt-1">
              <Link
                href={localePath(locale, `/quen-mat-khau?cong=${PORTAL_SLUG[portal]}`)}
                className="font-semibold text-brand-700 hover:text-brand-900 underline underline-offset-4"
              >
                {t('Quên mật khẩu?', 'Forgot password?')}
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={onMfa} noValidate className="space-y-4.5" aria-label={t('Xác thực hai lớp', 'Two-factor authentication')}>
            <h2 className="font-serif text-2xl font-bold tracking-tight text-ink">{t('Xác thực hai lớp', 'Two-factor authentication')}</h2>
            <p className="text-sm text-ink-2 leading-relaxed">
              {t('Nhập mã 6 số từ ứng dụng xác thực, hoặc một mã khôi phục.', 'Enter the 6-digit code from your authenticator app, or a recovery code.')}
            </p>
            <Field label={t('Mã xác thực', 'Verification code')} required>
              {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" autoFocus {...mfaForm.register('code', { required: true })} />}
            </Field>
            <Button type="submit" size="lg" className="w-full shadow-lift" loading={mfaForm.formState.isSubmitting}>
              {t('Xác nhận', 'Verify')}
            </Button>
          </form>
        )}
        {/* outside the code form, so Enter in these fields never submits the two-factor code */}
        {mfa && <LostAuthenticator locale={locale} admin={portal === 'ADMIN'} />}
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
        {(p) => <PasswordInput {...p} locale={locale} autoComplete="new-password" {...form.register('password')} />}
      </Field>
      <Field label={t('Nhập lại mật khẩu', 'Confirm password')} required error={err.passwordConfirm?.message}>
        {(p) => <PasswordInput {...p} locale={locale} autoComplete="new-password" {...form.register('passwordConfirm')} />}
      </Field>
      <Button type="submit" variant="secondary" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        {t('Đăng ký thành viên', 'Register')}
      </Button>
    </form>
  );
}

/** Forgot password for one portal: only an e-mail of an account with that portal's role is accepted (the API answers "wrong e-mail" otherwise). */
export function ForgotForm({ locale, portal }: { locale: Locale; portal: Portal }) {
  const t = tr(locale);
  const admin = portal === 'ADMIN';
  const info = PORTAL_INFO[portal];
  const [sentTo, setSentTo] = useState<string>();
  const [error, setError] = useState<string>();
  // CAPTCHA asked by the API after repeated wrong e-mails (collaborator/member portals); a token is single use, so the widget is remounted after each try.
  const [captchaKey, setCaptchaKey] = useState<string>();
  const [captchaToken, setCaptchaToken] = useState<string>();
  const [captchaRound, setCaptchaRound] = useState(0);
  const form = useForm<z.input<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '', portal } });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      await post('/auth/forgot-password', { email: v.email, portal, captchaToken });
      setSentTo(v.email);
    } catch (e) {
      const siteKey = e instanceof ApiError ? captchaSiteKey(e.details) : undefined;
      if (siteKey) setCaptchaKey(siteKey);
      setError(applyApiErrors(form, e, t('Không gửi được yêu cầu.', 'Could not send the request.')));
    } finally {
      if (captchaToken) {
        setCaptchaToken(undefined);
        setCaptchaRound((n) => n + 1);
      }
    }
  });
  if (sentTo && admin)
    return (
      <div className="mx-auto max-w-lg px-4 py-14">
        <h1 className="font-serif text-4xl font-semibold">{t('Kiểm tra email', 'Check your e-mail', 'メールを確認してください')}</h1>
        <Alert kind="success" className="mt-6" data-testid="admin-reset-sent">
          {t(
            `Nếu ${sentTo} là email của một tài khoản quản trị, chúng tôi đã gửi một liên kết đặt lại mật khẩu (hiệu lực 60 phút). Bấm liên kết trong thư để đặt mật khẩu mới — tài khoản quản trị không dùng mã 6 số.`,
            `If ${sentTo} belongs to an administrator account, we sent a password reset link (valid for 60 minutes). Open the link in the e-mail — administrator accounts do not use a 6-digit code.`,
            `${sentTo} が管理者アカウントのメールアドレスであれば、パスワード再設定用のリンク（60分間有効）を送信しました。メール内のリンクを開いてください。管理者アカウントでは6桁のコードは使用しません。`,
          )}
        </Alert>
      </div>
    );
  if (sentTo) return <ResetWithCode locale={locale} portal={portal} email={sentTo} onResend={() => setSentTo(undefined)} />;
  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="font-serif text-4xl font-semibold">{t('Quên mật khẩu', 'Forgot password')}</h1>
      <p className="mt-2 text-sm font-semibold text-brand-700" data-testid="forgot-portal">
        {t('Cổng', 'Portal')}: {t(info.vi, info.en)}
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-2xl bg-white p-6 shadow-card">
        {error && <Alert kind="error">{error}</Alert>}
        <p className="text-ink-2">
          {admin
            ? t(
                'Nhập email của tài khoản quản trị. Chúng tôi sẽ gửi một liên kết đặt lại mật khẩu (không dùng mã 6 số).',
                'Enter the administrator e-mail. We will send a password reset link (no 6-digit code).',
                '管理者アカウントのメールアドレスを入力してください。パスワード再設定用のリンクを送信します（6桁のコードは使用しません）。',
              )
            : portal === 'COLLABORATOR'
              ? t(
                  'Nhập email của tài khoản cộng tác viên, chúng tôi sẽ gửi mã 6 số để bạn đặt mật khẩu mới. Tài khoản cộng tác viên được quản trị viên mời cũng dùng chức năng này để kích hoạt.',
                  'Enter the collaborator account e-mail and we will send a 6-digit code so you can set a new password. Collaborator accounts invited by an admin also use this to activate.',
                )
              : t(
                  'Nhập email của tài khoản thành viên, chúng tôi sẽ gửi mã 6 số để bạn đặt mật khẩu mới. Tài khoản được quản trị viên mời hoặc chuyển từ website cũ cũng dùng chức năng này để kích hoạt.',
                  'Enter the member account e-mail and we will send a 6-digit code so you can set a new password. Accounts invited by an admin or migrated from the old website also use this to activate.',
                )}
        </p>
        <Field label="Email" required error={form.formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
        </Field>
        {captchaKey && <Turnstile key={captchaRound} siteKey={captchaKey} locale={locale} onToken={setCaptchaToken} />}
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting} disabled={!!captchaKey && !captchaToken}>
          {admin ? t('Gửi liên kết về email', 'Send link to my e-mail', 'メールにリンクを送信') : t('Gửi mã về email', 'Send code to my e-mail')}
        </Button>
        <p className="text-center text-sm">
          <Link href={localePath(locale, info.path)} className="font-semibold text-brand-700 underline underline-offset-4">
            {t('Quay lại đăng nhập', 'Back to sign in')}
          </Link>
        </p>
      </form>
    </div>
  );
}

/** Site key when the API asks for the CAPTCHA: `{ captcha, siteKey }` alone (CAPTCHA_REQUIRED) or next to field errors (wrong e-mail). */
function captchaSiteKey(details: unknown): string | undefined {
  const items = Array.isArray(details) ? details : [details];
  for (const d of items as { captcha?: unknown; siteKey?: unknown }[]) if (d && d.captcha === 'turnstile' && typeof d.siteKey === 'string') return d.siteKey;
  return undefined;
}

/** Step 2: the e-mailed 6-digit code + new password. The server answers identically for unknown e-mails, wrong codes and expired codes. */
function ResetWithCode({ locale, portal, email, onResend }: { locale: Locale; portal: Portal; email: string; onResend: () => void }) {
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
    const parsed = resetPasswordCodeSchema.safeParse({ email, portal, code: v.code, password: v.password });
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path[0]);
      if (paths.includes('code')) form.setError('code', { message: t('Nhập đủ 6 chữ số.', 'Enter all 6 digits.') });
      if (paths.includes('password')) form.setError('password', { message: t('Mật khẩu cần 10–128 ký tự.', 'Password must be 10–128 characters.') });
      return;
    }
    try {
      await post('/auth/reset-password-code', parsed.data);
      setDone(true);
      setTimeout(() => router.push(localePath(locale, PORTAL_LOGIN_PATH[portal])), 1500);
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
            {(p) => <PasswordInput {...p} locale={locale} autoComplete="new-password" {...form.register('password')} />}
          </Field>
          <Field label={t('Nhập lại mật khẩu', 'Confirm password')} required error={form.formState.errors.passwordConfirm?.message}>
            {(p) => <PasswordInput {...p} locale={locale} autoComplete="new-password" {...form.register('passwordConfirm')} />}
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

export function ResetForm({ locale, token, portal }: { locale: Locale; token: string; portal: Portal }) {
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
      setTimeout(() => router.push(localePath(locale, PORTAL_LOGIN_PATH[portal])), 1500);
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
              <Link className="font-semibold underline" href={localePath(locale, `/quen-mat-khau?cong=${PORTAL_SLUG[portal]}`)}>
                {t('Yêu cầu liên kết mới', 'Request a new link')}
              </Link>
            </Alert>
          )}
          <Field label={t('Mật khẩu mới (ít nhất 10 ký tự)', 'New password (at least 10 characters)')} required error={form.formState.errors.password?.message}>
            {(p) => <PasswordInput {...p} locale={locale} autoComplete="new-password" {...form.register('password')} />}
          </Field>
          <Field label={t('Nhập lại mật khẩu', 'Confirm password')} required error={form.formState.errors.passwordConfirm?.message}>
            {(p) => <PasswordInput {...p} locale={locale} autoComplete="new-password" {...form.register('passwordConfirm')} />}
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

/**
 * Under the two-factor step (the password was right): what to do when the authenticator app is gone.
 *  - administrator: a one-time link is e-mailed that removes two-factor authentication (then enable it again);
 *  - collaborator / member: a code is e-mailed; with the right code the request goes to the administrators, who decide.
 */
function LostAuthenticator({ locale, admin }: { locale: Locale; admin: boolean }) {
  const t = tr(locale);
  const [step, setStep] = useState<'idle' | 'code' | 'sent' | 'pending' | 'link-sent'>('idle');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const fail = (e: unknown) => {
    if (e instanceof ApiError && (e.details as { reason?: string } | undefined)?.reason === 'ALREADY_PENDING') setStep('pending');
    else if (e instanceof ApiError && e.status === 429)
      setErr(t('Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau.', 'Too many requests. Please try again later.', 'リクエストが多すぎます。しばらくしてからお試しください。'));
    else setErr(e instanceof ApiError ? e.message : t('Không gửi được. Vui lòng thử lại.', 'Could not send. Please try again.', '送信できませんでした。もう一度お試しください。'));
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(undefined);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const box = 'rounded-xl border border-line bg-paper/60 p-4 text-sm space-y-3';
  return (
    <details className="pt-1 text-sm" data-testid="lost-authenticator">
      <summary className="cursor-pointer text-center font-semibold text-brand-700 hover:text-brand-900">
        {t('Mất thiết bị xác thực?', 'Lost your authenticator?', '認証デバイスを紛失しましたか？')}
      </summary>
      <div className="mt-3 space-y-3">
        {err && <Alert kind="error">{err}</Alert>}
        {admin ? (
          step === 'link-sent' ? (
            <Alert kind="success" data-testid="mfa-link-sent">
              {t(
                'Đã gửi liên kết gỡ xác thực 2 lớp tới email quản trị (hiệu lực 30 phút). Mở thư, bấm liên kết, rồi đăng nhập lại và bật xác thực 2 lớp với thiết bị mới.',
                'A link that removes two-factor authentication was sent to the administrator e-mail (valid 30 minutes). Open it, then sign in again and enable two-factor authentication with your new device.',
                '二段階認証を解除するリンクを管理者メールに送信しました（30分間有効）。リンクを開いた後、再度ログインし、新しいデバイスで二段階認証を有効にしてください。',
              )}
            </Alert>
          ) : (
            <div className={box}>
              <p className="text-ink-2">
                {t(
                  'Dùng một mã khôi phục ở ô phía trên nếu bạn còn. Nếu không, chúng tôi gửi liên kết gỡ xác thực 2 lớp tới email của tài khoản quản trị.',
                  'Use one of your recovery codes above if you still have them. Otherwise we e-mail a link that removes two-factor authentication to the administrator address.',
                  'リカバリーコードがあれば上の欄に入力してください。ない場合は、二段階認証を解除するリンクを管理者のメールアドレスに送信します。',
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                loading={busy}
                data-testid="mfa-send-link"
                onClick={() =>
                  void run(async () => {
                    await post('/auth/mfa/reset-link');
                    setStep('link-sent');
                  })
                }
              >
                {t('Gửi liên kết gỡ xác thực về email', 'E-mail me a removal link', '解除リンクをメールで送信')}
              </Button>
            </div>
          )
        ) : step === 'sent' || step === 'pending' ? (
          <Alert kind={step === 'sent' ? 'success' : 'info'} data-testid="mfa-request-sent">
            {step === 'sent'
              ? t(
                  'Đã gửi yêu cầu tới quản trị viên. Bạn sẽ nhận email khi yêu cầu được xử lý; khi được gỡ, bạn đăng nhập lại chỉ bằng mật khẩu.',
                  'Your request was sent to the administrators. You will get an e-mail when it is handled; once removed, sign in with your password alone.',
                  '管理者にリクエストを送信しました。処理されるとメールでお知らせします。解除後はパスワードのみでログインできます。',
                )
              : t(
                  'Bạn đã gửi yêu cầu trước đó; quản trị viên đang xem xét. Bạn sẽ nhận email khi có kết quả.',
                  'You already sent a request; the administrators are reviewing it. You will get an e-mail with the result.',
                  '以前にリクエストを送信済みです。管理者が確認中です。結果はメールでお知らせします。',
                )}
          </Alert>
        ) : step === 'code' ? (
          <div className={box}>
            <p className="text-ink-2">
              {t(
                'Nhập mã 6 số vừa gửi tới email của bạn. Đúng mã thì yêu cầu mới được gửi tới quản trị viên.',
                'Enter the 6-digit code we just e-mailed you. Only the right code sends the request to the administrators.',
                'メールで送信した6桁のコードを入力してください。正しいコードの場合のみ、管理者にリクエストが送信されます。',
              )}
            </p>
            <Field label={t('Mã trong email', 'Code from the e-mail', 'メールのコード')} required>
              {(p) => <Input {...p} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} data-testid="mfa-recovery-code" />}
            </Field>
            <Field label={t('Lời nhắn cho quản trị viên (tuỳ chọn)', 'Message for the administrators (optional)', '管理者へのメッセージ（任意）')}>
              {(p) => <Textarea {...p} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="mfa-recovery-note" />}
            </Field>
            <Button
              type="button"
              className="w-full"
              loading={busy}
              disabled={!/^\d{6}$/.test(code.trim())}
              data-testid="mfa-recovery-submit"
              onClick={() =>
                void run(async () => {
                  await post('/auth/mfa/recovery/request', { code: code.trim(), ...(note.trim() ? { note: note.trim() } : {}) });
                  setStep('sent');
                })
              }
            >
              {t('Gửi yêu cầu tới quản trị viên', 'Send the request to the administrators', '管理者にリクエストを送信')}
            </Button>
          </div>
        ) : (
          <div className={box}>
            <p className="text-ink-2">
              {t(
                'Dùng một mã khôi phục ở ô phía trên nếu bạn còn. Nếu không, hãy nhờ quản trị viên gỡ xác thực 2 lớp: chúng tôi gửi mã xác nhận tới email của bạn trước.',
                'Use one of your recovery codes above if you still have them. Otherwise ask the administrators to remove two-factor authentication: we first e-mail you a confirmation code.',
                'リカバリーコードがあれば上の欄に入力してください。ない場合は管理者に二段階認証の解除を依頼できます。まず確認コードをメールで送信します。',
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              loading={busy}
              data-testid="mfa-recovery-send"
              onClick={() =>
                void run(async () => {
                  await post('/auth/mfa/recovery/send-code');
                  setStep('code');
                })
              }
            >
              {t('Gửi mã xác nhận về email', 'E-mail me a confirmation code', '確認コードをメールで送信')}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * Administrator only, opened from the e-mailed link. An explicit button (not automatic on page load) so that mail scanners which
 * pre-fetch links cannot use the one-time link up.
 */
export function MfaResetForm({ locale, token }: { locale: Locale; token: string }) {
  const t = tr(locale);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'invalid'>(token.length >= 20 ? 'idle' : 'invalid');
  const submit = async () => {
    setState('busy');
    try {
      await post('/auth/mfa/reset', { token });
      setState('done');
    } catch {
      setState('invalid');
    }
  };
  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="font-serif text-4xl font-semibold">{t('Gỡ xác thực 2 lớp', 'Remove two-factor authentication', '二段階認証の解除')}</h1>
      <div className="mt-6 space-y-4 rounded-2xl bg-white p-6 shadow-card">
        {state === 'done' ? (
          <>
            <Alert kind="success" data-testid="mfa-reset-done">
              {t(
                'Đã gỡ xác thực 2 lớp và đăng xuất mọi thiết bị. Hãy đăng nhập lại bằng mật khẩu, rồi vào Tài khoản bật lại xác thực 2 lớp với thiết bị mới — khu quản trị bị khóa cho tới khi bạn bật lại.',
                'Two-factor authentication was removed and every device was signed out. Sign in with your password, then enable two-factor authentication again in Account with your new device — the admin area stays locked until you do.',
                '二段階認証を解除し、すべてのデバイスからログアウトしました。パスワードでログインし、アカウントページで新しいデバイスを使って二段階認証を再度有効にしてください。それまで管理画面は利用できません。',
              )}
            </Alert>
            <Button asChild className="w-full">
              <Link href={localePath(locale, '/dang-nhap-quan-tri')}>{t('Đăng nhập quản trị', 'Administrator sign in', '管理者ログイン')}</Link>
            </Button>
          </>
        ) : state === 'invalid' ? (
          <>
            <Alert kind="error" data-testid="mfa-reset-invalid">
              {t(
                'Liên kết không hợp lệ, đã dùng hoặc đã hết hạn (30 phút). Hãy đăng nhập lại và chọn “Mất thiết bị xác thực?” để nhận liên kết mới.',
                'The link is invalid, already used or expired (30 minutes). Sign in again and choose “Lost your authenticator?” to get a new one.',
                'リンクが無効、使用済み、または期限切れ（30分）です。再度ログインし「認証デバイスを紛失しましたか？」から新しいリンクを取得してください。',
              )}
            </Alert>
            <Button asChild variant="outline" className="w-full">
              <Link href={localePath(locale, '/dang-nhap-quan-tri')}>{t('Đăng nhập quản trị', 'Administrator sign in', '管理者ログイン')}</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="text-ink-2">
              {t(
                'Bấm nút bên dưới để gỡ xác thực 2 lớp khỏi tài khoản quản trị của bạn. Mọi phiên đăng nhập sẽ bị đăng xuất. Sau đó bạn cần bật lại xác thực 2 lớp trước khi vào khu quản trị.',
                'Press the button to remove two-factor authentication from your administrator account. Every session is signed out. You must enable it again before entering the admin area.',
                '下のボタンを押すと、管理者アカウントの二段階認証を解除します。すべてのセッションはログアウトされます。管理画面に入る前に再度有効にする必要があります。',
              )}
            </p>
            <Button className="w-full" loading={state === 'busy'} onClick={() => void submit()} data-testid="mfa-reset-confirm">
              {t('Gỡ xác thực 2 lớp', 'Remove two-factor authentication', '二段階認証を解除')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
