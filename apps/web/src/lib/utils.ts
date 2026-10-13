import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const mediaSrc = (path: string | undefined | null) => path ?? undefined;

export function pageHref(base: string, params: Record<string, string | number | undefined>, page: number): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  if (page > 1) sp.set('page', String(page));
  else sp.delete('page');
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
