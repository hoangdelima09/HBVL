import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-[0.95rem] text-ink placeholder:text-slate-500 shadow-subtle transition-all duration-150 focus-visible:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-600/20 focus-visible:outline-none aria-[invalid=true]:border-danger-600 aria-[invalid=true]:focus-visible:ring-danger-600/20 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed';

export interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean }) => ReactNode;
  className?: string;
}

/** Label ↔ control ↔ error association (WCAG 1.3.1 / 3.3.1): `aria-describedby` points at hint and error text. */
export function Field({ label, error, hint, required, children, className }: FieldProps) {
  const id = useId();
  const descIds = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
        {required && (
          <span aria-hidden className="text-danger-600">
            {' '}
            *
          </span>
        )}
      </label>
      {children({ id, 'aria-describedby': descIds, 'aria-invalid': error ? true : undefined, 'aria-required': required || undefined })}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-32 resize-y', className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cn(control, 'pr-9', className)} {...p} />;
});
