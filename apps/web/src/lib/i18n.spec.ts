import { describe, expect, it } from 'vitest';
import { formatDate, isLocale, localePath, stripLocale, tr } from './i18n';
import { pageHref } from './utils';
import { ApiError } from './client';
import { googleMapsLinks } from './maps';

describe('locale routing (VI default without prefix, EN under /en, JA under /ja)', () => {
  it('builds localised paths', () => {
    expect(localePath('vi', '/lien-he')).toBe('/lien-he');
    expect(localePath('vi', 'lien-he')).toBe('/lien-he');
    expect(localePath('en', '/')).toBe('/en');
    expect(localePath('en', '/category/tin-tuc')).toBe('/en/category/tin-tuc');
    expect(localePath('ja', '/')).toBe('/ja');
    expect(localePath('ja', '/lien-he')).toBe('/ja/lien-he');
  });
  it('strips the locale prefix and round-trips', () => {
    expect(stripLocale('/en')).toEqual({ locale: 'en', path: '/' });
    expect(stripLocale('/en/lien-he')).toEqual({ locale: 'en', path: '/lien-he' });
    expect(stripLocale('/lien-he')).toEqual({ locale: 'vi', path: '/lien-he' });
    expect(stripLocale('/english-lessons')).toEqual({ locale: 'vi', path: '/english-lessons' }); // "/en" must match a whole segment
    expect(stripLocale('/ja')).toEqual({ locale: 'ja', path: '/' });
    expect(stripLocale('/ja/category/tin-tuc')).toEqual({ locale: 'ja', path: '/category/tin-tuc' });
    expect(stripLocale('/jazz')).toEqual({ locale: 'vi', path: '/jazz' });
    for (const p of ['/', '/a/b']) for (const l of ['vi', 'en', 'ja'] as const) expect(stripLocale(localePath(l, p))).toEqual({ locale: l, path: p });
  });
  it('validates locales and translates inline', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(tr('vi')('Xin chào', 'Hello')).toBe('Xin chào');
    expect(tr('en')('Xin chào', 'Hello')).toBe('Hello');
    expect(isLocale('ja')).toBe(true);
  });
  it('Japanese: explicit argument, then dictionary (by Vietnamese string), then English', () => {
    expect(tr('ja')('Trang chủ', 'Home')).toBe('ホーム'); // dictionary
    expect(tr('ja')('Trang chủ', 'Home', 'トップ')).toBe('トップ'); // explicit wins
    expect(tr('ja')('Một câu chưa dịch', 'Untranslated')).toBe('Untranslated'); // never blank
    expect(tr('ja')('Đà Nẵng', 'Da Nang')).toBe('ダナン市'); // province names
  });
  it('formats dates in the Vietnam timezone', () => {
    expect(formatDate('vi', '2026-03-12T17:30:00Z')).toBe('13/03/2026'); // 00:30 next day in UTC+7
    expect(formatDate('vi', null)).toBe('');
    expect(formatDate('ja', '2026-03-12T17:30:00Z')).toBe('2026/03/13');
  });
});

describe('pagination links', () => {
  it('omits empty params and page 1', () => {
    expect(pageHref('/tim-kiem', { q: 'học bổng', empty: '' }, 1)).toBe('/tim-kiem?q=h%E1%BB%8Dc+b%E1%BB%95ng');
    expect(pageHref('/x', {}, 3)).toBe('/x?page=3');
    expect(pageHref('/x', {}, 1)).toBe('/x');
  });
});

describe('ApiError', () => {
  it('maps server validation details to field messages (first message wins)', () => {
    const e = new ApiError(400, 'VALIDATION', 'Dữ liệu không hợp lệ.', [
      { path: 'email', message: 'Sai định dạng' },
      { path: 'email', message: 'khác' },
      { path: 'password', message: 'Quá ngắn' },
    ]);
    expect(e.fieldErrors()).toEqual({ email: 'Sai định dạng', password: 'Quá ngắn' });
    expect(new ApiError(500, 'X', 'm').fieldErrors()).toEqual({});
  });
});

describe('Google Maps links for the contact address', () => {
  const addr = '43D/46 Hồ Văn Huê, P. Đức Nhuận, TP. HCM';
  it('builds the embed and the click-through from the address on the page', () => {
    const m = googleMapsLinks(`  ${addr}  `, { hl: 'ja' })!;
    expect(m.embed).toBe(`https://www.google.com/maps?q=${encodeURIComponent(addr)}&z=16&hl=ja&output=embed`);
    expect(m.open).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`);
    expect(decodeURIComponent(m.open)).toContain('43D/46 Hồ Văn Huê');
  });
  it('uses an administrator link only when it really is Google Maps', () => {
    expect(googleMapsLinks(addr, { override: 'https://maps.app.goo.gl/abc123' })!.open).toBe('https://maps.app.goo.gl/abc123');
    expect(googleMapsLinks(addr, { override: 'https://www.google.com/maps/place/x' })!.open).toBe('https://www.google.com/maps/place/x');
    for (const bad of [
      'https://www.openstreetmap.org/?mlat=10.8',
      'javascript:alert(1)',
      'https://www.google.com.evil.example/maps',
      'http://www.google.com/maps',
      'https://evil.example/?https://www.google.com/maps',
      '',
    ]) {
      expect(googleMapsLinks(addr, { override: bad })!.open).toContain('https://www.google.com/maps/search/?api=1&query=');
    }
  });
  it('no address, no map', () => {
    expect(googleMapsLinks('   ')).toBeNull();
  });
});
