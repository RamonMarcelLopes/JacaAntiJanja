import { expect, Page, test } from '@playwright/test';
import { createRoom, enterCode, joinRoom, launchNext, modal, NextApp, openCreateDialog, openSettings, PNG_1X1, closeSettings, readConfig, sounds } from './app';

// Two instances of the app, one hosting a room on the loopback address and one joining it. No network and no Cloudflare account needed.
const HOST = (name: string, port: number) => ({ name, hostAddressOverride: '127.0.0.1', port });

const side = (page: Page) => page.locator('#sidebar');
const tile = (page: Page, name: string) => page.locator(`.tile[data-person="${name}"]`);
const clipboard = (a: NextApp) => a.app.evaluate(({ clipboard }) => clipboard.readText());

test('the chosen room name is the title for host and guest; with no name it is "Jaca room"; names are cut at 32 characters', async () => {
  const host = await launchNext('room-name-host', HOST('Ana', 47861));
  const guest = await launchNext('room-name-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page, 'Sexta do Filme');
    await expect(host.page.getByTestId('room-title')).toHaveText('Sexta do Filme');
    await joinRoom(guest.page, code);
    await expect(guest.page.getByTestId('room-title')).toHaveText('Sexta do Filme');
    await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(host.page.getByTestId('home')).toBeVisible();

    // the field comes with "Jaca room"; emptied, the room is called that too
    let dialog = await openCreateDialog(host.page);
    await dialog.getByLabel('Nome da sala').fill('');
    await dialog.getByRole('button', { name: 'Criar sala' }).click();
    await expect(host.page.getByTestId('room-title')).toHaveText('Jaca room', { timeout: 20_000 });
    await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(host.page.getByTestId('home')).toBeVisible();

    // typing more than 32 characters is cut by the field itself
    dialog = await openCreateDialog(host.page);
    await dialog.getByLabel('Nome da sala').fill('');
    await dialog.getByLabel('Nome da sala').pressSequentially('x'.repeat(45));
    await expect(dialog.getByLabel('Nome da sala')).toHaveValue('x'.repeat(32));
    await dialog.getByRole('button', { name: 'Criar sala' }).click();
    await expect(host.page.getByTestId('room-title')).toHaveText('x'.repeat(32), { timeout: 20_000 });
  } finally {
    await guest.close();
    await host.close();
  }
});

test('both people see each other in the column, the host is told "você", and everybody sees and copies the invite code', async () => {
  const host = await launchNext('room-people-host', HOST('Ana', 47862));
  const guest = await launchNext('room-people-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    for (const page of [host.page, guest.page]) {
      await expect(side(page)).toContainText('Ana');
      await expect(side(page)).toContainText('Bia');
      await expect(page.locator('.tile')).toHaveCount(2);
    }
    await expect(side(host.page)).toContainText('Ana (você)');
    await expect(side(guest.page)).toContainText('Bia (você)');

    // the code is the same for everybody and is copied to the clipboard with its button
    const chip = (p: Page) => p.getByRole('button', { name: 'Copiar código da sala' });
    await expect(chip(guest.page)).toHaveAttribute('data-code', code);
    await chip(guest.page).click();
    await expect(guest.page.locator('.toast').last()).toContainText('Código copiado');
    expect(await clipboard(guest)).toBe(code);
    await side(host.page).getByRole('button', { name: 'Copiar o código da sala' }).click();
    expect(await clipboard(host)).toBe(code);
  } finally {
    await guest.close();
    await host.close();
  }
});

test('invalid and wrong codes show clear errors; a code typed in lowercase with spaces still gets in', async () => {
  const host = await launchNext('room-codes-host', HOST('Ana', 47863));
  const guest = await launchNext('room-codes-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await guest.page.getByTestId('home').getByRole('button', { name: 'Entrar com código' }).click();
    const dialog = modal(guest.page);
    await dialog.getByLabel('Código da sala').fill('xxxx');
    await dialog.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(guest.page.locator('.toast[data-kind="warn"]').last()).toContainText('Código de convite inválido');

    // a well formed code of a room that does not exist: it cannot be reached
    await dialog.getByLabel('Código da sala').fill('0000-0000-0000-0000');
    await dialog.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(guest.page.locator('.toast[data-kind="warn"]').last()).not.toContainText('Código de convite inválido', { timeout: 30_000 });

    await dialog.getByLabel('Código da sala').fill(`  ${code.toLowerCase()}  `);
    await dialog.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(guest.page.getByTestId('stage')).toBeVisible({ timeout: 20_000 });
    await expect(guest.page.getByRole('button', { name: 'Copiar código da sala' })).toHaveAttribute('data-code', code); // the canonical code
  } finally {
    await guest.close();
    await host.close();
  }
});

