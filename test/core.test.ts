import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { decodeInvite, encodeCloudInvite, encodeInvite, isValidRoomId, parseInvite, roomIdFromBytes, workerHost, parseWorkerAddress } from '../src/shared/invite';
import { APP_DOWNLOAD_URL, closedEmbed, discordText, humanDuration, openedEmbed, parseDiscordWebhook } from '../src/shared/discord';
import { cleanNotice, MAX_NOTICE_MS, MAX_NOTICE_TEXT } from '../src/shared/protocol';
import { cleanFavorites, cleanFixedRooms } from '../src/shared/rooms';
import { formatDuration } from '../src/shared/time';
import { buildStunRequest, classifyVpnInterfaces, isCgnatRange, isPrivateIpv4, natVerdict, parseStunMapped, parseStunResponse } from '../src/main/network';
import { SignalingServer } from '../src/main/signaling';
import { JoinError, redact } from '../src/renderer/signaling-client';
import { readConfig, writeConfig } from '../src/main/config-store';
import { readRoomsBackup, writeRoomsBackup } from '../src/main/rooms-backup';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('invite code round-trips and is 16 chars in 4 groups', () => {
  const data = { ip: '201.17.5.250', port: 47800, token: 0xdeadbeef };
  const code = encodeInvite(data);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  assert.deepEqual(decodeInvite(code), data);
});

test('invite decode tolerates case, spaces and ambiguous characters', () => {
  const data = { ip: '10.0.0.1', port: 1024, token: 1 };
  const code = encodeInvite(data).toLowerCase().replace(/-/g, ' ');
  assert.deepEqual(decodeInvite(code), data);
  assert.equal(decodeInvite('not-a-code'), null);
  assert.equal(decodeInvite('UUUU-UUUU-UUUU-UUUU'), null);
});

test('invite encode rejects bad input', () => {
  assert.throws(() => encodeInvite({ ip: '300.1.1.1', port: 80, token: 0 }));
  assert.throws(() => encodeInvite({ ip: '1.1.1.1', port: 0, token: 0 }));
});

test('STUN response parsing extracts XOR-MAPPED-ADDRESS', () => {
  const tx = Buffer.alloc(12, 7);
  assert.equal(buildStunRequest(tx).length, 20);
  const cookie = 0x2112a442;
  const ip = [203, 0, 113, 9];
  const body = Buffer.alloc(12);
  body.writeUInt16BE(0x0020, 0);
  body.writeUInt16BE(8, 2);
  body[5] = 0x01;
  body.writeUInt16BE(54321 ^ (cookie >>> 16), 6);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(cookie);
  ip.forEach((b, i) => (body[8 + i] = b ^ c[i]));
  const head = Buffer.alloc(20);
  head.writeUInt16BE(0x0101, 0);
  head.writeUInt16BE(body.length, 2);
  head.writeUInt32BE(cookie, 4);
  tx.copy(head, 8);
  assert.equal(parseStunResponse(Buffer.concat([head, body]), tx), '203.0.113.9');
  assert.equal(parseStunResponse(Buffer.concat([head, body]), Buffer.alloc(12, 1)), null);
});

test('private / CGNAT address helpers', () => {
  assert.ok(isPrivateIpv4('192.168.0.5') && isPrivateIpv4('10.1.2.3') && isPrivateIpv4('172.20.0.1'));
  assert.ok(!isPrivateIpv4('8.8.8.8'));
  assert.ok(isCgnatRange('100.64.1.1') && !isCgnatRange('100.128.0.1'));
});

function open(port: number): Promise<{ ws: WebSocket; msgs: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('error', reject);
  });
}
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const join = (ws: WebSocket, token: number, name: string) => ws.send(JSON.stringify({ type: 'join', payload: { token, name, avatar: null } }));

test('signaling: join, relay, share state, leave, room limit and bad token', async () => {
  const port = 48123;
  const srv = new SignalingServer(port, 'Sala de teste');
  await srv.start();
  try {
    const a = await open(port);
    join(a.ws, srv.token, 'Ana');
    await wait();
    assert.equal(a.msgs[0].type, 'welcome');
    const aId = a.msgs[0].payload.peerId;

    const b = await open(port);
    join(b.ws, srv.token, 'Bia');
    await wait();
    const bId = b.msgs[0].payload.peerId;
    assert.equal(b.msgs[0].payload.peers.length, 1);
    assert.equal(a.msgs.at(-1).type, 'peer-joined');

    // relay: only the addressee receives it and `from` is set by the server
    a.ws.send(JSON.stringify({ type: 'offer', to: bId, from: 'forged', payload: { sdp: 'x' } }));
    await wait();
    const offer = b.msgs.find((m) => m.type === 'offer');
    assert.equal(offer.from, aId);
    assert.equal(a.msgs.some((m) => m.type === 'offer'), false);

    // share state is broadcast and given to late joiners
    a.ws.send(JSON.stringify({ type: 'share-started', payload: { resolution: '1080p', fps: 60, mode: 'motion' } }));
    await wait();
    assert.equal(b.msgs.at(-1).type, 'share-started');
    const c = await open(port);
    join(c.ws, srv.token, 'Caio');
    await wait();
    const peers = c.msgs[0].payload.peers as any[];
    assert.equal(peers.find((p) => p.peerId === aId).share.fps, 60);

    // bad token + unknown message types
    const bad = await open(port);
    join(bad.ws, srv.token ^ 1, 'Hacker');
    await wait();
    assert.equal(bad.msgs[0].payload.code, 'BAD_TOKEN');
    a.ws.send(JSON.stringify({ type: 'welcome', payload: {} }));
    await wait();
    assert.equal(b.msgs.some((m) => m.type === 'welcome' && m.from), false);

    // leave
    c.ws.close();
    await wait();
    assert.equal(a.msgs.at(-1).type, 'peer-left');

    // room limit (10 peers: a, b already inside)
    const extra: Array<{ ws: WebSocket; msgs: any[] }> = [];
    for (let i = 0; i < 8; i++) {
      const p = await open(port);
      join(p.ws, srv.token, `P${i}`);
      extra.push(p);
    }
    await wait(200);
    const full = await open(port);
    join(full.ws, srv.token, 'Late');
    await wait();
    assert.equal(full.msgs[0].payload.code, 'ROOM_FULL');

    srv.stop();
    await wait();
    assert.equal(a.msgs.at(-1).type, 'room-closed');
  } finally {
    srv.stop();
  }
});

