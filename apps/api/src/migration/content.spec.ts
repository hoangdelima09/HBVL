import { describe, expect, it } from 'vitest';
import { autop, normalizeLegacyContent, originalUploadPath, type ContentContext } from './content';

const ctx: ContentContext = {
  siteUrls: ['http://localhost/sampleweb/wordpress'],
  resolveUpload: (rel) => (rel === '2026/08/a.jpg' ? { id: 'asset-1' } : null),
  resolveLegacyLink: (id) => (id === '6' ? '/bai-viet/hello' : null),
};

describe('legacy content normalisation', () => {
  it('wraps classic-editor text in paragraphs and keeps existing block markup untouched', () => {
    expect(autop('Dòng 1\nDòng 2\n\nĐoạn 2')).toBe('<p>Dòng 1<br>Dòng 2</p>\n<p>Đoạn 2</p>');
    expect(autop('<p>Đã có</p>')).toBe('<p>Đã có</p>');
  });
  it('strips WordPress block comments', () => {
    const r = normalizeLegacyContent('<!-- wp:paragraph --><p>Xin chào</p><!-- /wp:paragraph -->', ctx);
    expect(r.html).toBe('<p>Xin chào</p>');
  });
  it('maps uploads (including derived sizes) to migrated media and removes unresolved images with a report', () => {
    const r = normalizeLegacyContent(
      '<p><img src="http://localhost/sampleweb/wordpress/wp-content/uploads/2026/08/a-300x200.jpg" alt="A"><img src="/wp-content/uploads/2026/08/missing.png"></p>',
      ctx,
    );
    expect(r.html).toContain('/api/v1/media/asset-1/large');
    expect(r.html).not.toContain('missing.png');
    expect(r.unresolvedMedia).toEqual(['2026/08/missing.png']);
    expect(r.mediaIds).toEqual(['asset-1']);
  });
  it('rewrites links to the old site to relative paths and ?p=ID to the new URL', () => {
    const r = normalizeLegacyContent(
      '<p><a href="http://localhost/sampleweb/wordpress/?p=6">a</a> <a href="http://localhost/sampleweb/wordpress/gioi-thieu/">b</a> <a href="https://example.org/x">c</a></p>',
      ctx,
    );
    expect(r.html).toContain('href="/bai-viet/hello"');
    expect(r.html).toContain('href="/gioi-thieu/"');
    expect(r.html).toContain('https://example.org/x');
    expect(r.rewrittenLinks).toBe(2);
  });
  it('drops gallery shortcodes (reported) and unwraps captions', () => {
    const r = normalizeLegacyContent('<p>x</p>[gallery ids="1,2"][caption id="a"]<img src="https://cdn.example.org/i.jpg"> Chú thích[/caption]', ctx);
    expect(r.shortcodes.some((s) => s.startsWith('[gallery'))).toBe(true);
    expect(r.html).toContain('<figure>');
    expect(r.html).not.toContain('[gallery');
  });
  it('removes scripts, event handlers and reports removed tags', () => {
    const r = normalizeLegacyContent('<p onclick="x()">a</p><script>alert(1)</script><form><input></form>', ctx);
    expect(r.html).not.toMatch(/script|onclick|form/);
    expect(r.removed).toMatchObject({ script: 1, form: 1 });
  });
  it('derives original upload paths', () => {
    expect(originalUploadPath('2026/08/x-1024x768.jpg')).toBe('2026/08/x.jpg');
    expect(originalUploadPath('2026/08/x-scaled.png')).toBe('2026/08/x.png');
    expect(originalUploadPath('2026/08/x.png')).toBe('2026/08/x.png');
  });
});
