import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createPrismaClient, seedReferenceData } from '../src';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });
  try {
    const result = await seedReferenceData(prisma);
    console.log('Reference data seeded:', result);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
