// The original interface tells that a new one exists (a notice at the top right that never closes by itself) and leads to the place where the
// interface is chosen. Switching reloads the window, so it is refused inside a room.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchNext } from '../e2e-next/app';
import { createRoom, launchApp, TestApp } from './app';

const KEEP = { JACA_TEST_KEEP_UI_NOTICE: '1' };
const readConfig = (a: TestApp) => JSON.parse(fs.readFileSync(path.join(a.dir, 'config.json'), 'utf8'));

test('the original interface is the default and shows the notice at the top right; it stays until its X is pressed, and comes back the next time the app opens', async () => {
  const first = await launchApp('notice-x', { name: 'Ana' }, KEEP);
  const dir = first.dir;
  try {
    const notice = first.page.locator('#ui-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('A nova interface já está disponível!');
    // top right corner, under the title bar
    const box = (await notice.boundingBox())!;
    const width = await first.page.evaluate(() => window.innerWidth);
    expect(box.x + box.width).toBeGreaterThan(width - 40);
    expect(box.y).toBeGreaterThan(30);
    expect(box.y).toBeLessThan(80);
    // it does not close by itself
    await first.page.waitForTimeout(6000);
    await expect(notice).toBeVisible();
    // only the X closes it
    await notice.getByRole('button', { name: 'Fechar o aviso da nova interface' }).click();
    await expect(notice).toHaveCount(0);
    await first.app.close();

    const again = await launchApp('notice-x', undefined, KEEP, [], dir);
    try {
      await expect(again.page.locator('#ui-notice')).toBeVisible(); // nothing was remembered: it is back
      expect(readConfig(again).ui ?? 'legacy').toBe('legacy');
    } finally {
      await again.app.close();
    }
  } finally {
    await first.app.close().catch(() => undefined);
    await first.close();
  }
});

test('clicking the notice opens Settings on the Interface category, where the original one is marked and the new one can be chosen', async () => {
  const a = await launchApp('notice-click', { name: 'Ana' }, KEEP);
  try {
    await a.page.locator('#ui-notice .ui-notice-body').click();
    await expect(a.page.locator('#ui-notice')).toHaveCount(0); // clicking it takes the notice away
    await expect(a.page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
    await expect(a.page.getByRole('tab', { name: 'Interface' })).toHaveAttribute('aria-selected', 'true');
    const panel = a.page.locator('#panel-interface');
    await expect(panel.getByRole('heading', { name: 'Interface' })).toBeVisible();
    await expect(panel.getByRole('radio', { name: /Clássica/ })).toHaveAttribute('aria-checked', 'true');
    await expect(panel.getByRole('radio', { name: /Clássica/ })).toBeDisabled();
    await expect(panel.getByRole('radio', { name: /Moderna/ })).toHaveAttribute('aria-checked', 'false');
    await expect(panel.getByRole('radio', { name: /Moderna/ })).toBeEnabled();
  } finally {
    await a.close();
  }
});

test('choosing the new interface reloads the window with it, the choice is kept, and the new interface has the choice to go back', async () => {
  const a = await launchApp('notice-switch', { name: 'Ana' }, KEEP);
  const dir = a.dir;
  try {
    await a.page.getByRole('button', { name: 'Configurações' }).click();
    await a.page.getByRole('tab', { name: 'Interface' }).click();
    await a.page.locator('#panel-interface').getByRole('radio', { name: /Moderna/ }).click();
    await expect.poll(() => a.page.url(), { timeout: 15_000 }).toContain('renderer-next');
    await expect(a.page.getByTestId('home')).toBeVisible();
    await expect(a.page.locator('#ui-notice')).toHaveCount(0); // the new interface does not show the notice
    expect(readConfig(a).ui).toBe('next');
    await a.app.close();

    // opened again: the new interface, as chosen
    const again = await launchNext('notice-switch-again', {}, {}, [], dir);
    try {
      expect(again.page.url()).toContain('renderer-next');
      await again.page.getByRole('button', { name: 'Configurações' }).first().click();
      await again.page.getByTestId('settings').getByRole('tab', { name: 'Interface' }).click();
      const panel = again.page.getByTestId('settings');
      await expect(panel.getByRole('button', { name: /Moderna/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.getByRole('button', { name: /Moderna/ })).toBeDisabled();
      // and back to the original one
      await panel.getByRole('button', { name: /Clássica/ }).click();
      await expect.poll(() => again.page.url(), { timeout: 15_000 }).toContain('renderer/index.html');
      await expect(again.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible();
      // whoever has been in the new interface is not told about it again, not even in the original one they came back to
      await expect(again.page.locator('#ui-notice')).toHaveCount(0);
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
      expect(saved.ui).toBe('legacy');
      expect(saved.newUiSeen).toBe(true);
      await again.app.close();

      // and it stays that way when the app is opened again later: the original interface (the last one used), still without the notice
      const third = await launchApp('notice-third', undefined, KEEP, [], dir);
      try {
        expect(third.page.url()).toContain('renderer/index.html');
        await expect(third.page.locator('#ui-notice')).toHaveCount(0);
        expect(readConfig(third).ui).toBe('legacy');
      } finally {
        await third.app.close();
      }
    } finally {
      await again.app.close();
    }
  } finally {
    await a.app.close().catch(() => undefined);
    await a.close();
  }
});

test('inside a room the notice steps aside (it would cover the settings button) and the interface cannot be switched: Settings > Interface says to leave the room first; the notice is back after leaving', async () => {
  const a = await launchApp('notice-room', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47888 }, KEEP);
  try {
    await expect(a.page.locator('#ui-notice')).toBeVisible();
    await createRoom(a.page);
    await expect(a.page.locator('#ui-notice')).toBeHidden();

    // the gear of the room is reachable (REGRESSION: the notice used to sit over it)
    await a.page.locator('.screen.room .topbar').getByRole('button', { name: 'Configurações' }).click();
    await a.page.getByRole('tab', { name: 'Interface' }).click();
    const panel = a.page.locator('#panel-interface');
    await expect(panel.getByText('Saia da sala para trocar de interface')).toBeVisible();
    await expect(panel.getByRole('radio', { name: /Moderna/ })).toBeDisabled();
    // even asked directly the main process refuses while this PC hosts a room
    expect(await a.page.evaluate(() => (window as any).jaca.setUi('next'))).toBe(false);
    expect(readConfig(a).ui ?? 'legacy').toBe('legacy');

    await a.page.keyboard.press('Escape');
    await a.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(a.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible({ timeout: 15_000 });
    await expect(a.page.locator('#ui-notice')).toBeVisible();
  } finally {
    await a.close();
  }
});
