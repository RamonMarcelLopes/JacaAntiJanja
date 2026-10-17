import { expect, Page, test } from '@playwright/test';
import { createRoom, joinRoom, launchNext, modal, sounds } from './app';

// Needs a real desktop session: it captures the first screen and watches it from the second instance.

const tile = (page: Page, name: string) => page.locator(`.tile[data-person="${name}"]`);
const live = (page: Page, name: string) => page.locator(`#sidebar [data-live="${name}"]`);
/** The call bar hides in the focus view until the pointer is over the picture. */
const overStage = (page: Page) => page.getByTestId('stage').hover();

async function startScreenShare(page: Page) {
  await page.locator('.callbar').getByRole('button', { name: 'Compartilhar tela' }).click();
  const dialog = modal(page);
  await expect(dialog.locator('.source').first()).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Compartilhar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Parar de compartilhar' })).toBeVisible({ timeout: 20_000 });
}

test('sharing a screen: the guest sees "AO VIVO", watches the picture with audio, the sharer counts the viewer, and it stops cleanly', async () => {
  test.slow();
  const host = await launchNext('share-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47881 });
  const guest = await launchNext('share-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    await startScreenShare(host.page);

    // the own preview opens by itself, in focus
    await expect(tile(host.page, 'Ana').locator('video')).toBeVisible({ timeout: 15_000 });
    await expect(host.page.locator('.tile.big')).toHaveAttribute('data-person', 'Ana');
    expect(await sounds(host.page)).toContain('self-share-start');

    // the guest sees Ana live, with the quality, and is told with a sound
    await expect(live(guest.page, 'Ana')).toBeVisible();
    await expect(live(guest.page, 'Ana')).toContainText('AO VIVO');
    await expect(live(guest.page, 'Ana')).toContainText('1080p · 30 fps');
    await expect.poll(() => sounds(guest.page)).toContain('peer-share-start');
    await expect(tile(guest.page, 'Ana')).toHaveClass(/\blive\b/);

    // watching: a click on "Assistir" opens the picture in focus, with audio
    await tile(guest.page, 'Ana').getByRole('button', { name: 'Assistir Ana' }).click();
    const video = tile(guest.page, 'Ana').locator('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream | null)?.getAudioTracks().length ?? 0), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(guest.page.locator('.tile.big')).toHaveAttribute('data-person', 'Ana');
    await expect(host.page.getByLabel('1 assistindo')).toBeVisible({ timeout: 15_000 });
    await expect(live(host.page, 'Ana')).toContainText('1 assistindo');

    // volume and fullscreen of the picture (they show while the pointer is over it): the slider, the speaker that mutes and restores, the fullscreen toggle
    await tile(guest.page, 'Ana').hover();
    const controls = tile(guest.page, 'Ana').locator('.controls');
    await expect(controls.getByLabel('Volume')).toBeVisible();
    await controls.getByLabel('Volume').fill('40');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => Math.round(v.volume * 100))).toBe(40);
    await controls.getByRole('button', { name: 'Silenciar' }).click();
    await expect(controls.getByLabel('Volume')).toHaveValue('0');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.volume)).toBe(0);
    await controls.getByRole('button', { name: 'Ativar o som' }).click();
    await expect(controls.getByLabel('Volume')).toHaveValue('40'); // back to the level before muting
    await controls.getByRole('button', { name: 'Tela cheia' }).click();
    await expect.poll(() => guest.page.evaluate(() => document.fullscreenElement?.classList.contains('tile') ?? false)).toBe(true);
    await guest.page.keyboard.press('Escape');
    await expect.poll(() => guest.page.evaluate(() => document.fullscreenElement === null)).toBe(true);

    // quality can be changed without dropping the stream: the little arrow of the screen button opens Qualidade > Resolução > the choices
    await overStage(host.page);
    await host.page.locator('.callbar [aria-label="Parar de compartilhar"] .chev').click();
    await host.page.getByRole('menuitem', { name: /Qualidade/ }).click();
    await host.page.getByRole('menuitem', { name: /Resolução/ }).click();
    await host.page.getByRole('menuitem', { name: '720p' }).click();
    await expect(live(guest.page, 'Ana')).toContainText('720p', { timeout: 15_000 });

    // watching never changes the screen button: it stays "Compartilhar tela" (not red); the picture is closed by the X on it
    await overStage(guest.page);
    const share = guest.page.locator('.callbar').getByRole('button', { name: 'Compartilhar tela' });
    await expect(share).toBeEnabled();
    await expect(share).not.toHaveClass(/\bstop\b/);
    await expect(guest.page.locator('.callbar').getByRole('button', { name: 'Parar de assistir' })).toHaveCount(0);
    await tile(guest.page, 'Ana').hover();
    await tile(guest.page, 'Ana').getByRole('button', { name: 'Parar de assistir Ana' }).click();
    await expect(guest.page.locator('video')).toHaveCount(0); // the picture is gone
    await expect(host.page.getByLabel('0 assistindo')).toBeVisible({ timeout: 15_000 });

    // the quality change re-announces the share but must not replay the "friend started sharing" sound
    expect((await sounds(guest.page)).filter((s) => s === 'peer-share-start')).toHaveLength(1);

    await overStage(host.page);
    await host.page.getByRole('button', { name: 'Parar de compartilhar' }).click();
    await expect.poll(() => sounds(host.page)).toContain('self-share-stop');
    await expect.poll(() => sounds(guest.page)).toContain('peer-share-stop');
    await expect(live(guest.page, 'Ana')).toHaveCount(0);
    await expect(guest.page.locator('video')).toHaveCount(0);
  } finally {
    await guest.close();
    await host.close();
  }
});