test('signaling: rate limits repeated bad tokens', async () => {
  const srv = new SignalingServer(48124, 'Sala de teste');
  await srv.start();
  try {
    let last = '';
    for (let i = 0; i < 7; i++) {
      const c = await open(48124);
      join(c.ws, srv.token ^ 1, 'x');
      await wait(40);
      last = c.msgs[0]?.payload?.code;
    }
    assert.equal(last, 'RATE_LIMITED');
  } finally {
    srv.stop();
  }
});

test('signaling: closes connections that never join', async () => {
  const srv = new SignalingServer(48125, 'Sala de teste');
  await srv.start();
  try {
    const c = await open(48125);
    const closed = new Promise<number>((r) => c.ws.on('close', (code) => r(code)));
    assert.equal(await closed, 4000);
  } finally {
    srv.stop();
  }
});

test('signaling: profile updates are sanitized and broadcast to the others', async () => {
  const srv = new SignalingServer(48126, 'Sala de teste');
  await srv.start();
  try {
    const a = await open(48126);
    join(a.ws, srv.token, 'Ana');
    const b = await open(48126);
    join(b.ws, srv.token, 'Bia');
    await wait();
    const bId = b.msgs[0].payload.peerId;

    const png = 'data:image/png;base64,AAAA';
    b.ws.send(JSON.stringify({ type: 'profile-update', payload: { name: '  Bianca  ', avatar: png } }));
    await wait();
    const upd = a.msgs.find((m) => m.type === 'peer-updated');
    assert.deepEqual(upd.payload, { peerId: bId, name: 'Bianca', avatar: png });
    assert.equal(b.msgs.some((m) => m.type === 'peer-updated'), false, 'the sender is not notified');

    // non-image avatars are dropped, empty names are ignored, names are cut to 24 chars
    b.ws.send(JSON.stringify({ type: 'profile-update', payload: { name: 'x'.repeat(40), avatar: 'javascript:alert(1)' } }));
    b.ws.send(JSON.stringify({ type: 'profile-update', payload: { name: '   ', avatar: null } }));
    await wait();
    const updates = a.msgs.filter((m) => m.type === 'peer-updated');
    assert.equal(updates.length, 2);
    assert.equal(updates[1].payload.name.length, 24);
    assert.equal(updates[1].payload.avatar, null);

    // a late joiner sees the updated profile
    const c = await open(48126);
    join(c.ws, srv.token, 'Caio');
    await wait();
    const peer = c.msgs[0].payload.peers.find((p: any) => p.peerId === bId);
    assert.equal(peer.name.length, 24);
  } finally {
    srv.stop();
  }
});

test('signaling: the invite code reaches everyone who joins in the welcome message', async () => {
  const srv = new SignalingServer(48129, 'Sala de teste');
  srv.inviteCode = 'K7QM-2XRA-9TPD-H4WB';
  await srv.start();
  try {
    const a = await open(48129);
    join(a.ws, srv.token, 'Ana');
    const b = await open(48129);
    join(b.ws, srv.token, 'Bia');
    await wait();
    assert.equal(a.msgs[0].payload.inviteCode, 'K7QM-2XRA-9TPD-H4WB');
    assert.equal(b.msgs[0].payload.inviteCode, 'K7QM-2XRA-9TPD-H4WB');
  } finally {
    srv.stop();
  }
});

test('signaling: the room name reaches everyone who joins in the welcome message', async () => {
  const srv = new SignalingServer(48127, 'Noite de filmes');
  await srv.start();
  try {
    const a = await open(48127);
    join(a.ws, srv.token, 'Ana');
    await wait();
    assert.equal(a.msgs[0].payload.roomName, 'Noite de filmes');
    const b = await open(48127);
    join(b.ws, srv.token, 'Bia');
    await wait();
    assert.equal(b.msgs[0].payload.roomName, 'Noite de filmes');
  } finally {
    srv.stop();
  }
});

