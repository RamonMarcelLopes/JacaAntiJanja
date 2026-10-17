// Regression tests: a friend lost the favorite rooms after an update. Whatever happens to config.json (a write cut short, a wiped data
// folder after a reinstall), the saved rooms must come back.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, TestApp } from './app';

const favorites = [
  { code: 'AAAAA-AAAAA@sala-um', name: 'Filmes de Sexta' },
  { code: 'BBBBB-BBBBB@sala-um', name: 'Jogos do João' },
];
const env = (backup: string) => ({ JACA_WORKER_URL: 'http://127.0.0.1:9', JACA_BACKUP_DIR: backup });
const readConfig = (a: TestApp) => JSON.parse(fs.readFileSync(path.join(a.dir, 'config.json'), 'utf8'));

/** Changes the name so the app saves its config (the first save keeps the file it found as config.json.bak). */
async function saveOnce(a: TestApp, name: string) {
  const input = a.page.getByPlaceholder('Seu nome');
  await input.fill(name);
  await input.blur();
  await expect.poll(() => readConfig(a).name).toBe(name);
}

test('a config.json cut in the middle (an interrupted write) does not take the favorite rooms away', async () => {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'jaj-backup-'));
  const first = await launchApp('saved-damaged', { name: 'Ana', favoriteRooms: favorites }, env(backup));
  const dir = first.dir;
  try {
    await saveOnce(first, 'Ana Maria');
    await first.app.close();
    // what an update killing the app in the middle of a save leaves behind
    fs.writeFileSync(path.join(dir, 'config.json'), '{"name":"Ana Maria","favoriteRooms":[{"code":"AAAAA-AAAAA@sa');
    fs.rmSync(path.join(backup, 'rooms.json'), { force: true }); // the second safety net is off: only config.json.bak can save this case

    const again = await launchApp('saved-damaged', undefined, env(backup), [], dir);
    try {
      await expect(again.page.locator('.fav-row')).toHaveCount(2);
      await expect(again.page.locator('.fav-row').first()).toContainText('Filmes de Sexta');
      expect(readConfig(again).favoriteRooms).toEqual(favorites);
      expect(fs.readdirSync(dir).some((n) => /^config\.damaged-\d+\.json$/.test(n))).toBe(true); // the damaged file is kept, not overwritten
    } finally {
      await again.app.close();
    }
  } finally {
    await first.app.close().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  }
});

test('the app data folder wiped (reinstall, uninstall): favorite rooms come back from the copy kept outside of it', async () => {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'jaj-backup-'));
  const first = await launchApp('saved-wiped', { name: 'Ana', favoriteRooms: favorites }, env(backup));
  const dir = first.dir;
  try {
    await saveOnce(first, 'Ana Maria');
    await first.app.close();
    expect(fs.existsSync(path.join(backup, 'rooms.json'))).toBe(true);
    for (const n of fs.readdirSync(dir)) if (n.startsWith('config')) fs.rmSync(path.join(dir, n), { force: true }); // everything of the config is gone

    const again = await launchApp('saved-wiped', undefined, env(backup), [], dir);
    try {
      await expect(again.page.locator('.fav-row')).toHaveCount(2);
      expect(readConfig(again).favoriteRooms).toEqual(favorites);
      expect(fs.readFileSync(path.join(dir, 'jaca.log'), 'utf8')).toContain('salas recuperadas da cópia de segurança');
    } finally {
      await again.app.close();
    }
  } finally {
    await first.app.close().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  }
});

test('removing the last favorite on purpose is not undone by the copy', async () => {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'jaj-backup-'));
  const first = await launchApp('saved-removed', { name: 'Ana', favoriteRooms: [favorites[0]] }, env(backup));
  const dir = first.dir;
  try {
    const row = first.page.locator('.fav-row').first();
    await row.hover();
    await row.getByRole('button', { name: /Opções de/ }).click();
    await first.page.getByRole('menuitem', { name: 'Remover dos favoritos' }).click();
    await expect.poll(() => readConfig(first).favoriteRooms).toEqual([]);
    await first.app.close();

    const again = await launchApp('saved-removed', undefined, env(backup), [], dir);
    try {
      await expect(again.page.locator('.fav-row')).toHaveCount(0);
      expect(readConfig(again).favoriteRooms).toEqual([]);
    } finally {
      await again.app.close();
    }
  } finally {
    await first.app.close().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  }
});

test('the interface that was chosen and "already seen the new one" survive a wiped data folder: no notice comes back', async () => {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'jaj-backup-'));
  const first = await launchApp('saved-ui', { name: 'Ana', ui: 'legacy', newUiSeen: true, favoriteRooms: favorites }, { ...env(backup), JACA_TEST_KEEP_UI_NOTICE: '1' });
  const dir = first.dir;
  try {
    await saveOnce(first, 'Ana Maria');
    await first.app.close();
    for (const n of fs.readdirSync(dir)) if (n.startsWith('config')) fs.rmSync(path.join(dir, n), { force: true }); // like a reinstall

    const again = await launchApp('saved-ui', undefined, { ...env(backup), JACA_TEST_KEEP_UI_NOTICE: '1' }, [], dir);
    try {
      await expect(again.page.locator('#ui-notice')).toHaveCount(0);
      expect(readConfig(again).newUiSeen).toBe(true);
      expect(readConfig(again).ui).toBe('legacy');
    } finally {
      await again.app.close();
    }
  } finally {
    await first.app.close().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  }
});

test('the choice of interface is kept when the app is updated or reopened: the config keeps "ui" and "newUiSeen", and an older config without them means the original one, not seen', async () => {
  const a = await launchApp('saved-ui-old', { name: 'Ana' }, { JACA_TEST_KEEP_UI_NOTICE: '1' }); // a config written by a version before 2.0 has neither field
  try {
    await expect(a.page.locator('#ui-notice')).toBeVisible(); // never seen: the notice
    expect(await a.page.evaluate(async () => { const c = await (window as any).jaca.getConfig(); return [c.ui, c.newUiSeen]; })).toEqual(['legacy', false]);
  } finally {
    await a.close();
  }
});
