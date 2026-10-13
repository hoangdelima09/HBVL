import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Clock, Mail, MapPin, Phone } from 'lucide-react';
import { ContactForm } from '@/components/site/forms-pages';
import { apiGet } from '@/lib/api';
import { isLocale, tr } from '@/lib/i18n';
import type { Settings } from '@/lib/types';

export const metadata: Metadata = { title: 'Liên hệ' };
export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = tr(locale);
  const s = (await apiGet<Settings>('/settings/public')).contact;
  const cards = [
    { icon: MapPin, title: t('Địa chỉ', 'Address'), body: <p>{t(s.addressVi, s.addressEn)}</p> },
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
          <iframe
            title={t('Bản đồ văn phòng', 'Office location map')}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-[26rem] w-full border-0"
            src="https://www.openstreetmap.org/export/embed.html?bbox=106.66%2C10.79%2C106.70%2C10.82&layer=mapnik&marker=10.8%2C106.68"
          />
          <p className="p-3 text-sm text-muted">
            <a className="font-semibold text-brand-700 underline" href={s.mapUrl} target="_blank" rel="noopener noreferrer">
              {t('Mở bản đồ lớn hơn', 'Open larger map')}
            </a>{' '}
            · {t('Vị trí gần đúng; vui lòng xác nhận địa chỉ trước khi đến.', 'Approximate location; please confirm the address before visiting.')}
          </p>
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
