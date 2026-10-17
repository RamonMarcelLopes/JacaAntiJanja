import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, launchNext, modal, openCreateDialog } from './app';

const FAKE_CAMERA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

test('the picture of the room is chosen when it is created and everybody in the room sees that same one', async () => {
  test.slow();
  const host = await launchNext('icon-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47893 });
  const guest = await launchNext('icon-guest', { name: 'Bia' });
  try {
    const dialog = await openCreateDialog(host.page);
    await dialog.locator('[data-key="rocket"]').click();
    await dialog.getByRole('button', { name: 'Criar sala' }).click();
    const chip = host.page.getByRole('button', { name: 'Copiar código da sala' });
    await expect(chip).toBeVisible({ timeout: 20_000 });
    const code = (await chip.getAttribute('data-code'))!;
    await joinRoom(guest.page, code);

    await expect(host.page.getByTestId('room-icon')).toHaveAttribute('data-icon', 'rocket');
    await expect(guest.page.getByTestId('room-icon')).toHaveAttribute('data-icon', 'rocket');
  } finally {
    await guest.close();
    await host.close();
  }
});

test('a room made without a picture (an older app or Worker) shows the default one to everybody', async () => {
  test.slow();
  // the "users" picture is the default: the host never picks one here (the dialog keeps its default, which is also "users")
  const host = await launchNext('icon-default-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47894 });
  const guest = await launchNext('icon-default-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    await expect(host.page.getByTestId('room-icon')).toHaveAttribute('data-icon', 'users');
    await expect(guest.page.getByTestId('room-icon')).toHaveAttribute('data-icon', 'users');
  } finally {
    await guest.close();
    await host.close();
  }
});

test('REGRESSION: the picture in focus is not taken out and put back when somebody joins (its animated edge used to jump)', async () => {
  test.slow();
  const host = await launchNext('focus-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47896 }, {}, FAKE_CAMERA);
  const guest = await launchNext('focus-guest', { name: 'Bia' });
  const late = await launchNext('focus-late', { name: 'Caio' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    await host.page.locator('.callbar button[aria-label="Câmera"]').click();
    await expect(host.page.locator('.tile.big .live-edge')).toBeVisible({ timeout: 20_000 });
    await host.page.evaluate(() => {
      (window as any).__tile = document.querySelector('.tile.big');
      (window as any).__edge = document.querySelector('.tile.big .live-edge');
    });
    await joinRoom(late.page, code); // the room changes: the stage is redrawn
    await expect(host.page.getByText('Caio').first()).toBeVisible();
    await host.page.waitForTimeout(1500);
    const same = await host.page.evaluate(() => (window as any).__tile === document.querySelector('.tile.big') && (window as any).__edge === document.querySelector('.tile.big .live-edge') && (window as any).__tile.isConnected);
    expect(same).toBe(true);
    void modal;
  } finally {
    await late.close();
    await guest.close();
    await host.close();
  }
});

test('REGRESSION: a picture in fullscreen stays in fullscreen when the room changes (somebody joining used to throw it out)', async () => {
  test.slow();
  const host = await launchNext('fs-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47899 }, {}, FAKE_CAMERA);
  const guest = await launchNext('fs-guest', { name: 'Bia' });
  const late = await launchNext('fs-late', { name: 'Caio' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    await host.page.locator('.callbar button[aria-label="Câmera"]').click();
    await guest.page.locator('.tile[data-person="Ana"]').getByRole('button', { name: 'Assistir Ana' }).click();
    const big = guest.page.locator('.tile.big[data-person="Ana"]');
    await expect(big.locator('video')).toBeVisible({ timeout: 20_000 });
    await big.hover();
    await big.getByRole('button', { name: 'Tela cheia' }).click();
    const inFullscreen = () => guest.page.evaluate(() => document.fullscreenElement?.classList.contains('tile') ?? false);
    await expect.poll(inFullscreen).toBe(true);

    await joinRoom(late.page, code); // the room changes while the picture is in fullscreen
    await expect(guest.page.getByText('Caio').first()).toBeAttached();
    await guest.page.waitForTimeout(2000); // a few redraws (the timer of the room ticks every second)
    expect(await inFullscreen()).toBe(true);

    // Esc still leaves it
    await guest.page.keyboard.press('Escape');
    await expect.poll(() => guest.page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  } finally {
    await late.close();
    await guest.close();
    await host.close();
  }
});

test('REGRESSION: the buttons of the left rail are not rebuilt while nothing on them changes (they lost the hover and jumped)', async () => {
  test.slow();
  const host = await launchNext('rail-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47900 });
  const guest = await launchNext('rail-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    const plus = host.page.locator('nav[aria-label="Salas"] button[aria-label="Iniciar sala"]');
    await plus.hover();
    await host.page.evaluate(() => ((window as any).__plus = document.querySelector('nav[aria-label="Salas"] button[aria-label="Iniciar sala"]')));
    await joinRoom(guest.page, code); // the room changes (somebody joins, the call stats come in)
    await expect(host.page.getByText('Bia').first()).toBeAttached();
    await host.page.waitForTimeout(3000);
    expect(await host.page.evaluate(() => (window as any).__plus === document.querySelector('nav[aria-label="Salas"] button[aria-label="Iniciar sala"]'))).toBe(true);
  } finally {
    await guest.close();
    await host.close();
  }
});

test('REGRESSION: nothing under a resting pointer is rebuilt while the room changes (rail, column, its footer, top bar, details panel, tile labels)', async () => {
  test.slow();
  const host = await launchNext('still-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47900 }, {}, FAKE_CAMERA);
  const guest = await launchNext('still-guest', { name: 'Bia' });
  const late = await launchNext('still-late', { name: 'Caio' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    await host.page.locator('.callbar button[aria-label="Câmera"]').click();
    await expect(guest.page.locator('.tile[data-person="Ana"] .badge-live')).toBeVisible({ timeout: 20_000 });
    await guest.page.getByRole('button', { name: 'Detalhes' }).click();
    await expect(guest.page.locator('#details-panel [data-stats="Ana"]')).toBeVisible();

    const pick = `({
      plus: document.querySelector('nav[aria-label="Salas"] button[aria-label="Iniciar sala"]'),
      fold: document.querySelector('#sidebar button[aria-label="Recolher a coluna lateral"]'),
      name: document.querySelector('#sidebar button[aria-label="Copiar o código da sala"]'),
      profile: document.querySelector('#sidebar button[aria-label="Editar perfil"]'),
      gear: document.querySelector('#sidebar button[aria-label="Configurações"]'),
      leave: document.querySelector('#sidebar button[aria-label="Sair da sala"]'),
      details: document.querySelector('button[aria-label="Detalhes"]'),
      stats: document.querySelector('#details-panel [data-stats="Ana"]'),
      badge: document.querySelector('.tile[data-person="Ana"] .badge-live'),
    })`;
    await guest.page.evaluate(`window.__before = ${pick}`);
    expect(await guest.page.evaluate('Object.values(window.__before).every(Boolean)')).toBe(true);

    await joinRoom(late.page, code); // the room changes; the call stats keep coming in
    await expect(guest.page.locator('#sidebar')).toContainText('Caio');
    await guest.page.waitForTimeout(4000);
    // Caio joining changes the list of people, so the column body is redrawn once; after that nothing on screen is rebuilt again
    await guest.page.evaluate(`window.__before = ${pick}`);
    await guest.page.waitForTimeout(5000);
    const changed = await guest.page.evaluate(`(() => { const now = ${pick}; return Object.keys(now).filter((k) => now[k] !== window.__before[k]); })()`);
    expect(changed).toEqual([]);
  } finally {
    await late.close();
    await guest.close();
    await host.close();
  }
});

test('REGRESSION: a tooltip near the edge of the window stays inside it (the details button at the right cut half of its text)', async () => {
  const host = await launchNext('tip-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47901 });
  try {
    await createRoom(host.page);
    await host.page.getByRole('button', { name: 'Detalhes' }).hover();
    const tip = host.page.locator('.tooltip');
    await expect(tip).toBeVisible();
    const box = (await tip.boundingBox())!;
    const width = await host.page.evaluate(() => innerWidth);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  } finally {
    await host.close();
  }
});
