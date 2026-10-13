import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, verifyTotp } from './totp';
import { decrypt, encrypt } from './crypto';

describe('HOTP (RFC 4226 Appendix D vectors)', () => {
  const secret = Buffer.from('12345678901234567890');
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  it.each(expected.map((code, i) => [i, code] as const))('counter %i → %s', (counter, code) => {
    expect(hotp(secret, counter)).toBe(code);
  });
});

describe('TOTP (RFC 6238 SHA-1 vector, 8 digits truncated to 6)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('accepts the code for T=59s (counter 1 → 287082)', () => {
    expect(verifyTotp(secret, '287082', 59_000)).toBe(1);
  });
  it('rejects wrong codes and malformed input', () => {
    expect(verifyTotp(secret, '000000', 59_000)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', 59_000)).toBeNull();
    expect(verifyTotp(secret, '28708', 59_000)).toBeNull();
  });
  it('tolerates ±1 step and rejects beyond', () => {
    expect(verifyTotp(secret, '287082', 59_000 + 30_000)).toBe(1);
    expect(verifyTotp(secret, '287082', 59_000 + 90_000)).toBeNull();
  });
});

describe('base32', () => {
  it('round-trips', () => {
    const b = Buffer.from('hbvl-secret-bytes');
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });
});

describe('AES-GCM envelope', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  it('round-trips and detects tampering', () => {
    const env = encrypt('JBSWY3DPEHPK3PXP', key);
    expect(decrypt(env, key)).toBe('JBSWY3DPEHPK3PXP');
    const parts = env.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'), key)).toThrow();
  });
});
