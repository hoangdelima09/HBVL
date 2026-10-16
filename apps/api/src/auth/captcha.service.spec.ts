import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import { CaptchaService } from './captcha.service';

const make = (secret: string, nodeEnv: Env['NODE_ENV'] = 'test') => new CaptchaService({ TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: secret, NODE_ENV: nodeEnv } as Env);

afterEach(() => vi.unstubAllGlobals());

describe('CaptchaService', () => {
  it('Cloudflare test secrets answer locally outside production (1x passes, 2x/3x fail) and a missing token never passes', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await make('1x0000000000000000000000000000000AA').verify('XXXX.DUMMY.TOKEN.XXXX', '1.2.3.4')).toBe(true);
    expect(await make('2x0000000000000000000000000000000AA').verify('XXXX.DUMMY.TOKEN.XXXX', '1.2.3.4')).toBe(false);
    expect(await make('3x0000000000000000000000000000000AA').verify('XXXX.DUMMY.TOKEN.XXXX', '1.2.3.4')).toBe(false);
    expect(await make('1x0000000000000000000000000000000AA').verify(undefined, '1.2.3.4')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('real keys: asks Cloudflare with the secret, token and client IP; fails closed on rejection or network error', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ status: 200, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetch);
    const svc = make('0x-real-secret', 'production');
    expect(await svc.verify('tok', '1.2.3.4')).toBe(true);
    const body = fetch.mock.calls[0]![1].body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({ secret: '0x-real-secret', response: 'tok', remoteip: '1.2.3.4' });

    fetch.mockResolvedValueOnce({ status: 200, json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) });
    expect(await svc.verify('tok', '1.2.3.4')).toBe(false);
    fetch.mockRejectedValueOnce(new Error('network down'));
    expect(await svc.verify('tok', '1.2.3.4')).toBe(false);
  });
});
