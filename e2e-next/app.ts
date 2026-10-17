import { _electron as electron, ElectronApplication, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(__dirname, '..');

export interface NextApp {
  app: ElectronApplication;
  page: Page;
  dir: string;
  close(): Promise<void>;
}

/**
 * Starts one instance of the built app (run `node build.mjs` first) showing the NEW interface, with its own user-data folder so several
 * instances can run side by side. `config` pre-seeds config.json. `existingDir`: start again on the data folder of an app that was closed.
 */
export async function launchNext(label: string, config: Record<string, unknown> = {}, env: Record<string, string> = {}, extraArgs: string[] = [], existingDir?: string): Promise<NextApp> {
  const dir = existingDir ?? fs.mkdtempSync(path.join(os.tmpdir(), `jaj-next-${label}-`));
  if (!existingDir) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ ui: 'next', ...config }));
  const app = await electron.launch({ args: [root, `--user-data-dir=${dir}`, ...extraArgs], env: { ...(process.env as Record<string, string>), JACA_BACKUP_DIR: path.join(dir, 'backup'), ...env } });
  const page = await app.firstWindow();
  // every sound cue is announced on window ("jaca-sound"), so the tests can tell which sounds were triggered
  await page.evaluate(() => {
    (window as any).__sounds = [];
    window.addEventListener('jaca-sound', (e) => (window as any).__sounds.push((e as CustomEvent).detail));
  });
  await expect(page.getByTestId('home')).toBeVisible();
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

export const readConfig = (a: NextApp) => JSON.parse(fs.readFileSync(path.join(a.dir, 'config.json'), 'utf8'));
export const readLog = (a: NextApp) => {
  try {
    return fs.readFileSync(path.join(a.dir, 'jaca.log'), 'utf8');
  } catch {
    return '';
  }
};

/** Names of the sound cues triggered so far in this window, in order. */
export const sounds = (page: Page): Promise<string[]> => page.evaluate(() => [...((window as any).__sounds as string[])]);

/** A valid 1x1 PNG, enough for the photo upload path. */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** The dialog on screen (create room, join, share, profile...). */
export const modal = (page: Page) => page.locator('.backdrop:not(.closing) .modal');

/** Opens the "start a room" dialog from the home screen and returns it. */
export async function openCreateDialog(page: Page) {
  await page.getByTestId('home').getByRole('button', { name: 'Iniciar sala', exact: true }).click();
  const dialog = modal(page);
  await expect(dialog.getByLabel('Nome da sala')).toBeVisible();
  return dialog;
}

/** Creates a (temporary) room as the host from the home screen and returns its invite code. */
export async function createRoom(host: Page, roomName?: string): Promise<string> {
  const dialog = await openCreateDialog(host);
  if (roomName !== undefined) await dialog.getByLabel('Nome da sala').fill(roomName);
  await dialog.getByRole('button', { name: 'Criar sala' }).click();
  const chip = host.getByRole('button', { name: 'Copiar código da sala' });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  return (await chip.getAttribute('data-code'))!;
}

/** Types a code in the "enter" dialog of the home screen (opening it if needed) and confirms; does not wait for the result. */
export async function enterCode(page: Page, code: string): Promise<void> {
  const dialog = modal(page);
  if (!(await dialog.isVisible())) await page.getByTestId('home').getByRole('button', { name: 'Entrar com código' }).click();
  await dialog.getByLabel('Código da sala').fill(code);
  await dialog.getByRole('button', { name: 'Entrar', exact: true }).click();
}

/** Joins a room with an invite code from the home screen and waits until the room is on screen. */
export async function joinRoom(guest: Page, code: string): Promise<void> {
  await enterCode(guest, code);
  await expect(guest.getByTestId('stage')).toBeVisible({ timeout: 15_000 });
}

/** The tile of a person in the room (the grid), by name. */
export const tileOf = (page: Page, name: string) => page.locator('.tile', { has: page.locator(`[data-person="${name}"]`) }).or(page.locator(`.tile[data-person="${name}"]`));

/** Opens Settings (the gear of the column, or of the rail when the column is folded) and goes to a category. */
export async function openSettings(page: Page, category?: string) {
  await page.getByRole('button', { name: 'Configurações' }).first().click();
  const layer = page.getByTestId('settings');
  await expect(layer).toBeVisible();
  if (category) await layer.getByRole('tab', { name: category }).click();
  return layer;
}

/** Closes the settings layer with its back button. */
export async function closeSettings(page: Page) {
  await page.getByTestId('settings').getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByTestId('settings')).toHaveCount(0);
}

/** Picks an option of one of the app's own dropdowns. */
export async function pick(page: Page, dropdown: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: dropdown }).click();
  await page.getByRole('option', { name: option }).click();
}
