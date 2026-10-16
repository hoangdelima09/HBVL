import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Toaster } from 'sonner';
import '../../globals.css';
import { ExtensionAttributeGuard } from '@/components/extension-attribute-guard';
import { SiteFooter } from '@/components/site/footer';
import { ChatWidget } from '@/components/site/chat-widget';
import { SiteHeader } from '@/components/site/header';
import { apiGet } from '@/lib/api';
import { isLocale, LOCALE_INFO, siteOrigin, tr } from '@/lib/i18n';
import { LanguageGate } from '@/components/site/language-gate';
import { SessionProvider } from '@/lib/session';
import type { CategoryNode, Settings } from '@/lib/types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = tr(isLocale(locale) ? locale : 'vi');
  return {
    metadataBase: new URL(siteOrigin()),
    title: {
      default: t('Học Bổng Vươn Lên — Quỹ Khuyến Học Đông Du', 'Rise Up Scholarship — Dong Du Study Encouragement Fund'),
      template: `%s · ${t('Học Bổng Vươn Lên', 'Rise Up Scholarship')}`,
    },
    description: t(
      'Tin tức, câu chuyện học bổng, hoạt động cộng đồng và bản đồ kết nối của Học Bổng Vươn Lên.',
      'News, scholarship stories, community activities and the member map of Rise Up Scholarship.',
    ),
    openGraph: { siteName: 'Học Bổng Vươn Lên', locale: LOCALE_INFO[isLocale(locale) ? locale : 'vi'].og, type: 'website' },
    icons: { icon: '/brand/dong-du-logo.jpg' },
  };
}

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = tr(locale);
  const [{ items: tree }, settings] = await Promise.all([apiGet<{ items: CategoryNode[] }>(`/categories?locale=${locale}`), apiGet<Settings>('/settings/public')]);
  const b = settings.brand;
  return (
    <html lang={locale} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ExtensionAttributeGuard />
        <SessionProvider>
          <a href="#main-content" className="sr-only z-[100] rounded-md bg-white px-4 py-2 font-semibold text-brand-700 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
            {t('Bỏ qua, tới nội dung chính', 'Skip to main content')}
          </a>
          <SiteHeader
            locale={locale}
            tree={tree}
            location={t(b.locationVi ?? '', b.locationEn ?? '')}
            siteName={t(b.siteNameVi ?? 'Vươn Lên', b.siteNameEn ?? 'Rise Up')}
            orgName={t(b.orgVi ?? '', b.orgEn ?? '')}
          />
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter locale={locale} tree={tree} settings={settings} />
          <ChatWidget locale={locale} />
          <LanguageGate locale={locale} />
          <Toaster richColors closeButton position="top-center" />
        </SessionProvider>
      </body>
    </html>
  );
}
