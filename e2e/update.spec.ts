import { expect, test } from '@playwright/test';
import path from 'node:path';
import { launchApp, TestApp } from './app';

// The app under test is not packaged, so it never asks GitHub. These tests send the "an update is available" notice to the window by hand.
const announce = (a: TestApp, state: Record<string, unknown>) =>
  a.app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('update:state', s), state);

test('nothing is downloaded or installed by itself: the updater only acts when the update button is pressed', async () => {
  const a = await launchApp('update-config', { name: 'Ana' });
  try {
    // the very module the app loaded (same real path), read from inside the main process
    const updaterPath = path.resolve(__dirname, '..', 'node_modules', 'electron-updater');
    const config = await a.app.evaluate((_electron, modulePath) => {
      const { autoUpdater } = process.mainModule!.require(modulePath);
      return { autoDownload: autoUpdater.autoDownload, autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit, allowPrerelease: autoUpdater.allowPrerelease, channel: autoUpdater.channel };
    }, updaterPath);
    expect(config).toEqual({ autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, channel: 'latest' });
  } finally {
    await a.close();
  }
});

test('an available update shows a banner with the update button and an X; the X hides it until the app is closed; Configurações > Sobre keeps offering it', async () => {
  const a = await launchApp('update-banner', { name: 'Ana' });
  try {
    const banner = a.page.locator('.update-banner');
    await expect(banner).toHaveCount(0);

    await announce(a, { status: 'available', version: '9.9.9' });
    await expect(banner).toContainText('A versão 9.9.9 está disponível.');
    await expect(banner.getByRole('button', { name: 'Atualizar agora' })).toBeEnabled();

    // the X takes the banner away
    await banner.getByRole('button', { name: 'Dispensar o aviso de atualização' }).click();
    await expect(banner).toHaveCount(0);
    await announce(a, { status: 'available', version: '9.9.9' }); // announced again (the next check): still hidden while the app stays open
    await expect(banner).toHaveCount(0);

    // Configurações > Sobre says there is an update and has the install button
    await a.page.getByRole('button', { name: 'Configurações' }).click();
    await a.page.getByRole('tab', { name: 'Sobre' }).click();
    const about = a.page.locator('#panel-sobre');
    await expect(about).toContainText('Há uma atualização: a versão 9.9.9 está disponível.');
    await expect(about.getByRole('button', { name: 'Instalar a versão 9.9.9' })).toBeEnabled();

    // nothing available any more: no install button
    await announce(a, { status: 'none' });
    await expect(about.getByRole('button', { name: /Instalar a versão/ })).toBeHidden();
    await expect(about).toContainText('Você está na versão mais recente.');
  } finally {
    await a.close();
  }
});

test('the X is forgotten when the app is closed: the banner is back the next time it opens', async () => {
  const first = await launchApp('update-reopen', { name: 'Ana' });
  const dir = first.dir;
  try {
    await announce(first, { status: 'available', version: '9.9.9' });
    await first.page.locator('.update-banner').getByRole('button', { name: 'Dispensar o aviso de atualização' }).click();
    await expect(first.page.locator('.update-banner')).toHaveCount(0);
  } finally {
    await first.close();
  }
  // the same data folder, as if the person opened the app again
  const again = await launchApp('update-reopen', { name: 'Ana' }, {}, [], dir);
  try {
    await announce(again, { status: 'available', version: '9.9.9' });
    await expect(again.page.locator('.update-banner')).toContainText('A versão 9.9.9 está disponível.');
  } finally {
    await again.close();
  }
});
