'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/misc';
import { tr, type Locale } from '@/lib/i18n';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<TurnstileApi> | undefined;
/** Loads Cloudflare's script once (injected by our own nonced bundle, so the strict CSP's 'strict-dynamic' allows it). */
function loadTurnstile(): Promise<TurnstileApi> {
  loader ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => reject(new Error('turnstile'));
    document.head.appendChild(s);
  }).catch((e: unknown) => {
    loader = undefined; // allow a retry on the next mount
    throw e;
  });
  return loader;
}

/** Cloudflare Turnstile widget. `onToken(undefined)` when the token expires or the challenge errors. A token is single use: remount (change `key`) after each submit. */
export function Turnstile({ siteKey, locale, onToken }: { siteKey: string; locale: Locale; onToken: (token: string | undefined) => void }) {
  const t = tr(locale);
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    cb.current = onToken;
  }, [onToken]);
  useEffect(() => {
    let alive = true;
    let id: string | undefined;
    loadTurnstile()
      .then((api) => {
        if (!alive || !box.current) return;
        id = api.render(box.current, {
          sitekey: siteKey,
          language: locale,
          callback: (token: string) => cb.current(token),
          'expired-callback': () => cb.current(undefined),
          'error-callback': () => cb.current(undefined),
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey, locale]);
  if (failed)
    return (
      <Alert kind="error">
        {t(
          'Không tải được bước xác minh. Hãy tải lại trang hoặc tắt trình chặn quảng cáo rồi thử lại.',
          'Could not load the verification step. Reload the page or turn off your ad blocker and try again.',
        )}
      </Alert>
    );
  return <div ref={box} data-testid="captcha" className="min-h-[65px]" />;
}
