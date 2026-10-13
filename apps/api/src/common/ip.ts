import { createHmac } from 'node:crypto';
import type { Request } from 'express';

/** Client IP as resolved by Express (`trust proxy` is configured explicitly; X-Forwarded-For is never trusted blindly). */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Short keyed hash for storing/logging an IP without keeping the address. */
export function hashIp(ip: string, pepper: string): string {
  return createHmac('sha256', pepper).update(ip).digest('hex').slice(0, 16);
}