test('formatDuration shows mm:ss under an hour and h:mm:ss after', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(999), '00:00');
  assert.equal(formatDuration(65_000), '01:05');
  assert.equal(formatDuration(59 * 60_000 + 59_000), '59:59');
  assert.equal(formatDuration(3_600_000), '1:00:00');
  assert.equal(formatDuration(3 * 3_600_000 + 7 * 60_000 + 9_000), '3:07:09');
  assert.equal(formatDuration(-5), '00:00');
  assert.equal(formatDuration(NaN), '00:00');
});

test('signaling: welcome reports how long the room has been open', async () => {
  const srv = new SignalingServer(48128, 'Sala de teste');
  await srv.start();
  try {
    const a = await open(48128);
    join(a.ws, srv.token, 'Ana');
    await wait(300);
    const b = await open(48128);
    join(b.ws, srv.token, 'Bia');
    await wait();
    assert.ok(a.msgs[0].payload.roomAgeMs >= 0 && a.msgs[0].payload.roomAgeMs < 250);
    assert.ok(b.msgs[0].payload.roomAgeMs >= 290, 'a later joiner sees the real age of the room');
  } finally {
    srv.stop();
  }
});

test('Cloudflare invite codes round-trip, tolerate sloppy typing and keep the direct codes working', () => {
  const id = roomIdFromBytes(Uint8Array.from([1, 2, 3, 4, 5, 6, 7]));
  assert.equal(id.length, 10);
  assert.ok(isValidRoomId(id));
  assert.equal(id, roomIdFromBytes(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 99]))); // only the first 7 bytes count
  assert.notEqual(id, roomIdFromBytes(Uint8Array.from([7, 6, 5, 4, 3, 2, 1])));
  const code = encodeCloudInvite(id, 'ramonlopes');
  assert.match(code, /^[0-9A-Z]{5}-[0-9A-Z]{5}@ramonlopes$/);
  assert.deepEqual(parseInvite(code), { kind: 'cloud', roomId: id, subdomain: 'ramonlopes' });
  assert.deepEqual(parseInvite('  ' + code.toLowerCase().replace('-', ' ') + '  '), { kind: 'cloud', roomId: id, subdomain: 'ramonlopes' });
  assert.deepEqual(parseInvite(code.replace('@ramonlopes', ' @ RamonLopes')), { kind: 'cloud', roomId: id, subdomain: 'ramonlopes' });
  assert.equal(workerHost('ramonlopes'), 'jaca-sala.ramonlopes.workers.dev');

  const direct = { ip: '201.17.5.250', port: 47800, token: 0xdeadbeef };
  assert.deepEqual(parseInvite(encodeInvite(direct)), { kind: 'direct', ...direct });
});

test('invite codes that could point somewhere else are refused', () => {
  const good = 'ABCDE-FGHJK';
  assert.notEqual(parseInvite(good + '@ok-name'), null);
  for (const bad of [
    good + '@evil.com', // a dot would let the code choose the whole host
    good + '@localhost:8080',
    good + '@a/b',
    good + '@-start',
    good + '@end-',
    good + '@',
    good + '@' + 'a'.repeat(64), // longer than a DNS label
    'ABCDE-FGHJ@ramon', // room id too short
    'ABCDE-FGHJKL@ramon', // too long
    'ABCDE-FGHJU@ramon', // U is not in the alphabet
    '@ramon',
    'not a code @ ramon',
  ]) {
    assert.equal(parseInvite(bad), null, 'must refuse: ' + bad);
  }
  assert.throws(() => encodeCloudInvite('SHORT', 'ramon'));
  assert.throws(() => encodeCloudInvite('ABCDEFGHJK', 'evil.com'));
});

test('VPN and mesh adapters are recognised by name and listed once per address', () => {
  const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal }) as never;
  const found = classifyVpnInterfaces({
    Ethernet: [v4('192.168.0.5')],
    'Radmin VPN': [v4('26.218.158.49')],
    'vEthernet (WSL)': [v4('172.28.64.1')],
    Tailscale: [v4('100.101.102.103'), { address: 'fe80::1', family: 'IPv6', internal: false } as never],
    ZeroTier: [v4('10.147.1.2'), v4('10.147.1.2')], // the same address twice
    'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
    'My WireGuard Tunnel': [v4('10.0.0.2', true)], // internal ones are ignored
  });
  assert.deepEqual(
    found.map((f) => [f.kind, f.ip]),
    [['Radmin VPN', '26.218.158.49'], ['Tailscale', '100.101.102.103'], ['ZeroTier', '10.147.1.2']],
  );
});

test('NAT verdict: the same public port everywhere is cone, different ports are symmetric, too few answers is unknown', () => {
  const same = natVerdict(['1.2.3.4:5000', '1.2.3.4:5000', '1.2.3.4:5000']);
  assert.equal(same.kind, 'cone');
  assert.equal(same.publicIp, '1.2.3.4');
  assert.equal(natVerdict(['1.2.3.4:5000', '1.2.3.4:5001']).kind, 'symmetric');
  assert.equal(natVerdict(['1.2.3.4:5000']).kind, 'unknown');
  assert.equal(natVerdict([]).kind, 'unknown');
  assert.equal(natVerdict([]).publicIp, null);
});

