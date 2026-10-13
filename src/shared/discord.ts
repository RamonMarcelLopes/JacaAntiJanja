// Pure helpers for the Discord notice of a room (kept apart from main.ts so they can be unit tested).

/** Accepts only a real Discord webhook address (so the app can never be made to post somewhere else); returns it without any query string. */
export function parseDiscordWebhook(raw: unknown): string | null {
  const m = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/(?:v\d+\/)?webhooks\/(\d{17,20})\/([\w-]{20,120})\/?(?:\?.*)?$/.exec(String(raw ?? '').trim());
  return m ? `https://discord.com/api/webhooks/${m[1]}/${m[2]}` : null;
}

/** Plain text for an embed: no control characters, no markdown or mention characters (a room name is typed by a person). */
export function discordText(raw: unknown, max: number): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/([\\*_~`|>@#:\[\]()])/g, '\\$1');
}
