import { describe, expect, it } from 'vitest';
import { extractMediaIds, sanitizeRichText } from './sanitize';

describe('sanitizeRichText (stored XSS defence)', () => {
  const cases: [string, string, RegExp][] = [
    ['script tag', '<p>a</p><script>alert(1)</script>', /<script|alert/i],
    ['onerror handler', '<img src="https://x.test/a.png" onerror="alert(1)">', /onerror/i],
    ['javascript: href', '<a href="javascript:alert(1)">x</a>', /javascript:/i],
    ['data: image', '<img src="data:image/svg+xml;base64,PHN2Zz4=">', /data:/i],
    ['svg', '<svg onload=alert(1)></svg>', /<svg/i],
    ['style tag content', '<style>body{display:none}</style>x', /display:none/],
    ['iframe from evil host', '<iframe src="https://evil.example/x"></iframe>', /evil\.example/],
    ['iframe javascript', '<iframe src="javascript:alert(1)"></iframe>', /javascript:/i],
    ['protocol-relative', '<a href="//evil.example">x</a>', /evil\.example/],
    ['inline style', '<p style="position:fixed;top:0">x</p>', /style=/i],
    ['form', '<form action="https://evil.example"><input></form>', /<form|<input/i],
    ['arbitrary class', '<p class="fixed inset-0 z-50">x</p>', /fixed|inset/],
  ];
  it.each(cases)('removes %s', (_n, input, bad) => {
    expect(sanitizeRichText(input).html).not.toMatch(bad);
  });

  it('keeps allowed formatting, safe links and approved embeds', () => {
    const r = sanitizeRichText(
      '<h2>Tiêu đề</h2><p>Xin <strong>chào</strong> <a href="https://hbvl.example/a" target="_blank">link</a></p>' +
        '<iframe src="https://www.youtube-nocookie.com/embed/abc" title="v"></iframe><p class="has-text-align-center">c</p>',
    );
    expect(r.html).toContain('<h2>Tiêu đề</h2>');
    expect(r.html).toContain('rel="noopener noreferrer"');
    expect(r.html).toContain('youtube-nocookie.com/embed/abc');
    expect(r.html).toContain('has-text-align-center');
  });

  it('strips WordPress block comments but keeps content', () => {
    const r = sanitizeRichText('<!-- wp:paragraph --><p>Xin chào</p><!-- /wp:paragraph -->');
    expect(r.html).toBe('<p>Xin chào</p>');
    expect(r.text).toBe('Xin chào');
  });

  it('reports removed tags for the migration report', () => {
    const r = sanitizeRichText('<p>a</p><script>x</script><form></form><form></form>');
    expect(r.removed).toMatchObject({ script: 1, form: 2 });
  });

  it('computes folded search text (no diacritics, đ→d)', () => {
    expect(sanitizeRichText('<p>Học bổng Đồng Tháp</p>').searchText).toBe('hoc bong dong thap');
  });
});

describe('extractMediaIds', () => {
  it('finds referenced media assets', () => {
    const id = '01a1225f-93a8-764f-801e-9720b124c201';
    expect(extractMediaIds(`<img src="/api/v1/media/${id}/large">`)).toEqual([id]);
  });
});
