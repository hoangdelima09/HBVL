import { describe, expect, it } from 'vitest';
import { phpUnserialize, PhpUnserializeError, tryPhpUnserialize } from './php-unserialize';

describe('phpUnserialize', () => {
  it('parses WordPress capabilities', () => {
    expect(phpUnserialize('a:1:{s:13:"administrator";b:1;}')).toEqual({ administrator: true });
    expect(phpUnserialize('a:2:{s:10:"subscriber";b:1;s:13:"riseup_member";b:0;}')).toEqual({ subscriber: true, riseup_member: false });
  });
  it('uses UTF-8 byte lengths like PHP', () => {
    expect(phpUnserialize('s:4:"Đà";')).toBe('Đà');
    expect(() => phpUnserialize('s:2:"Đà";')).toThrow(PhpUnserializeError); // character count instead of byte count
  });
  it('parses nested arrays, lists, ints, floats, null', () => {
    expect(phpUnserialize('a:3:{i:0;i:7;i:1;d:1.5;i:2;N;}')).toEqual([7, 1.5, null]);
    expect(phpUnserialize('a:1:{s:4:"file";a:2:{s:5:"width";i:256;s:6:"height";i:256;}}')).toEqual({ file: { width: 256, height: 256 } });
  });
  it('refuses objects and custom serialisation (no instantiation, ever)', () => {
    expect(() => phpUnserialize('O:8:"stdClass":0:{}')).toThrow(PhpUnserializeError);
    expect(() => phpUnserialize('C:3:"Foo":0:{}')).toThrow(PhpUnserializeError);
    expect(() => phpUnserialize('a:1:{i:0;O:8:"stdClass":0:{}}')).toThrow(PhpUnserializeError);
  });
  it('rejects malformed, truncated, wrongly-sized and trailing input', () => {
    for (const bad of ['a:1:{s:3:"ab";b:1;}', 'a:2:{i:0;i:1;}', 's:5:"abc";', 'i:abc;', 'a:1:{b:1;i:1;}', 'b:2;', 'a:1:{i:0;i:1;}garbage', '', 'x:1;']) {
      expect(() => phpUnserialize(bad), bad).toThrow(PhpUnserializeError);
    }
  });
  it('is depth-limited', () => {
    const deep = 'a:1:{i:0;'.repeat(40) + 'i:1;' + '}'.repeat(40);
    expect(() => phpUnserialize(deep)).toThrow(/too deep/);
  });
  it('ignores __proto__ keys', () => {
    const v = phpUnserialize('a:1:{s:9:"__proto__";a:1:{s:1:"x";i:1;}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBeNull();
    expect(v['__proto__']).toBeUndefined();
  });
  it('tryPhpUnserialize never throws', () => {
    expect(tryPhpUnserialize('not serialized')).toBeUndefined();
    expect(tryPhpUnserialize('a:1:{broken')).toBeUndefined();
    expect(tryPhpUnserialize(null)).toBeUndefined();
  });
});
