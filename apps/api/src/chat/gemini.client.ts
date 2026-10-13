import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

export type GeminiResult = { ok: true; text: string } | { ok: false; reason: 'disabled' | 'http' | 'timeout' | 'network' | 'blocked' | 'empty'; status?: number };

/** Thin REST client for Gemini `generateContent`. The key travels only in a header from this process; it is never logged or returned. */
@Injectable()
export class GeminiClient {
  private readonly log = new Logger('Gemini');
  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return this.env.GEMINI_API_KEY.length > 0;
  }

  /** Primary model first; if it is overloaded (429/5xx) or slow, one attempt on the fallback model. Auth/permission errors (401/403) do not retry: another model would fail the same way. */
  async generate(system: string, user: string): Promise<GeminiResult> {
    if (!this.enabled) return { ok: false, reason: 'disabled' };
    const first = await this.call(this.env.GEMINI_MODEL, system, user);
    const retryable = !first.ok && (first.reason === 'timeout' || first.reason === 'network' || (first.reason === 'http' && [429, 500, 502, 503, 504].includes(first.status ?? 0)));
    if (!retryable || this.env.GEMINI_FALLBACK_MODEL === this.env.GEMINI_MODEL) return first;
    this.log.warn(`primary model unavailable, trying ${this.env.GEMINI_FALLBACK_MODEL}`);
    return this.call(this.env.GEMINI_FALLBACK_MODEL, system, user);
  }

  private async call(model: string, system: string, user: string): Promise<GeminiResult> {
    const url = `${this.env.GEMINI_API_BASE.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.env.CHAT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? '';
        this.log.warn(`upstream ${res.status}: ${detail.slice(0, 160)}`);
        return { ok: false, reason: 'http', status: res.status };
      }
      const data = (await res.json()) as {
        promptFeedback?: { blockReason?: string };
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      };
      if (data.promptFeedback?.blockReason) return { ok: false, reason: 'blocked' };
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text)
        .join('')
        .trim();
      return text ? { ok: true, text } : { ok: false, reason: 'empty' };
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      this.log.warn(aborted ? 'upstream timeout' : 'upstream network error');
      return { ok: false, reason: aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }
}
