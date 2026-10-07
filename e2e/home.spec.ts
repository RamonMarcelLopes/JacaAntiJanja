import { expect, test } from '@playwright/test';
import { launchApp, PNG_1X1 } from './app';

test('first run: typing a name and creating a room works (no stale config)', async () => {
  // No name saved yet, like a fresh install.
  const a = await launchApp('first-run', { port: 47851, hostAddressOverride: '127.0.0.1' });
  try {
    await expect(a.page.getByPlaceholder('Seu nome')).toHaveValue('');
    await a.page.getByPlaceholder('Seu nome').fill('Ramon');
    await a.page.getByRole('button', { name: 'Criar sala' }).click();
    await expect(a.page.locator('.code-chip code')).toBeVisible({ timeout: 20_000 });
    // empty room name falls back to "Sala de <name>"
    await expect(a.page.getByRole('heading', { name: 'Sala de Ramon' })).toBeVisible();
  } finally {
    await a.close();
  }
});

test('creating a room without a name asks for one instead of failing', async () => {
  const a = await launchApp('no-name', { port: 47851, hostAddressOverride: '127.0.0.1' });
  try {
    await a.page.getByRole('button', { name: 'Criar sala' }).click();
    await expect(a.page.locator('.toast.error')).toContainText('Escolha um nome');
    await expect(a.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible();
  } finally {
    await a.close();
  }
});

test('text cannot be selected anywhere except in inputs', async () => {
  const a = await launchApp('select', { name: 'Ramon' });
  try {
    const selectedAfterSelectAll = await a.page.evaluate(() => {
      document.execCommand('selectAll');
      return window.getSelection()!.toString();
    });
    expect(selectedAfterSelectAll).toBe('');

    const fromInput = await a.page.evaluate(() => {
      window.getSelection()!.removeAllRanges();
      const input = document.querySelector<HTMLInputElement>('.profile-fields input[type=text]')!;
      input.focus();
      input.select();
      return input.value.slice(input.selectionStart!, input.selectionEnd!);
    });
    expect(fromInput).toBe('Ramon');
  } finally {
    await a.close();
  }
});

test('profile photo changes on screen immediately and can be removed', async () => {
  const a = await launchApp('avatar', { name: 'Ramon' });
  try {
    const photo = a.page.locator('.avatar-holder img');
    await expect(photo).toHaveCount(0);
    await a.page.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await expect(photo).toBeVisible();
    await a.page.getByRole('button', { name: 'Remover' }).click();
    await expect(photo).toHaveCount(0);
  } finally {
    await a.close();
  }
});

test('settings has a left sidebar with an icon and a name per category, one panel at a time', async () => {
  const a = await launchApp('settings', { name: 'Ramon' });
  try {
    await a.page.getByRole('button', { name: 'Configurações' }).click();
    const tabs = a.page.getByRole('tab');
    await expect(tabs).toHaveText(['Rede', 'Áudio', 'Transmissão', 'Sobre']);
    for (const tab of await tabs.all()) await expect(tab.locator('svg')).toHaveCount(1); // every entry has an icon

    // the sidebar is on the left of the content
    const navBox = (await a.page.locator('.settings-nav').boundingBox())!;
    const contentBox = (await a.page.locator('.settings-content').boundingBox())!;
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(contentBox.x + 1);

    // starts on "Rede": only its panel is visible
    await expect(a.page.getByRole('tab', { name: 'Rede' })).toHaveAttribute('aria-selected', 'true');
    await expect(a.page.getByText('Porta do servidor')).toBeVisible();
    await expect(a.page.getByRole('heading', { name: 'Sobre' })).toBeHidden();

    await a.page.getByRole('tab', { name: 'Áudio' }).click();
    await expect(a.page.getByText('Excluir do áudio compartilhado')).toBeVisible();
    await expect(a.page.getByText('Porta do servidor')).toBeHidden();

    await a.page.getByRole('tab', { name: 'Transmissão' }).click();
    await expect(a.page.getByText('Codec preferido')).toBeVisible();
    // dropdowns are our own: split pill (text centered on the left, divider, chevron segment) that opens a styled list
    const codec = a.page.locator('.settings-content .select-btn').first();
    await expect(codec).toHaveAttribute('data-value', 'auto');
    await expect(codec).toHaveCSS('padding-right', '50px');
    await expect(codec).toHaveCSS('justify-content', 'center');
    await expect(codec).toHaveCSS('background-image', /data:image\/svg\+xml/);
    await codec.click();
    await expect(a.page.getByRole('listbox')).toBeVisible();
    await expect(a.page.getByRole('option')).toHaveText(['Automático', 'VP9', 'H.264', 'AV1']);
    await expect(a.page.getByRole('option', { name: 'Automático' })).toHaveAttribute('aria-selected', 'true');
    await a.page.keyboard.press('Escape');
    await expect(a.page.getByRole('listbox')).toHaveCount(0);
    await codec.click();
    await a.page.getByRole('option', { name: 'VP9' }).click();
    await expect(a.page.getByRole('listbox')).toHaveCount(0);
    await expect(codec).toHaveAttribute('data-value', 'vp9');
    await codec.focus();
    await a.page.keyboard.press('ArrowDown'); // opens
    await a.page.keyboard.press('ArrowDown'); // moves to H.264
    await a.page.keyboard.press('Enter');
    await expect(codec).toHaveAttribute('data-value', 'h264');

    await a.page.getByRole('tab', { name: 'Sobre' }).click();
    await expect(a.page.getByText(/^Versão \d+\.\d+\.\d+/)).toBeVisible();
    // not packaged in tests, so updates are reported as unavailable instead of hitting GitHub
    await a.page.getByRole('button', { name: 'Verificar atualizações' }).click();
    await expect(a.page.getByText('Atualizações só funcionam no app instalado.')).toBeVisible();

    // arrow keys move between categories, and the last one is remembered when coming back
    await a.page.getByRole('tab', { name: 'Sobre' }).focus();
    await a.page.keyboard.press('ArrowDown');
    await expect(a.page.getByRole('tab', { name: 'Rede' })).toHaveAttribute('aria-selected', 'true');
    await a.page.getByRole('tab', { name: 'Áudio' }).click();
    await a.page.getByRole('button', { name: 'Voltar' }).click();
    await a.page.getByRole('button', { name: 'Configurações' }).click();
    await expect(a.page.getByRole('tab', { name: 'Áudio' })).toHaveAttribute('aria-selected', 'true');
  } finally {
    await a.close();
  }
});

test('the window uses our own title bar instead of the native one', async () => {
  const a = await launchApp('titlebar', { name: 'Ramon' });
  try {
    // no native frame: the window and its content area have the same size
    const sizes = await a.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { frame: w.getBounds(), content: w.getContentBounds() };
    });
    expect(sizes.frame.width).toBe(sizes.content.width);
    expect(sizes.frame.height).toBe(sizes.content.height);

    const bar = a.page.locator('#titlebar');
    await expect(bar).toBeVisible();
    await expect(bar.getByText('Jaca anti Janja')).toBeVisible();
    await expect(bar.locator('img')).toBeVisible();
    await expect(bar.getByRole('button')).toHaveCount(3);

    const isMaximized = () => a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
    const before = await isMaximized();
    await bar.getByRole('button', { name: before ? 'Restaurar' : 'Maximizar' }).click();
    await expect.poll(isMaximized).toBe(!before);
    // the button swaps between maximize and restore
    await expect(bar.getByRole('button', { name: before ? 'Maximizar' : 'Restaurar' })).toBeVisible();
    await bar.getByRole('button', { name: before ? 'Maximizar' : 'Restaurar' }).click();
    await expect.poll(isMaximized).toBe(before);

    // minimize, then bring the window back so the test can go on
    await bar.getByRole('button', { name: 'Minimizar' }).click();
    await expect.poll(() => a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
    await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  } finally {
    await a.close();
  }
});

