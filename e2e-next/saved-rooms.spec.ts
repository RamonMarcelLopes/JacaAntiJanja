// Regression tests: a friend lost the favorite rooms after an update. Whatever happens to config.json (a write cut short, a wiped data
// folder after a reinstall), the saved rooms come back, and the new interface shows them.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchNext, NextApp, readConfig } from './app';

const favorites = [
  { code: 'AAAAA-AAAAA@sala-um', name: 'Filmes de Sexta' },
  { code: 'BBBBB-BBBBB@sala-um', name: 'Jogos do João' },
];
const env = (backup: string) => ({ JACA_WORKER_URL: 'http://127.0.0.1:9', JACA_BACKUP_DIR: backup });

/** Changes the name so the app saves its config (the first save keeps the file it found as config.json.bak). */
async function saveOnce(a: NextApp, name: string) {
  await a.page.getByRole('button', { name: 'Editar perfil' }).first().click();
  const field = a.page.locator('.modal').getByLabel('Seu nome');
  await field.fill(name);
  await field.blur();
  await expect.poll(() => readConfig(a).name).toBe(name);
  await a.page.keyboard.press('Escape');
}

test('a config.json cut in the middle (an interrupted write) does not take the favorite rooms away', async () => {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'jaj-backup-'));
  const first = await launchNext('saved-damaged', { name: 'Ana', favoriteRooms: favorites }, env(backup));
  const dir = first.dir;
  try {
    await saveOnce(first, 'Ana Maria');
    await first.app.close();
    // what an update killing the app in the middle of a save leaves behind
    fs.writeFileSync(path.join(dir, 'config.json'), '{"name":"Ana Maria","favoriteRooms":[{"code":"AAAAA-AAAAA@sa');
    fs.rmSync(path.join(backup, 'rooms.json'), { force: true }); // the second safety net is off: only config.json.bak can save this case

    const again = await launchNext('saved-damaged', {}, env(backup), [], dir);
    try {
      await expect(again.page.locator('[data-room-card]')).toHaveCount(2);
      await expect(again.page.locator('[data-room-card]').first()).toContainText('Filmes de Sexta');
      expect(readConfig(again).favoriteRooms).toEqual(favorites);
      expect(readConfig(again).ui).toBe('next'); // and the interface that was chosen is still the one that opens
    } finally {
      await again.app.close();
    }
  } finally {
    await first.app.close().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  }
});

test('removing the last favorite on purpose (the star of its card) is not undone by the copy kept outside the app data', async () => {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'jaj-backup-'));
  const first = await launchNext('saved-removed', { name: 'Ana', favoriteRooms: [favorites[0]] }, env(backup));
  const dir = first.dir;
  try {
    await first.page.locator('[data-room-card]').getByRole('button', { name: /Tirar Filmes de Sexta dos favoritos/ }).click();
    await expect.poll(() => readConfig(first).favoriteRooms).toEqual([]);
    await first.app.close();

    const again = await launchNext('saved-removed', {}, env(backup), [], dir);
    try {
      await expect(again.page.locator('[data-room-card]')).toHaveCount(0);
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
