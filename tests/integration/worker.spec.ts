import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/app';
import { mailpit } from './support/mailpit';

let t: TestApp;
let worker: INestApplicationContext | undefined;

async function startWorker(env: Record<string, string> = {}) {
  const { resetEnvCache } = await import('../../apps/api/src/config/env');
  Object.assign(process.env, env);
  resetEnvCache();
  const { WorkerModule } = await import('../../apps/api/src/worker/worker.module');
  worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  worker.enableShutdownHooks();
  return worker;
}
async function stopWorker() {
  await worker?.close();
  worker = undefined;
}

beforeAll(async () => {
  t = await createTestApp();
  await mailpit.clear();
});
afterAll(async () => {
  await stopWorker();
  await t.close();
});
beforeEach(async () => {
  await stopWorker();
  await t.reset();
  await mailpit.clear();
});

const contact = { name: 'Trần Thị B', email: 'tran.b@example.test', subject: 'Chủ đề kiểm tra worker', message: 'Nội dung thử worker.' };

describe('outbox → queue → SMTP', () => {
  it('delivers the contact notification to Mailpit, marks SENT_TO_PROVIDER (never "delivered"), scrubs the payload', async () => {
    const member = await t.loginAs(await t.makeUser());
    const r = await member.post('/contact', contact);
    expect(r.status).toBe(201);
    await startWorker();
    const msg = await mailpit.waitFor((m) => m.Subject.includes(r.body.receiptCode));
    expect(msg).toBeDefined();
    expect(msg!.To[0]!.Address).toBe(process.env.CONTACT_INBOX_EMAIL);
    expect(msg!.ReplyTo?.[0]?.Address).toBe(contact.email);
    // wait for the DB state transition
    let state = '';
    for (let i = 0; i < 40 && state !== 'SENT_TO_PROVIDER'; i++) {
      state = (await t.admin.query(`SELECT "mailState" FROM contact_messages`)).rows[0].mailState;
      if (state !== 'SENT_TO_PROVIDER') await new Promise((s) => setTimeout(s, 250));
    }
    expect(state).toBe('SENT_TO_PROVIDER');
    const ob = await t.admin.query(`SELECT status, payload FROM outbox_events WHERE "aggregateType"='contact'`);
    expect(ob.rows[0].status).toBe('DONE');
    expect(ob.rows[0].payload.scrubbed).toBe(true);
    expect(ob.rows[0].payload.enc).toBeUndefined();
    const attempts = await t.admin.query(`SELECT state FROM email_delivery_attempts`);
    expect(attempts.rows.map((a) => a.state)).toEqual(['SENT_TO_PROVIDER']);
    expect((await t.admin.query(`SELECT count(*)::int n FROM contact_messages WHERE "mailState"='DELIVERED'`)).rows[0].n).toBe(0);
  });

  it('SMTP failure keeps the message, retries with backoff, then marks FAILED with a readable error', async () => {
    const member = await t.loginAs(await t.makeUser());
    await member.post('/contact', contact);
    const goodPort = process.env.SMTP_PORT!;
    await startWorker({ SMTP_PORT: '1', EMAIL_ATTEMPTS: '2', EMAIL_BACKOFF_MS: '200' });
    let row: { mailState: string; mailError: string | null } = { mailState: '', mailError: null };
    for (let i = 0; i < 60 && row.mailState !== 'FAILED'; i++) {
      row = (await t.admin.query(`SELECT "mailState", "mailError" FROM contact_messages`)).rows[0];
      if (row.mailState !== 'FAILED') await new Promise((s) => setTimeout(s, 250));
    }
    process.env.SMTP_PORT = goodPort;
    expect(row.mailState).toBe('FAILED');
    expect(row.mailError).toBeTruthy();
    expect((await t.admin.query(`SELECT count(*)::int n FROM contact_messages`)).rows[0].n).toBe(1); // data is never lost
    const attempts = await t.admin.query(`SELECT count(*)::int n FROM email_delivery_attempts WHERE state='FAILED'`);
    expect(attempts.rows[0].n).toBe(2);
    expect((await t.admin.query(`SELECT status FROM outbox_events`)).rows[0].status).toBe('DEAD');
  });

  it('a verification mail is sent once even if the relay ticks repeatedly', async () => {
    const c = await t.newClient();
    await c.post('/auth/register', { displayName: 'An', username: 'mailonce', email: 'mailonce@example.test', password: 'long-enough-pass', passwordConfirm: 'long-enough-pass' });
    await startWorker();
    const msg = await mailpit.waitFor((m) => m.To.some((a) => a.Address === 'mailonce@example.test'));
    expect(msg).toBeDefined();
    const text = await mailpit.fullText(msg!.ID);
    expect(text).toMatch(/xac-minh-email\?token=/);
    await new Promise((s) => setTimeout(s, 2500));
    const all = (await mailpit.messages()).filter((m) => m.To.some((a) => a.Address === 'mailonce@example.test'));
    expect(all).toHaveLength(1);
  });
});
