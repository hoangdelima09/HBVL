import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/i18n';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/cong-tac-vien',
          '/api/',
          '/tai-khoan',
          '/bai-cua-toi',
          '/gui-bai',
          '/gui-y-kien',
          '/dang-nhap-',
          '/en/tai-khoan',
          '/en/bai-cua-toi',
          '/en/gui-bai',
          '/en/gui-y-kien',
          '/en/dang-nhap-',
        ],
      },
    ],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
