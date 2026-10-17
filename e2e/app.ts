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
export async function launchApp(label: string, config?: Record<string, unknown>, env: Record<string, string> = {}, extraArgs: string[] = [], existingDir?: string): Promise<TestApp> {
  // `existingDir`: start again on the data folder of an app that was killed (everything it saved is still there)
  const dir = existingDir ?? fs.mkdtempSync(path.join(os.tmpdir(), `jaj-e2e-${label}-`));
  if (config && !existingDir) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  const app = await electron.launch({ args: [root, `--user-data-dir=${dir}`, ...extraArgs], env: { ...(process.env as Record<string, string>), ...env } });
  const page = await app.firstWindow();
  // every sound cue is announced on window ("jaca-sound"), so the tests can tell which sounds were triggered
  await page.evaluate(() => {
    (window as any).__sounds = [];
    window.addEventListener('jaca-sound', (e) => (window as any).__sounds.push((e as CustomEvent).detail));
  });
  await expect(page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible();
  // the notice about the new interface sits over the top right corner (it never closes by itself): a person closes it with its X, so do the tests
  // (e2e/ui-notice.spec.ts is the one that looks at it, and asks to keep it with JACA_TEST_KEEP_UI_NOTICE)
  if (!env.JACA_TEST_KEEP_UI_NOTICE) await page.locator('#ui-notice .ui-notice-close').click();
  return {
    app,
    page,
    dir,
    close: async () => {
      await app.close().catch(() => undefined);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* a killed app can leave files locked for a moment: the temporary folder is cleaned by the system later */
      }
    },
  };
}

/** Names of the sound cues triggered so far in this window, in order. */
export const sounds = (page: Page): Promise<string[]> => page.evaluate(() => [...((window as any).__sounds as string[])]);

/**
 * The small dialogs of the home screen (create a room, enter with a code) and of the fixed rooms. A dialog that is already closing is
 * left out: in a window that is not in front its exit animation (and the timer that removes it) can take about a second to finish.
 */
export const smallDialog = (page: Page) => page.locator('.overlay:not(.closing) .dialog.small');

/** Opens the "create a room" dialog from the home screen and returns it. */
export async function openCreateDialog(page: Page) {
  await page.locator('.home-actions').getByRole('button', { name: 'Iniciar sala' }).click();
  const dialog = smallDialog(page);
  await expect(dialog.getByPlaceholder('Nome da sala')).toBeVisible();
  return dialog;
}

/** Creates a (temporary) room as the host from the home screen and returns its invite code. */
export async function createRoom(host: Page, roomName?: string): Promise<string> {
  const dialog = await openCreateDialog(host);
  if (roomName !== undefined) await dialog.getByPlaceholder('Nome da sala').fill(roomName);
  await dialog.getByRole('button', { name: 'Criar sala' }).click();
  const code = host.locator('.code-chip code');
  await expect(code).toBeVisible({ timeout: 20_000 });
  return (await code.textContent())!.trim();
}

/** Opens the share dialog from the screen button of the call dock (nothing open and nothing shared: the dock sits over the participant tiles). */
export async function openShareDialog(page: Page): Promise<void> {
  await page.locator('.dock-screen').click();
}

/** Ends your own transmission from the screen button of the dock (it sits in the player bar, which only reacts while the pointer is over the picture). */
export async function stopSharing(page: Page): Promise<void> {
  await page.locator('.player').hover();
  await page.getByRole('button', { name: 'Parar de compartilhar' }).click();
}

/** Types a code in the "enter" dialog of the home screen (opening it if needed) and confirms; does not wait for the result. */
export async function enterCode(page: Page, code: string): Promise<void> {
  const dialog = smallDialog(page);
  if (!(await dialog.isVisible())) await page.locator('.home-actions').getByRole('button', { name: 'Entrar' }).click();
  await dialog.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(code);
  await dialog.getByRole('button', { name: 'Entrar', exact: true }).click();
}

/** Joins a room with an invite code from the home screen. */
export async function joinRoom(guest: Page, code: string): Promise<void> {
  await enterCode(guest, code);
  await expect(guest.getByRole('heading', { name: 'Participantes' })).toBeVisible({ timeout: 15_000 });
}

/** A valid 1x1 PNG, enough for the avatar upload path. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
