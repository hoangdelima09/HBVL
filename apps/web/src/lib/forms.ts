import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { ApiError } from './client';

/** Map server-side (zod) field errors onto the react-hook-form fields; returns a general message for non-field errors. */
export function applyApiErrors<T extends FieldValues>(form: UseFormReturn<T>, err: unknown, fallback: string): string | undefined {
  if (err instanceof ApiError) {
    const fields = err.fieldErrors();
    let any = false;
    for (const [path, message] of Object.entries(fields)) {
      form.setError(path as Path<T>, { type: 'server', message });
      any = true;
    }
    if (!any || err.status !== 400) return err.message;
    return undefined;
  }
  return fallback;
}
