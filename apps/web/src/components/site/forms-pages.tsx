'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { type z } from 'zod';
import { contactSchema, feedbackSchema, LIMITS } from '@hbvl/contracts';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Alert, Skeleton } from '@/components/ui/misc';
import { ApiError, post } from '@/lib/client';
import { applyApiErrors } from '@/lib/forms';
import { localePath, tr, type Locale } from '@/lib/i18n';
import { useSession } from '@/lib/session';

function Gate({ locale, returnTo, children }: { locale: Locale; returnTo: string; children: React.ReactNode }) {
  const t = tr(locale);
  const { user, loading } = useSession();
  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!user)
    return (
      <Alert kind="info">
        {t(
          'Khách chưa đăng nhập chỉ có thể xem nội dung. Thành viên có thể gửi tin nhắn và ý kiến sau khi đăng nhập.',
          'Guests can view content only. Members can send messages and feedback after signing in.',
        )}{' '}
        <Link className="font-semibold underline" href={`${localePath(locale, '/dang-nhap-thanh-vien')}?returnTo=${encodeURIComponent(returnTo)}`}>
          {t('Đăng nhập thành viên', 'Member sign in')}
        </Link>
      </Alert>
    );
  if (!user.emailVerified)
    return (
      <Alert kind="warning">
        {t('Hãy xác minh email trong ', 'Verify your e-mail in ')}
        <Link className="font-semibold underline" href={localePath(locale, '/tai-khoan')}>
          {t('Tài khoản', 'Account')}
        </Link>
        {t(' để gửi nội dung này.', ' to send this.')}
      </Alert>
    );
  return <>{children}</>;
}

export function FeedbackForm({ locale }: { locale: Locale }) {
  const t = tr(locale);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const form = useForm<z.input<typeof feedbackSchema>>({ resolver: zodResolver(feedbackSchema), defaultValues: { subject: '', message: '', website: '' } });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      await post('/feedback', v);
      setSent(true);
      form.reset();
    } catch (e) {
      // text is kept on every failure; cleared only after success
      setError(
        e instanceof ApiError && e.status === 429
          ? t('Vui lòng đợi một phút trước khi gửi ý kiến tiếp theo.', 'Please wait one minute before sending more feedback.')
          : applyApiErrors(form, e, t('Không thể gửi ý kiến. Hãy kiểm tra nội dung và thử lại.', 'Feedback could not be sent. Check the form and try again.')),
      );
    }
  });
  const e = form.formState.errors;
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-wider text-leaf-700">{t('Kênh nội bộ', 'Private channel')}</p>
      <h1 className="mt-1 font-serif text-4xl font-semibold">{t('Gửi ý kiến', 'Send feedback')}</h1>
      <p className="mt-2 text-lg text-ink-2">
        {t('Ý kiến của bạn chỉ hiển thị trong khu vực quản lý để cộng tác viên và quản trị viên xem.', 'Your feedback is visible only to collaborators and administrators.')}
      </p>
      <div className="mt-8 rounded-3xl border border-line bg-white p-6 sm:p-9 shadow-card">
        <Gate locale={locale} returnTo={localePath(locale, '/gui-y-kien')}>
          {sent && (
            <Alert kind="success" className="mb-5">
              {t('Ý kiến đã được gửi thành công.', 'Your feedback was sent.')}
            </Alert>
          )}
          {error && (
            <Alert kind="error" className="mb-5">
              {error}
            </Alert>
          )}
          <form onSubmit={onSubmit} noValidate className="space-y-4.5">
            <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" {...form.register('website')} />
            <Field label={t('Tiêu đề', 'Subject')} required error={e.subject?.message}>
              {(p) => <Input {...p} maxLength={LIMITS.feedbackSubjectMax} {...form.register('subject')} />}
            </Field>
            <Field label={t('Nội dung ý kiến', 'Feedback')} required error={e.message?.message}>
              {(p) => <Textarea {...p} rows={8} maxLength={LIMITS.feedbackMessageMax} {...form.register('message')} />}
            </Field>
            <Button type="submit" size="lg" className="shadow-lift" loading={form.formState.isSubmitting}>
              {t('Gửi cho ban biên tập', 'Send to editorial team')}
            </Button>
          </form>
        </Gate>
      </div>
    </div>
  );
}

