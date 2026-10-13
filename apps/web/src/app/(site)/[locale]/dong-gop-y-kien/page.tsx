import { notFound, permanentRedirect } from 'next/navigation';
import { isLocale, localePath } from '@/lib/i18n';

/** Legacy alias `/dong-gop-y-kien/` → `/gui-y-kien`. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  permanentRedirect(localePath(locale, '/gui-y-kien'));
}
