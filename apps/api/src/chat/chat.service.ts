import { Injectable, Logger } from '@nestjs/common';
import { LIMITS, foldVietnamese, type LocaleName } from '@hbvl/contracts';
import { PostsPublicService } from '../posts/posts.public.service';
import { SiteService } from '../site/site.service';
import { GeminiClient } from './gemini.client';
import { expandEnglish, expandJapanese, systemPrompt, topicTokens, userPrompt, type ContextDoc } from './chat.prompt';

export type ChatMode = 'ai' | 'fallback' | 'no-results';
export interface ChatRequest {
  message: string;
  locale: LocaleName;
  history: { role: 'user' | 'assistant'; text: string }[];
}
export interface ChatResponse {
  answer: string;
  mode: ChatMode;
  sources: { title: string; path: string }[];
}

const DOCS_TO_MODEL = 4;
const CHARS_PER_DOC = 1500;
const CONTACT_INTENT = /\b(lien he|dia chi|hotline|sdt|so dien thoai|dien thoai|email|thu dien tu|contact|address|phone)\b/;

const T = {
  vi: {
    none: 'Mình chưa tìm thấy thông tin này trên website. Bạn có thể xem trang Liên hệ để được hỗ trợ trực tiếp, hoặc thử hỏi bằng từ khoá khác (ví dụ: học bổng, chương trình, sự kiện, bản đồ).',
    down: 'Trợ lý AI đang tạm thời không khả dụng. Dưới đây là các nội dung liên quan trên website:',
  },
  en: {
    none: "I couldn't find this on the website. Please visit the Contact page for direct help, or try different keywords (e.g. scholarship, program, event, map).",
    down: 'The AI assistant is temporarily unavailable. Here is related content on the website:',
  },
  ja: {
    none: 'このウェブサイトでは該当する情報が見つかりませんでした。お問い合わせページからご連絡いただくか、別のキーワード（例：奨学金、プログラム、イベント、地図）でお試しください。',
    down: 'AIアシスタントは現在ご利用いただけません。ウェブサイト内の関連コンテンツをご案内します：',
  },
} as const;

@Injectable()
export class ChatService {
  private readonly log = new Logger('Chat');
  constructor(
    private readonly posts: PostsPublicService,
    private readonly site: SiteService,
    private readonly gemini: GeminiClient,
  ) {}

  async answer(req: ChatRequest): Promise<ChatResponse> {
    const t0 = Date.now();
    const text = T[req.locale];
    const tokens = req.locale === 'en' ? expandEnglish(topicTokens(req.message)) : req.locale === 'ja' ? expandJapanese(req.message) : topicTokens(req.message);
    const docs = (await this.posts.retrieveForChat(tokens, DOCS_TO_MODEL, CHARS_PER_DOC)) as (ContextDoc & { score: number })[];
    const contactIntent = CONTACT_INTENT.test(foldVietnamese(req.message));

    if (!docs.length && !contactIntent) return this.done('no-results', { answer: text.none, mode: 'no-results', sources: [] }, t0);

    const sources = docs.map((d) => ({ title: d.title, path: d.path }));
    const r = await this.gemini.generate(systemPrompt(req.locale), userPrompt(req.message, docs, req.history, await this.siteInfo()));
    if (r.ok) return this.done('ai', { answer: r.text.slice(0, 4000), mode: 'ai', sources }, t0);

    this.log.warn(`fallback (${r.reason}${r.status ? ` ${r.status}` : ''})`);
    if (!docs.length)
      return this.done(
        'fallback',
        {
          answer: (contactIntent && (await this.contactAnswer(req.locale))) || text.none,
          mode: 'fallback',
          sources: [{ title: { vi: 'Liên hệ', en: 'Contact', ja: 'お問い合わせ' }[req.locale], path: '/lien-he' }],
        },
        t0,
      );
    const lines = docs.slice(0, 3).map((d) => `• ${d.title}: ${d.text.replace(/\s+/g, ' ').slice(0, 220).trimEnd()}…`);
    return this.done('fallback', { answer: `${text.down}\n${lines.join('\n')}`, mode: 'fallback', sources }, t0);
  }

  /** Deterministic answer from the public contact settings, used when the model is unavailable. Empty string when nothing is configured. */
  private async contactAnswer(locale: LocaleName): Promise<string> {
    const c = ((await this.site.publicSettings().catch(() => ({}))) as { contact?: Record<string, unknown> }).contact ?? {};
    const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : '');
    // Settings hold Vietnamese and English variants; Japanese readers get the English text (closer than Vietnamese).
    const en = locale !== 'vi';
    const hours = (c[en ? 'hoursEn' : 'hoursVi'] as unknown[] | undefined)?.filter((h): h is string => typeof h === 'string').join('; ') ?? '';
    const L = { vi: ['Địa chỉ', 'Điện thoại', 'Email', 'Giờ làm việc'], en: ['Address', 'Phone', 'Email', 'Hours'], ja: ['住所', '電話', 'メール', '営業時間'] }[locale];
    const rows = [
      [L[0]!, str(en ? 'addressEn' : 'addressVi')],
      [L[1]!, str('phone')],
      [L[2]!, str('email')],
      [L[3]!, hours],
    ].filter(([, v]) => v);
    return rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  }

  /** Public brand/contact settings (already public via /settings/public) so questions about address or phone can be answered. */
  private async siteInfo(): Promise<string> {
    try {
      const s = (await this.site.publicSettings()) as Record<string, unknown>;
      return JSON.stringify({ brand: s.brand, contact: s.contact }).slice(0, 1500);
    } catch {
      return '';
    }
  }

  /** Log mode and latency only: user questions are never written to logs. */
  private done(mode: ChatMode, res: ChatResponse, t0: number): ChatResponse {
    this.log.log(`mode=${mode} ms=${Date.now() - t0} qMax=${LIMITS.chatMessageMax}`);
    return res;
  }
}
