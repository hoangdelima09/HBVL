import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export * from './generated/client';

export interface CreateClientOptions {
  connectionString: string;
  /** Max pooled connections for THIS process (budget: replicas × poolMax ≤ server max_connections). */
  poolMax?: number;
  log?: ('query' | 'warn' | 'error')[];
}

/** Build a PrismaClient on the `pg` driver adapter (Prisma 7). */
export function createPrismaClient(opts: CreateClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: opts.connectionString,
    max: opts.poolMax ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({ adapter, log: opts.log });
}

export { seedReferenceData } from './reference-data';
