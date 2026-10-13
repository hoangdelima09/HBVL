'use client';

import { Alert } from '@/components/ui/misc';
import { formatDate, tr, type Locale } from '@/lib/i18n';
import type { SessionUser } from '@/lib/session';

/** Shown to a restricted account (can read and sign in, cannot comment/like/submit). The reason is the one staff typed for the person. */
export function RestrictionNotice({ locale, restriction, className }: { locale: Locale; restriction: NonNullable<SessionUser['restriction']>; className?: string }) {
  const t = tr(locale);
  const until = restriction.until ? formatDate(locale, restriction.until) : null;
  return (
    <Alert kind="warning" className={className} title={t('Tài khoản của bạn đang bị hạn chế tương tác', 'Your account is restricted', 'アカウントの利用が制限されています')}>
      {t(
        'Bạn vẫn đọc được nội dung nhưng tạm thời không thể bình luận, thích bài, gửi bài, gửi ý kiến hay liên hệ.',
        'You can still read the site, but you cannot comment, like, submit posts or send feedback or contact messages for now.',
        'サイトの閲覧はできますが、現在はコメント、いいね、記事の投稿、ご意見・お問い合わせの送信はできません。',
      )}{' '}
      {until
        ? t(`Hạn chế kéo dài đến ${until}.`, `The restriction lasts until ${until}.`, `制限は${until}まで続きます。`)
        : t('Hạn chế sẽ được gỡ khi ban quản trị xem xét lại.', 'The restriction stays until staff lift it.', '制限は運営チームが解除するまで続きます。')}
      {restriction.reason && (
        <>
          {' '}
          {t('Lý do:', 'Reason:', '理由：')} <span className="font-semibold">{restriction.reason}</span>
        </>
      )}
    </Alert>
  );
}
