import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createLogger, PinoNestLogger } from './common/logger';
import { loadEnv } from './config/env';
import { WorkerModule } from './worker/worker.module';

/** Background worker entrypoint: outbox relay → BullMQ → SMTP, plus maintenance. No HTTP server; graceful on SIGTERM. */
async function main() {
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: new PinoNestLogger(createLogger(env.LOG_LEVEL)) });
  app.enableShutdownHooks();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
