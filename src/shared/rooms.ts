// Pure helpers that keep the lists of saved rooms in the config well-formed (kept apart from main.ts so they can be unit tested).
import { encodeCloudInvite, isValidRoomId, parseInvite } from './invite';
import { FavoriteRoom, FixedRoom, MAX_FAVORITE_ROOMS, MAX_FIXED_ROOMS, MAX_ROOM_NAME } from './protocol';

/** The pictures a fixed room can have in the new interface. */
export const ROOM_ICON_KEYS = ['film', 'gamepad', 'book', 'music', 'users', 'tv', 'popcorn', 'headphones', 'swords', 'dices', 'trophy', 'rocket', 'code', 'palette', 'graduation', 'coffee', 'pizza', 'heart', 'flame', 'moon'] as const;

const cleanName = (raw: unknown): string => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ROOM_NAME);

/** Keeps only well-formed Cloudflare codes (stored in their canonical form), one entry per room, with a clean name. */
export function cleanFavorites(raw: unknown): FavoriteRoom[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, FavoriteRoom>();
  for (const item of raw) {
    const invite = parseInvite(String((item as FavoriteRoom | undefined)?.code ?? ''));
    if (!invite || invite.kind !== 'cloud') continue;
    const code = encodeCloudInvite(invite.roomId, invite.subdomain);
    out.set(code, { code, name: cleanName((item as FavoriteRoom).name) || 'Sala' });
  }
  return [...out.values()].slice(0, MAX_FAVORITE_ROOMS);
}

/**
 * Keeps only fixed rooms with a valid id (one entry per id) and a clean name. The webhook of a room is kept as stored; the value 'set'
 * is what the window sees instead of the real one, so it is never accepted as a real value.
 */
export function cleanFixedRooms(raw: unknown): FixedRoom[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, FixedRoom>();
  for (const item of raw) {
    const id = String((item as FixedRoom | undefined)?.id ?? '');
    if (!isValidRoomId(id)) continue;
    const hook = (item as FixedRoom).discordWebhookEnc;
    const icon = (ROOM_ICON_KEYS as readonly string[]).includes(String((item as FixedRoom).icon)) ? (item as FixedRoom).icon : undefined;
    out.set(id, { id, name: cleanName((item as FixedRoom).name) || 'Sala fixa', ...(icon ? { icon } : {}), discordWebhookEnc: typeof hook === 'string' && hook !== 'set' ? hook : '' });
  }
  return [...out.values()].slice(0, MAX_FIXED_ROOMS);
}
