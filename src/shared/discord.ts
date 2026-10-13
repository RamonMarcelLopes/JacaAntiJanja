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

// ---------------------------------------------------------------- the notice of a room that opens, and the same message once it closed

const GREEN = 0x9ad04d;
const GREY = 0x6b7160;
/** Where the title of the notice leads: the page to download the app. */
export const APP_DOWNLOAD_URL = 'https://github.com/RamonMarcelLopes/JacaAntiJanja/releases/latest';

/** "menos de 1 minuto", "1 minuto", "45 minutos", "1 hora", "2 horas e 5 minutos", "1 dia e 3 horas". */
export function humanDuration(ms: number): string {
  const minutes = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60_000) : 0;
  if (minutes < 1) return 'menos de 1 minuto';
  const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${unit(days, 'dia', 'dias')} e ${unit(hours, 'hora', 'horas')}` : unit(days, 'dia', 'dias');
  if (hours > 0) return rest > 0 ? `${unit(hours, 'hora', 'horas')} e ${unit(rest, 'minuto', 'minutos')}` : unit(hours, 'hora', 'horas');
  return unit(minutes, 'minuto', 'minutos');
}

export interface NoticeInfo {
  /** Who opened the room (already plain text). */
  host: string;
  roomName: string;
  code: string;
  /** The host has a photo: the embed shows it next to the name (the message then carries it as the attachment host.jpg). */
  hasAvatar: boolean;
}

/** Plain text for the places of an embed that do not read markdown (the author line): no control characters, collapsed blanks, capped. */
export function discordPlain(raw: unknown, max: number): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const frame = (info: NoticeInfo, status: 'open' | 'closed') => ({
  color: status === 'open' ? GREEN : GREY,
  author: { name: `${discordPlain(info.host, 24) || 'Alguém'} ${status === 'open' ? 'abriu uma sala' : 'encerrou a sala'}`, ...(info.hasAvatar ? { icon_url: 'attachment://host.jpg' } : {}) },
  title: discordText(info.roomName, 32) || 'Jaca room',
  thumbnail: { url: 'attachment://icon.png' },
  footer: { text: 'Jaca anti Janja', icon_url: 'attachment://icon.png' },
});

const codeField = (code: string) => ({ name: 'Código da sala', value: '```\n' + code.replace(/`/g, '') + '\n```' });

/** The notice when the room opens. `openedAtSec` is a Unix time in seconds; Discord turns it into "há 3 minutos" and keeps counting by itself. */
export function openedEmbed(info: NoticeInfo, openedAtSec: number): Record<string, unknown> {
  return {
    ...frame(info, 'open'),
    url: APP_DOWNLOAD_URL,
    description: 'Abra o **Jaca anti Janja**, clique em **Entrar** e cole o código abaixo.\nAinda não tem o app? Clique no título para baixar.',
    fields: [
      codeField(info.code),
      { name: 'Host', value: discordText(info.host, 24) || 'Alguém', inline: true },
      { name: 'Tipo', value: 'Sala fixa', inline: true },
      { name: 'Status', value: 'Aberta', inline: true },
      { name: 'Tempo aberta', value: `<t:${Math.floor(openedAtSec)}:R>`, inline: true },
    ],
    timestamp: new Date(openedAtSec * 1000).toISOString(),
  };
}

/** The same message after the room closed. `openMs` is how long it was open, or null when that is not known (the app closed abruptly). */
export function closedEmbed(info: NoticeInfo, openMs: number | null, nowMs: number = Date.now()): Record<string, unknown> {
  return {
    ...frame(info, 'closed'),
    description: 'Esta sala foi encerrada. Quando abrir de novo, um aviso novo aparece com o mesmo código.',
    fields: [
      codeField(info.code),
      { name: 'Host', value: discordText(info.host, 24) || 'Alguém', inline: true },
      { name: 'Tipo', value: 'Sala fixa', inline: true },
      { name: 'Status', value: 'Fechada', inline: true },
      { name: 'Ficou aberta por', value: openMs === null ? 'Desconhecido' : humanDuration(openMs), inline: true },
    ],
    timestamp: new Date(nowMs).toISOString(),
  };
}
