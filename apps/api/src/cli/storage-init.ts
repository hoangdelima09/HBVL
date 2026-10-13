import 'reflect-metadata';
import { StorageService } from '../media/storage.service';
import { loadEnv } from '../config/env';

/** Idempotently creates the private bucket. Run once per environment (`pnpm storage:init`). */
async function main() {
  const storage = new StorageService(loadEnv());
  await storage.ensureBucket();
  console.log(`Bucket ready: ${storage.bucket}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
