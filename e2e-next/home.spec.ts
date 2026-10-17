import { expect, test } from '@playwright/test';
import { closeSettings, launchNext, modal, openCreateDialog, openSettings, PNG_1X1, pick, readConfig, sounds } from './app';

const OFFLINE = { JACA_WORKER_URL: 'http://127.0.0.1:9' }; // every room server answer is "no answer", so nothing depends on the network

test('first run: the home asks for a name, the room cannot be created before it, and saving it greets the person', async () => {
  const a = await launchNext('home-first-run');
  try {
    const page = a.page;
    await expect(page.getByText('Como você quer ser chamado?')).toBeVisible();
    // without a name nothing starts: the app says so instead of failing
    const dialog = await openCreateDialog(page);
    await dialog.getByRole('button', { name: 'Criar sala' }).click();
    await expect(page.locator('.toast[data-kind="warn"]').last()).toContainText('Escolha um nome de exibição primeiro.');
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);

    await page.getByTestId('home').getByLabel('Seu nome').fill('Ramon');
    await page.getByTestId('home').getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Como você quer ser chamado?')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/(Bom dia|Boa tarde|Boa noite|Boa madrugada), Ramon/);
    expect(readConfig(a).name).toBe('Ramon');
  } finally {
    await a.close();
  }
});

test('home layout: the two ways in open their dialogs, which close with Cancelar, the X, Esc and a click outside', async () => {
  const a = await launchNext('home-layout', { name: 'Ana' }, OFFLINE);
  try {
    const page = a.page;
    const home = page.getByTestId('home');
    await expect(home.getByRole('button', { name: 'Iniciar sala' })).toBeVisible();
    await expect(home.getByRole('button', { name: 'Entrar com código' })).toBeVisible();
    await expect(home.getByRole('button', { name: /Modo de conexão: Direto \(VPN\)/ })).toBeVisible();

    // direct mode: the create dialog only asks for the name and the icon (no kind of room, no Discord)
    const create = await openCreateDialog(page);
    await expect(create.getByRole('heading', { name: 'Iniciar sala' })).toBeVisible();
    await expect(create.getByLabel('Nome da sala')).toHaveValue('Jaca room');
    await expect(create.getByRole('combobox', { name: 'Tipo de sala' })).toHaveCount(0);
    await expect(create.getByRole('switch')).toHaveCount(0);
    await create.getByRole('button', { name: 'Cancelar' }).click();
    await expect(modal(page)).toHaveCount(0);

    // the enter dialog: focused code field, closes with the X, with Esc and with a click outside, but not with a click inside
    await home.getByRole('button', { name: 'Entrar com código' }).click();
    const join = modal(page);
    await expect(join.getByRole('heading', { name: 'Entrar em uma sala' })).toBeVisible();
    await expect(join.getByLabel('Código da sala')).toBeFocused();
    await join.getByRole('heading', { name: 'Entrar em uma sala' }).click();
    await expect(join).toBeVisible();
    await join.getByRole('button', { name: 'Fechar' }).click();
    await expect(modal(page)).toHaveCount(0);
    await home.getByRole('button', { name: 'Entrar com código' }).click();
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
    await home.getByRole('button', { name: 'Entrar com código' }).click();
    await page.locator('.backdrop').click({ position: { x: 5, y: 5 } });
    await expect(modal(page)).toHaveCount(0);
  } finally {
    await a.close();
  }
});

test('a wrong code keeps the dialog open and says so; a whole Cloudflare code with a long account name is not cut', async () => {
  const a = await launchNext('home-bad-code', { name: 'Ana' }, OFFLINE);
  try {
    const page = a.page;
    await page.getByTestId('home').getByRole('button', { name: 'Entrar com código' }).click();
    const join = modal(page);
    await join.getByLabel('Código da sala').fill('NAO-E-UM-CODIGO');
    await join.getByLabel('Código da sala').press('Enter');
    await expect(page.locator('.toast[data-kind="warn"]').last()).toContainText('Código de convite inválido');
    await expect(join).toBeVisible();
    // REGRESSION (legacy had maxLength 24 and cut the end of the account name): the field takes 80 characters
    const long = 'K7QM2-XRA9T@' + 'a'.repeat(40);
    await join.getByLabel('Código da sala').fill(long);
    await expect(join.getByLabel('Código da sala')).toHaveValue(long);
  } finally {
    await a.close();
  }
});