export function ContactForm({ locale }: { locale: Locale }) {
  const t = tr(locale);
  const { user } = useSession();
  const [receipt, setReceipt] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const form = useForm<z.input<typeof contactSchema>>({ resolver: zodResolver(contactSchema), defaultValues: { name: '', email: '', subject: '', message: '' } });
  useEffect(() => {
    if (user) {
      if (!form.getValues('name')) form.setValue('name', user.displayName);
      if (!form.getValues('email')) form.setValue('email', user.email);
    }
  }, [user, form]);
  const onSubmit = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      const r = await post<{ receiptCode: string }>('/contact', v);
      setReceipt(r.receiptCode);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? t('Vui lòng đợi một phút trước khi gửi tiếp.', 'Please wait one minute before sending again.')
          : applyApiErrors(form, e, t('Chưa gửi được. Nội dung của bạn vẫn còn trong form — hãy thử lại.', 'Not sent. Your message is still in the form — please retry.')),
      );
    }
  });
  const e = form.formState.errors;
  if (receipt) {
    return (
      <div role="status" className="rounded-3xl border border-ok-600/30 bg-ok-50/60 p-7 sm:p-9 text-ok-800 shadow-card" data-testid="contact-receipt">
        <h2 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-ink">{t('Đã tiếp nhận tin nhắn!', 'Message received!')}</h2>
        <div className="mt-3.5 inline-flex items-center gap-2 rounded-xl border border-ok-600/20 bg-white px-3.5 py-1.5 text-sm">
          <span className="text-ink-2">{t('Mã liên hệ:', 'Reference:')}</span>
          <strong className="font-mono text-base font-bold text-ok-800 tracking-wider" data-testid="receipt-code">
            {receipt}
          </strong>
        </div>
        <p className="mt-3.5 text-sm sm:text-base text-ink-2 leading-relaxed">
          {t(
            'Tin nhắn đã được lưu. Thông báo cho ban điều hành đang được xếp hàng gửi đi; chúng tôi sẽ phản hồi trong thời gian sớm nhất.',
            'Your message is saved. The notification to the committee is queued for sending; we will respond as soon as possible.',
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-3xl border border-line bg-white p-6 sm:p-9 shadow-card">
      <Gate locale={locale} returnTo={localePath(locale, '/lien-he')}>
        {error && (
          <Alert kind="error" className="mb-5">
            {error}
          </Alert>
        )}
        <form onSubmit={onSubmit} noValidate className="space-y-4.5">
          <div className="grid gap-4.5 sm:grid-cols-2">
            <Field label={t('Họ và tên', 'Full name')} required error={e.name?.message}>
              {(p) => <Input {...p} autoComplete="name" maxLength={LIMITS.contactNameMax} {...form.register('name')} />}
            </Field>
            <Field label="Email" required error={e.email?.message}>
              {(p) => <Input {...p} type="email" autoComplete="email" maxLength={LIMITS.contactEmailMax} {...form.register('email')} />}
            </Field>
          </div>
          <Field label={t('Tiêu đề', 'Subject')} error={e.subject?.message}>
            {(p) => <Input {...p} maxLength={LIMITS.contactSubjectMax} {...form.register('subject')} />}
          </Field>
          <Field label={t('Nội dung', 'Message')} required error={e.message?.message}>
            {(p) => <Textarea {...p} rows={6} maxLength={LIMITS.contactMessageMax} {...form.register('message')} />}
          </Field>
          <Button type="submit" size="lg" className="shadow-lift" loading={form.formState.isSubmitting}>
            {t('Gửi tin nhắn', 'Send message')}
          </Button>
        </form>
      </Gate>
    </div>
  );
}
