import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { isLocale, localePath, tr } from '@/lib/i18n';

interface Province {
  slug: string;
  nameVi: string;
  nameEn: string;
  kind: string;
  photo: { url: string; placeholder: boolean } | null;
  current: { slug: string; nameVi: string; nameEn: string } | null;
  memberCount: number;
  contacts: { name: string; role: string; contactPath: string }[];
}
type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const p = await apiGet<Province>(`/provinces/${slug}`);
  const t = tr(isLocale(locale) ? locale : 'vi');
  return { title: `${t(p.nameVi, p.nameEn)} — ${t('Bản đồ Vươn Lên', 'Rise Up Map')}` };
}

export default async function ProvincePage({ params }: Props) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw;
  const t = tr(locale);
  const p = await apiGet<Province>(`/provinces/${slug}`);
  const name = t(p.nameVi, p.nameEn);
  const back = localePath(locale, '/category/dong-du-ky/ban-do-vuon-len');
  return (
    <>
      <div className="relative isolate min-h-64 overflow-hidden bg-brand-900">
        {p.photo && !p.photo.placeholder ? (
          <Image src={p.photo.url} alt="" fill priority sizes="100vw" className="object-cover opacity-60" />
        ) : (
          <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-brand-600 to-brand-900" />
        )}
        <div className="relative mx-auto flex max-w-[82rem] flex-col justify-end px-4 py-14 sm:px-6">
          <Link href={back} className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/90 px-4 py-1.5 text-sm font-semibold text-brand-700">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('Về bản đồ', 'Back to map')}
          </Link>
          <h1 className="mt-4 font-serif text-5xl font-semibold text-white">{name}</h1>
          {p.current && p.current.slug !== p.slug && (
            <p className="mt-2 text-white/90">
              {t('Nay thuộc', 'Now part of')} {t(p.current.nameVi, p.current.nameEn)}
            </p>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-[82rem] px-4 py-12 sm:px-6">
        <p className="text-lg font-semibold text-brand-700" data-testid="province-count">
          {p.memberCount} {t('thành viên HBVL có quê quán tại đây', 'HBVL members from here')}
        </p>
        <h2 className="mt-8 font-serif text-3xl font-semibold">{t('Thành viên Đông Du', 'Đông Du members')}</h2>
        {p.contacts.length === 0 ? (
          <p className="mt-3 text-muted" data-testid="province-empty">
            {t('Chưa có thông tin liên hệ được xác minh cho tỉnh này.', 'No verified contact details are available for this province yet.')}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full text-left">
              <caption className="sr-only">{t('Danh bạ thành viên', 'Member directory')}</caption>
              <thead className="bg-paper text-sm">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    {t('Tên', 'Name')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('Vai trò', 'Role')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('Liên hệ', 'Contact')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.contacts.map((c, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-4 py-3 font-semibold">{c.name}</td>
                    <td className="px-4 py-3">{c.role}</td>
                    <td className="px-4 py-3">
                      <Link className="font-semibold text-brand-700 underline" href={localePath(locale, c.contactPath)}>
                        {t('Liên hệ', 'Contact')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