test('every person has a menu: yours offers "Editar perfil", everybody\'s "Ver perfil", which opens a big photo and the name', async () => {
  const host = await launchNext('room-menu-host', HOST('Ana', 47864));
  const guest = await launchNext('room-menu-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    const bia = side(host.page).locator('[data-pid]', { hasText: 'Bia' });
    await bia.hover();
    await bia.getByRole('button', { name: 'Opções do perfil de Bia' }).click();
    const menu = host.page.locator('.peer-menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Ver perfil']);
    await menu.getByRole('menuitem', { name: 'Ver perfil' }).click();
    await expect(modal(host.page).getByRole('heading', { name: 'Bia' })).toBeVisible();
    await modal(host.page).getByRole('button', { name: 'Fechar' }).click();
    await expect(modal(host.page)).toHaveCount(0);

    const ana = side(host.page).locator('[data-pid]', { hasText: 'Ana' });
    await ana.hover();
    await ana.getByRole('button', { name: 'Opções do perfil de Ana' }).click();
    await expect(host.page.locator('.peer-menu').getByRole('menuitem')).toHaveText(['Ver perfil', 'Editar perfil']);
  } finally {
    await guest.close();
    await host.close();
  }
});

test('profile changes made inside the room (name and photo) reach the others at once', async () => {
  const host = await launchNext('room-profile-host', HOST('Ana', 47865));
  const guest = await launchNext('room-profile-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    await host.page.getByRole('button', { name: 'Editar perfil' }).first().click();
    const dialog = modal(host.page);
    await expect(dialog.getByText('As mudanças aparecem na hora para todos na sala.')).toBeVisible();
    await dialog.getByLabel('Seu nome').fill('Ana Maria');
    await dialog.getByLabel('Seu nome').blur();
    await expect(side(guest.page)).toContainText('Ana Maria');
    await expect(tile(guest.page, 'Ana Maria')).toBeVisible();

    await dialog.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await host.page.getByRole('button', { name: 'Usar esta foto' }).click();
    await expect(tile(guest.page, 'Ana Maria').locator('img')).toBeVisible({ timeout: 15_000 });
    expect(readConfig(host).avatar).toMatch(/^data:image\/jpeg/);
  } finally {
    await guest.close();
    await host.close();
  }
});

