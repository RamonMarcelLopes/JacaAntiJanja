import { expect, test } from '@playwright/test';
import { launchNext, readConfig } from './app';

test('the new interface opens when it was chosen, has no notice about itself, and Configurações > Interface goes back to the original and forth again', async () => {
  const a = await launchNext('iface', { name: 'Ana' });
  try {
    expect(a.page.url()).toContain('renderer-next');
    await expect(a.page.locator('#ui-notice')).toHaveCount(0);
    await a.page.getByRole('button', { name: 'Configurações' }).first().click();
    const layer = a.page.getByTestId('settings');
    await layer.getByRole('tab', { name: 'Interface' }).click();
    await expect(layer.getByRole('button', { name: /Moderna/ })).toBeDisabled();
    await expect(layer.getByRole('button', { name: /Clássica/ })).toBeEnabled();

    await layer.getByRole('button', { name: /Clássica/ }).click();
    await expect.poll(() => a.page.url(), { timeout: 15_000 }).toContain('renderer/index.html');
    await expect(a.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible();
    expect(readConfig(a).ui).toBe('legacy');
    await expect(a.page.locator('#ui-notice')).toHaveCount(0); // it was seen already: no notice in the original one either
    expect(readConfig(a).newUiSeen).toBe(true);

    // forth again from the original one (its Settings > Interface, reached with the gear: there is no notice any more)
    await a.page.getByRole('button', { name: 'Configurações' }).click();
    await a.page.getByRole('tab', { name: 'Interface' }).click();
    await a.page.locator('#panel-interface').getByRole('radio', { name: /Moderna/ }).click();
    await expect.poll(() => a.page.url(), { timeout: 15_000 }).toContain('renderer-next');
    await expect(a.page.getByTestId('home')).toBeVisible();
    expect(readConfig(a).ui).toBe('next');
    // the data did not move: the same profile in both
    await expect(a.page.getByRole('heading', { level: 1 })).toContainText('Ana');
  } finally {
    await a.close();
  }
});

test('the two interfaces share the same data: favorites saved in one show in the other', async () => {
  const favorites = [{ code: 'AAAAA-AAAAA@sala-um', name: 'Filmes de Sexta' }];
  const a = await launchNext('iface-data', { name: 'Ana', favoriteRooms: favorites }, { JACA_WORKER_URL: 'http://127.0.0.1:9' });
  try {
    await expect(a.page.locator('[data-room-card]')).toContainText('Filmes de Sexta');
    await a.page.getByRole('button', { name: 'Configurações' }).first().click();
    await a.page.getByTestId('settings').getByRole('tab', { name: 'Interface' }).click();
    await a.page.getByTestId('settings').getByRole('button', { name: /Clássica/ }).click();
    await expect(a.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible({ timeout: 15_000 });
    await expect(a.page.locator('.fav-row')).toContainText('Filmes de Sexta');
  } finally {
    await a.close();
  }
});
