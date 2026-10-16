import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Clock, Mail, MapPin, Phone } from 'lucide-react';
import { ContactMap } from '@/components/site/contact-map';
import { ContactForm } from '@/components/site/forms-pages';
import { apiGet } from '@/lib/api';
import { isLocale, tr } from '@/lib/i18n';
import { googleMapsLinks } from '@/lib/maps';
import type { Settings } from '@/lib/types';

export const metadata: Metadata = { title: 'Liên hệ' };
export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = tr(locale);
  const s = (await apiGet<Settings>('/settings/public')).contact;
  // The map is driven by the Vietnamese address shown on this page (the form Google Maps resolves exactly); `hl` only sets the map's own language.
  const map = googleMapsLinks(s.addressVi, { override: s.mapUrl, hl: locale });
  const address = t(s.addressVi, s.addressEn);
  const cards = [
    {
      icon: MapPin,
      title: t('Địa chỉ', 'Address'),
      body: map ? (
        <p>
          <a className="hover:underline" href={map.open} target="_blank" rel="noopener noreferrer">
            {address}
          </a>
        </p>
      ) : (
        <p>{address}</p>
      ),
    },
    {
      icon: Phone,
      title: t('Điện thoại', 'Phone'),
      body: (
        <p>
          <a className="hover:underline" href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}>
            {s.phone}
          </a>
          <br />
          {t(s.phoneNoteVi ?? '', s.phoneNoteEn ?? '')}
        </p>
      ),
    },
    {
      icon: Mail,
      title: 'Email',
      body: (
        <p>
          <a className="break-all hover:underline" href={`mailto:${s.email}`}>
            {s.email}
          </a>
        </p>
      ),
    },
    {
      icon: Clock,
      title: t('Giờ làm việc', 'Office hours'),
      body: (
        <p>
          {s.hoursVi.map((vi, i) => {
            const h = t(vi, s.hoursEn[i] ?? vi);
            return (
              <span key={vi} className="block">
                {h}
              </span>
            );
          })}
        </p>
      ),
    },
  ];
  return (
    <div className="mx-auto max-w-[82rem] px-4 py-12 sm:px-6">
      <h1 className="font-serif text-4xl font-semibold sm:text-5xl">{t('Liên Hệ Với Chúng Tôi', 'Contact us')}</h1>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <li key={c.title} className="rounded-xl bg-white p-5 shadow-card">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-leaf-50 text-leaf-700">
              <c.icon className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="mt-3 font-semibold">{c.title}</h2>
            <div className="mt-1 text-ink-2">{c.body}</div>
          </li>
        ))}
      </ul>
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl bg-white shadow-card">
          {map ? (
            <>
              <ContactMap
                embedSrc={map.embed}
                href={map.open}
                title={t('Bản đồ văn phòng', 'Office location map')}
                label={t(`Mở ${s.addressVi} trên Google Maps (tab mới)`, `Open ${s.addressEn} in Google Maps (new tab)`, `${s.addressVi} を Google マップで開く（新しいタブ）`)}
                cta={t('Mở trong Google Maps', 'Open in Google Maps', 'Google マップで開く')}
                address={address}
              />
              <p className="p-3 text-sm text-muted">
                <MapPin className="mr-1 inline h-4 w-4" aria-hidden />
                {address}
              </p>
            </>
          ) : (
            <p className="p-6 text-muted">{address}</p>
          )}
        </div>
        <div className="rounded-xl bg-white p-6 shadow-card sm:p-8">
          <h2 className="font-serif text-2xl font-semibold">{t('Gửi tin nhắn', 'Send a message')}</h2>
          <p className="mb-4 mt-1 text-ink-2">
            {t('Điền thông tin bên dưới, chúng tôi sẽ liên lạc sớm nhất có thể.', 'Fill in the form below, we will get back to you as soon as possible.')}
          </p>
          <ContactForm locale={locale} />
        </div>
      </div>
    </div>
  );
}