test('a STUN response yields the public port as well as the address', () => {
  const tx = Buffer.alloc(12, 3);
  const cookie = 0x2112a442;
  const body = Buffer.alloc(12);
  body.writeUInt16BE(0x0020, 0);
  body.writeUInt16BE(8, 2);
  body[5] = 0x01;
  body.writeUInt16BE(40123 ^ (cookie >>> 16), 6);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(cookie);
  [198, 51, 100, 7].forEach((b, i) => (body[8 + i] = b ^ c[i]));
  const head = Buffer.alloc(20);
  head.writeUInt16BE(0x0101, 0);
  head.writeUInt16BE(body.length, 2);
  head.writeUInt32BE(cookie, 4);
  tx.copy(head, 8);
  const msg = Buffer.concat([head, body]);
  assert.deepEqual(parseStunMapped(msg, tx), { ip: '198.51.100.7', port: 40123 });
  assert.equal(parseStunResponse(msg, tx), '198.51.100.7');
  assert.equal(parseStunMapped(msg, Buffer.alloc(12, 4)), null);
});

test('Worker address: full address, host or only the account name; anything else is refused', () => {
  assert.equal(parseWorkerAddress('ramon'), 'ramon');
  assert.equal(parseWorkerAddress('  Ramon-1 '), 'ramon-1');
  assert.equal(parseWorkerAddress('jaca-sala.ramon.workers.dev'), 'ramon');
  assert.equal(parseWorkerAddress('https://jaca-sala.ramon.workers.dev/'), 'ramon');
  assert.equal(parseWorkerAddress('https://jaca-sala.ramon.workers.dev/health?x=1'), 'ramon');
  assert.equal(parseWorkerAddress('https://evil.example.com'), null);
  assert.equal(parseWorkerAddress('jaca-sala.ramon.evil.com'), null);
  assert.equal(parseWorkerAddress('ra mon'), null);
  assert.equal(parseWorkerAddress(''), null);
});

test('the Worker copy of the shared files is in sync (run pnpm worker:sync after changing src/shared)', async () => {
  const fs = await import('node:fs');
  for (const f of ['invite.ts', 'protocol.ts']) assert.equal(fs.readFileSync(`worker/src/shared/${f}`, 'utf8'), fs.readFileSync(`src/shared/${f}`, 'utf8'), f);
});

// ---------------------------------------------------------------- Discord webhook of a fixed room

const HOOK_ID = '123456789012345678';
const HOOK_TOKEN = 'abcDEF_ghi-JKL0123456789xyzABC';

test('Discord webhook: only real Discord webhook addresses are accepted, and the query string is dropped', () => {
  const canonical = `https://discord.com/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`;
  assert.equal(parseDiscordWebhook(canonical), canonical);
  assert.equal(parseDiscordWebhook(`  ${canonical}  `), canonical);
  assert.equal(parseDiscordWebhook(`${canonical}?wait=true&thread_id=1`), canonical);
  assert.equal(parseDiscordWebhook(`${canonical}/`), canonical);
  // older and test hosts and API versions are normalized to the canonical address
  assert.equal(parseDiscordWebhook(`https://discordapp.com/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`), canonical);
  assert.equal(parseDiscordWebhook(`https://canary.discord.com/api/v10/webhooks/${HOOK_ID}/${HOOK_TOKEN}`), canonical);
  assert.equal(parseDiscordWebhook(`https://ptb.discord.com/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`), canonical);
});

test('Discord webhook: another host, plain http, an incomplete or tampered address are all refused', () => {
  const bad = [
    `http://discord.com/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`, // not https
    `https://discord.com.evil.example/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`, // the host only starts like Discord
    `https://evil.example/https://discord.com/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`,
    `https://user@discord.com/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`, // credentials in front of the host
    `https://discord.com:8443/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`, // another port
    `https://discord.com/api/webhooks/${HOOK_ID}`, // no token
    `https://discord.com/api/webhooks/12345/${HOOK_TOKEN}`, // short id
    `https://discord.com/api/webhooks/${HOOK_ID}/short`, // short token
    `https://discord.com/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}/extra/path`,
    `https://discord.com/api/webhooks/${HOOK_ID}/${HOOK_TOKEN} https://evil.example`,
    'https://discord.com/api/webhooks/',
    '',
  ];
  for (const url of bad) assert.equal(parseDiscordWebhook(url), null, url);
  assert.equal(parseDiscordWebhook(undefined), null);
  assert.equal(parseDiscordWebhook({ toString: () => 'nope' }), null);
});

