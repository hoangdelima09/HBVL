import type { ConnectionOptions } from 'bullmq';

/** BullMQ wants plain connection options (it manages its own ioredis connections, incl. blocking ones). */
export function bullConnection(redisUrl: string): ConnectionOptions {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

export const EMAIL_QUEUE = 'email';
