import { resolve } from 'node:path';
import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 does not load .env by itself. Load the repo-root file unless variables are already set (CI/Docker).
config({ path: resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // Migrations/seed use the dedicated migrator role, never the runtime app role.
  datasource: { url: env('MIGRATION_DATABASE_URL') },
});
