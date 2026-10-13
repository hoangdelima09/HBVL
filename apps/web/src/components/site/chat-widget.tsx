'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Bot, Send, X } from 'lucide-react';
import { LIMITS } from '@hbvl/contracts';
import { ApiError, post } from '@/lib/client';
import { localePath, tr, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface Source {
  title: string;
  path: string;
}
interface Msg {
  role: 'user' | 'assistant';
  text: string;
  sources?: Source[];
  error?: boolean;
}
interface ChatReply {
  answer: string;
  mode: 'ai' | 'fallback' | 'no-results';
  sources: Source[];
}

/** Floating site assistant. Answers come from the server (retrieval over published content + Gemini); the browser never sees an AI key. Replies are rendered as plain text. */
export function ChatWidget({ locale }: { locale: Locale }) {
  const t = tr(locale);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const suggestions = [
    t('Học bổng Vươn Lên là gì?', 'What is the Rise Up scholarship?'),
    t('Có sự kiện nào sắp tới?', 'Are there any upcoming events?'),
    t('Liên hệ quỹ bằng cách nào?', 'How can I contact the fund?'),
  ];

  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) openerRef.current?.focus(); // the opener is only mounted while closed, so focus can be restored only after this render
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [msgs, busy]);

  const close = () => setOpen(false);

  const send = async (raw: string) => {
    const message = raw.trim().slice(0, LIMITS.chatMessageMax);
    if (!message || busy) return;
    const history = msgs
      .filter((m) => !m.error)
      .slice(-LIMITS.chatHistoryTurns)
      .map((m) => ({ role: m.role, text: m.text.slice(0, LIMITS.chatHistoryTurnMax) }));
    setMsgs((m) => [...m, { role: 'user', text: message }]);
    setInput('');
    setBusy(true);
    try {
      const r = await post<ChatReply>('/chat', { message, locale, history });
      setMsgs((m) => [...m, { role: 'assistant', text: r.answer, sources: r.sources }]);
    } catch (e) {
      const limited = e instanceof ApiError && e.status === 429;
      setMsgs((m) => [
        ...m,
        {
          role: 'assistant',
          error: true,
          text: limited
            ? t('Bạn hỏi hơi nhanh. Vui lòng đợi một chút rồi thử lại.', 'You are asking too fast. Please wait a moment and try again.')
            : t('Chưa gửi được câu hỏi. Vui lòng thử lại.', 'Could not send your question. Please try again.'),
        },
      ]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      {!open && (
        <button
          ref={openerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('Mở trợ lý hỏi đáp', 'Open the Q&A assistant')}
          data-testid="chat-open"
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 print:hidden"
        >
          <Bot className="size-5" aria-hidden />
          <span className="hidden sm:inline">{t('Hỏi trợ lý', 'Ask assistant')}</span>
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label={t('Trợ lý hỏi đáp', 'Q&A assistant')}
          onKeyDown={(e) => e.key === 'Escape' && close()}
          data-testid="chat-panel"
          className="fixed bottom-4 right-4 z-50 flex h-[min(34rem,calc(100dvh-2rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl print:hidden"
        >
          <header className="flex items-center justify-between bg-brand-700 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Bot className="size-5" aria-hidden />
              <h2 className="text-sm font-bold">{t('Trợ lý Vươn Lên', 'Rise Up assistant')}</h2>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t('Đóng trợ lý', 'Close assistant')}
              className="rounded p-1 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              <X className="size-5" aria-hidden />
            </button>
          </header>

          <div ref={logRef} role="log" aria-live="polite" aria-label={t('Cuộc trò chuyện', 'Conversation')} className="flex-1 space-y-3 overflow-y-auto bg-paper px-3 py-3 text-sm">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <p className="text-ink-2">
                  {t(
                    'Xin chào! Mình trả lời dựa trên nội dung đã đăng trên website. Bạn muốn hỏi gì?',
                    'Hello! I answer from the content published on this website. What would you like to know?',
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="rounded-full border border-brand-200 bg-white px-3 py-1.5 text-left text-brand-700 hover:bg-brand-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  data-testid={m.role === 'assistant' ? 'chat-answer' : undefined}
                  className={cn(
                    'max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2',
                    m.role === 'user' ? 'bg-brand-700 text-white' : m.error ? 'border border-danger-600/40 bg-white text-danger-600' : 'border border-line bg-white text-ink',
                  )}
                >
                  {m.text}
                  {!!m.sources?.length && (
                    <div className="mt-2 border-t border-line pt-2">
                      <p className="mb-1 text-xs font-semibold text-muted">{t('Nguồn trên website', 'Sources on this site')}</p>
                      <ul className="space-y-1">
                        {m.sources.map((s) => (
                          <li key={s.path}>
                            <Link href={localePath(locale, s.path)} className="text-brand-700 underline underline-offset-2 hover:text-brand-900">
                              {s.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <p className="text-muted" role="status">
                {t('Đang soạn câu trả lời…', 'Writing an answer…')}
              </p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-end gap-2 border-t border-line bg-white p-3"
          >
            <label htmlFor="chat-input" className="sr-only">
              {t('Câu hỏi của bạn', 'Your question')}
            </label>
            <textarea
              id="chat-input"
              ref={inputRef}
              value={input}
              rows={2}
              maxLength={LIMITS.chatMessageMax}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={t('Nhập câu hỏi…', 'Type your question…')}
              className="min-h-0 flex-1 resize-none rounded-lg border border-line px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label={t('Gửi câu hỏi', 'Send question')}
              data-testid="chat-send"
              className="rounded-lg bg-brand-700 p-2.5 text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <Send className="size-5" aria-hidden />
            </button>
          </form>
        </section>
      )}
    </>
  );
}
