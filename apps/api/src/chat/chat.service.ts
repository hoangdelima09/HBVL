import { Injectable, Logger } from '@nestjs/common';
import { LIMITS, foldVietnamese, type LocaleName } from '@hbvl/contracts';
import { MapService } from '../map/map.service';
import { PostsPublicService } from '../posts/posts.public.service';
import { SiteService } from '../site/site.service';
import { GeminiClient } from './gemini.client';
import { expandEnglish, expandJapanese, siteKnowledge, systemPrompt, topicTokens, userPrompt, type ContextDoc, type KnowledgeInput } from './chat.prompt';

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
const MAP_PATH = '/category/dong-du-ky/ban-do-vuon-len';

/** Intents are checked on the folded (diacritic-free) question, plus the raw text for Japanese. */
const CONTACT_INTENT =
  /\b(lien he|dia chi|hotline|sdt|so dien thoai|dien thoai|email|thu dien tu|gio lam viec|van phong|contact|address|phone|office)\b|連絡|住所|電話|メール|問い合わせ|問合せ/;
const MAP_INTENT = /\b(ban do|hoc vien|thanh vien|sinh vien|tinh nao|tinh thanh|que quan|map|members?|students?|alumni)\b|地図|マップ|学生|会員/;
const ABOUT_INTENT = /\b(vuon len|hoc bong|quy|dong du|gioi thieu|la gi|lam gi|muc tieu|su menh|about|scholarship|fund|mission)\b|奨学金|基金|ライズアップ|ドンズー|東遊/;
const GREETING = /^(xin chao|chao|hello|hi|hey|alo|chao ban|chao bot)\b|^こんにちは|^はじめまして/;

const T = {
  vi: {
    none: 'Mình chưa tìm thấy thông tin này trên website. Bạn có thể xem trang Liên hệ để được hỗ trợ trực tiếp, hoặc thử hỏi bằng từ khoá khác (ví dụ: học bổng, chương trình, sự kiện, bản đồ).',
    down: 'Trợ lý AI đang tạm thời không khả dụng. Dưới đây là các nội dung liên quan trên website:',
    related: 'Các nội dung liên quan trên website:',
    hello: 'Xin chào! Mình là trợ lý của website Học Bổng Vươn Lên. Bạn có thể hỏi về học bổng, các bài viết mới, sự kiện, bản đồ học viên hoặc cách liên hệ với Quỹ.',
    map: (m: number, u: number, n: number, top: string) => `Bản đồ Vươn Lên hiện có ${m} học viên ở ${u}/${n} tỉnh/thành.${top ? ` Nhiều nhất: ${top}.` : ''}`,
    mapLabel: 'Bản đồ Vươn Lên',
    contact: 'Liên hệ',
  },
  en: {
    none: "I couldn't find this on the website. Please visit the Contact page for direct help, or try different keywords (e.g. scholarship, program, event, map).",
    down: 'The AI assistant is temporarily unavailable. Here is related content on the website:',
    related: 'Related content on the website:',
    hello: 'Hello! I am the Rise Up Scholarship website assistant. Ask me about the scholarship, recent posts, events, the member map or how to contact the Fund.',
    map: (m: number, u: number, n: number, top: string) => `The Rise Up map currently shows ${m} members in ${u}/${n} provinces/cities.${top ? ` Most: ${top}.` : ''}`,
    mapLabel: 'Rise Up Map',
    contact: 'Contact',
  },
  ja: {
    none: 'このウェブサイトでは該当する情報が見つかりませんでした。お問い合わせページからご連絡いただくか、別のキーワード（例：奨学金、プログラム、イベント、地図）でお試しください。',
    down: 'AIアシスタントは現在ご利用いただけません。ウェブサイト内の関連コンテンツをご案内します：',
    related: 'ウェブサイト内の関連コンテンツ：',
    hello: 'こんにちは！ライズアップ奨学金ウェブサイトのアシスタントです。奨学金、最新の記事、イベント、会員マップ、基金へのお問い合わせ方法などについてご質問ください。',
    map: (m: number, u: number, n: number, top: string) => `ライズアップ・マップには現在、${n}省・市のうち${u}か所に${m}名の会員がいます。${top ? `多い地域：${top}。` : ''}`,
    mapLabel: 'ライズアップ・マップ',
    contact: 'お問い合わせ',
  },
} as const;

@Injectable()
export class ChatService {
  private readonly log = new Logger('Chat');
  constructor(
    private readonly posts: PostsPublicService,
    private readonly site: SiteService,
    private readonly map: MapService,
    private readonly gemini: GeminiClient,
  ) {}

