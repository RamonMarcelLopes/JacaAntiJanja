import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { enterCode, launchApp, openCreateDialog, smallDialog, TestApp } from './app';

const readConfig = (a: TestApp) => JSON.parse(fs.readFileSync(path.join(a.dir, 'config.json'), 'utf8'));

test('home screen: two buttons open the create and enter dialogs; the old text and the code field are gone', async () => {
  const a = await launchApp('home-layout', { name: 'Ana' });
  try {
    const page = a.page;
    await expect(page.getByRole('heading', { name: 'Iniciar ou entrar em uma sala' })).toBeVisible();
    await expect(page.locator('.home-actions button')).toHaveText(['Iniciar sala', 'Entrar']);
    await expect(page.getByText('Você vira o host')).toHaveCount(0);
    await expect(page.getByText('sem servidor no meio')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Entrar com código' })).toHaveCount(0);
    await expect(page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX')).toHaveCount(0); // the code is asked in a dialog

    // in the direct mode the create dialog only asks for the name (no kind of room, no Discord)
    const create = await openCreateDialog(page);
    await expect(create.getByRole('heading', { name: 'Criar sala' })).toBeVisible();
    await expect(create.getByRole('combobox', { name: 'Tipo de sala' })).toHaveCount(0);
    await expect(create.locator('.discord-section')).toHaveCount(0);
    await create.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('.dialog.small')).toHaveCount(0);

    // the enter dialog: focused code field, Enter submits (a wrong code keeps it open), closes with Esc and with Cancelar
    await page.locator('.home-actions').getByRole('button', { name: 'Entrar' }).click();
    const join = smallDialog(page);
    await expect(join.getByRole('heading', { name: 'Entrar em uma sala' })).toBeVisible();
    await expect(join.getByPlaceholder('XXXX-XXXX-XXXX-XXXX')).toBeFocused();
    await join.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill('NAO-E-UM-CODIGO');
    await join.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').press('Enter');
    await expect(page.locator('.toast.error').last()).toContainText('Código de convite inválido');
    await expect(join).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dialog.small')).toHaveCount(0);
    await page.locator('.home-actions').getByRole('button', { name: 'Entrar' }).click();
    await smallDialog(page).getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('.dialog.small')).toHaveCount(0);
  } finally {
    await a.close();
  }
});

test('favorite rooms on the home screen: filters by name and state, "Entrar" off only for closed rooms, three dots with copy / remove', async () => {
  const favorites = [
    { code: 'AAAAA-AAAAA@sala-um', name: 'Filmes de Sexta' },
    { code: 'BBBBB-BBBBB@sala-um', name: 'Jogos do João' },
    { code: 'CCCCC-CCCCC@sala-um', name: 'Música Ao Vivo' },
  ];
  // the Worker address points to a closed local port, so every state is "unknown" (no answer) and nothing depends on the network
  const a = await launchApp('home-favs', { name: 'Ana', favoriteRooms: favorites }, { JACA_WORKER_URL: 'http://127.0.0.1:9' });
  try {
    const page = a.page;
    const rows = page.locator('.fav-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('Sem resposta do servidor da sala', { timeout: 15_000 });
    await expect(rows.first().getByRole('button', { name: 'Entrar' })).toBeEnabled(); // unknown is not "closed": it can be tried

    // by name, ignoring accents and case
    const search = page.getByPlaceholder('Buscar sala pelo nome');
    await search.fill('joao');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Jogos do João');
    await search.fill('MUSICA');
    await expect(rows).toHaveCount(1);
    await search.fill('');

    // by state: nothing is known to be open or closed, so those filters are empty and say so
    await page.getByRole('radio', { name: 'Abertas' }).click();
    await expect(rows).toHaveCount(0);
    await expect(page.getByText('Nenhuma sala encontrada com esse filtro.')).toBeVisible();
    await page.getByRole('radio', { name: 'Fechadas' }).click();
    await expect(rows).toHaveCount(0);
    await page.getByRole('radio', { name: 'Todas' }).click();
    await expect(rows).toHaveCount(3);

    // the box keeps its size whatever the filter shows
    const box = page.locator('.fav-block .fav-list');
    const height = async () => Math.round((await box.boundingBox())!.height);
    const full = await height();
    await search.fill('zzz');
    await expect(rows).toHaveCount(0);
    expect(await height()).toBe(full);
    await search.fill('');
    await expect(rows).toHaveCount(3);

    // the three dots: no room at rest, copy the code, remove from the favorites
    const row = rows.nth(1);
    await page.mouse.move(2, 2);
    await expect(row.locator('.fav-kebab')).toHaveCSS('opacity', '0');
    await row.hover();
    await expect(row.locator('.fav-kebab')).toHaveCSS('opacity', '1');
    await row.locator('.fav-kebab').click();
    await expect(page.getByRole('menuitem')).toHaveText(['Copiar código', 'Remover dos favoritos']);
    await page.getByRole('menuitem', { name: 'Copiar código' }).click();
    expect(await a.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('BBBBB-BBBBB@sala-um');
    await row.hover();
    await row.locator('.fav-kebab').click();
    await page.getByRole('menuitem', { name: 'Remover dos favoritos' }).click();
    await expect(rows).toHaveCount(2);
    await expect.poll(() => readConfig(a).favoriteRooms.map((f: { name: string }) => f.name)).toEqual(['Filmes de Sexta', 'Música Ao Vivo']);
  } finally {
    await a.close();
  }
});

test('Configurações > Câmera has its own defaults, saved separately from Transmissão', async () => {
  const a = await launchApp('cam-settings', { name: 'Ana' });
  try {
    await a.page.getByRole('button', { name: 'Configurações' }).click();
    await a.page.getByRole('tab', { name: 'Câmera' }).click();
    await expect(a.page.getByRole('heading', { name: 'Câmera', exact: true })).toBeVisible();
    const panel = a.page.locator('#panel-camera');
    const selects = panel.locator('.select-btn');
    await expect(selects).toHaveCount(3);
    await expect(selects.nth(0)).toHaveAttribute('data-value', '720p'); // the camera starts lighter than the screen
    await expect(selects.nth(1)).toHaveAttribute('data-value', '30');
    await expect(selects.nth(2)).toHaveAttribute('data-value', 'motion');

    await selects.nth(0).click();
    await a.page.getByRole('option', { name: '1080p' }).click();
    await selects.nth(2).click();
    await a.page.getByRole('option', { name: /Detalhe/ }).click();
    await expect.poll(() => readConfig(a).cameraResolution).toBe('1080p');
    await expect.poll(() => readConfig(a).cameraMode).toBe('detail');
    expect(readConfig(a).resolution ?? '1080p').toBe('1080p'); // the screen defaults did not move
    expect(readConfig(a).mode ?? 'motion').toBe('motion');
    expect(readConfig(a).cameraFps).toBe(30);
  } finally {
    await a.close();
  }
});

test('a code typed in lowercase with spaces still gets in through the enter dialog (the helper path used by the other tests)', async () => {
  const a = await launchApp('enter-helper', { name: 'Ana' });
  try {
    await enterCode(a.page, 'zzzz zzzz');
    await expect(a.page.locator('.toast.error').last()).toContainText('Código de convite inválido');
  } finally {
    await a.close();
  }
});