test('leaving and closing: the host ends the room for everybody, a guest only leaves; both go back to the home', async () => {
  const host = await launchNext('room-leave-host', HOST('Ana', 47866));
  const guest = await launchNext('room-leave-guest', { name: 'Bia' });
  const third = await launchNext('room-leave-third', { name: 'Caio' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    await joinRoom(third.page, code);
    await expect(guest.page.getByRole('button', { name: 'Encerrar sala' })).toHaveCount(0); // only the host has it
    await guest.page.getByRole('button', { name: 'Sair da sala' }).first().click();
    await expect(guest.page.getByTestId('home')).toBeVisible();
    await expect(side(host.page)).not.toContainText('Bia');
    await expect(side(host.page)).toContainText('Caio');

    await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(host.page.getByTestId('home')).toBeVisible();
    await expect(third.page.getByTestId('home')).toBeVisible({ timeout: 15_000 });
    await expect(third.page.locator('.toast').last()).toContainText('A sala foi encerrada pelo host.');
  } finally {
    await third.close();
    await guest.close();
    await host.close();
  }
});

test('the icon of the app in the rail is a way out of the room, and it asks first', async () => {
  const host = await launchNext('room-rail-host', HOST('Ana', 47867));
  try {
    await createRoom(host.page);
    const rail = host.page.getByRole('navigation', { name: 'Salas' });
    await rail.getByRole('button', { name: 'Início' }).click();
    const dialog = modal(host.page);
    await expect(dialog.getByRole('heading', { name: 'Ir para o início' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(host.page.getByTestId('stage')).toBeVisible();
    await rail.getByRole('button', { name: 'Início' }).click();
    await modal(host.page).getByRole('button', { name: 'Ir para o início' }).click();
    await expect(host.page.getByTestId('home')).toBeVisible({ timeout: 15_000 });
  } finally {
    await host.close();
  }
});

test('the room timer counts from when the room was opened, also for people who join later', async () => {
  const host = await launchNext('room-timer-host', HOST('Ana', 47868));
  const guest = await launchNext('room-timer-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    const seconds = async (p: Page) => {
      const text = (await side(p).getByTestId('room-timer').textContent()) ?? '';
      const parts = text.split(':').map(Number);
      return parts.reduce((a, n) => a * 60 + n, 0);
    };
    await expect.poll(() => seconds(host.page), { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    await joinRoom(guest.page, code);
    // the guest does not start from zero: it shows how long the room has been open
    await expect.poll(() => seconds(guest.page)).toBeGreaterThanOrEqual(3);
    await expect(side(guest.page).getByTestId('room-timer')).toHaveText(/^\d{1,2}:\d{2}(:\d{2})?$/);
  } finally {
    await guest.close();
    await host.close();
  }
});

test('the call bar: camera, screen and leave; the screen button opens the share dialog with Telas and Janelas, which closes on Esc and outside but not inside', async () => {
  const host = await launchNext('room-share-host', HOST('Ana', 47869));
  try {
    await createRoom(host.page);
    const bar = host.page.locator('.callbar');
    await expect(bar.getByRole('button', { name: 'Câmera' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Compartilhar tela' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Encerrar sala' })).toBeVisible();

    await bar.getByRole('button', { name: 'Compartilhar tela' }).click();
    const dialog = modal(host.page);
    await expect(dialog.getByRole('heading', { name: 'Compartilhar tela' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Telas' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('tab', { name: 'Janelas' })).toBeVisible();
    // the quality: groups of options (not dropdowns)
    await expect(dialog.getByRole('radiogroup', { name: 'Resolução' })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: '1080p' })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('radiogroup', { name: 'FPS' }).getByRole('radio', { name: '30 fps' })).toHaveAttribute('aria-checked', 'true');
    await dialog.getByRole('radio', { name: '1440p' }).click();
    await dialog.getByRole('radio', { name: '60 fps' }).click();
    await expect(dialog.getByRole('radio', { name: '1440p' })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByText(/Mbps/)).toHaveCount(0); // no cost line under the options
    await dialog.getByRole('radio', { name: 'Detalhe' }).click();
    await expect(dialog.getByRole('radio', { name: 'Detalhe' })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByText(/pior caso/i)).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Janelas' }).click();
    await expect(dialog.getByRole('tab', { name: 'Janelas' })).toHaveAttribute('aria-selected', 'true');

    await dialog.getByRole('heading', { name: 'Compartilhar tela' }).click(); // inside: stays
    await expect(dialog).toBeVisible();
    await host.page.keyboard.press('Escape');
    await expect(modal(host.page)).toHaveCount(0);
    await bar.getByRole('button', { name: 'Compartilhar tela' }).click();
    await host.page.locator('.backdrop').click({ position: { x: 5, y: 5 } });
    await expect(modal(host.page)).toHaveCount(0);
  } finally {
    await host.close();
  }
});

test('sound cues: you enter, someone enters and leaves, you leave; a switched-off notification stays silent while the others play', async () => {
  const host = await launchNext('room-sound-host', { ...HOST('Ana', 47870), disabledSounds: ['peer-leave'] });
  const guest = await launchNext('room-sound-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await expect.poll(() => sounds(host.page)).toContain('self-join');
    await joinRoom(guest.page, code);
    await expect.poll(() => sounds(host.page)).toContain('peer-join');
    await guest.page.getByRole('button', { name: 'Sair da sala' }).first().click();
    await expect(guest.page.getByTestId('home')).toBeVisible();
    await expect(side(host.page)).not.toContainText('Bia');
    expect(await sounds(host.page)).not.toContain('peer-leave'); // switched off in the config
    expect(await sounds(guest.page)).toEqual(expect.arrayContaining(['self-join', 'self-leave']));
  } finally {
    await guest.close();
    await host.close();
  }
});

test('the settings open over the room without leaving it: Esc and the back button close them and the room is still there', async () => {
  const host = await launchNext('room-settings-host', HOST('Ana', 47871));
  try {
    await createRoom(host.page, 'Sala viva');
    await openSettings(host.page, 'Interface');
    // switching the interface reloads the window, so it is refused inside a room
    const layer = host.page.getByTestId('settings');
    await expect(layer.getByText('Saia da sala para trocar de interface')).toBeVisible();
    await expect(layer.getByRole('button', { name: /Clássica/ })).toBeDisabled();
    await host.page.keyboard.press('Escape');
    await expect(layer).toHaveCount(0);
    await expect(host.page.getByTestId('room-title')).toHaveText('Sala viva');
    await openSettings(host.page, 'Rede');
    await closeSettings(host.page);
    await expect(host.page.getByTestId('room-title')).toHaveText('Sala viva');
  } finally {
    await host.close();
  }
});

test('the details panel opens from the top bar and shows the connection and who is live', async () => {
  const host = await launchNext('room-panel-host', HOST('Ana', 47872));
  try {
    await createRoom(host.page);
    const panel = host.page.locator('#details-panel');
    const width = async () => (await panel.boundingBox())!.width;
    await expect.poll(width).toBeLessThanOrEqual(1); // folded (only its border shows)
    await host.page.getByRole('button', { name: 'Detalhes' }).click();
    await expect.poll(width).toBeGreaterThan(300);
    await expect(panel.getByText('Sua conexão com a sala')).toBeVisible();
    await expect(panel.getByText('Ninguém está transmitindo agora.')).toBeVisible();
    await panel.getByRole('button', { name: 'Fechar' }).click();
    await expect.poll(width).toBeLessThanOrEqual(1);
  } finally {
    await host.close();
  }
});

test('REGRESSION: a room that is entered while another one is open asks first, leaves the old one and joins the new one', async () => {
  const hostA = await launchNext('room-switch-a', HOST('Ana', 47873));
  const hostB = await launchNext('room-switch-b', HOST('Caio', 47874));
  const guest = await launchNext('room-switch-guest', { name: 'Bia' });
  try {
    const codeA = await createRoom(hostA.page, 'Sala A');
    const codeB = await createRoom(hostB.page, 'Sala B');
    await joinRoom(guest.page, codeA);
    await expect(guest.page.getByTestId('room-title')).toHaveText('Sala A');
    // there is no code field inside a room: the person goes home first and joins the other one
    await guest.page.getByRole('button', { name: 'Sair da sala' }).first().click();
    await expect(guest.page.getByTestId('home')).toBeVisible();
    await enterCode(guest.page, codeB);
    await expect(guest.page.getByTestId('room-title')).toHaveText('Sala B', { timeout: 20_000 });
    await expect(side(hostA.page)).not.toContainText('Bia');
    await expect(side(hostB.page)).toContainText('Bia');
  } finally {
    await guest.close();
    await hostB.close();
    await hostA.close();
  }
});

test('REGRESSION: the screens of the share dialog come in once; the background refresh of the lists must not make them jump again', async () => {
  const host = await launchNext('room-share-jump', HOST('Ana', 47875));
  try {
    await createRoom(host.page);
    const starts = async (name: string) => {
      await host.page.evaluate(() => {
        (window as any).__starts = {};
        if (!(window as any).__startsListener) {
          // one listener for the whole test (a second one would count every card twice)
          (window as any).__startsListener = (e: Event) => {
            const card = (e.target as HTMLElement).closest?.('.source') as HTMLElement | null;
            if (card?.dataset.id) (window as any).__starts[card.dataset.id] = ((window as any).__starts[card.dataset.id] ?? 0) + 1;
          };
          document.addEventListener('animationstart', (window as any).__startsListener, true);
        }
      });
      await host.page.locator('.callbar').getByRole('button', { name: 'Compartilhar tela' }).click();
      await expect(modal(host.page).locator('.source').first()).toBeVisible({ timeout: 20_000 });
      await host.page.waitForTimeout(2500); // the lists are refreshed in the background meanwhile
      const counts = Object.values(await host.page.evaluate(() => (window as any).__starts)) as number[];
      expect(counts.length, `${name}: the cards played their entrance`).toBeGreaterThan(0);
      expect(Math.max(...counts), `${name}: no card played its entrance twice`).toBe(1);
    };
    await starts('first opening');
    await host.page.keyboard.press('Escape');
    await expect(modal(host.page)).toHaveCount(0);
    await starts('second opening (lists already known)');
  } finally {
    await host.close();
  }
});

test('the little arrow of a call button has no tooltip of the button, and pressing it does not squeeze the button (only pressing the button does)', async () => {
  const host = await launchNext('room-chev', HOST('Ana', 47876));
  try {
    await createRoom(host.page);
    await host.page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); // the notices of the room opening sit over the bar for a while
    const btn = host.page.locator('.callbar button[aria-label="Compartilhar tela"]');
    const chev = btn.locator('.chev');
    const squeeze = () => btn.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    const c = (await chev.boundingBox())!;
    await host.page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await host.page.waitForTimeout(500);
    await expect(host.page.locator('.tooltip')).toHaveCount(0); // not "Compartilhar tela" over the arrow
    await host.page.mouse.down();
    await host.page.waitForTimeout(250);
    expect(await squeeze()).toBeGreaterThanOrEqual(1); // lifted by the pointer, never squeezed
    await host.page.mouse.up();
    await host.page.keyboard.press('Escape');

    const b = (await btn.boundingBox())!;
    await host.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 6);
    await expect(host.page.locator('.tooltip')).toHaveText('Compartilhar tela'); // over the button itself it shows
    await host.page.mouse.down();
    await host.page.waitForTimeout(250);
    expect(await squeeze()).toBeLessThan(1); // pressing the button squeezes it
    await host.page.mouse.up();
  } finally {
    await host.close();
  }
});
