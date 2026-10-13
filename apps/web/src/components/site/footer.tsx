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
  const heading = 'text-sm font-bold uppercase tracking-wider text-white';
  const li = 'text-sm text-white/80 hover:text-white hover:underline underline-offset-4';
  return (
    <footer className="mt-24 bg-brand-900 text-white">
      <div className="mx-auto grid max-w-[82rem] gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <Link href={localePath(locale, '/')} className="flex items-center gap-3">
            <Image src="/brand/dong-du-logo.jpg" alt="" width={48} height={48} className="h-12 w-12 rounded-lg bg-white object-contain p-0.5" />
            <span>
              <strong className="block font-serif text-lg">{full}</strong>
              <span className="text-sm text-white/80">{org}</span>
            </span>
          </Link>
          <p className="mt-4 text-sm leading-relaxed text-white/80">
            {t(
              'Website lưu giữ tin tức, câu chuyện học bổng, hoạt động cộng đồng và bản đồ kết nối của Học Bổng Vươn Lên.',
              'The website gathers Rise Up news, scholarship stories, community activities, and the member connection map.',
            )}
          </p>
          <p className="mt-4 inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">{t(b.sloganVi ?? '', b.sloganEn ?? '')}</p>
        </div>
        <nav aria-label={t('Chuyên mục', 'Sections')}>
          <h2 className={heading}>{t('Chuyên mục', 'Sections')}</h2>
          <ul className="mt-4 space-y-2">
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
          <h2 className={heading}>{t('Liên kết nhanh', 'Quick links')}</h2>
          <ul className="mt-4 space-y-2">
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
        <div>
          <h2 className={heading}>{t('Đồng hành cùng Quỹ', 'Get in touch')}</h2>
          <p className="mt-4 text-sm text-white/80">
            {t(
              'Mọi đóng góp, câu hỏi và đề xuất hợp tác xin vui lòng liên hệ Ban Điều Hành Quỹ.',
              'For contributions, inquiries, and partnerships, please contact the Fund Committee.',
            )}
          </p>
          <ul className="mt-4 space-y-2 text-sm text-white/90">
            <li className="flex items-start gap-2">
              <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <a className="break-all hover:underline" href={`mailto:${c.email}`}>
                {c.email}
              </a>
            </li>
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{t(c.addressVi, c.addressEn)}</span>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-[82rem] flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-white/70 sm:px-6">
          <span>
            © {new Date().getFullYear()} {full} · {org}. {t('Tất cả quyền được bảo lưu.', 'All rights reserved.')}
          </span>
          <span>{t('Xây dựng với tâm huyết vì thế hệ sinh viên Việt Nam.', 'Built with passion for Vietnam’s future generations.')}</span>
        </div>
      </div>
    </footer>
  );
}