test('favorite rooms: cards with the state, filters by name and state, the star takes one out, "Entrar" is off only for closed rooms', async () => {
  const favorites = [
    { code: 'AAAAA-AAAAA@sala-um', name: 'Filmes de Sexta' },
    { code: 'BBBBB-BBBBB@sala-um', name: 'Jogos do João' },
    { code: 'CCCCC-CCCCC@sala-um', name: 'Música Ao Vivo' },
  ];
  const a = await launchNext('home-favs', { name: 'Ana', favoriteRooms: favorites }, OFFLINE);
  try {
    const page = a.page;
    const cards = page.locator('[data-room-card]');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('Sem resposta do servidor da sala', { timeout: 15_000 });
    await expect(cards.first().getByRole('button', { name: 'Entrar em Filmes de Sexta' })).toBeEnabled(); // unknown is not "closed": it can be tried
    // the rail has one button per saved room
    await expect(page.getByRole('navigation', { name: 'Salas' }).getByRole('button', { name: 'Jogos do João' })).toBeVisible();

    // by name, ignoring accents and case
    const search = page.getByLabel('Buscar sala pelo nome');
    await search.fill('joao');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Jogos do João');
    await search.fill('MUSICA');
    await expect(cards).toHaveCount(1);
    await search.fill('');

    // by state: nothing is known to be open or closed, so those filters are empty and say so
    await page.getByRole('tab', { name: 'Abertas' }).click();
    await expect(cards).toHaveCount(0);
    await expect(page.getByText('Nenhuma sala encontrada com esse filtro.')).toBeVisible();
    await page.getByRole('tab', { name: 'Todas' }).click();
    await expect(cards).toHaveCount(3);

    // the star takes a room out of the favorites (and out of the config)
    await cards.filter({ hasText: 'Jogos do João' }).getByRole('button', { name: /Tirar Jogos do João dos favoritos/ }).click();
    await expect(cards).toHaveCount(2);
    await expect.poll(() => readConfig(a).favoriteRooms.map((f: { name: string }) => f.name)).toEqual(['Filmes de Sexta', 'Música Ao Vivo']);
  } finally {
    await a.close();
  }
});

test('the connection mode badge says how friends reach you and leads to Configurações > Rede', async () => {
  const a = await launchNext('home-mode', { name: 'Ana' }, OFFLINE);
  try {
    await a.page.getByRole('button', { name: /Modo de conexão/ }).click();
    const layer = a.page.getByTestId('settings');
    await expect(layer).toBeVisible();
    await expect(layer.getByRole('tab', { name: 'Rede' })).toHaveAttribute('aria-selected', 'true');
    await expect(layer.getByRole('heading', { name: 'Rede' })).toBeVisible();
  } finally {
    await a.close();
  }
});

