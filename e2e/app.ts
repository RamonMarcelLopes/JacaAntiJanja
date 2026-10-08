import { _electron as electron, ElectronApplication, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(__dirname, '..');

export interface TestApp {
  app: ElectronApplication;
  page: Page;
  dir: string;
  close(): Promise<void>;
}

/**
 * Starts one instance of the built app (run `node build.mjs` first) with its own user-data folder, so two
 * instances can run side by side. `config` pre-seeds config.json; omit it to behave like a first run.
 */
export async function launchApp(label: string, config?: Record<string, unknown>, env: Record<string, string> = {}): Promise<TestApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jaj-e2e-${label}-`));
  if (config) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  const app = await electron.launch({ args: [root, `--user-data-dir=${dir}`], env: { ...(process.env as Record<string, string>), ...env } });
  const page = await app.firstWindow();
  // every sound cue is announced on window ("jaca-sound"), so the tests can tell which sounds were triggered
  await page.evaluate(() => {
    (window as any).__sounds = [];
    window.addEventListener('jaca-sound', (e) => (window as any).__sounds.push((e as CustomEvent).detail));
  });
  await expect(page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible();
  return {
    app,
    page,
    dir,
    close: async () => {
      await app.close().catch(() => undefined);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Names of the sound cues triggered so far in this window, in order. */
export const sounds = (page: Page): Promise<string[]> => page.evaluate(() => [...((window as any).__sounds as string[])]);

/** Creates a room as the host and returns its invite code. */
export async function createRoom(host: Page, roomName?: string): Promise<string> {
  if (roomName !== undefined) await host.getByPlaceholder('Nome da sala (opcional)').fill(roomName);
  await host.getByRole('button', { name: 'Criar sala' }).click();
  const code = host.locator('.code-chip code');
  await expect(code).toBeVisible({ timeout: 20_000 });
  return (await code.textContent())!.trim();
}

/** Joins a room with an invite code from the home screen. */
export async function joinRoom(guest: Page, code: string): Promise<void> {
  await guest.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(code);
  await guest.getByRole('button', { name: 'Entrar' }).click();
  await expect(guest.getByRole('heading', { name: 'Participantes' })).toBeVisible({ timeout: 15_000 });
}

/** A valid 1x1 PNG, enough for the avatar upload path. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