test('Discord text: markdown, mentions and control characters in names are neutralized and the length is capped', () => {
  const BS = '\\'; // one backslash
  assert.equal(discordText('Sala *do* Ramon', 32), `Sala ${BS}*do${BS}* Ramon`);
  assert.equal(discordText('@everyone', 32), `${BS}@everyone`);
  assert.equal(discordText('a\nb\tc', 32), 'a b c');
  assert.equal(discordText('  muitos   espaços  ', 32), 'muitos espaços');
  assert.equal(discordText('x'.repeat(100), 10).length, 10);
  assert.equal(discordText('`code` [link](http://x) #canal', 40), `${BS}\`code${BS}\` ${BS}[link${BS}]${BS}(http${BS}://x${BS}) ${BS}#canal`);
  assert.equal(discordText(`um${BS}dois`, 32), `um${BS}${BS}dois`); // a backslash typed by the person cannot escape the escaping
  assert.equal(discordText(null, 5), '');
});

// ---------------------------------------------------------------- saved rooms (favorites and fixed rooms)

const ROOM_ID = 'JACAT-ESTE1'.replace('-', '');

test('favorite rooms: only Cloudflare codes survive, in canonical form, once each, with a clean name', () => {
  const good = encodeCloudInvite(ROOM_ID, 'ramon');
  const list = cleanFavorites([
    { code: good.toLowerCase().replace('-', ' '), name: '  Sala   do   Ramon  ' }, // typed any way, name with extra blanks
    { code: good, name: 'duplicada' }, // the same room again: one entry (the last name wins)
    { code: encodeInvite({ ip: '10.0.0.1', port: 47800, token: 1 }), name: 'direta' }, // direct codes cannot be favorites
    { code: 'ABCDE-FGHJK@evil.com', name: 'x' },
    { code: 42, name: 'x' },
    null,
    { name: 'sem código' },
  ]);
  assert.deepEqual(list, [{ code: good, name: 'duplicada' }]);
  assert.equal(cleanFavorites([{ code: good, name: '' }])[0].name, 'Sala'); // a nameless favorite still shows something
  assert.equal(cleanFavorites([{ code: good, name: 'n'.repeat(100) }])[0].name.length, 32);
  assert.deepEqual(cleanFavorites('not a list'), []);
  assert.deepEqual(cleanFavorites(undefined), []);
});

test('favorite rooms: no more than 20', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ code: encodeCloudInvite(roomIdFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, i])), 'ramon'), name: `Sala ${i}` }));
  assert.equal(cleanFavorites(many).length, 20);
});

test('fixed rooms: valid ids only, one entry per id, clean names, and the webhook is never taken from what the window sends back', () => {
  const list = cleanFixedRooms([
    { id: ROOM_ID, name: '  Sala   fixa ', discordWebhookEnc: 'c2VjcmV0' },
    { id: ROOM_ID, name: 'repetida', discordWebhookEnc: '' }, // same id again
    { id: 'curto', name: 'id inválido' },
    { id: 'ILOUILOUIL', name: 'letras que não existem no código' },
    { id: roomIdFromBytes(new Uint8Array([9, 9, 9, 9, 9, 9, 9])), name: '', discordWebhookEnc: 'set' }, // 'set' is what the window sees: not a real value
    { id: roomIdFromBytes(new Uint8Array([8, 8, 8, 8, 8, 8, 8])), discordWebhookEnc: 42 },
    null,
  ]);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { id: ROOM_ID, name: 'repetida', discordWebhookEnc: '' });
  assert.equal(list[1].name, 'Sala fixa'); // nameless
  assert.equal(list[1].discordWebhookEnc, ''); // 'set' never counts as a stored address
  assert.equal(list[2].discordWebhookEnc, ''); // not a string
  assert.deepEqual(cleanFixedRooms({}), []);
  assert.equal(cleanFixedRooms([{ id: ROOM_ID, name: 'a', discordWebhookEnc: 'c2VjcmV0' }])[0].discordWebhookEnc, 'c2VjcmV0'); // a stored address is kept
});

test('fixed rooms: no more than 10', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ id: roomIdFromBytes(new Uint8Array([7, 7, 7, 7, 7, 7, i])), name: `Sala ${i}` }));
  assert.equal(cleanFixedRooms(many).length, 10);
});

// ---------------------------------------------------------------- the Discord notice: open, then the same message closed

test('time open reads naturally in Portuguese', () => {
  assert.equal(humanDuration(0), 'menos de 1 minuto');
  assert.equal(humanDuration(59_000), 'menos de 1 minuto');
  assert.equal(humanDuration(-5), 'menos de 1 minuto');
  assert.equal(humanDuration(Number.NaN), 'menos de 1 minuto');
  assert.equal(humanDuration(60_000), '1 minuto');
  assert.equal(humanDuration(45 * 60_000), '45 minutos');
  assert.equal(humanDuration(60 * 60_000), '1 hora');
  assert.equal(humanDuration(125 * 60_000), '2 horas e 5 minutos');
  assert.equal(humanDuration(61 * 60_000), '1 hora e 1 minuto');
  assert.equal(humanDuration(24 * 60 * 60_000), '1 dia');
  assert.equal(humanDuration((27 * 60 + 40) * 60_000), '1 dia e 3 horas');
  assert.equal(humanDuration(50 * 60 * 60_000), '2 dias e 2 horas');
});

const fieldOf = (embed: Record<string, unknown>, name: string) => (embed.fields as Array<{ name: string; value: string; inline?: boolean }>).find((f) => f.name === name);