test('the window uses its own title bar: the buttons minimize, maximize and close the app', async () => {
  const a = await launchNext('home-titlebar', { name: 'Ana' });
  try {
    const bar = a.page.locator('#titlebar');
    await expect(bar.getByRole('button', { name: 'Minimizar' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Maximizar' })).toBeVisible();
    const win = await a.app.evaluateHandle(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]);
    const maximized = () => win.evaluate((w) => w.isMaximized());
    expect(await maximized()).toBe(false);
    await bar.getByRole('button', { name: 'Maximizar' }).click();
    await expect.poll(maximized).toBe(true);
    await bar.getByRole('button', { name: 'Maximizar' }).click();
    await expect.poll(maximized).toBe(false);
    const closed = a.app.waitForEvent('close');
    await bar.getByRole('button', { name: 'Fechar' }).click();
    await closed;
  } finally {
    await a.close();
  }
});

test('profile: the name and the photo change on screen at once (with the crop dialog), are saved, and the photo can be removed', async () => {
  const a = await launchNext('home-profile', { name: 'Ana' }, OFFLINE);
  try {
    const page = a.page;
    await page.getByRole('button', { name: 'Editar perfil' }).first().click();
    const dialog = modal(page);
    await expect(dialog.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();
    await dialog.getByLabel('Seu nome').fill('Ana Maria');
    await dialog.getByLabel('Seu nome').blur();
    await expect.poll(() => readConfig(a).name).toBe('Ana Maria');

    // choosing a picture opens the crop dialog; "Usar esta foto" saves it
    await dialog.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await expect(page.getByText('Ajustar foto')).toBeVisible();
    await page.getByRole('button', { name: 'Usar esta foto' }).click();
    await expect.poll(() => readConfig(a).avatar).toMatch(/^data:image\/jpeg;base64,/);
    await expect(dialog.locator('img').first()).toBeVisible();

    // cancelling the crop keeps what was there
    const before = readConfig(a).avatar;
    await dialog.locator('input[type=file]').setInputFiles({ name: 'outra.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await page.getByRole('button', { name: 'Cancelar' }).last().click();
    expect(readConfig(a).avatar).toBe(before);

    await dialog.getByRole('button', { name: 'Remover' }).click();
    await expect.poll(() => readConfig(a).avatar).toBeNull();
    await dialog.getByRole('button', { name: 'Pronto' }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ana Maria');
  } finally {
    await a.close();
  }
});

test('Configurações: a layer with a tab per category, one panel at a time, back button and Esc close it, and it remembers where you were', async () => {
  const a = await launchNext('home-settings', { name: 'Ana' }, OFFLINE);
  try {
    const page = a.page;
    const layer = await openSettings(page);
    const names = ['Rede', 'Salas fixas', 'Áudio', 'Notificações', 'Transmissão', 'Câmera', 'Aparência', 'Interface', 'Sobre'];
    for (const name of names) {
      await layer.getByRole('tab', { name }).click();
      await expect(layer.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      await expect(layer.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    await closeSettings(page);
    // coming back lands on the last category
    await openSettings(page);
    await expect(page.getByTestId('settings').getByRole('tab', { name: 'Sobre' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings')).toHaveCount(0);
  } finally {
    await a.close();
  }
});

test('Configurações > Notificações: volume saved in the config, the mute button, one switch per sound and a button to hear each one', async () => {
  const a = await launchNext('home-sounds', { name: 'Ana', soundVolume: 60 }, OFFLINE);
  try {
    const page = a.page;
    const layer = await openSettings(page, 'Notificações');
    const slider = layer.locator('input[type=range]').first();
    await slider.fill('30');
    await slider.dispatchEvent('change');
    await expect.poll(() => readConfig(a).soundVolume).toBe(30);
    await expect(layer.getByText('30%')).toBeVisible();
    await layer.getByRole('button', { name: 'Silenciar as notificações' }).click();
    await expect.poll(() => readConfig(a).soundVolume).toBe(0);
    await layer.getByRole('button', { name: 'Ativar as notificações' }).click();
    await expect.poll(() => readConfig(a).soundVolume).toBe(30); // back to the level before muting

    // the play button always plays, even for a sound that is switched off
    await layer.getByRole('switch', { name: 'Alguém entra na sala' }).click();
    await expect.poll(() => readConfig(a).disabledSounds).toEqual(['peer-join']);
    await layer.getByRole('button', { name: 'Ouvir: Alguém entra na sala' }).click();
    await expect.poll(() => sounds(page)).toContain('peer-join');
    await layer.getByRole('switch', { name: 'Alguém entra na sala' }).click();
    await expect.poll(() => readConfig(a).disabledSounds).toEqual([]);

    // the notice sound: its own switch, a button to hear it and its own volume (saved apart from the general one)
    await layer.getByRole('switch', { name: 'Um aviso é publicado na sala' }).click();
    await expect.poll(() => readConfig(a).disabledSounds).toEqual(['notice']);
    await layer.getByRole('button', { name: 'Ouvir: Um aviso é publicado na sala' }).click();
    await expect.poll(() => sounds(page)).toContain('notice');
    const noticeVolume = layer.getByLabel('Volume do som de aviso');
    await noticeVolume.fill('40');
    await noticeVolume.dispatchEvent('change');
    await expect.poll(() => readConfig(a).noticeSoundVolume).toBe(40);
    expect(readConfig(a).soundVolume).toBe(30);
  } finally {
    await a.close();
  }
});

test('Configurações > Transmissão, Câmera e Áudio: every default is saved, the camera ones apart from the screen ones', async () => {
  const a = await launchNext('home-defaults', { name: 'Ana' }, OFFLINE);
  try {
    const page = a.page;
    const layer = await openSettings(page, 'Transmissão');
    await pick(page, 'Codec preferido', 'H.264');
    await pick(page, 'Resolução padrão da tela', '1440p');
    await pick(page, 'FPS padrão da tela', '60');
    await pick(page, 'Modo padrão da tela', /Detalhe/);
    await expect.poll(() => readConfig(a)).toMatchObject({ codec: 'h264', resolution: '1440p', fps: 60, mode: 'detail' });

    await layer.getByRole('tab', { name: 'Câmera' }).click();
    await pick(page, 'Resolução padrão da câmera', '1080p');
    await pick(page, 'FPS padrão da câmera', '60');
    await pick(page, 'Modo padrão da câmera', /Detalhe/);
    await expect.poll(() => readConfig(a)).toMatchObject({ cameraResolution: '1080p', cameraFps: 60, cameraMode: 'detail', resolution: '1440p' });

    await layer.getByRole('tab', { name: 'Áudio' }).click();
    const exclude = layer.getByLabel('Processo excluído do áudio');
    await expect(exclude).toHaveValue('Discord');
    await exclude.fill('Spotify');
    await exclude.blur();
    await expect.poll(() => readConfig(a).excludeAudioProcess).toBe('Spotify');
  } finally {
    await a.close();
  }
});

test('Configurações > Aparência: the accent color changes the whole interface and is remembered; the animated background and reduced motion are switches', async () => {
  const first = await launchNext('home-theme', { name: 'Ana' }, OFFLINE);
  const dir = first.dir;
  try {
    const accent = () => first.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase());
    expect(await accent()).toBe('#9cff8c'); // green until the person picks another
    const layer = await openSettings(first.page, 'Aparência');
    await expect(layer.getByRole('button', { name: 'Verde' })).toHaveAttribute('aria-pressed', 'true');
    await layer.getByRole('button', { name: 'Azul' }).click();
    await expect.poll(accent).toBe('#8cb8ff');
    await expect(layer.getByRole('button', { name: 'Azul' })).toHaveAttribute('aria-pressed', 'true');

    await layer.getByRole('switch', { name: 'Fundo animado' }).click();
    await expect(first.page.locator('html')).toHaveClass(/no-aurora/);
    await layer.getByRole('switch', { name: 'Reduzir animações' }).click();
    await expect(first.page.locator('html')).toHaveClass(/no-motion/);
    await first.app.close();

    // the same data folder: the choices are still there
    const again = await launchNext('home-theme', {}, OFFLINE, [], dir);
    try {
      await expect.poll(() => again.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase())).toBe('#8cb8ff');
      await expect(again.page.locator('html')).toHaveClass(/no-aurora/);
      await expect(again.page.locator('html')).toHaveClass(/no-motion/);
    } finally {
      await again.app.close();
    }
  } finally {
    await first.app.close().catch(() => undefined);
    await first.close();
  }
});

test('the column folds to the side: the profile and the settings move to the rail, and the choice is kept', async () => {
  const a = await launchNext('home-fold', { name: 'Ana' }, OFFLINE);
  try {
    const page = a.page;
    const side = page.locator('#sidebar');
    await expect(side).toHaveAttribute('aria-hidden', 'false');
    await page.getByRole('button', { name: 'Recolher a coluna lateral' }).click();
    await expect(side).toHaveAttribute('aria-hidden', 'true');
    const rail = page.getByRole('navigation', { name: 'Salas' });
    await expect(rail.getByRole('button', { name: 'Editar perfil' })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Configurações' })).toBeVisible();
    await rail.getByRole('button', { name: 'Configurações' }).click();
    await expect(page.getByTestId('settings')).toBeVisible();
    await closeSettings(page);
    await rail.getByRole('button', { name: 'Mostrar a coluna lateral' }).click();
    await expect(side).toHaveAttribute('aria-hidden', 'false');
  } finally {
    await a.close();
  }
});

test('REGRESSION: the status check of the saved rooms (every 20 s) must not redraw the cards when nothing changed (they used to jump and replay their entrance)', async () => {
  test.setTimeout(90_000);
  const a = await launchNext('home-no-jump', { name: 'Ana', favoriteRooms: [{ code: 'AAAAA-AAAAA@sala-um', name: 'Filmes de Sexta' }, { code: 'BBBBB-BBBBB@sala-um', name: 'Jogos do João' }] }, OFFLINE);
  try {
    const cards = a.page.locator('[data-room-card]');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('Sem resposta do servidor da sala', { timeout: 15_000 });
    // mark the very elements on screen; a redraw would replace them with new ones that do not carry the mark
    await a.page.evaluate(() => document.querySelectorAll('[data-room-card]').forEach((el) => ((el as any).__mark = true)));
    const rail = a.page.getByRole('navigation', { name: 'Salas' }).getByRole('button', { name: 'Filmes de Sexta' });
    await rail.evaluate((el) => ((el as any).__mark = true));
    await a.page.waitForTimeout(23_000); // at least one more check of the room server happened meanwhile
    expect(await a.page.evaluate(() => [...document.querySelectorAll('[data-room-card]')].every((el) => (el as any).__mark === true))).toBe(true);
    expect(await rail.evaluate((el) => (el as any).__mark === true)).toBe(true);
  } finally {
    await a.close();
  }
});

test('a toast shows an X when the pointer is over it, which closes it at once; an error toast is red, and a toast under the pointer does not time out', async () => {
  const a = await launchNext('home-toast', {}, OFFLINE);
  try {
    const page = a.page;
    const dialog = await openCreateDialog(page);
    await dialog.getByRole('button', { name: 'Criar sala' }).click(); // no name yet: an error toast
    const toast = page.locator('.toast[data-kind="warn"]').last();
    await expect(toast).toContainText('Escolha um nome de exibição primeiro.');
    // red, not the yellow of the old warning
    const red = await toast.evaluate((el) => getComputedStyle(el).borderTopColor);
    const [r, g, b] = red.match(/\d+(\.\d+)?/g)!.map(Number);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    // the X is hidden until the pointer is over the toast
    const close = toast.getByRole('button', { name: 'Fechar o aviso' });
    await expect(close).toHaveCSS('opacity', '0');
    await toast.hover();
    await expect(close).toHaveCSS('opacity', '1');
    await close.click();
    await expect(page.locator('.toast[data-kind="warn"]')).toHaveCount(0, { timeout: 2000 }); // at once, not after the 7 s
  } finally {
    await a.close();
  }
});

test('a toast under the pointer waits: it is still there after its time, and goes shortly after the pointer leaves', async () => {
  test.setTimeout(60_000);
  const a = await launchNext('home-toast-hover', {}, OFFLINE);
  try {
    const page = a.page;
    const dialog = await openCreateDialog(page);
    await dialog.getByRole('button', { name: 'Criar sala' }).click();
    const toast = page.locator('.toast[data-kind="warn"]').last();
    await expect(toast).toBeVisible();
    await toast.hover();
    await page.waitForTimeout(8000); // longer than its 7 s
    await expect(toast).toBeVisible();
    await page.mouse.move(5, 300); // away
    await expect(page.locator('.toast[data-kind="warn"]')).toHaveCount(0, { timeout: 6000 });
  } finally {
    await a.close();
  }
});
