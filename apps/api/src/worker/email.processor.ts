import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@hbvl/database';
import { Job, Worker } from 'bullmq';
import nodemailer, { type Transporter } from 'nodemailer';
import { decrypt } from '../auth/crypto';
import { ENV, type Env } from '../config/env';
import type { EmailMessage } from '../outbox/outbox.service';
import { bullConnection, EMAIL_QUEUE } from './queue';

/**
 * Delivers e-mail with bounded retries (BullMQ exponential backoff). States are honest:
 *   SENT_TO_PROVIDER = the SMTP server accepted the message — NOT "delivered". DELIVERED is only set from a provider delivery event
 *   (none exists for local Mailpit), so this worker never claims it.
 */
@Injectable()
export class EmailProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('EmailProcessor');
  private worker!: Worker;
  private transport!: Transporter;

  constructor(
    private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap() {
    this.transport = nodemailer.createTransport({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      secure: this.env.SMTP_SECURE,
      ...(this.env.SMTP_USER ? { auth: { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD } } : {}),
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
    this.worker = new Worker(EMAIL_QUEUE, (job) => this.process(job), { connection: bullConnection(this.env.REDIS_URL), concurrency: 5 });
    this.worker.on('failed', (job, err) => void this.onFailed(job, err));
    this.worker.on('error', (e) => this.log.warn(`worker error: ${e.message}`));
  }

  async onApplicationShutdown() {
    await this.worker?.close(); // waits for in-flight jobs
    this.transport?.close();
  }

  private async process(job: Job<{ outboxId: string }>) {
    const ev = await this.prisma.outboxEvent.findUnique({ where: { id: job.data.outboxId } });
    if (!ev || ev.status === 'DONE') return; // idempotent: a redelivered job never sends twice once marked DONE
    const enc = (ev.payload as { enc?: string }).enc;
    if (!enc) throw new Error('payload already scrubbed');
    const msg = JSON.parse(decrypt(enc, this.env.MFA_ENCRYPTION_KEY)) as EmailMessage;
    const attempt = job.attemptsMade + 1;
    try {
      const info = await this.transport.sendMail({ from: this.env.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, replyTo: msg.replyTo });
      await this.prisma.$transaction([
        this.prisma.emailDeliveryAttempt.create({
          data: {
            outboxEventId: ev.id,
            attempt,
            state: 'SENT_TO_PROVIDER',
            providerResponse: String(info.response ?? '').slice(0, 480),
            messageId: String(info.messageId ?? '').slice(0, 190),
          },
        }),
        // scrub: one-time links must not stay in the database after delivery
        this.prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: 'DONE', processedAt: new Date(), payload: { kind: msg.kind, scrubbed: true }, lastError: null } }),
        ...(ev.aggregateType === 'contact'
          ? [this.prisma.contactMessage.updateMany({ where: { id: ev.aggregateId }, data: { mailState: 'SENT_TO_PROVIDER', mailError: null } })]
          : []),
      ]);
    } catch (e) {
      await this.prisma.emailDeliveryAttempt.create({ data: { outboxEventId: ev.id, attempt, state: 'FAILED', providerResponse: (e as Error).message.slice(0, 480) } });
      throw e;
    }
  }

  private async onFailed(job: Job<{ outboxId: string }> | undefined, err: Error) {
    if (!job) return;
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    const ev = await this.prisma.outboxEvent.findUnique({ where: { id: job.data.outboxId }, select: { aggregateType: true, aggregateId: true } });
    await this.prisma.outboxEvent
      .update({
        where: { id: job.data.outboxId },
        data: exhausted ? { status: 'DEAD', lastError: err.message.slice(0, 480) } : { lastError: err.message.slice(0, 480) },
      })
      .catch(() => undefined);
    if (exhausted && ev?.aggregateType === 'contact') {
      await this.prisma.contactMessage.updateMany({ where: { id: ev.aggregateId }, data: { mailState: 'FAILED', mailError: err.message.slice(0, 480) } });
    }
  }
}
