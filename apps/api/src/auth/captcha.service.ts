import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Cloudflare's documented test secrets: 1x… always passes, 2x… always fails, 3x… "token already spent". */
const TEST_SECRET = /^([123])x0{30,}AA$/;

/** Server-side check of a Cloudflare Turnstile token. Fails closed: no token, a network error or a timeout is "not verified". */
@Injectable()
export class CaptchaService {
  private readonly log = new Logger('Captcha');

  constructor(@Inject(ENV) private readonly env: Env) {}

  get siteKey(): string {
    return this.env.TURNSTILE_SITE_KEY;
  }

  async verify(token: string | undefined, ip: string): Promise<boolean> {
    if (!token) return false;
    const test = TEST_SECRET.exec(this.env.TURNSTILE_SECRET_KEY);
    if (test && this.env.NODE_ENV !== 'production') return test[1] === '1'; // dev/test: no call to Cloudflare
    try {
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        body: new URLSearchParams({ secret: this.env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(5000),
      });
      const body = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
      if (!body.success) this.log.warn(`Turnstile rejected a token: ${(body['error-codes'] ?? []).join(',') || res.status}`);
      return body.success === true;
    } catch (e) {
      this.log.warn(`Turnstile verification unavailable: ${(e as Error).message}`);
      return false;
    }
  }
}
