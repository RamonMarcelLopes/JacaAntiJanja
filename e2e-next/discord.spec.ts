import { expect, Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FAKE_WEBHOOK, FakeDiscord, startFakeDiscord } from '../e2e/discord';
import { OWNER_KEY, startWorker, WORKER_URL } from '../e2e/worker';
import { closeSettings, launchNext, modal, NextApp, openCreateDialog, openSettings, pick } from './app';

// The Discord notice of a fixed room, against a Worker started locally and a small server that plays Discord (JACA_DISCORD_BASE).
let stopWorker: (() => void) | undefined;
let discord: FakeDiscord;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  stopWorker = await startWorker();
  discord = await startFakeDiscord(8795);
});
test.afterAll(async () => {
  stopWorker?.();
  await discord.stop();
});
test.beforeEach(() => discord.reset());

const env = () => ({ JACA_WORKER_URL: WORKER_URL, JACA_DISCORD_BASE: discord.base });
const readNotices = (a: NextApp) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(a.dir, 'discord-notices.json'), 'utf8')) as Array<{ messageId: string }>;
  } catch {
    return [];
  }
};
const fieldOf = (embed: Record<string, any>, name: string) => (embed.fields as Array<{ name: string; value: string }>).find((f) => f.name === name)?.value;
const code = (page: Page) => page.getByRole('button', { name: 'Copiar código da sala' });

async function configureWorker(a: NextApp) {
  const layer = await openSettings(a.page, 'Rede');
  await layer.getByRole('tab', { name: 'Cloudflare' }).click();
  await layer.getByPlaceholder('sua-conta').fill('ramon');
  await layer.getByPlaceholder('Cole a chave do dono').fill(OWNER_KEY);
  await layer.getByRole('button', { name: 'Salvar e testar' }).click();
  await expect(layer.getByText('Worker conectado.')).toBeVisible({ timeout: 20_000 });
  await closeSettings(a.page);
}

/** Creates a NEW fixed room with the Discord notice on and returns the invite code of the room it opened. */
async function openFixedRoomWithDiscord(a: NextApp, roomName: string): Promise<string> {
  const dialog = await openCreateDialog(a.page);
  await pick(a.page, 'Tipo de sala', '+ Nova sala fixa');
  await dialog.getByLabel('Nome da sala').fill(roomName);
  await dialog.getByRole('switch', { name: /Avisar no Discord/ }).click();
  await dialog.getByLabel('Webhook desta sala').fill(FAKE_WEBHOOK);
  await dialog.getByRole('button', { name: 'Criar sala' }).click();
  await expect(code(a.page)).toBeVisible({ timeout: 20_000 });
  return (await code(a.page).getAttribute('data-code'))!;
}

const leave = async (page: Page) => {
  await page.getByRole('button', { name: 'Encerrar sala' }).click();
  await expect(page.getByTestId('home')).toBeVisible({ timeout: 15_000 });
};

test('the notice opens green with the code and "Aberta", and the same message turns "Fechada" when the room ends', async () => {
  const host = await launchNext('dc-life', { name: 'Ana' }, env());
  try {
    await configureWorker(host);
    const roomCode = await openFixedRoomWithDiscord(host, 'Sala Discord');

    // 1) the test message sent when the webhook was saved, 2) the notice of the room that opened
    await expect.poll(() => discord.calls.length, { timeout: 15_000 }).toBe(2);
    expect(discord.calls[0].method).toBe('POST');
    expect(discord.calls[0].embed.title).toBe('Teste do Jaca anti Janja');
    const opened = discord.calls[1];
    expect(opened.method).toBe('POST');
    expect(opened.path).toContain('wait=true'); // the id of the message comes back, to be edited later
    expect(opened.embed.color).toBe(0x9ad04d);
    expect(opened.embed.author.name).toBe('Ana abriu uma sala');
    expect(opened.embed.title).toBe('Sala Discord');
    // the room id part is the same; the account part comes from the Worker's address (a local Worker has none, so the room shows "local")
    const roomId = roomCode.split('@')[0];
    expect(fieldOf(opened.embed, 'Código da sala')).toContain(roomId);
    expect(fieldOf(opened.embed, 'Status')).toBe('Aberta');
    expect(fieldOf(opened.embed, 'Tempo aberta')).toMatch(/^<t:\d+:R>$/);
    expect(opened.files).toContain('icon.png');
    await expect.poll(() => readNotices(host).length).toBe(1); // remembered on disk until it is closed

    // ending the room edits THAT message (it does not post another one)
    await leave(host.page);
    await expect.poll(() => discord.calls.length, { timeout: 15_000 }).toBe(3);
    const closed = discord.calls[2];
    expect(closed.method).toBe('PATCH');
    expect(closed.path).toMatch(/\/messages\/1002/); // the id the server gave to the second message
    expect(closed.embed.color).toBe(0x6b7160);
    expect(closed.embed.author.name).toBe('Ana encerrou a sala');
    expect(fieldOf(closed.embed, 'Status')).toBe('Fechada');
    expect(fieldOf(closed.embed, 'Ficou aberta por')).toBe('menos de 1 minuto');
    expect(fieldOf(closed.embed, 'Código da sala')).toContain(roomId); // the code stays as a record
    await expect.poll(() => readNotices(host).length).toBe(0);

    // opening the same room again is a NEW message
    const dialog = await openCreateDialog(host.page);
    await pick(host.page, 'Tipo de sala', 'Sala fixa: Sala Discord');
    await dialog.getByRole('button', { name: 'Iniciar sala' }).click();
    await expect(code(host.page)).toHaveAttribute('data-code', roomCode);
    await expect.poll(() => discord.calls.length, { timeout: 15_000 }).toBe(4);
    expect(discord.calls[3].method).toBe('POST');
    expect(fieldOf(discord.calls[3].embed, 'Status')).toBe('Aberta');
    await leave(host.page);
    await expect.poll(() => discord.calls.length, { timeout: 15_000 }).toBe(5);
    expect(discord.calls[4].path).toMatch(/\/messages\/1003/);
  } finally {
    await host.close();
  }
});

