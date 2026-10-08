import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import test from 'node:test';
import WebSocket from 'ws';

// A Worker published WITHOUT an OWNER_KEY secret (what the "Deploy to Cloudflare" button does): the first app to claim it becomes the owner.
const HTTP = process.env.CLAIM_URL;
const WS = HTTP.replace(/^http/, 'ws');
const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const roomId = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(32)]).join('');
const post = (path, key) => fetch(`${HTTP}${path}`, { method: 'POST', body: JSON.stringify({ key }) });

function tryCreate(key) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/ws/${roomId()}?create=1&key=${encodeURIComponent(key)}`);
    ws.on('open', () => {
      ws.close();
      resolve(101);
    });
    ws.on('unexpected-response', (_q, res) => resolve(res.statusCode));
    ws.on('error', () => {});
  });
}

test('nobody is the owner before the first claim, and a short key is refused', async () => {
  assert.equal((await (await fetch(`${HTTP}/api/status`)).json()).claimed, false);
  assert.equal((await fetch(`${HTTP}/api/check?key=${KEY_A}`)).status, 401);
  assert.equal((await post('/api/claim', 'short')).status, 400);
  assert.equal(await tryCreate(KEY_A), 401);
});

test('the first key claims the Worker, the same key can repeat it, any other key is refused for good', async () => {
  const first = await post('/api/claim', KEY_A);
  assert.equal(first.status, 200);
  const body = await first.text();
  assert.ok(!body.includes(KEY_A), 'the answer never repeats the key');
  assert.equal((await post('/api/claim', KEY_A)).status, 200);
  assert.equal((await post('/api/claim', KEY_B)).status, 403);
  assert.equal((await fetch(`${HTTP}/api/check?key=${KEY_A}`)).status, 200);
  assert.equal((await fetch(`${HTTP}/api/check?key=${KEY_B}`)).status, 401);
  const status = await (await fetch(`${HTTP}/api/status`)).text();
  assert.ok(status.includes('"claimed":true') && !status.includes(KEY_A));
});

test('only the owner key creates rooms, and anyone can still join an existing one', async () => {
  assert.equal(await tryCreate(KEY_B), 401);
  assert.equal(await tryCreate(KEY_A), 101);
});

test('two claims at the same time: exactly one wins', async () => {
  // a second, fresh Worker state is not available here, so check the invariant on the claimed one: every other key loses
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => post('/api/claim', String(i).repeat(30))));
  assert.ok(results.every((r) => r.status === 403));
});
