import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, launchApp, openShareDialog, sounds, stopSharing } from './app';

// Needs a real desktop session: it captures the first screen and watches it from the second instance.
test('sharing a screen: the guest sees "AO VIVO", watches the video with audio, and it stops cleanly', async () => {
  test.slow();
  const host = await launchApp('share-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47853 });
  const guest = await launchApp('share-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);

    await openShareDialog(host.page);
    const dialog = host.page.locator('.dialog');
    await expect(dialog.locator('.source').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Compartilhar', exact: true }).click();

    await expect(host.page.getByRole('button', { name: 'Parar de compartilhar' })).toBeVisible({ timeout: 20_000 });
    const anaOnGuest = guest.page.locator('.peer.live', { hasText: 'Ana' });
    await expect(anaOnGuest).toBeVisible();
    await expect(anaOnGuest.getByText('AO VIVO')).toBeVisible();
    // sound cues: you hear yours when you start sharing, your friend hears theirs
    expect(await sounds(host.page)).toContain('self-share-start');
    await expect.poll(() => sounds(guest.page)).toContain('peer-share-start');

    await anaOnGuest.click();
    const video = guest.page.locator('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream | null)?.getAudioTracks().length ?? 0), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await expect(host.page.locator('.viewers-count')).toHaveText('1');

    // watching someone else: volume is there, and the fullscreen icon toggles between enter and exit.
    // These controls only react while the pointer is over the picture, so hover it first.
    const hoverPicture = () => guest.page.locator('.player').hover();
    await hoverPicture();
    await expect(guest.page.locator('.volume')).toBeVisible();
    // speaker icon in front of the slider, percentage on the right, and the icon mutes / unmutes
    const volumeGroup = guest.page.locator('.volume-group');
    await expect(volumeGroup.getByRole('button', { name: 'Silenciar' })).toBeVisible();
    await expect(volumeGroup.locator('.volume-pct')).toHaveText('100%');
    const slider = (await guest.page.locator('.volume').boundingBox())!;
    const pct = (await volumeGroup.locator('.volume-pct').boundingBox())!;
    const speaker = (await volumeGroup.getByRole('button').boundingBox())!;
    expect(speaker.x + speaker.width).toBeLessThanOrEqual(slider.x);
    expect(slider.x + slider.width).toBeLessThanOrEqual(pct.x + 1);
    await guest.page.locator('.volume').fill('40');
    await expect(volumeGroup.locator('.volume-pct')).toHaveText('40%');
    await volumeGroup.getByRole('button', { name: 'Silenciar' }).click();
    await expect(volumeGroup.locator('.volume-pct')).toHaveText('0%');
    await expect(volumeGroup.getByRole('button', { name: 'Ativar o som' })).toBeVisible();
    await volumeGroup.getByRole('button', { name: 'Ativar o som' }).click();
    await expect(volumeGroup.locator('.volume-pct')).toHaveText('40%'); // back to the level before muting
    // the dot is small at rest and grows while the pointer is on the bar
    // (the dot size lives in a custom property because pseudo-element styles cannot be read from the page)
    const thumbSize = () => guest.page.locator('.volume').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--thumb')));
    await hoverPicture(); // pointer on the picture but not on the bar: small dot
    await expect.poll(thumbSize).toBeLessThan(11);
    await guest.page.locator('.volume').hover();
    await expect.poll(thumbSize).toBeGreaterThan(12);
    const fs = guest.page.locator('.player-bar').getByRole('button', { name: /tela cheia/i });
    await hoverPicture();
    await expect(fs).toHaveAttribute('aria-label', 'Tela cheia');
    await fs.click();
    await expect(fs).toHaveAttribute('aria-label', 'Sair da tela cheia');
    await expect.poll(() => guest.page.evaluate(() => document.fullscreenElement?.classList.contains('player') ?? false)).toBe(true);
    // our own controls: they hide after a moment without mouse movement and return when the mouse moves
    await guest.page.mouse.move(300, 200);
    await expect(guest.page.locator('.player')).toHaveClass(/idle/, { timeout: 8000 });
    await guest.page.mouse.move(340, 230);
    await expect(guest.page.locator('.player')).not.toHaveClass(/idle/);
    await fs.click();
    await expect(fs).toHaveAttribute('aria-label', 'Tela cheia');
    await expect.poll(() => guest.page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    // the eye + counter sit beside AO VIVO in the sharer's card of the participants list, at its far right
    const side = host.page.locator('.peer-row', { hasText: 'Ana (você)' }).locator('.peer-side');
    await expect(side.locator('.viewers')).toHaveAttribute('title', /1 espectador/);
    const card = (await host.page.locator('.peer-row', { hasText: 'Ana (você)' }).boundingBox())!;
    const live = (await side.locator('.badge-live').boundingBox())!;
    const eye = (await side.locator('.viewers').boundingBox())!;
    expect(eye.x + eye.width).toBeLessThanOrEqual(live.x); // the counter is to the left of AO VIVO
    expect(card.x + card.width - (live.x + live.width)).toBeLessThan(10); // AO VIVO ends close to the card's right border
    await expect(host.page.getByText('Ninguém assistindo ainda.')).toHaveCount(0);
    await expect(host.page.getByText('Áudio do sistema sem o Discord.')).toHaveCount(0);

    // own preview: the title is the user's name, and the upload info sits behind the signal icon (hover)
    await host.page.locator('.peer.live', { hasText: 'Ana' }).click();
    await expect(host.page.locator('.player-title')).toHaveText('Ana');
    await expect(host.page.locator('.volume')).toBeHidden(); // no volume control for your own screen
    await expect(host.page.getByText('Prévia da sua tela', { exact: true })).toHaveCount(0);
    await expect(host.page.locator('.netinfo-tip')).toBeHidden();
    // the name and the signal icon (bottom left) only show while the pointer is over the picture, like the stop button and the volume
    await host.page.mouse.move(2, 2);
    await expect(host.page.locator('.pb-left')).toHaveCSS('opacity', '0');
    await host.page.locator('.player').hover();
    await expect(host.page.locator('.pb-left')).toHaveCSS('opacity', '1');
    await host.page.locator('.netinfo').hover();
    await expect(host.page.locator('.netinfo-tip')).toContainText('1 espectador');
    await expect(host.page.locator('.netinfo-tip')).toContainText('Mbps');
    await host.page.mouse.move(2, 2);
    await expect(host.page.locator('.netinfo-tip')).toBeHidden();

    // quality can be changed without dropping the stream: the chevron of the screen button opens Qualidade > Resolução > the choices
    await host.page.locator('.player').hover();
    await host.page.locator('.dock-screen .dock-chev').click();
    await host.page.getByRole('menuitem', { name: /Qualidade/ }).click();
    await host.page.getByRole('menuitem', { name: /Resolução/ }).click();
    await host.page.getByRole('menuitem', { name: '720p' }).click();
    await expect(guest.page.locator('.peer', { hasText: 'Ana' })).toContainText('720p');

    // the stop-watching button is the screen button of the dock: red with an X, centered at the bottom of the picture, shown only while the pointer is over it
    const hoverables = guest.page.locator('.pb-hover');
    await guest.page.mouse.move(2, 300);
    await expect(hoverables.first()).toHaveCSS('opacity', '0');
    await expect(hoverables.last()).toHaveCSS('opacity', '0');
    await hoverPicture();
    await expect(hoverables.first()).toHaveCSS('opacity', '1');
    await expect(hoverables.last()).toHaveCSS('opacity', '1');
    const stop = guest.page.locator('.dock-screen');
    await expect(stop).toHaveAttribute('aria-label', 'Parar de assistir');
    await expect(stop).toHaveCSS('background-color', 'rgb(255, 90, 54)');
    const pictureBox = (await guest.page.locator('.player').boundingBox())!;
    const dockBox = (await guest.page.locator('.call-dock').boundingBox())!;
    expect(Math.abs(dockBox.x + dockBox.width / 2 - (pictureBox.x + pictureBox.width / 2))).toBeLessThan(3);
    expect(dockBox.y + dockBox.height).toBeGreaterThan(pictureBox.y + pictureBox.height * 0.75);
    expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(pictureBox.y + pictureBox.height);
    await stop.click();
    await expect(guest.page.locator('video')).toHaveCount(0); // the picture is gone
    await expect(host.page.locator('.peer-row', { hasText: 'Ana (você)' }).locator('.viewers-count')).toHaveText('0');

    // the quality change above re-announces the share but must not replay the "friend started sharing" sound
    expect((await sounds(guest.page)).filter((s) => s === 'peer-share-start')).toHaveLength(1);

    await stopSharing(host.page);
    await expect.poll(() => sounds(host.page)).toContain('self-share-stop');
    await expect.poll(() => sounds(guest.page)).toContain('peer-share-stop');
    await expect(guest.page.locator('.peer.live')).toHaveCount(0);
    await expect(guest.page.locator('video')).toHaveCount(0);
  } finally {
    await guest.close();
    await host.close();
  }
});

// Needs a real desktop session too.
test('while you share a whole screen: people entering and leaving still sound, and your own screen cannot go fullscreen on the monitor it captures', async () => {
  test.slow();
  const host = await launchApp('share2-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47855 });
  const guest = await launchApp('share2-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await openShareDialog(host.page);
    const dialog = host.page.locator('.dialog');
    await expect(dialog.locator('.source').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Compartilhar', exact: true }).click();
    await expect(host.page.getByRole('button', { name: 'Parar de compartilhar' })).toBeVisible({ timeout: 20_000 });

    // entering and leaving are heard even though incoming audio is muted while a whole screen is shared
    await joinRoom(guest.page, code);
    await expect.poll(() => sounds(host.page)).toContain('peer-join');
    await guest.page.getByRole('button', { name: 'Sair' }).click();
    await expect.poll(() => sounds(host.page)).toContain('peer-leave');

    // own preview: the app window sits on the first monitor, which is also the one being shared
    await host.page.locator('.peer.live', { hasText: 'Ana' }).click();
    await host.page.locator('.player').hover();
    await host.page.locator('.player-bar').getByRole('button', { name: /tela cheia/i }).click();
    await expect(host.page.locator('.toast', { hasText: 'Mova o app para outro monitor' })).toBeVisible();
    expect(await host.page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  } finally {
    await guest.close();
    await host.close();
  }
});
