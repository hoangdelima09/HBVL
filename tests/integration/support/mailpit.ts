const BASE = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? '58025'}/api/v1`;

export interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  ReplyTo?: { Address: string }[];
  Snippet: string;
}

export const mailpit = {
  async clear() {
    await fetch(`${BASE}/messages`, { method: 'DELETE' });
  },
  async messages(): Promise<MailpitMessage[]> {
    const r = await fetch(`${BASE}/messages`);
    return ((await r.json()) as { messages: never[] }).messages;
  },
  async waitFor(predicate: (m: MailpitMessage) => boolean, timeoutMs = 15_000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const hit = (await this.messages()).find(predicate);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 250));
    }
    return undefined;
  },
  async fullText(id: string): Promise<string> {
    const r = await fetch(`${BASE}/message/${id}`);
    return ((await r.json()) as { Text: string }).Text;
  },
};
