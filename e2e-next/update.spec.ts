import { expect, test } from '@playwright/test';
import { createRoom, launchNext, NextApp, openSettings } from './app';

// The app under test is not packaged, so it never asks GitHub. These tests send the "an update is available" notice to the window by hand.
const announce = (a: NextApp, state: Record<string, unknown>) =>
  a.app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('update:state', s), state);

test('an available update shows a banner with the update button and an X; the X hides it until the app is closed; Configurações > Sobre keeps offering it', async () => {
  const a = await launchNext('update-banner', { name: 'Ana' });
  try {
    const banner = a.page.getByTestId('update-banner');
    await expect(banner).toBeEmpty();

    await announce(a, { status: 'available', version: '9.9.9' });
    await expect(banner).toContainText('A versão 9.9.9 está disponível.');
    await expect(banner.getByRole('button', { name: 'Atualizar agora' })).toBeEnabled();
    // the rail also points at it
    await expect(a.page.getByRole('navigation', { name: 'Salas' }).getByRole('button', { name: 'Atualização disponível' })).toBeVisible();

    // the X takes the banner away
    await banner.getByRole('button', { name: 'Dispensar o aviso de atualização' }).click();
    await expect(banner).toBeEmpty();
    await announce(a, { status: 'available', version: '9.9.9' }); // announced again (the next check): still hidden while the app stays open
    await expect(banner).toBeEmpty();

    // Configurações > Sobre says there is an update and has the install button
    const layer = await openSettings(a.page, 'Sobre');
    await expect(layer).toContainText('Há uma atualização: a versão 9.9.9 está disponível.');
    await expect(layer.getByRole('button', { name: 'Instalar a versão 9.9.9' })).toBeEnabled();

    // nothing available any more: no install button
    await announce(a, { status: 'none' });
    await expect(layer.getByRole('button', { name: /Instalar a versão/ })).toHaveCount(0);
    await expect(layer).toContainText('Você está na versão mais recente.');
  } finally {
    await a.close();
  }
});

test('the X is forgotten when the app is closed: the banner is back the next time it opens', async () => {
  const first = await launchNext('update-reopen', { name: 'Ana' });
  const dir = first.dir;
  try {
    await announce(first, { status: 'available', version: '9.9.9' });
    await first.page.getByTestId('update-banner').getByRole('button', { name: 'Dispensar o aviso de atualização' }).click();
    await expect(first.page.getByTestId('update-banner')).toBeEmpty();
    await first.app.close();

    // the same data folder, as if the person opened the app again
    const again = await launchNext('update-reopen', {}, {}, [], dir);
    try {
      await announce(again, { status: 'available', version: '9.9.9' });
      await expect(again.page.getByTestId('update-banner')).toContainText('A versão 9.9.9 está disponível.');
    } finally {
      await again.app.close();
    }
  } finally {
    await first.close();
  }
});

test('updating restarts the app, so inside a room the banner and Sobre ask to leave the room first; the download progress is shown', async () => {
  const a = await launchNext('update-room', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47887 });
  try {
    await createRoom(a.page);
    await announce(a, { status: 'available', version: '9.9.9' });
    const banner = a.page.getByTestId('update-banner');
    await expect(banner.getByRole('button', { name: 'Saia da sala para atualizar' })).toBeDisabled();
    const layer = await openSettings(a.page, 'Sobre');
    await expect(layer.getByRole('button', { name: 'Saia da sala para instalar' })).toBeDisabled();
    await announce(a, { status: 'downloading', version: '9.9.9', percent: 42 });
    await expect(banner).toContainText('Baixando a versão 9.9.9... 42%');
    await expect(layer).toContainText('Baixando a versão 9.9.9... 42%');
    await announce(a, { status: 'ready', version: '9.9.9' });
    await expect(banner).toContainText('Instalando a atualização. O app vai reiniciar.');
  } finally {
    await a.close();
  }
});
