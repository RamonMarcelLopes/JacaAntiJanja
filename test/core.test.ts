import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { decodeInvite, encodeInvite } from '../src/shared/invite';
import { formatDuration } from '../src/shared/time';
import { buildStunRequest, isCgnatRange, isPrivateIpv4, parseStunResponse } from '../src/main/network';
import { SignalingServer } from '../src/main/signaling';

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
