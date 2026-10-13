import { z } from 'zod';
import { LIMITS, LOCALES, POST_STATUSES } from '@hbvl/contracts';

export const localeQuery = z.enum(LOCALES).default('vi');

export const listQuery = z.object({
  locale: localeQuery,
  category: z
    .string()
    .regex(/^[a-z0-9-]{1,100}$/)
    .optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
});

export const localeOnly = z.object({ locale: localeQuery });
export const searchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  locale: localeQuery,
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
});

export const mineQuery = z.object({
  status: z.enum(POST_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(10),
});

export const adminListQuery = mineQuery.extend({ q: z.string().trim().max(100).optional() });
