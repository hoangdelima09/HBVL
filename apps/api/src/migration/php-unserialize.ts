/**
 * Minimal, SAFE parser for PHP `serialize()` output as stored by WordPress (user capabilities, attachment metadata, options).
 * - It never instantiates classes: objects (`O:`) and custom-serialised data (`C:`) are rejected, so a crafted dump cannot execute anything.
 * - It is length-checked (byte lengths, like PHP), depth-limited and size-limited, and throws `PhpUnserializeError` on any malformed input.
 * Supported: `N;`, `b:`, `i:`, `d:`, `s:`, `a:`.
 */
export class PhpUnserializeError extends Error {}

export type PhpValue = null | boolean | number | string | PhpValue[] | { [key: string]: PhpValue };

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 16;
const MAX_ITEMS = 100_000;

export function phpUnserialize(input: string): PhpValue {
  const buf = Buffer.from(input, 'utf8');
  if (buf.length > MAX_BYTES) throw new PhpUnserializeError('input too large');
  let pos = 0;
  let items = 0;

  const fail = (msg: string): never => {
    throw new PhpUnserializeError(`${msg} at byte ${pos}`);
  };
  const expect = (ch: string) => {
    if (buf[pos] !== ch.charCodeAt(0)) fail(`expected "${ch}"`);
    pos += 1;
  };
  const readUntil = (ch: string): string => {
    const end = buf.indexOf(ch, pos, 'latin1');
    if (end < 0) fail(`missing "${ch}"`);
    const s = buf.toString('latin1', pos, end);
    pos = end + 1;
    return s;
  };
  const readInt = (terminator: string): number => {
    const s = readUntil(terminator);
    if (!/^-?\d{1,18}$/.test(s)) fail('bad integer');
    return Number(s);
  };

  function value(depth: number): PhpValue {
    if (depth > MAX_DEPTH) fail('nesting too deep');
    if (++items > MAX_ITEMS) fail('too many items');
    const type = String.fromCharCode(buf[pos] ?? 0);
    switch (type) {
      case 'N':
        pos += 1;
        expect(';');
        return null;
      case 'b': {
        pos += 1;
        expect(':');
        const v = readUntil(';');
        if (v !== '0' && v !== '1') fail('bad boolean');
        return v === '1';
      }
      case 'i': {
        pos += 1;
        expect(':');
        return readInt(';');
      }
      case 'd': {
        pos += 1;
        expect(':');
        const s = readUntil(';');
        if (s === 'NAN') return Number.NaN;
        if (s === 'INF') return Number.POSITIVE_INFINITY;
        if (s === '-INF') return Number.NEGATIVE_INFINITY;
        if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) fail('bad float');
        return Number(s);
      }
      case 's': {
        pos += 1;
        expect(':');
        const len = readInt(':');
        if (len < 0 || pos + len + 2 > buf.length) fail('string length out of range');
        expect('"');
        const s = buf.toString('utf8', pos, pos + len);
        pos += len;
        expect('"');
        expect(';');
        return s;
      }
      case 'a': {
        pos += 1;
        expect(':');
        const n = readInt(':');
        if (n < 0 || n > MAX_ITEMS) fail('bad array size');
        expect('{');
        const entries: [string | number, PhpValue][] = [];
        for (let i = 0; i < n; i++) {
          const k = value(depth + 1);
          if (typeof k !== 'string' && typeof k !== 'number') fail('array key must be int or string');
          entries.push([k as string | number, value(depth + 1)]);
        }
        expect('}');
        // PHP arrays with keys 0..n-1 are lists; everything else becomes a null-prototype-free plain record (keys are strings).
        if (entries.every(([k], i) => k === i)) return entries.map(([, v]) => v);
        const out: Record<string, PhpValue> = Object.create(null) as Record<string, PhpValue>;
        for (const [k, v] of entries) {
          if (String(k) === '__proto__') continue;
          out[String(k)] = v;
        }
        return out;
      }
      case 'O':
      case 'C':
      case 'E':
      case 'r':
      case 'R':
        return fail(`unsupported type "${type}" (objects/references are refused)`);
      default:
        return fail(`unknown type "${type}"`);
    }
  }

  const result = value(0);
  if (pos !== buf.length) fail('trailing data');
  return result;
}

/** Never throws: returns `undefined` for non-serialised or malformed text (the caller decides whether that is an issue). */
export function tryPhpUnserialize(input: string | null | undefined): PhpValue | undefined {
  if (!input || !/^(a|s|i|b|d|N):?/.test(input)) return undefined;
  try {
    return phpUnserialize(input);
  } catch {
    return undefined;
  }
}
