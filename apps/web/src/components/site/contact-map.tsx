'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, MapPin } from 'lucide-react';

/**
 * Small Google map of the office. The whole card is ONE link: a click (or Enter) opens the address on Google Maps in a new tab.
 *
 * The Google frame is added only after the page itself has finished loading and the card is near the viewport, so a slow or blocked
 * google.com can never hold up the page (or its `load` event). Until then — and without JavaScript — the link and the address still work.
 * The frame is decorative for assistive technology; the label sits at the top so Google's own attribution at the bottom stays visible.
 */
export function ContactMap({ embedSrc, href, title, label, cta, address }: { embedSrc: string; href: string; title: string; label: string; cta: string; address: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    let io: IntersectionObserver | undefined;
    const start = () => {
      if (!box.current) return;
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setShow(true);
            io?.disconnect();
          }
        },
        { rootMargin: '300px' },
      );
      io.observe(box.current);
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      window.removeEventListener('load', start);
      io?.disconnect();
    };
  }, []);
  return (
    <div ref={box} className="group relative h-[26rem] bg-brand-50">
      <div className="absolute inset-0 grid place-items-center px-6 text-center text-ink-2" aria-hidden>
        <span>
          <MapPin className="mx-auto h-8 w-8 text-brand-600" />
          <span className="mt-2 block text-sm font-medium">{address}</span>
        </span>
      </div>
      {show && (
        <iframe
          title={title}
          referrerPolicy="no-referrer"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full border-0"
          src={embedSrc}
          data-testid="contact-map"
        />
      )}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="contact-map-link"
        aria-label={label}
        className="absolute inset-0 flex items-start justify-end p-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-brand-500"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-brand-700 shadow-card group-hover:bg-brand-600 group-hover:text-white">
          <ExternalLink className="h-4 w-4" aria-hidden />
          {cta}
        </span>
      </a>
    </div>
  );
}
