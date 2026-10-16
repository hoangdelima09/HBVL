import Image from 'next/image';
import Link from 'next/link';
import { Mail, MapPin } from 'lucide-react';
import { localePath, tr, type Locale } from '@/lib/i18n';
import { categoryHref, type CategoryNode, type Settings } from '@/lib/types';

export function SiteFooter({ locale, tree, settings }: { locale: Locale; tree: CategoryNode[]; settings: Settings }) {
  const t = tr(locale);
  const b = settings.brand;
  const c = settings.contact;
  const full = t(b.fullNameVi ?? 'Học Bổng Vươn Lên', b.fullNameEn ?? 'Rise Up Scholarship');
  const org = t(b.orgVi ?? 'Quỹ Khuyến Học Đông Du', b.orgEn ?? 'Dong Du Study Encouragement Fund');
  const heading = 'text-xs font-bold uppercase tracking-[0.16em] text-white/90 flex items-center gap-2';
  const li = 'text-sm text-white/75 hover:text-white transition-all duration-150 inline-block hover:translate-x-0.5';
  return (
    <footer className="mt-28 bg-brand-900 text-white relative border-t-4 border-accent-500">
      <div className="mx-auto grid max-w-[82rem] gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-4">
          <Link href={localePath(locale, '/')} className="flex items-center gap-3 group">
            <Image
              src="/brand/dong-du-logo.jpg"
              alt=""
              width={52}
              height={52}
              className="h-13 w-13 rounded-xl bg-white object-contain p-1 shadow-card transition-transform group-hover:scale-105"
            />
            <span>
              <strong className="block font-serif text-xl tracking-tight text-white">{full}</strong>
              <span className="text-xs text-white/75">{org}</span>
            </span>
          </Link>
          <p className="text-sm leading-relaxed text-white/80">
            {t(
              'Website lưu giữ tin tức, câu chuyện học bổng, hoạt động cộng đồng và bản đồ kết nối của Học Bổng Vươn Lên.',
              'The website gathers Rise Up news, scholarship stories, community activities, and the member connection map.',
            )}
          </p>
          {b.sloganVi && (
            <p className="inline-block rounded-full bg-white/10 px-3.5 py-1 text-xs font-semibold text-accent-100 ring-1 ring-white/20">{t(b.sloganVi, b.sloganEn ?? '')}</p>
          )}
        </div>
        <nav aria-label={t('Chuyên mục', 'Sections')}>
          <h2 className={heading}>
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
            {t('Chuyên mục', 'Sections')}
          </h2>
          <ul className="mt-5 space-y-2.5">
            {tree.map((g) => (
              <li key={g.slug}>
                <Link className={li} href={localePath(locale, categoryHref(g))}>
                  {g.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t('Liên kết nhanh', 'Quick links')}>
          <h2 className={heading}>
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
            {t('Liên kết nhanh', 'Quick links')}
          </h2>
          <ul className="mt-5 space-y-2.5">
            <li>
              <Link className={li} href={localePath(locale, '/')}>
                {t('Trang chủ', 'Home')}
              </Link>
            </li>
            <li>
              <Link className={li} href={localePath(locale, '/category/dong-du-ky/ban-do-vuon-len')}>
                {t('Bản đồ Vươn Lên', 'Rise Up Map')}
              </Link>
            </li>
            <li>
              <Link className={li} href={localePath(locale, '/su-kien')}>
                {t('Sự kiện', 'Events')}
              </Link>
            </li>
            <li>
              <Link className={li} href={localePath(locale, '/chuong-trinh')}>
                {t('Chương trình học bổng', 'Scholarship programs')}
              </Link>
            </li>
            <li>
              <Link className={li} href={localePath(locale, '/dang-nhap-thanh-vien')}>
                {t('Cổng thành viên', 'Member portal')}
              </Link>
            </li>
            <li>
              <Link className={li} href={localePath(locale, '/gui-bai')}>
                {t('Đóng góp bài viết', 'Submit a story')}
              </Link>
            </li>
            <li>
              <Link className={li} href={localePath(locale, '/gui-y-kien')}>
                {t('Gửi ý kiến phản hồi', 'Send feedback')}
              </Link>
            </li>
            <li>
              <Link className={li} href={localePath(locale, '/lien-he')}>
                {t('Liên hệ', 'Contact')}
              </Link>
            </li>
          </ul>
        </nav>
        <div className="space-y-4">
          <h2 className={heading}>
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
            {t('Đồng hành cùng Quỹ', 'Get in touch')}
          </h2>
          <p className="text-sm leading-relaxed text-white/80">
            {t(
              'Mọi đóng góp, câu hỏi và đề xuất hợp tác xin vui lòng liên hệ Ban Điều Hành Quỹ.',
              'For contributions, inquiries, and partnerships, please contact the Fund Committee.',
            )}
          </p>
          <ul className="space-y-3 text-sm text-white/90">
            <li className="flex items-start gap-2.5">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" aria-hidden />
              <a className="break-all hover:text-white hover:underline transition-colors" href={`mailto:${c.email}`}>
                {c.email}
              </a>
            </li>
            <li className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" aria-hidden />
              <span className="text-white/85 leading-relaxed">{t(c.addressVi, c.addressEn)}</span>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 bg-black/15">
        <div className="mx-auto flex max-w-[82rem] flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-white/65 sm:px-6">
          <span>
            © {new Date().getFullYear()} {full} · {org}. {t('Tất cả quyền được bảo lưu.', 'All rights reserved.')}
          </span>
          <span className="text-white/50">{t('Xây dựng với tâm huyết vì thế hệ sinh viên Việt Nam.', 'Built with passion for Vietnam’s future generations.')}</span>
        </div>
      </div>
    </footer>
  );
}
