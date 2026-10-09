import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import test, { after } from 'node:test';
import WebSocket from 'ws';

const WS = process.env.WORKER_URL;
const HTTP = WS.replace(/^ws/, 'http');
const KEY = process.env.OWNER_KEY;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const roomId = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(32)]).join('');
const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const opened = [];

/** Connects; resolves with the socket and everything it receives (JSON parsed, plain text kept as a string). */
function open(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}${path}`);
    const msgs = [];
    ws.on('message', (d) => {
      const text = d.toString();
      try {
        msgs.push(JSON.parse(text));
      } catch {
        msgs.push(text);
      }
    });
    ws.on('open', () => {
      opened.push(ws);
      resolve({ ws, msgs });
    });
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(Object.assign(new Error(`http ${res.statusCode}`), { status: res.statusCode })));
  });
}
const send = (ws, type, payload = {}, to = null) => ws.send(JSON.stringify({ type, to, payload }));

async function createRoom(id, name = 'Ana', roomName = 'Sala X', canResume = false) {
  const c = await open(`/ws/${id}?create=1&key=${KEY}`);
  send(c.ws, 'join', { token: 0, name, avatar: null, roomName, ...(canResume ? { canResume } : {}) });
  await wait();
  return c;
}
async function joinGuest(id, name = 'Bia', canResume = false) {
  const g = await open(`/ws/${id}`);
  send(g.ws, 'join', { token: 0, name, avatar: null, ...(canResume ? { canResume } : {}) });
  await wait();
  return g;
}

after(() => opened.forEach((ws) => ws.terminate()));

test('health and the owner key check', async () => {
  assert.equal((await fetch(`${HTTP}/health`)).status, 200);
  assert.equal((await fetch(`${HTTP}/api/check?key=wrong`)).status, 401);
  assert.equal((await fetch(`${HTTP}/api/check`)).status, 401);
  assert.equal((await fetch(`${HTTP}/api/check?key=${KEY}`)).status, 200);
});

test('creating a room needs the owner key; joining does not', async () => {
  const id = roomId();
  await assert.rejects(open(`/ws/${id}?create=1&key=nope`), (e) => e.status === 401);
  await assert.rejects(open(`/ws/${id}?create=1`), (e) => e.status === 401);
  assert.equal((await fetch(`${HTTP}/ws/${id}`)).status, 426); // plain HTTP is not a WebSocket upgrade
});

test('the owner gets a welcome with the room name, invite code and age', async () => {
  const host = await createRoom(roomId(), 'Ana', '  Noite   de filmes  ');
  const welcome = host.msgs.find((m) => m.type === 'welcome');
  assert.ok(welcome, 'welcome received');
  assert.equal(welcome.payload.roomName, 'Noite de filmes'); // whitespace collapsed
  assert.match(welcome.payload.inviteCode, /^[0-9A-Z]{5}-[0-9A-Z]{5}@local$/);
  assert.ok(welcome.payload.roomAgeMs >= 0 && welcome.payload.roomAgeMs < 5000);
  assert.deepEqual(welcome.payload.peers, []);
});

test('a room without a name falls back to "Sala de <owner>"', async () => {
  const id = roomId();
  const c = await open(`/ws/${id}?create=1&key=${KEY}`);
  send(c.ws, 'join', { token: 0, name: 'Ana', avatar: null });
  await wait();
  assert.equal(c.msgs.find((m) => m.type === 'welcome').payload.roomName, 'Sala de Ana');
});

test('a guest joins: both sides see each other', async () => {
  const id = roomId();
  const host = await createRoom(id);
  const guest = await joinGuest(id, 'Bia');
  const gw = guest.msgs.find((m) => m.type === 'welcome');
  assert.equal(gw.payload.roomName, 'Sala X');
  assert.equal(gw.payload.peers.length, 1);
  assert.equal(gw.payload.peers[0].name, 'Ana');
  assert.equal(host.msgs.at(-1).type, 'peer-joined');
  assert.equal(host.msgs.at(-1).payload.name, 'Bia');
});

test('a room nobody created answers ROOM_CLOSED', async () => {
  const g = await open(`/ws/${roomId()}`);
  await wait();
  assert.equal(g.msgs[0].payload.code, 'ROOM_CLOSED');
});

test('creating a room id that is already in use is refused', async () => {
  const id = roomId();
  await createRoom(id);
  await assert.rejects(open(`/ws/${id}?create=1&key=${KEY}`), (e) => e.status === 409);
});

test('messages to one peer are relayed with the real sender; nobody else sees them', async () => {
  const id = roomId();
  const host = await createRoom(id);
  const guest = await joinGuest(id, 'Bia');
  const third = await joinGuest(id, 'Caio');
  const hostId = host.msgs.find((m) => m.type === 'welcome').payload.peerId;
  const guestId = guest.msgs.find((m) => m.type === 'welcome').payload.peerId;

  send(guest.ws, 'offer', { sdp: 'x' }, hostId);
  guest.ws.send(JSON.stringify({ type: 'offer', from: 'forged', to: hostId, payload: { sdp: 'y' } }));
  await wait();
  const offers = host.msgs.filter((m) => m.type === 'offer');
  assert.equal(offers.length, 2);
  assert.ok(offers.every((o) => o.from === guestId), 'from is set by the server');
  assert.equal(third.msgs.filter((m) => m.type === 'offer').length, 0);
  assert.equal(guest.msgs.filter((m) => m.type === 'offer').length, 0);
});

test('sharing: announced to the others, remembered for late joiners, quality updates re-announced, stop announced', async () => {
  const id = roomId();
  const host = await createRoom(id);
  const guest = await joinGuest(id, 'Bia');
  const guestId = guest.msgs.find((m) => m.type === 'welcome').payload.peerId;

  send(guest.ws, 'share-started', { resolution: '1080p', fps: 60, mode: 'motion' });
  await wait();
  const started = host.msgs.find((m) => m.type === 'share-started');
  assert.equal(started.from, guestId);
  assert.equal(started.payload.fps, 60);

  const late = await joinGuest(id, 'Caio');
  const seen = late.msgs.find((m) => m.type === 'welcome').payload.peers.find((p) => p.peerId === guestId);
  assert.equal(seen.share.resolution, '1080p');

  send(guest.ws, 'share-started', { resolution: '720p', fps: 30, mode: 'detail' });
  await wait();
  assert.equal(host.msgs.filter((m) => m.type === 'share-started').length, 2);

  send(guest.ws, 'share-stopped');
  await wait();
  assert.equal(host.msgs.at(-1).type, 'share-stopped');
  assert.equal(host.msgs.at(-1).from, guestId);
});

test('profile updates are sanitized and broadcast to the others only', async () => {
  const id = roomId();
  const host = await createRoom(id);
  const guest = await joinGuest(id, 'Bia');
  const guestId = guest.msgs.find((m) => m.type === 'welcome').payload.peerId;
  const png = 'data:image/png;base64,AAAA';

  send(guest.ws, 'profile-update', { name: '  Bianca  ', avatar: png });
  await wait();
  assert.deepEqual(host.msgs.find((m) => m.type === 'peer-updated').payload, { peerId: guestId, name: 'Bianca', avatar: png });
  assert.equal(guest.msgs.some((m) => m.type === 'peer-updated'), false);

  send(guest.ws, 'profile-update', { name: 'x'.repeat(40), avatar: 'javascript:alert(1)' });
  send(guest.ws, 'profile-update', { name: '   ', avatar: null });
  await wait();
  const updates = host.msgs.filter((m) => m.type === 'peer-updated');
  assert.equal(updates.length, 2);
  assert.equal(updates[1].payload.name.length, 24);
  assert.equal(updates[1].payload.avatar, null);
});

test('the room holds 10 people; the 11th gets ROOM_FULL', async () => {
  const id = roomId();
  await createRoom(id);
  for (let i = 0; i < 9; i++) await joinGuest(id, `P${i}`);
  const extra = await joinGuest(id, 'Late');
  assert.equal(extra.msgs.find((m) => m.type === 'error')?.payload.code, 'ROOM_FULL');
});

test('a guest leaving is announced; the owner leaving closes the room for everyone', async () => {
  const id = roomId();
  const host = await createRoom(id);
  const a = await joinGuest(id, 'Bia');
  const b = await joinGuest(id, 'Caio');
  const aId = a.msgs.find((m) => m.type === 'welcome').payload.peerId;

  a.ws.close();
  await wait(400);
  const left = host.msgs.find((m) => m.type === 'peer-left');
  assert.equal(left.payload.peerId, aId);
  assert.ok(b.msgs.some((m) => m.type === 'peer-left'));

  host.ws.close();
  await wait(500);
  assert.ok(b.msgs.some((m) => m.type === 'room-closed'), 'the remaining guest is told the room is over');

  const after = await open(`/ws/${id}`);
  await wait();
  assert.equal(after.msgs[0].payload.code, 'ROOM_CLOSED'); // the room is gone
  const again = await createRoom(id); // and the id can be used again
  assert.ok(again.msgs.some((m) => m.type === 'welcome'));
});

test('the plain-text ping is answered with pong, and garbage does not break the room', async () => {
  const id = roomId();
  const host = await createRoom(id);
  host.ws.send('ping');
  host.ws.send('this is not json');
  host.ws.send(JSON.stringify({ type: 'welcome', payload: {} })); // not a client message type
  await wait();
  assert.ok(host.msgs.includes('pong'));
  const guest = await joinGuest(id, 'Bia'); // still works
  assert.ok(guest.msgs.some((m) => m.type === 'welcome'));
});

test('a Worker with an OWNER_KEY secret never accepts a claim', async () => {
  const res = await fetch(`${HTTP}/api/claim`, { method: 'POST', body: JSON.stringify({ key: 'z'.repeat(32) }) });
  assert.equal(res.status, 403);
  assert.equal((await fetch(`${HTTP}/api/check?key=${KEY}`)).status, 200);
});

test('a dropped guest keeps its place and takes it back with the resume token (nobody is told it left)', async () => {
  const id = roomId();
  const host = await createRoom(id, 'Ana', 'Sala X', true);
  const guest = await joinGuest(id, 'Bia', true);
  const welcome = guest.msgs.find((m) => m.type === 'welcome').payload;
  assert.match(welcome.resumeToken, /^[0-9a-f]{32}$/);

  guest.ws.terminate(); // a connection that just disappears
  await wait(600);
  assert.equal(host.msgs.some((m) => m.type === 'peer-left'), false, 'the host is not told yet');

  const back = await open(`/ws/${id}`);
  send(back.ws, 'join', { token: 0, name: 'Bia', avatar: null, resume: { peerId: welcome.peerId, token: welcome.resumeToken } });
  await wait();
  const again = back.msgs.find((m) => m.type === 'welcome').payload;
  assert.equal(again.resumed, true);
  assert.equal(again.peerId, welcome.peerId);
  assert.deepEqual(again.peers.map((p) => p.name), ['Ana']);
  assert.equal(host.msgs.some((m) => m.type === 'peer-left'), false);

  // messages reach the resumed socket and come from the same id
  send(host.ws, 'offer', { sdp: 'x' }, welcome.peerId);
  await wait();
  assert.ok(back.msgs.some((m) => m.type === 'offer'));
});

test('a wrong resume token is refused, and choosing to leave is immediate', async () => {
  const id = roomId();
  const host = await createRoom(id, 'Ana', 'Sala X', true);
  const guest = await joinGuest(id, 'Bia', true);
  const welcome = guest.msgs.find((m) => m.type === 'welcome').payload;

  const thief = await open(`/ws/${id}`);
  send(thief.ws, 'join', { token: 0, name: 'Eve', avatar: null, resume: { peerId: welcome.peerId, token: 'f'.repeat(32) } });
  await wait();
  assert.equal(thief.msgs.find((m) => m.type === 'error')?.payload.code, 'BAD_TOKEN');

  guest.ws.close(1000, 'leave');
  await wait();
  assert.ok(host.msgs.some((m) => m.type === 'peer-left' && m.payload.peerId === welcome.peerId));
});

test('a host whose connection dropped can come back without ?create and the room stays open', async () => {
  const id = roomId();
  const host = await createRoom(id, 'Ana', 'Sala X', true);
  const hostWelcome = host.msgs.find((m) => m.type === 'welcome').payload;
  const guest = await joinGuest(id, 'Bia', true);

  host.ws.terminate();
  await wait(600);
  assert.equal(guest.msgs.some((m) => m.type === 'room-closed'), false, 'the room stays open during the grace period');

  const back = await open(`/ws/${id}`);
  send(back.ws, 'join', { token: 0, name: 'Ana', avatar: null, resume: { peerId: hostWelcome.peerId, token: hostWelcome.resumeToken } });
  await wait();
  assert.equal(back.msgs.find((m) => m.type === 'welcome').payload.resumed, true);
  assert.equal(guest.msgs.some((m) => m.type === 'room-closed'), false);

  // the room is still the host's: closing for real ends it for everyone
  back.ws.close(1000, 'leave');
  await wait();
  assert.ok(guest.msgs.some((m) => m.type === 'room-closed'));
});