test('the app dies with the room open: the next start edits the notice to "Fechada" with the time open as "Desconhecido"', async () => {
  let first = await launchNext('dc-crash', { name: 'Ana' }, env());
  const dir = first.dir;
  let second: NextApp | undefined;
  try {
    await configureWorker(first);
    // an app that has been used before: a clean exit writes the encryption key of Windows safeStorage to disk, and that is what lets the next start read the webhook
    await first.app.close();
    first = await launchNext('dc-crash-1', {}, env(), [], dir);
    await openFixedRoomWithDiscord(first, 'Sala Que Caiu');
    await expect.poll(() => discord.calls.length, { timeout: 15_000 }).toBe(2);
    await expect.poll(() => readNotices(first).length).toBe(1);

    // no chance to say goodbye: the whole tree of processes dies at once, like in a crash
    execFileSync('taskkill', ['/PID', String(first.app.process().pid), '/T', '/F'], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(discord.calls.length).toBe(2); // nothing was edited yet

    second = await launchNext('dc-crash-2', {}, env(), [], dir);
    await expect.poll(() => discord.calls.length, { timeout: 20_000 }).toBe(3);
    const closed = discord.calls[2];
    expect(closed.method).toBe('PATCH');
    expect(closed.path).toMatch(/\/messages\/1002/);
    expect(fieldOf(closed.embed, 'Status')).toBe('Fechada');
    expect(fieldOf(closed.embed, 'Ficou aberta por')).toBe('Desconhecido');
    expect(closed.embed.title).toBe('Sala Que Caiu');
    await expect.poll(() => readNotices(second!).length).toBe(0);
    await expect(second.page.locator('.toast[data-kind="warn"]')).toHaveCount(0); // nothing to complain about
  } finally {
    await second?.close();
    if (!second) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* locked for a moment by the killed app */
      }
    }
  }
});

test('somebody deleted the webhook in Discord: the app just ignores it and the room ends as usual', async () => {
  const host = await launchNext('dc-gone', { name: 'Ana' }, env());
  try {
    await configureWorker(host);
    await openFixedRoomWithDiscord(host, 'Sala Sem Webhook');
    await expect.poll(() => discord.calls.length, { timeout: 15_000 }).toBe(2);
    await expect.poll(() => readNotices(host).length).toBe(1);

    discord.deleteWebhook(); // from now on Discord answers 404
    await leave(host.page);
    await expect.poll(() => discord.calls.length, { timeout: 15_000 }).toBe(3); // it tried to edit once
    expect(discord.calls[2].method).toBe('PATCH');
    await expect.poll(() => readNotices(host).length).toBe(0); // and gave up on that notice for good
    await expect(host.page.locator('.toast[data-kind="warn"]')).toHaveCount(0); // no error shown to anybody
    await expect(host.page.getByTestId('home')).toBeVisible();
  } finally {
    await host.close();
  }
});

test('a room without a webhook posts nothing, and the switch off in "Editar sala" stops the notices', async () => {
  const host = await launchNext('dc-off', { name: 'Ana' }, env());
  try {
    await configureWorker(host);
    const roomCode = await openFixedRoomWithDiscord(host, 'Sala Com Aviso');
    await expect.poll(() => discord.calls.length, { timeout: 15_000 }).toBe(2);
    await leave(host.page);
    await expect.poll(() => discord.calls.length, { timeout: 15_000 }).toBe(3);

    // turn the notice off for this room (Configurações > Salas fixas > Editar)
    const layer = await openSettings(host.page, 'Salas fixas');
    await layer.locator('[data-fixed="Sala Com Aviso"]').getByRole('button', { name: 'Editar Sala Com Aviso' }).click();
    const edit = modal(host.page);
    const toggle = edit.getByRole('switch', { name: /Avisar no Discord/ });
    await expect(toggle).toHaveAttribute('aria-checked', 'true'); // it has a webhook
    await expect(edit.getByPlaceholder('Webhook guardado (cole outro para trocar)')).toBeVisible();
    await toggle.click();
    await edit.getByRole('button', { name: 'Salvar' }).click();
    await expect(modal(host.page)).toHaveCount(0);
    await closeSettings(host.page);

    const dialog = await openCreateDialog(host.page);
    await pick(host.page, 'Tipo de sala', 'Sala fixa: Sala Com Aviso');
    await dialog.getByRole('button', { name: 'Iniciar sala' }).click();
    await expect(code(host.page)).toHaveAttribute('data-code', roomCode);
    await host.page.waitForTimeout(1500);
    expect(discord.calls.length).toBe(3); // no new notice
    await leave(host.page);
    await host.page.waitForTimeout(1000);
    expect(discord.calls.length).toBe(3);
  } finally {
    await host.close();
  }
});
