// Regression tests for bugs that were found in real use. Each test says what went wrong, so that it cannot come back unnoticed.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { WebSocketServer } from 'ws';
import { createRoom, enterCode, launchApp, TestApp } from './app';
import { OWNER_KEY, startWorker, WORKER_URL } from './worker';

let stopWorker: (() => void) | undefined;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  stopWorker = await startWorker();
});
test.afterAll(() => stopWorker?.());

const env = { JACA_WORKER_URL: WORKER_URL };
const readConfig = (a: TestApp) => JSON.parse(fs.readFileSync(path.join(a.dir, 'config.json'), 'utf8'));
const readLog = (a: TestApp) => {
  try {
    return fs.readFileSync(path.join(a.dir, 'jaca.log'), 'utf8');
  } catch {
    return '';
  }
};

/** Switches to Cloudflare mode and saves the (local) Worker. */
async function configureWorker(a: TestApp) {
  await a.page.getByRole('button', { name: 'Configurações' }).click();
  await a.page.getByRole('radio', { name: 'Cloudflare' }).click();
  await a.page.getByPlaceholder('sua-conta').fill('ramon');
  await a.page.getByPlaceholder('Cole a chave do dono').fill(OWNER_KEY);
  await a.page.getByRole('button', { name: 'Salvar e testar' }).click();
  await expect(a.page.getByText('Worker conectado.')).toBeVisible({ timeout: 20_000 });
  await a.page.getByRole('button', { name: 'Voltar' }).click();
}

// ---------------------------------------------------------------------------------------------------------------- big profile photo

/** A valid PNG with a smooth picture and a little noise: big as text (tens of KB), but a JPEG of it is small, like a real photo. */
function bigPhoto(size = 180): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 9) - 4;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 3;
      raw[i] = Math.max(0, Math.min(255, Math.round((x / size) * 230) + noise()));
      raw[i + 1] = Math.max(0, Math.min(255, Math.round((y / size) * 200) + noise()));
      raw[i + 2] = Math.max(0, Math.min(255, 120 + noise()));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

