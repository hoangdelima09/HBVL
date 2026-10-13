import { describe, expect, it } from 'vitest';
import { foldVietnamese, htmlToText, normalizeEmail, normalizeUsername, safeReturnTo, slugify } from './text';
import { registerSchema, feedbackSchema } from './schemas';

describe('foldVietnamese', () => {
  it('removes diacritics and maps đ→d', () => {
    expect(foldVietnamese('Đồng Tháp')).toBe('dong thap');
    expect(foldVietnamese('Quảng Ngãi')).toBe('quang ngai');
    expect(foldVietnamese('ĐẮK LẮK')).toBe('dak lak');
  });
  it('is stable for decomposed (NFD) input', () => {
    expect(foldVietnamese('Hu\u1ebf'.normalize('NFD'))).toBe('hue');
  });
});

describe('slugify', () => {
  it('builds ascii slugs', () => {
    expect(slugify('Trò chơi/sinh hoạt tập thể')).toBe('tro-choi-sinh-hoat-tap-the');
  });
});

describe('identity normalisation', () => {
  it('normalises username & email deterministically', () => {
    expect(normalizeUsername('  Qm1719 ')).toBe('qm1719');
    expect(normalizeEmail(' A@B.COM ')).toBe('a@b.com');
  });
});

describe('htmlToText', () => {
  it('strips tags and keeps text', () => {
    expect(htmlToText('<p>Xin&nbsp;chào <b>bạn</b></p>')).toBe('Xin chào bạn');
  });
  it('yields blank for markup-only content', () => {
    expect(htmlToText('<p> </p><p><br></p>')).toBe('');
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['//evil.com', '/'],
    ['https://evil.com', '/'],
    ['/\\evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/gui-bai', '/gui-bai'],
    ['/bai-cua-toi?page=2', '/bai-cua-toi?page=2'],
    [undefined, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});

describe('schemas', () => {
  it('rejects extra privileged fields on register (mass assignment)', () => {
    const r = registerSchema.safeParse({
      displayName: 'A',
      username: 'abc',
      email: 'a@b.co',
      password: 'x'.repeat(12),
      passwordConfirm: 'x'.repeat(12),
      role: 'ADMIN',
    });
    expect(r.success).toBe(false);
  });
  it('keeps backslashes and unicode in feedback message', () => {
    const msg = "Kiểm tra O'Reilly C:\\notes\\new";
    const r = feedbackSchema.parse({ subject: 'Chủ đề', message: msg });
    expect(r.message).toBe(msg);
  });
  it('enforces feedback limits', () => {
    expect(feedbackSchema.safeParse({ subject: 'a'.repeat(161), message: 'x' }).success).toBe(false);
    expect(feedbackSchema.safeParse({ subject: 'a', message: 'x'.repeat(5001) }).success).toBe(false);
    expect(feedbackSchema.safeParse({ subject: 'a'.repeat(160), message: 'x'.repeat(5000) }).success).toBe(true);
  });
});
