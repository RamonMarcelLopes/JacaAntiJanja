import { expect, Page, test } from '@playwright/test';
import { createRoom, enterCode, joinRoom, launchApp, openShareDialog, PNG_1X1, smallDialog, sounds, TestApp } from './app';

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

test('the room is called "Jaca room" when nobody types another name, also when the field is emptied', async () => {
  const code = await createRoom(host.page);
  await joinRoom(guest.page, code);
  await expect(guest.page.getByRole('heading', { name: 'Jaca room' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
  await expect(host.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible({ timeout: 15_000 });

  await createRoom(host.page, '   '); // only blanks: the suggested name is used
  await expect(host.page.getByRole('heading', { name: 'Jaca room' })).toBeVisible();
});

test('both people see each other in the participant list', async () => {
  const code = await createRoom(host.page);
  await joinRoom(guest.page, code);
  await expect(names(host.page)).toHaveText(['Ana (você)', 'Bia']);
  await expect(names(guest.page)).toHaveText(['Bia (você)', 'Ana']);
});

test('invalid and wrong invite codes show clear errors', async () => {
  const code = await createRoom(host.page);

  await enterCode(guest.page, 'NAO-E-UM-CODIGO');
  await expect(guest.page.locator('.toast.error').last()).toContainText('Código de convite inválido');
  await expect(smallDialog(guest.page)).toBeVisible(); // the dialog stays open so the code can be fixed

  // flip the last character: same address, different token
  const flipped = code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A');
  await enterCode(guest.page, flipped);
  await expect(guest.page.locator('.toast.error').last()).toContainText('Código de convite incorreto');
});

test('every card has the three-dot menu: yours offers "Editar perfil", everybody\'s "Ver perfil"', async () => {
  const code = await createRoom(host.page);
  await joinRoom(guest.page, code);

  await expect(guest.page.locator('.kebab')).toHaveCount(2);
  await expect(guest.page.locator('.peer-row .peer-name')).toHaveText(['Bia (você)', 'Ana']);

  // the dots sit inside the card's border and only show while the pointer is over the card
  const ownRow = guest.page.locator('.peer-row', { hasText: 'Bia (você)' });
  const kebab = ownRow.locator('.kebab');
  await guest.page.mouse.move(2, 2);
  await expect(kebab).toHaveCSS('opacity', '0');
  await ownRow.hover();
  await expect(kebab).toHaveCSS('opacity', '1');
  const card = (await ownRow.locator('.peer').boundingBox())!;
  const dots = (await kebab.boundingBox())!;
  expect(dots.x).toBeGreaterThan(card.x);
  expect(dots.x + dots.width).toBeLessThanOrEqual(card.x + card.width);
  expect(dots.y).toBeGreaterThanOrEqual(card.y);
  expect(dots.y + dots.height).toBeLessThanOrEqual(card.y + card.height);
  await guest.page.mouse.move(2, 2);
  await expect(guest.page.getByRole('button', { name: 'Editar perfil' })).toHaveCount(0); // no longer in the top bar

  await guest.page.getByRole('button', { name: 'Opções do perfil de Bia' }).click();
  await expect(guest.page.getByRole('menuitem', { name: 'Editar perfil' })).toBeVisible();
  await expect(guest.page.getByRole('menuitem', { name: 'Ver perfil' })).toBeVisible();
  await guest.page.keyboard.press('Escape');
  await expect(guest.page.getByRole('menuitem')).toHaveCount(0);

  await guest.page.getByRole('button', { name: 'Opções do perfil de Bia' }).click();
  await guest.page.getByRole('menuitem', { name: 'Editar perfil' }).click();
  await expect(guest.page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();
});

test('"Ver perfil" opens the profile of any participant: a big photo and the name, closed with the X', async () => {
  const code = await createRoom(host.page);
  await joinRoom(guest.page, code);

  // somebody else's card: only "Ver perfil"
  await guest.page.getByRole('button', { name: 'Opções do perfil de Ana' }).click();
  await expect(guest.page.getByRole('menuitem')).toHaveText(['Ver perfil']);
  await guest.page.getByRole('menuitem', { name: 'Ver perfil' }).click();

  const view = guest.page.locator('.profile-view');
  await expect(view).toBeVisible();
  await expect(view.getByRole('heading', { name: 'Ana' })).toBeVisible();
  const photo = (await view.locator('.avatar').boundingBox())!;
  expect(photo.width).toBeGreaterThanOrEqual(200); // much bigger than the 44 px of the list
  expect(photo.height).toBeGreaterThanOrEqual(200);

  // closes with the X in the top right corner of the modal (there is no "Fechar" button any more)
  await expect(view.getByRole('button', { name: 'Fechar' })).toHaveCount(1);
  const box = (await view.boundingBox())!;
  const x = (await view.getByRole('button', { name: 'Fechar' }).boundingBox())!;
  expect(x.x + x.width).toBeGreaterThan(box.x + box.width - 60);
  expect(x.y).toBeLessThan(box.y + 60);
  await view.getByRole('button', { name: 'Fechar' }).click();
  await expect(guest.page.locator('.profile-view')).toHaveCount(0);

  // your own card: "Ver perfil" too, with "(você)"
  await guest.page.getByRole('button', { name: 'Opções do perfil de Bia' }).click();
  await guest.page.getByRole('menuitem', { name: 'Ver perfil' }).click();
  await expect(guest.page.locator('.profile-view').getByRole('heading', { name: 'Bia (você)' })).toBeVisible();
  await guest.page.keyboard.press('Escape');
  await expect(guest.page.locator('.profile-view')).toHaveCount(0);
});

test('profile changes made inside the room reach the others immediately', async () => {
  const code = await createRoom(host.page);
  await joinRoom(guest.page, code);
  const biaOnHost = host.page.locator('.peer', { hasText: 'Bia' });
  await expect(biaOnHost.locator('img')).toHaveCount(0);

  await guest.page.getByRole('button', { name: 'Opções do perfil de Bia' }).click();
  await guest.page.getByRole('menuitem', { name: 'Editar perfil' }).click();
  const dialog = guest.page.locator('.profile-dialog');

  await dialog.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await guest.page.getByRole('button', { name: 'Usar esta foto' }).click();
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
  const title = await host.page.locator('.room-title').textContent();
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
  const gearBox = (await host.page.locator('.topbar').getByRole('button', { name: 'Configurações' }).boundingBox())!;
  expect(timerBox.x + timerBox.width).toBeLessThanOrEqual(gearBox.x); // in the header, left of the settings button (leaving lives in the call dock now)
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
  await enterCode(guest.page, code.toLowerCase().replace(/-/g, ' '));
  await expect(guest.page.getByRole('heading', { name: 'Participantes' })).toBeVisible({ timeout: 15_000 });
  await expect(guest.page.locator('.code-chip code')).toHaveText(code);
});

test('the share dialog has Telas and Janelas tabs that swipe, a fixed size, and no worst-case upload text', async () => {
  await createRoom(host.page);
  await openShareDialog(host.page);
  const dialog = host.page.locator('.dialog');
  const visibleSources = dialog.locator('.source-panel:not([inert]) .source');
  const size = async () => {
    const b = (await dialog.boundingBox())!;
    return `${Math.round(b.width)}x${Math.round(b.height)}`;
  };

  await expect(dialog.getByRole('tab')).toHaveText(['Telas', 'Janelas']); // the camera has its own menu on the camera button
  await expect(dialog.getByText(/Pior caso/)).toHaveCount(0);
  const fixedSize = await size();

  // Telas first: screens only, named in Portuguese
  await expect(dialog.getByRole('tab', { name: 'Telas' })).toHaveAttribute('aria-selected', 'true');
  await expect(visibleSources.first()).toContainText(/^Tela \d+$/);
  await expect(dialog.locator('.seg')).toHaveAttribute('data-pos', '0');
  await expect(dialog.locator('.source-track')).toHaveCSS('transform', /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/); // not moved

  // Janelas: the highlight and the lists swipe; the open windows include the app's own window; the selection moves to the visible tab
  await dialog.getByRole('tab', { name: 'Janelas' }).click();
  await expect(dialog.getByRole('tab', { name: 'Janelas' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.locator('.seg')).toHaveAttribute('data-pos', '1');
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
  await expect(dialog.locator('.seg')).toHaveAttribute('data-pos', '0');
});

test('modals close when you click outside them or press Esc, but not when you click inside', async () => {
  await createRoom(host.page);

  // share dialog
  await openShareDialog(host.page);
  const dialog = host.page.locator('.dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('h2').click(); // inside: stays open
  await expect(dialog).toBeVisible();
  await host.page.locator('.overlay').click({ position: { x: 6, y: 6 } }); // the dark backdrop
  await expect(host.page.locator('.overlay')).toHaveCount(0); // gone once the exit animation finishes

  // Esc closes it too
  await openShareDialog(host.page);
  await expect(dialog).toBeVisible();
  await host.page.keyboard.press('Escape');
  await expect(host.page.locator('.overlay')).toHaveCount(0);

  // Esc inside an open dropdown only closes the dropdown, not the dialog
  await openShareDialog(host.page);
  await dialog.locator('.select-btn').first().click();
  await expect(host.page.getByRole('listbox')).toBeVisible();
  await host.page.keyboard.press('Escape');
  await expect(host.page.getByRole('listbox')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await host.page.keyboard.press('Escape');
  await expect(host.page.locator('.overlay')).toHaveCount(0);

  // profile dialog
  await host.page.getByRole('button', { name: 'Opções do perfil de Ana' }).click();
  await host.page.getByRole('menuitem', { name: 'Editar perfil' }).click();
  await expect(host.page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();
  await host.page.locator('.overlay').click({ position: { x: 6, y: 6 } });
  await expect(host.page.locator('.overlay')).toHaveCount(0);
});

test('sound cues: you enter, someone enters and leaves, you leave', async () => {
  const code = await createRoom(host.page);
  await expect.poll(() => sounds(host.page)).toContain('self-join');
  expect(await sounds(host.page)).not.toContain('peer-join'); // nobody else yet

  await joinRoom(guest.page, code);
  await expect.poll(() => sounds(guest.page)).toContain('self-join');
  await expect.poll(() => sounds(host.page)).toContain('peer-join'); // the host hears the guest come in
  expect(await sounds(guest.page)).not.toContain('peer-join'); // the guest joined, so nobody "entered" for them

  await guest.page.getByRole('button', { name: 'Sair' }).click();
  await expect.poll(() => sounds(guest.page)).toContain('self-leave');
  await expect.poll(() => sounds(host.page)).toContain('peer-leave');

  await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
  await expect.poll(() => sounds(host.page)).toContain('self-leave');
});

test('a switched-off notification stays silent while the others still play', async () => {
  const quiet = await launchApp('host-quiet', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47854, disabledSounds: ['peer-join', 'peer-leave'] });
  try {
    const code = await createRoom(quiet.page);
    await expect.poll(() => sounds(quiet.page)).toContain('self-join'); // not switched off
    await joinRoom(guest.page, code);
    await expect(quiet.page.locator('.peer-name')).toHaveCount(2); // the guest is in the room
    await guest.page.getByRole('button', { name: 'Sair' }).click();
    await expect(quiet.page.locator('.peer-name')).toHaveCount(1);
    const heard = await sounds(quiet.page);
    expect(heard).not.toContain('peer-join');
    expect(heard).not.toContain('peer-leave');
  } finally {
    await quiet.close();
  }
});

test('the settings open in a drawer inside the room: the back button works on its whole area, Esc and the backdrop close it, and the room stays', async () => {
  await createRoom(host.page);
  const gear = host.page.locator('.topbar').getByRole('button', { name: 'Configurações' });
  await gear.click();
  const drawer = host.page.locator('.settings-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('tab')).toHaveText(['Rede', 'Salas fixas', 'Áudio', 'Notificações', 'Transmissão', 'Câmera', 'Interface', 'Sobre']);
  await expect(host.page.locator('.code-chip')).toBeVisible(); // still in the room behind it

  // the window's title bar is a drag area that swallows clicks: the drawer starts under it, so the top of the back button works too
  const bar = (await host.page.locator('#titlebar').boundingBox())!;
  const drawerBox = (await host.page.locator('.drawer-overlay').boundingBox())!;
  expect(drawerBox.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  const back = drawer.getByRole('button', { name: 'Voltar' });
  const backBox = (await back.boundingBox())!;
  await host.page.mouse.click(backBox.x + backBox.width / 2, backBox.y + 2); // the very top edge of the button
  await expect(host.page.locator('.drawer-overlay')).toHaveCount(0);

  // Esc and a click on the dark backdrop close it too
  await gear.click();
  await expect(drawer).toBeVisible();
  await host.page.keyboard.press('Escape');
  await expect(host.page.locator('.drawer-overlay')).toHaveCount(0);
  await gear.click();
  await host.page.locator('.drawer-overlay').click({ position: { x: 8, y: 200 } });
  await expect(host.page.locator('.drawer-overlay')).toHaveCount(0);

  // a setting changed in the drawer is saved without leaving the room
  await gear.click();
  await drawer.getByRole('tab', { name: 'Câmera' }).click();
  await drawer.locator('#panel-camera .select-btn').nth(1).click(); // the first one is the default camera, then the resolution
  await host.page.getByRole('option', { name: '1440p' }).click();
  await host.page.keyboard.press('Escape');
  await expect(host.page.locator('.code-chip')).toBeVisible();
});