test('REGRESSION: a profile photo bigger than 16 KB used to make the room server stay silent (the join timed out); now the app sends a smaller copy and everybody gets in', async () => {
  const photo = bigPhoto();
  expect(photo.length).toBeGreaterThan(30_000); // the same kind of photo that a 256 px crop produces: far above the 16 KB the room server can keep per person
  const host = await launchApp('photo-host', { name: 'Ana', avatar: photo }, env);
  const guest = await launchApp('photo-guest', { name: 'Bia', avatar: photo }, env);
  try {
    await configureWorker(host);
    const code = await createRoom(host.page, 'Sala da foto'); // creating a room with a big photo used to fail the same way
    await enterCode(guest.page, code);
    await expect(guest.page.getByRole('heading', { name: 'Participantes' })).toBeVisible({ timeout: 30_000 });
    await expect(host.page.locator('.peer-name')).toHaveText(['Ana (você)', 'Bia'], { timeout: 15_000 });

    // each side sees the other's photo (the smaller copy); the photo saved on the PC of each one is untouched
    await expect(guest.page.locator('.peer-row', { hasText: 'Ana' }).locator('img')).toHaveCount(1);
    await expect(host.page.locator('.peer-row', { hasText: 'Bia' }).locator('img')).toHaveCount(1);
    expect(readConfig(host).avatar).toBe(photo);
    expect(readConfig(guest).avatar).toBe(photo);
    expect(readLog(guest)).toContain('foto de perfil reduzida para a sala');

    // what the others receive really fits the limit of the room server
    const sent = await guest.page.locator('.peer-row', { hasText: 'Ana' }).locator('img').getAttribute('src');
    expect(sent!.length).toBeLessThanOrEqual(12_000);
  } finally {
    await guest.close();
    await host.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------- join with no answer

test('REGRESSION: a room that opens the connection but never answers gets two attempts of 15 s, an honest message, and a log that says exactly what happened', async () => {
  test.setTimeout(180_000);
  // a fake room server: it accepts connections, answers the "room closed" test of the diagnosis, and stays silent for any real room
  let joinAttempts = 0;
  const server = http.createServer((_req, res) => res.end('{"ok":true,"service":"jaca-sala"}'));
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const probe = req.url?.includes('0000000000');
    if (!probe) joinAttempts++;
    ws.on('message', () => {
      if (probe) ws.send(JSON.stringify({ type: 'error', payload: { code: 'ROOM_CLOSED' } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(8795, '127.0.0.1', resolve));
  const guest = await launchApp('silent-guest', { name: 'Bia' }, { JACA_WORKER_URL: 'http://127.0.0.1:8795' });
  try {
    const started = Date.now();
    await enterCode(guest.page, 'ABCDE-FGHJK@local');
    await expect(guest.page.locator('.toast.error').last()).toContainText('A sala não respondeu a tempo', { timeout: 120_000 });
    const waited = (Date.now() - started) / 1000;
    expect(waited).toBeGreaterThan(29); // two attempts of 15 s, not the old single 7 s
    expect(joinAttempts).toBe(2);
    await expect(guest.page.locator('.toast.error').last()).toContainText('duas tentativas');
    await expect(guest.page.locator('.toast.error').last()).not.toContainText('Provavelmente a sala não está aberta'); // the old, misleading text

    // the screen stays plain; the log has the detail
    const shown = await guest.page.locator('.toast.error').last().innerText();
    expect(shown).not.toMatch(/\d+ ms/);
    const log = readLog(guest);
    expect(log).toContain('entrada 1/2: conectando a 127.0.0.1:8795');
    expect(log).toMatch(/entrada 1\/2: conexão aberta em \d+ ms/);
    expect(log).toMatch(/entrada 1\/2: falhou \(TIMEOUT\): a conexão abriu em \d+ ms, mas a sala não respondeu em 15 s/);
    expect(log).toContain('sem resposta na tentativa 1/2; tentando de novo em 1 s');
    expect(log).toContain('entrada 2/2: conectando');
    expect(log).toMatch(/tentativa 1: .*\| tentativa 2: /);
    expect(log).toMatch(/teste de conexão com a sala inexistente: respondeu em \d+ ms — resposta: .*ROOM_CLOSED/);
    expect(log).not.toContain('ABCDEFGHJK'); // the room id is a way into the room: never in the log
  } finally {
    await guest.close();
    await new Promise((resolve) => wss.close(() => server.close(resolve)));
  }
});

// ---------------------------------------------------------------------------------------------------------------- the log tells what came back, and never a secret

test('REGRESSION: the log has the real answers of the server and of the Worker, and never the owner key or the invite code', async () => {
  const host = await launchApp('log-host', { name: 'Ana' }, env);
  const guest = await launchApp('log-guest', { name: 'Bia' }, env);
  try {
    await configureWorker(host);
    const code = await createRoom(host.page, 'Sala do log');
    await enterCode(guest.page, code);
    await expect(guest.page.getByRole('heading', { name: 'Participantes' })).toBeVisible({ timeout: 20_000 });
    await expect(host.page.locator('.peer-name')).toHaveText(['Ana (você)', 'Bia'], { timeout: 15_000 });

    const hostLog = readLog(host);
    // answers as they came (not only a sentence of ours)
    expect(hostLog).toMatch(/\[worker\] verificar chave em 127\.0\.0\.1:8798: HTTP 200 .* em \d+ ms.*; corpo: /);
    expect(hostLog).toMatch(/\[worker\] salvar e testar: endereço "ramon", chave colada \(\d+ caracteres\)/);
    expect(hostLog).toMatch(/\[worker\] salvar e testar: deu certo/);
    expect(hostLog).toContain('[entrar] entrada 1/1: conectando');
    expect(hostLog).toMatch(/resposta "welcome", \d+ bytes, em \d+ ms; conteúdo: \{"type":"welcome"/);
    expect(hostLog).toMatch(/recebido peer-joined: \{"type":"peer-joined".*"name":"Bia"/);
    expect(hostLog).toContain('Bia ('); // who came in
    expect(hostLog).toMatch(/\[config\] alterado: connectionMode=cloudflare/);
    expect(hostLog).toMatch(/\[app\] tela: sala/);
    const guestLog = readLog(guest);
    expect(guestLog).toMatch(/entrada 1\/2: resposta "welcome"/);

    // never a way into the room or into the Worker
    const roomId = code.split('@')[0].replace('-', '');
    for (const [name, log] of [['host', hostLog], ['guest', guestLog]] as const) {
      expect(log, `${name} log must not hold the owner key`).not.toContain(OWNER_KEY);
      expect(log, `${name} log must not hold the invite code`).not.toContain(code);
      expect(log, `${name} log must not hold the room id`).not.toContain(roomId);
      expect(log, `${name} log must not hold a resume token`).not.toMatch(/"resumeToken":"(?!<oculto>)/);
      expect(log, `${name} log must not hold a photo`).not.toMatch(/data:image\/[a-z]+;base64,[A-Za-z0-9+/]{50}/);
    }
  } finally {
    await guest.close();
    await host.close();
  }
});
