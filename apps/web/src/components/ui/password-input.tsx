'use client';

import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/form';
import { tr, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { locale: Locale };

/** Password field with a show/hide toggle; the toggle is a real button with `aria-pressed` so screen readers announce its state. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput({ locale, className, disabled, ...p }, ref) {
  const t = tr(locale);
  const [visible, setVisible] = useState(false);
  const label = visible ? t('Ẩn mật khẩu', 'Hide password', 'パスワードを隠す') : t('Hiện mật khẩu', 'Show password', 'パスワードを表示');
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} className={cn('pr-11', className)} disabled={disabled} {...p} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-500 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {visible ? <EyeOff aria-hidden className="h-4.5 w-4.5" /> : <Eye aria-hidden className="h-4.5 w-4.5" />}
      </button>
    </div>
  );
});
