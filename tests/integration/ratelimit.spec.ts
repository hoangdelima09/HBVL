import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// This file runs with throttling ENABLED (every other integration file disables it so the suites do not interfere).
process.env.TEST_KEEP_THROTTLE = '1';

import type { TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  const { createTestApp } = await import('./support/app');
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

describe('rate limiting (Redis, real throttling enabled)', () => {
  it('login (per address): the 21st attempt within a minute is refused with 429 + Retry-After', async () => {
    const c = await t.newClient();
    const statuses: number[] = [];
    let last: { headers: Record<string, string>; body: { error: { code: string } } } | undefined;
    for (let i = 0; i < 22; i++) {
      // different unknown usernames: the account lock-out below cannot be what stops us
      const r = await c.post('/auth/login', { portal: 'MEMBER', identifier: `ghost${i}`, password: 'wrong-password-123' });
      statuses.push(r.status);
      last = r;
    }
    expect(statuses.slice(0, 20), JSON.stringify(statuses)).toEqual(Array(20).fill(401));
    expect(statuses.slice(20)).toEqual([429, 429]);
    expect(last!.body.error.code).toBe('RATE_LIMITED');
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('login (per account): 10 wrong passwords lock the account, even against the right password, and the answer is the same 429 family', async () => {
    const u = await t.makeUser();
    const c = await t.newClient();
    for (let i = 0; i < 10; i++) expect((await c.post('/auth/login', { portal: 'MEMBER', identifier: u.username, password: 'wrong-password-123' })).status).toBe(401);
    const locked = await c.post('/auth/login', { portal: 'MEMBER', identifier: u.username, password: u.password });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    const row = await t.admin.query(`SELECT "lockedUntil" FROM users WHERE id = $1`, [u.id]);
    expect(row.rows[0].lockedUntil).not.toBeNull();
  });

  it('registration: more than 3 sign-ups per minute from one address are refused', async () => {
    const c = await t.newClient();
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/auth/register', {
        displayName: `N${i}`,
        username: `limit${i}x`,
        email: `limit${i}@example.test`,
        password: 'long-enough-pass',
        passwordConfirm: 'long-enough-pass',
      });
      results.push(r.status);
    }
    expect(results.slice(0, 3)).toEqual([201, 201, 201]);
    expect(results.slice(3).every((s) => s === 429)).toBe(true);
  });

  it('forgot-password: throttled per client; an unknown address is refused the same way every time', async () => {
    const c = await t.newClient();
    const results: number[] = [];
    for (let i = 0; i < 12; i++) results.push((await c.post('/auth/forgot-password', { email: 'nobody@example.test', portal: 'MEMBER' })).status);
    expect(new Set(results.slice(0, 10))).toEqual(new Set([results[0]])); // identical answer for an unknown address
    expect(results[0]).toBe(400);
    expect(results.slice(10).every((s) => s === 429)).toBe(true);
  });

  it('the throttle state lives in Redis (so it is shared by every API instance) and expires', async () => {
    const c = await t.newClient();
    await c.post('/auth/forgot-password', { email: 'x@example.test', portal: 'MEMBER' });
    const { Redis } = await import('ioredis');
    const redis = new Redis(process.env.REDIS_URL!);
    try {
      const keys = await redis.keys('rl:*');
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) expect(await redis.ttl(k)).toBeGreaterThan(0);
    } finally {
      redis.disconnect();
    }
  });
});
