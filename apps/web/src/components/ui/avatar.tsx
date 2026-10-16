import { cn } from '@/lib/utils';

const TONES = [
  'bg-brand-100 text-brand-800',
  'bg-leaf-50 text-leaf-700',
  'bg-amber-100 text-amber-800',
  'bg-sky-100 text-sky-800',
  'bg-rose-100 text-rose-800',
  'bg-violet-100 text-violet-800',
];

/** Up to two initials ("Nguyễn Văn An" → "NA"); the tone is stable per name so a person keeps the same colour everywhere. */
function initials(name: string): { text: string; tone: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const text = words.length > 1 ? `${words[0]![0]}${words[words.length - 1]![0]}` : (words[0]?.slice(0, 2) ?? '?');
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return { text: text.toLocaleUpperCase('vi'), tone: TONES[h % TONES.length]! };
}

/** Profile picture, or the person's initials when they have none. Decorative next to a visible name (empty alt). */
export function Avatar({ src, name, size = 32, className }: { src?: string | null; name: string; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  if (src)
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={style}
        className={cn('shrink-0 rounded-full object-cover ring-1 ring-black/5', className)}
      />
    );
  const i = initials(name);
  return (
    <span aria-hidden style={style} className={cn('inline-grid shrink-0 select-none place-items-center rounded-full font-bold leading-none', i.tone, className)}>
      {i.text}
    </span>
  );
}