test('Discord notice (room opened): green, host photo, room name, code, status and a counter that Discord keeps updating', () => {
  const info = { host: 'Ramon', roomName: 'Sala do Teste', code: 'K7QM2-XRA9T@ramonlopesdev', hasAvatar: true };
  const e = openedEmbed(info, 1_760_000_000) as Record<string, any>;
  assert.equal(e.color, 0x9ad04d);
  assert.equal(e.author.name, 'Ramon abriu uma sala');
  assert.equal(e.author.icon_url, 'attachment://host.jpg');
  assert.equal(e.title, 'Sala do Teste');
  assert.equal(e.url, APP_DOWNLOAD_URL);
  assert.equal(e.thumbnail.url, 'attachment://icon.png');
  assert.equal(e.footer.text, 'Jaca anti Janja');
  assert.equal(e.timestamp, new Date(1_760_000_000 * 1000).toISOString());
  assert.deepEqual((e.fields as Array<{ name: string }>).map((f) => f.name), ['Código da sala', 'Host', 'Tipo', 'Status', 'Tempo aberta']);
  assert.ok(fieldOf(e, 'Código da sala')!.value.includes('K7QM2-XRA9T@ramonlopesdev'));
  assert.equal(fieldOf(e, 'Status')!.value, 'Aberta');
  assert.equal(fieldOf(e, 'Tempo aberta')!.value, '<t:1760000000:R>'); // Discord shows "há 3 minutos" and counts by itself
  assert.equal(fieldOf(e, 'Tipo')!.value, 'Sala fixa');
  // without a photo there is no author icon (the message would point to an attachment that does not exist)
  assert.equal((openedEmbed({ ...info, hasAvatar: false }, 1_760_000_000) as Record<string, any>).author.icon_url, undefined);
});

test('Discord notice (room closed): same message turned grey, status "Fechada", how long it was open or "Desconhecido"', () => {
  const info = { host: 'Ramon', roomName: 'Sala do Teste', code: 'K7QM2-XRA9T@ramonlopesdev', hasAvatar: false };
  const e = closedEmbed(info, 125 * 60_000, 1_760_000_000_000) as Record<string, any>;
  assert.equal(e.color, 0x6b7160);
  assert.equal(e.author.name, 'Ramon encerrou a sala');
  assert.equal(e.title, 'Sala do Teste');
  assert.equal(e.url, undefined); // the closed one no longer invites anybody to download the app
  assert.deepEqual((e.fields as Array<{ name: string }>).map((f) => f.name), ['Código da sala', 'Host', 'Tipo', 'Status', 'Ficou aberta por']);
  assert.equal(fieldOf(e, 'Status')!.value, 'Fechada');
  assert.equal(fieldOf(e, 'Ficou aberta por')!.value, '2 horas e 5 minutos');
  assert.equal(e.timestamp, new Date(1_760_000_000_000).toISOString());
  // the app died: the time is not known
  assert.equal(fieldOf(closedEmbed(info, null), 'Ficou aberta por')!.value, 'Desconhecido');
});

test('Discord notice: names typed by a person cannot break the message or ping anybody', () => {
  const evil = { host: '@everyone *Ana*\nlinha', roomName: '[sala](http://x) @here', code: 'AB`CD', hasAvatar: false };
  const e = openedEmbed(evil, 1_760_000_000) as Record<string, any>;
  assert.equal(e.author.name, '@everyone *Ana* linha abriu uma sala'); // the author line reads no markdown: plain, on one line
  const BS = String.fromCharCode(92);
  assert.equal(e.title, `${BS}[sala${BS}]${BS}(http${BS}://x${BS}) ${BS}@here`); // the title does: escaped
  assert.equal(fieldOf(e, 'Host')!.value, `${BS}@everyone ${BS}*Ana${BS}* linha`);
  assert.ok(!fieldOf(e, 'Código da sala')!.value.slice(3, -3).includes('`')); // a backtick in the code cannot close the code block
  assert.equal((openedEmbed({ host: '', roomName: '', code: 'X', hasAvatar: false }, 1) as Record<string, any>).title, 'Jaca room'); // nameless room
  assert.equal((openedEmbed({ host: '', roomName: 'S', code: 'X', hasAvatar: false }, 1) as Record<string, any>).author.name, 'Alguém abriu uma sala');
});

// ---- regressions: the log must say what really came back, but never hold a way into a room

test('log: a server answer keeps its content but hides the resume token, the invite code and shortens photos', () => {
  const answer = JSON.stringify({
    type: 'welcome',
    payload: {
      peerId: 'a1b2c3d4e5f6',
      resumeToken: 'SEGREDO-DE-RETOMADA',
      inviteCode: 'K7QM2-XRA9T@minha-conta',
      roomName: 'Sala X',
      peers: [{ peerId: 'z9', name: 'Ana', avatar: 'data:image/jpeg;base64,' + 'A'.repeat(5000), share: null }],
    },
  });
  const line = redact(answer);
  assert.ok(line.includes('"type":"welcome"') && line.includes('"roomName":"Sala X"') && line.includes('"peerId":"a1b2c3d4e5f6"'), 'what the server said stays readable');
  assert.ok(!line.includes('SEGREDO-DE-RETOMADA') && !line.includes('K7QM2-XRA9T'), 'secrets are hidden');
  assert.ok(line.includes('"resumeToken":"<oculto>"') && line.includes('"inviteCode":"<oculto>"'));
  assert.ok(/"avatar":"<foto \d+ bytes>"/.test(line) && !line.includes('AAAA'), 'a photo is only its size');
  assert.ok(redact('x'.repeat(5000)).length <= 700, 'cut so one answer cannot fill the file');
  assert.ok(!redact('{"key":"owner-key-123456789012345678"}').includes('owner-key'), 'an owner key is hidden too');
});