test('the close button of our title bar closes the app', async () => {
  const a = await launchApp('titlebar-close', { name: 'Ramon' });
  try {
    const closed = a.app.waitForEvent('close');
    await a.page.locator('#titlebar').getByRole('button', { name: 'Fechar' }).click();
    await closed;
  } finally {
    await a.close();
  }
});

test('moving between screens slides instead of cutting, both ways', async () => {
  const a = await launchApp('slide', { name: 'Ramon' });
  try {
    // watch the root for the "transitioning" class (the slide only lasts a fraction of a second)
    await a.page.evaluate(() => {
      (window as any).__slides = [];
      new MutationObserver(() => {
        const app = document.getElementById('app')!;
        if (app.classList.contains('transitioning')) {
          const classes = [...app.children].map((c) => c.className).join(' | ');
          (window as any).__slides.push(classes);
        }
      }).observe(document.getElementById('app')!, { attributes: true, childList: true, subtree: true, attributeFilter: ['class'] });
    });
    const slides = () => a.page.evaluate(() => ((window as any).__slides as string[]).join(' || '));
    const settled = async () => {
      await expect(a.page.locator('#app')).not.toHaveClass(/transitioning/);
      await expect(a.page.locator('#app > .screen')).toHaveCount(1); // the old screen is removed when the slide ends
    };

    await a.page.getByRole('button', { name: 'Configurações' }).click();
    await settled();
    await expect(a.page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
    expect(await slides()).toMatch(/enter-from-left/); // Settings comes in from the left (left to right)
    expect(await slides()).toMatch(/leave-to-right/);

    await a.page.evaluate(() => ((window as any).__slides = []));
    await a.page.getByRole('button', { name: 'Voltar' }).click();
    await settled();
    await expect(a.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible();
    expect(await slides()).toMatch(/enter-from-right/); // coming back from Settings, Home comes in from the right
    expect(await slides()).toMatch(/leave-to-left/);
  } finally {
    await a.close();
  }
});
