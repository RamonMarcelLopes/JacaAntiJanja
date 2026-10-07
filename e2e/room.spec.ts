import { expect, Page, test } from '@playwright/test';
import { createRoom, joinRoom, launchApp, PNG_1X1, TestApp } from './app';

let host: TestApp;
let guest: TestApp;

test.beforeEach(async () => {
  host = await launchApp('host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47852 });
  guest = await launchApp('guest', { name: 'Bia' });
});

test.afterEach(async () => {
  await guest.close();
  await host.close();
});

const names = (page: Page) => page.locator('.peer-name');

test('the chosen room name is the title for host and guest', async () => {
  const code = await createRoom(host.page, 'Noite de filmes');
  await expect(host.page.getByRole('heading', { name: 'Noite de filmes' })).toBeVisible();
  await joinRoom(guest.page, code);
  await expect(guest.page.getByRole('heading', { name: 'Noite de filmes' })).toBeVisible();
});

test('without a room name the title is "Sala de <host>"', async () => {
  const code = await createRoom(host.page);
  await joinRoom(guest.page, code);
  await expect(guest.page.getByRole('heading', { name: 'Sala de Ana' })).toBeVisible();
});

test('both people see each other in the participant list', async () => {
  const code = await createRoom(host.page);
  await joinRoom(guest.page, code);
  await expect(names(host.page)).toHaveText(['Ana (você)', 'Bia']);
  await expect(names(guest.page)).toHaveText(['Bia (você)', 'Ana']);
});

test('invalid and wrong invite codes show clear errors', async () => {
  const code = await createRoom(host.page);

  await guest.page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill('NAO-E-UM-CODIGO');
  await guest.page.getByRole('button', { name: 'Entrar' }).click();
  await expect(guest.page.locator('.toast.error').last()).toContainText('Código de convite inválido');

  // flip the last character: same address, different token
  const flipped = code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A');
  await guest.page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(flipped);
  await guest.page.getByRole('button', { name: 'Entrar' }).click();
  await expect(guest.page.locator('.toast.error').last()).toContainText('Código de convite incorreto');
});

test('only your own card has the three-dot menu, and it opens "Editar perfil"', async () => {
  const code = await createRoom(host.page);
  await joinRoom(guest.page, code);

  await expect(guest.page.locator('.kebab')).toHaveCount(1);
  await expect(guest.page.locator('.peer-row .peer-name')).toHaveText('Bia (você)');

  // the dots sit inside the card's border and only show while the pointer is over the card
  const kebab = guest.page.locator('.kebab');
  await guest.page.mouse.move(2, 2);
  await expect(kebab).toHaveCSS('opacity', '0');
  await guest.page.locator('.peer-row').hover();
  await expect(kebab).toHaveCSS('opacity', '1');
  const card = (await guest.page.locator('.peer-row .peer').boundingBox())!;
  const dots = (await kebab.boundingBox())!;
  expect(dots.x).toBeGreaterThan(card.x);
  expect(dots.x + dots.width).toBeLessThanOrEqual(card.x + card.width);
  expect(dots.y).toBeGreaterThanOrEqual(card.y);
  expect(dots.y + dots.height).toBeLessThanOrEqual(card.y + card.height);
  await guest.page.mouse.move(2, 2);
  await expect(guest.page.getByRole('button', { name: 'Editar perfil' })).toHaveCount(0); // no longer in the top bar

  await guest.page.getByRole('button', { name: 'Opções do perfil' }).click();
  await expect(guest.page.getByRole('menuitem', { name: 'Editar perfil' })).toBeVisible();
  await guest.page.keyboard.press('Escape');
  await expect(guest.page.getByRole('menuitem')).toHaveCount(0);

  await guest.page.getByRole('button', { name: 'Opções do perfil' }).click();
  await guest.page.getByRole('menuitem', { name: 'Editar perfil' }).click();
  await expect(guest.page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();
});

test('profile changes made inside the room reach the others immediately', async () => {
  const code = await createRoom(host.page);
  await joinRoom(guest.page, code);
  const biaOnHost = host.page.locator('.peer', { hasText: 'Bia' });
  await expect(biaOnHost.locator('img')).toHaveCount(0);

  await guest.page.getByRole('button', { name: 'Opções do perfil' }).click();
  await guest.page.getByRole('menuitem', { name: 'Editar perfil' }).click();
  const dialog = guest.page.locator('.profile-dialog');

  await dialog.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(host.page.locator('.peer', { hasText: 'Bia' }).locator('img')).toBeVisible();

  await dialog.locator('input[type=text]').fill('Bianca');
  await dialog.locator('input[type=text]').blur();
  await expect(names(host.page)).toHaveText(['Ana (você)', 'Bianca']);

  await dialog.getByRole('button', { name: 'Remover' }).click();
  await expect(host.page.locator('.peer', { hasText: 'Bianca' }).locator('img')).toHaveCount(0);
});

test('leaving and closing the room send people back to the home screen', async () => {
  const code = await createRoom(host.page);
  await joinRoom(guest.page, code);

  await guest.page.getByRole('button', { name: 'Sair' }).click();
  await expect(guest.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible();
  await expect(names(host.page)).toHaveCount(1);

  await joinRoom(guest.page, code);
  await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
  await expect(host.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible();
  await expect(guest.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible();
  await expect(guest.page.locator('.toast')).toContainText('A sala foi encerrada pelo host.');
});

test('room names keep every letter, collapse repeated spaces and are limited to 32 characters', async () => {
  const code = await createRoom(host.page, '  Mesas  de  sábado   sensatas ');
  await expect(host.page.getByRole('heading', { name: 'Mesas de sábado sensatas' })).toBeVisible();
  await joinRoom(guest.page, code);
  await expect(guest.page.getByRole('heading', { name: 'Mesas de sábado sensatas' })).toBeVisible();
});

test('a very long room name is cut to 32 characters', async () => {
  const long = 'Sala super gigante das sextas-feiras de verão';
  await createRoom(host.page, long);
  const title = await host.page.locator('h1').textContent();
  expect(title!.length).toBeLessThanOrEqual(32);
  expect(long.startsWith(title!.trim())).toBe(true);
});

test('"Copiar código" puts the invite code on the clipboard', async () => {
  const code = await createRoom(host.page);
  await host.page.getByRole('button', { name: 'Copiar código' }).click();
  await expect(host.page.locator('.toast', { hasText: 'Código copiado.' })).toBeVisible(); // the host also has room-creation warnings
  const clipboardText = await host.app.evaluate(({ clipboard }) => clipboard.readText());
  expect(clipboardText).toBe(code);
});

test('the room timer in the header counts from when the room was opened, also for people who join later', async () => {
  const code = await createRoom(host.page);
  await expect(host.page.locator('.room-timer-text')).toHaveText(/^\d{2}:\d{2}$/);
  await host.page.waitForTimeout(3000);
  await joinRoom(guest.page, code);
  const seconds = (text: string) => {
    const [m, s] = text.split(':').map(Number);
    return m * 60 + s;
  };
  const guestStart = seconds((await guest.page.locator('.room-timer-text').textContent())!);
  expect(guestStart).toBeGreaterThanOrEqual(3); // not zero: the room was already open
  await expect
    .poll(async () => seconds((await guest.page.locator('.room-timer-text').textContent())!), { timeout: 5000 })
    .toBeGreaterThan(guestStart);
  const timerBox = (await host.page.locator('.room-timer').boundingBox())!;
  const leaveBox = (await host.page.getByRole('button', { name: 'Encerrar sala' }).boundingBox())!;
  expect(timerBox.x + timerBox.width).toBeLessThanOrEqual(leaveBox.x); // in the header, left of the leave button
});

test('everyone in the room sees the invite code and can copy it, not only the host', async () => {
  const code = await createRoom(host.page);
  await joinRoom(guest.page, code);

  await expect(guest.page.locator('.code-chip code')).toHaveText(code);
  await guest.page.getByRole('button', { name: 'Copiar código' }).click();
  await expect(guest.page.locator('.toast')).toContainText('Código copiado.');
  const clipboardText = await guest.app.evaluate(({ clipboard }) => clipboard.readText());
  expect(clipboardText).toBe(code);
});

test('a guest who typed the code in lowercase still sees the canonical code in the header', async () => {
  const code = await createRoom(host.page);
  await guest.page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(code.toLowerCase().replace(/-/g, ' '));
  await guest.page.getByRole('button', { name: 'Entrar' }).click();
  await expect(guest.page.getByRole('heading', { name: 'Participantes' })).toBeVisible({ timeout: 15_000 });
  await expect(guest.page.locator('.code-chip code')).toHaveText(code);
});

test('the share dialog has Telas and Janelas tabs that swipe, a fixed size, and no worst-case upload text', async () => {
  await createRoom(host.page);
  await host.page.getByRole('button', { name: 'Compartilhar tela' }).click();
  const dialog = host.page.locator('.dialog');
  const visibleSources = dialog.locator('.source-panel:not([inert]) .source');
  const size = async () => {
    const b = (await dialog.boundingBox())!;
    return `${Math.round(b.width)}x${Math.round(b.height)}`;
  };

  await expect(dialog.getByRole('tab')).toHaveText(['Telas', 'Janelas']);
  await expect(dialog.getByText(/Pior caso/)).toHaveCount(0);
  const fixedSize = await size();

  // Telas first: screens only, named in Portuguese
  await expect(dialog.getByRole('tab', { name: 'Telas' })).toHaveAttribute('aria-selected', 'true');
  await expect(visibleSources.first()).toContainText(/^Tela \d+$/);
  await expect(dialog.locator('.seg')).toHaveAttribute('data-kind', 'screens');
  await expect(dialog.locator('.source-track')).toHaveCSS('transform', /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/); // not moved

  // Janelas: the highlight and the lists swipe; the open windows include the app's own window; the selection moves to the visible tab
  await dialog.getByRole('tab', { name: 'Janelas' }).click();
  await expect(dialog.getByRole('tab', { name: 'Janelas' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.locator('.seg')).toHaveAttribute('data-kind', 'windows');
  await expect(dialog.locator('.source-track')).toHaveCSS('transform', /^matrix\(1, 0, 0, 1, -\d/); // moved sideways to the left (after the swipe finishes)
  await expect(visibleSources.first()).toBeVisible();
  await expect(dialog.locator('.source.selected')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Compartilhar', exact: true })).toBeEnabled();
  await expect(dialog.locator('.source-panel[inert]')).toHaveCount(1); // the hidden list cannot be tabbed into

  // the modal never changes size when switching tabs; the lists scroll inside it
  expect(await size()).toBe(fixedSize);
  await expect(dialog.locator('.source-panel:not([inert])')).toHaveCSS('overflow-y', 'auto');

  // arrow keys switch tabs
  await dialog.getByRole('tab', { name: 'Janelas' }).focus();
  await host.page.keyboard.press('ArrowLeft');
  await expect(dialog.getByRole('tab', { name: 'Telas' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.locator('.seg')).toHaveAttribute('data-kind', 'screens');
});

test('modals close when you click outside them or press Esc, but not when you click inside', async () => {
  await createRoom(host.page);

  // share dialog
  await host.page.getByRole('button', { name: 'Compartilhar tela' }).click();
  const dialog = host.page.locator('.dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('h2').click(); // inside: stays open
  await expect(dialog).toBeVisible();
  await host.page.locator('.overlay').click({ position: { x: 6, y: 6 } }); // the dark backdrop
  await expect(host.page.locator('.overlay')).toHaveCount(0); // gone once the exit animation finishes

  // Esc closes it too
  await host.page.getByRole('button', { name: 'Compartilhar tela' }).click();
  await expect(dialog).toBeVisible();
  await host.page.keyboard.press('Escape');
  await expect(host.page.locator('.overlay')).toHaveCount(0);

  // Esc inside an open dropdown only closes the dropdown, not the dialog
  await host.page.getByRole('button', { name: 'Compartilhar tela' }).click();
  await dialog.locator('.select-btn').first().click();
  await expect(host.page.getByRole('listbox')).toBeVisible();
  await host.page.keyboard.press('Escape');
  await expect(host.page.getByRole('listbox')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await host.page.keyboard.press('Escape');
  await expect(host.page.locator('.overlay')).toHaveCount(0);

  // profile dialog
  await host.page.getByRole('button', { name: 'Opções do perfil' }).click();
  await host.page.getByRole('menuitem', { name: 'Editar perfil' }).click();
  await expect(host.page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();
  await host.page.locator('.overlay').click({ position: { x: 6, y: 6 } });
  await expect(host.page.locator('.overlay')).toHaveCount(0);
});