test('join errors carry what exactly happened, for the log and not for the screen', () => {
  const e = new JoinError('TIMEOUT');
  assert.equal(e.code, 'TIMEOUT');
  assert.equal(e.detail, ''); // filled by the client with the phase, the times and the close codes
  e.detail = 'a conexão abriu em 273 ms, mas a sala não respondeu em 15 s';
  assert.equal(e.message, 'TIMEOUT'); // the text shown to the person is chosen elsewhere; the detail never leaks into it
});

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jaj-unit-'));
const FAV = { code: 'K7QM2-XRA9T@ramonlopesdev', name: 'Sexta do Filme' };

test('config: a missing file is "no config yet", not an error', () => {
  const dir = tempDir();
  assert.deepEqual(readConfig(path.join(dir, 'config.json')), { status: 'missing' });
});

test('config: saving keeps the previous good file as config.json.bak and leaves no temporary file behind', () => {
  const file = path.join(tempDir(), 'config.json');
  writeConfig(file, { name: 'Ana', favoriteRooms: [FAV] });
  writeConfig(file, { name: 'Ana', favoriteRooms: [FAV, { code: 'B5N7C-JT4HR@ramonlopesdev', name: 'Estudos' }] });
  const bak = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
  assert.equal(bak.favoriteRooms.length, 1, 'the copy is the save before the last one');
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

test('config: a damaged config.json does not erase the favorites, the last good copy is used and the damaged file is kept aside', () => {
  const dir = tempDir();
  const file = path.join(dir, 'config.json');
  writeConfig(file, { name: 'Ana', favoriteRooms: [FAV] });
  writeConfig(file, { name: 'Ana', favoriteRooms: [FAV] }); // now a .bak exists
  fs.writeFileSync(file, '{"name":"Ana","favoriteRooms":[{"code":"K7QM2-XR'); // cut in the middle, like a write interrupted by an update
  const read = readConfig(file);
  assert.equal(read.status, 'ok');
  assert.equal((read as any).from, 'backup');
  assert.deepEqual((read as any).value.favoriteRooms, [FAV]);
  assert.ok(fs.readdirSync(dir).some((n) => /^config\.damaged-\d+\.json$/.test(n)), 'the damaged file is not destroyed');
});

test('config: damaged and without a copy is reported as unreadable (never as an empty config that the next save would write over)', () => {
  const dir = tempDir();
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, 'not json at all');
  assert.equal(readConfig(file).status, 'unreadable');
});

test('rooms copy outside the app data: favorites and fixed rooms come back, the Discord webhook does not travel', () => {
  const dir = tempDir();
  writeRoomsBackup(dir, [FAV], [{ id: 'K7QM2XRA9T', name: 'Minha sala', discordWebhookEnc: 'SEGREDO' }]);
  assert.ok(!fs.readFileSync(path.join(dir, 'rooms.json'), 'utf8').includes('SEGREDO'));
  const back = readRoomsBackup(dir);
  assert.deepEqual(back?.favoriteRooms, [FAV]);
  assert.deepEqual(back?.fixedRooms, [{ id: 'K7QM2XRA9T', name: 'Minha sala' }]);
  assert.equal(readRoomsBackup(tempDir()), null, 'no copy yet');
});

test('fixed rooms: the icon is kept only when it is one of the pictures the interface knows, and it survives the copy outside the app data', () => {
  const rooms = cleanFixedRooms([
    { id: 'K7QM2XRA9T', name: 'Com ícone', icon: 'popcorn', discordWebhookEnc: '' },
    { id: 'B5N7CJT4HR', name: 'Ícone inventado', icon: 'not-an-icon', discordWebhookEnc: '' },
    { id: 'D9F2GSM6YE', name: 'Sem ícone', discordWebhookEnc: '' },
  ]);
  assert.equal(rooms[0].icon, 'popcorn');
  assert.equal(rooms[1].icon, undefined);
  assert.equal(rooms[2].icon, undefined);
  const dir = tempDir();
  writeRoomsBackup(dir, [], rooms);
  assert.equal(readRoomsBackup(dir)?.fixedRooms[0].icon, 'popcorn');
});

test('rooms copy outside the app data: it also remembers which interface was chosen and that the new one was already seen', () => {
  const dir = tempDir();
  writeRoomsBackup(dir, [], [], { ui: 'legacy', newUiSeen: true });
  assert.equal(readRoomsBackup(dir)?.ui, 'legacy');
  assert.equal(readRoomsBackup(dir)?.newUiSeen, true);
  writeRoomsBackup(dir, [], [], { ui: 'next', newUiSeen: true });
  assert.equal(readRoomsBackup(dir)?.ui, 'next');
  writeRoomsBackup(dir, [], []);
  assert.equal(readRoomsBackup(dir)?.newUiSeen, false);
});

test('room notice: text is trimmed and limited, the id is cleaned, the time is capped at 24 h and a notice with no text or under a second is refused', () => {
  assert.deepEqual(cleanNotice({ id: 'a-1', text: '  hello   world ', remainingMs: 60_000 }), { id: 'a-1', text: 'hello world', remainingMs: 60_000, totalMs: 60_000 });
  // the total (for the bar of time left) is kept, never below the time left and never above 24 h
  assert.equal(cleanNotice({ id: 'a', text: 't', remainingMs: 60_000, totalMs: 120_000 })?.totalMs, 120_000);
  assert.equal(cleanNotice({ id: 'a', text: 't', remainingMs: 60_000, totalMs: 1_000 })?.totalMs, 60_000);
  assert.equal(cleanNotice({ id: 'a', text: 't', remainingMs: 60_000, totalMs: 99 * 3_600_000 })?.totalMs, MAX_NOTICE_MS);
  assert.equal(cleanNotice({ id: 'a', text: 'x'.repeat(500), remainingMs: 60_000 })?.text.length, MAX_NOTICE_TEXT);
  assert.equal(cleanNotice({ id: 'a<b>', text: 't', remainingMs: 60_000 })?.id, 'ab');
  assert.equal(cleanNotice({ id: 'a', text: 't', remainingMs: 99 * 3_600_000 })?.remainingMs, MAX_NOTICE_MS);
  assert.equal(cleanNotice({ id: 'a', text: '   ', remainingMs: 60_000 }), null);
  assert.equal(cleanNotice({ id: 'a', text: 't', remainingMs: 500 }), null);
  assert.equal(cleanNotice({ id: 'a', text: 't', remainingMs: Number.NaN }), null);
  assert.equal(cleanNotice({ id: '', text: 't', remainingMs: 60_000 }), null);
  assert.equal(cleanNotice(null), null);
});

test('room notices are relayed by the room server: to everybody else when added, to one person when handed to a newcomer, and only the author name is trusted', async () => {
  const server = new SignalingServer(47895, 'Sala');
  await server.start();
  const open = (name: string) =>
    new Promise<{ ws: WebSocket; inbox: any[]; id: string }>((resolve) => {
      const ws = new WebSocket('ws://127.0.0.1:47895');
      const inbox: any[] = [];
      ws.on('open', () => ws.send(JSON.stringify({ type: 'join', payload: { token: server.token, name } })));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        inbox.push(m);
        if (m.type === 'welcome') resolve({ ws, inbox, id: m.payload.peerId });
      });
    });
  const wait = () => new Promise((r) => setTimeout(r, 150));
  try {
    const a = await open('Ana');
    const b = await open('Bia');
    a.ws.send(JSON.stringify({ type: 'notice-add', payload: { id: 'n1', text: ' hi ', remainingMs: 120_000, extra: 'x' } }));
    a.ws.send(JSON.stringify({ type: 'notice-add', payload: { id: 'bad', text: '', remainingMs: 120_000 } }));
    await wait();
    const got = b.inbox.filter((m) => m.type === 'notice-add');
    assert.equal(got.length, 1);
    assert.deepEqual(got[0].payload, { id: 'n1', text: 'hi', remainingMs: 120_000, totalMs: 120_000 });
    assert.equal(got[0].from, a.id);
    assert.equal(a.inbox.filter((m) => m.type === 'notice-add').length, 0); // not echoed to the author

    const c = await open('Caio');
    a.ws.send(JSON.stringify({ type: 'notice-add', to: c.id, payload: { id: 'n1', text: 'hi', remainingMs: 100_000 } }));
    await wait();
    assert.equal(c.inbox.filter((m) => m.type === 'notice-add').length, 1);
    assert.equal(b.inbox.filter((m) => m.type === 'notice-add').length, 1); // the hand-over reached only the newcomer

    b.ws.send(JSON.stringify({ type: 'notice-remove', payload: { id: 'n1' } }));
    await wait();
    const removed = a.inbox.find((m) => m.type === 'notice-remove');
    assert.equal(removed.from, b.id); // the server says who asked: the app ignores it unless that is the author
    assert.equal(removed.payload.id, 'n1');
    for (const p of [a, b, c]) p.ws.close();
  } finally {
    server.stop();
  }
});

test('the local room server sends the picture of the room to everybody who joins', async () => {
  const server = new SignalingServer(47897, 'Sala', 'rocket');
  await server.start();
  try {
    const welcome: any = await new Promise((resolve) => {
      const ws = new WebSocket('ws://127.0.0.1:47897');
      ws.on('open', () => ws.send(JSON.stringify({ type: 'join', payload: { token: server.token, name: 'Ana' } })));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === 'welcome') {
          ws.close();
          resolve(m.payload);
        }
      });
    });
    assert.equal(welcome.roomIcon, 'rocket');
  } finally {
    server.stop();
  }
});