  /**
   * Every question is answered against the CURRENT website: the most relevant published articles (retrieval) plus a digest of everything
   * the site says about itself (introduction, contact, sections, map counts, latest posts). Both are read live (through the public cache
   * that every publish/edit invalidates), so new content is known immediately. The model is always asked when a key is configured; the
   * deterministic fallback below only runs without a key or when the model fails.
   */
  async answer(req: ChatRequest): Promise<ChatResponse> {
    const t0 = Date.now();
    const text = T[req.locale];
    const folded = foldVietnamese(req.message);
    const tokens = req.locale === 'en' ? expandEnglish(topicTokens(req.message)) : req.locale === 'ja' ? expandJapanese(req.message) : topicTokens(req.message);
    const [docs, k] = await Promise.all([
      tokens.length ? (this.posts.retrieveForChat(tokens, DOCS_TO_MODEL, CHARS_PER_DOC) as Promise<(ContextDoc & { score: number })[]>) : Promise.resolve([]),
      this.knowledgeInput(),
    ]);
    const intent = {
      contact: CONTACT_INTENT.test(folded) || CONTACT_INTENT.test(req.message),
      map: MAP_INTENT.test(folded) || MAP_INTENT.test(req.message),
      about: ABOUT_INTENT.test(folded) || ABOUT_INTENT.test(req.message),
      greeting: GREETING.test(folded) || GREETING.test(req.message.trim()),
    };
    const sources = [
      ...docs.map((d) => ({ title: d.title, path: d.path })),
      ...(intent.map ? [{ title: text.mapLabel, path: MAP_PATH }] : []),
      ...(intent.contact ? [{ title: text.contact, path: '/lien-he' }] : []),
    ];

    if (this.gemini.enabled) {
      const r = await this.gemini.generate(systemPrompt(req.locale), userPrompt(req.message, docs, req.history, siteKnowledge(k)));
      if (r.ok) return this.done('ai', { answer: r.text.slice(0, 4000), mode: 'ai', sources }, t0);
      this.log.warn(`fallback (${r.reason}${r.status ? ` ${r.status}` : ''})`);
    }

    // ── no model (no key, or it failed): answer what can be answered deterministically ──
    if (docs.length) {
      const lines = docs.slice(0, 3).map((d) => `• ${d.title}: ${d.text.replace(/\s+/g, ' ').slice(0, 220).trimEnd()}…`);
      return this.done('fallback', { answer: `${this.gemini.enabled ? text.down : text.related}\n${lines.join('\n')}`, mode: 'fallback', sources }, t0);
    }
    const parts: string[] = [];
    if (intent.contact) {
      const c = await this.contactAnswer(req.locale);
      if (c) parts.push(c);
    }
    if (intent.map && k.map) {
      const top = k.map.provinces
        .filter((p) => p.count > 0)
        .sort((a, z) => z.count - a.count)
        .slice(0, 5)
        .map((p) => `${p.name} (${p.count})`)
        .join(', ');
      parts.push(text.map(k.map.members, k.map.unitsWithMembers, k.map.units, top));
    }
    if (!parts.length && (intent.greeting || intent.about)) {
      const about = this.aboutText(k.settings, req.locale);
      parts.push(intent.greeting || !about ? text.hello : about);
    }
    if (parts.length) return this.done('fallback', { answer: parts.join('\n\n'), mode: 'fallback', sources }, t0);
    return this.done('no-results', { answer: text.none, mode: 'no-results', sources: [] }, t0);
  }

  /** Live inputs for the site digest. Each part degrades to "unknown" rather than failing the question. */
  private async knowledgeInput(): Promise<KnowledgeInput> {
    const [settings, categories, summary, digest] = await Promise.all([
      this.site.publicSettings().catch(() => ({})) as Promise<Record<string, unknown>>,
      this.posts.categoryTree('vi').catch(() => []),
      this.map.summary('34').catch(() => null),
      this.posts.chatDigest().catch(() => ({ items: [], totals: {} })),
    ]);
    return {
      settings,
      categories,
      map: summary ? { ...summary.totals, provinces: summary.provinces.map((p) => ({ name: p.nameVi, count: p.count })) } : null,
      digest,
    };
  }

  private aboutText(settings: Record<string, unknown>, locale: LocaleName): string {
    const home = (settings.home ?? {}) as { hero?: Record<string, unknown>; mission?: Record<string, unknown> };
    const pick = (o: Record<string, unknown> | undefined, vi: string, en: string) => {
      const v = o?.[locale === 'vi' ? vi : en] ?? o?.[vi];
      return typeof v === 'string' ? v.trim() : '';
    };
    return [pick(home.hero, 'descVi', 'descEn'), pick(home.mission, 'descVi', 'descEn')].filter(Boolean).join(' ');
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

  /** Log mode and latency only: user questions are never written to logs. */
  private done(mode: ChatMode, res: ChatResponse, t0: number): ChatResponse {
    this.log.log(`mode=${mode} ms=${Date.now() - t0} qMax=${LIMITS.chatMessageMax}`);
    return res;
  }
}