test('while you share a whole screen: people entering and leaving still sound, and your own screen cannot go fullscreen on the monitor it captures', async () => {
  test.slow();
  const host = await launchNext('share2-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47882 });
  const guest = await launchNext('share2-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await startScreenShare(host.page);

    // entering and leaving are heard even though incoming audio is muted while a whole screen is shared
    await joinRoom(guest.page, code);
    await expect.poll(() => sounds(host.page)).toContain('peer-join');
    await guest.page.getByRole('button', { name: 'Sair da sala' }).first().click();
    await expect.poll(() => sounds(host.page)).toContain('peer-leave');

    // own preview: the app window sits on the first monitor, which is also the one being shared
    await tile(host.page, 'Ana').hover();
    await tile(host.page, 'Ana').getByRole('button', { name: 'Tela cheia' }).click();
    await expect(host.page.locator('.toast', { hasText: 'Mova o app para outro monitor' })).toBeVisible();
    expect(await host.page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  } finally {
    await guest.close();
    await host.close();
  }
});

test('the picture of the person being watched can be put away with a click (grid) and brought back (focus); the grid shows the live picture inside the tile', async () => {
  test.slow();
  const host = await launchNext('share3-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47883 });
  const guest = await launchNext('share3-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    await startScreenShare(host.page);
    await tile(guest.page, 'Ana').getByRole('button', { name: 'Assistir Ana' }).click();
    await expect.poll(() => tile(guest.page, 'Ana').locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    const stage = guest.page.getByTestId('stage');
    await expect(stage.locator('[data-layout]')).toHaveAttribute('data-layout', 'focus');

    // one click on the picture shows everybody; Ana keeps playing in her tile
    await tile(guest.page, 'Ana').click();
    await expect(stage.locator('[data-layout]')).toHaveAttribute('data-layout', 'grid');
    await expect(guest.page.locator('.tile')).toHaveCount(2);
    await expect.poll(() => tile(guest.page, 'Ana').locator('video').evaluate((v: HTMLVideoElement) => !v.paused && v.videoWidth > 0)).toBe(true);
    // and one more click brings it back to the focus
    await tile(guest.page, 'Ana').click();
    await expect(stage.locator('[data-layout]')).toHaveAttribute('data-layout', 'focus');
    await expect(guest.page.locator('.tile.big')).toHaveAttribute('data-person', 'Ana');
  } finally {
    await guest.close();
    await host.close();
  }
});

test('REGRESSION: while watching somebody you can start your own screen without closing theirs, and it does not take the focus', async () => {
  test.slow();
  const host = await launchNext('watch-share-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47898 }, {}, ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']);
  const guest = await launchNext('watch-share-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    await host.page.locator('.callbar button[aria-label="Câmera"]').click();
    await tile(guest.page, 'Ana').getByRole('button', { name: 'Assistir Ana' }).click();
    await expect(guest.page.locator('.tile.big')).toHaveAttribute('data-person', 'Ana', { timeout: 20_000 });

    // the screen button is the plain "Compartilhar tela" (not red) and opens the share dialog: Ana's picture stays open
    await startScreenShare(guest.page);
    await expect(live(host.page, 'Bia')).toBeVisible({ timeout: 15_000 });
    await expect(guest.page.locator('.tile.big')).toHaveAttribute('data-person', 'Ana');
    await expect(tile(guest.page, 'Ana').locator('video')).toBeVisible();
  } finally {
    await guest.close();
    await host.close();
  }
});
