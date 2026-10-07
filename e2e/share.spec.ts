import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, launchApp } from './app';

// Needs a real desktop session: it captures the first screen and watches it from the second instance.
test('sharing a screen: the guest sees "AO VIVO", watches the video with audio, and it stops cleanly', async () => {
  test.slow();
  const host = await launchApp('share-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47853 });
  const guest = await launchApp('share-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);

    await host.page.getByRole('button', { name: 'Compartilhar tela' }).click();
    const dialog = host.page.locator('.dialog');
    await expect(dialog.locator('.source').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Compartilhar', exact: true }).click();

    await expect(host.page.getByRole('button', { name: 'Parar de compartilhar' })).toBeVisible({ timeout: 20_000 });
    const anaOnGuest = guest.page.locator('.peer.live', { hasText: 'Ana' });
    await expect(anaOnGuest).toBeVisible();
    await expect(anaOnGuest.getByText('AO VIVO')).toBeVisible();

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
    // the eye + counter sit at the far right of the controls bar
    const bar = (await host.page.locator('.controls').boundingBox())!;
    const eye = (await host.page.locator('.viewers').boundingBox())!;
    expect(bar.x + bar.width - (eye.x + eye.width)).toBeLessThan(16);
    await expect(host.page.locator('.viewers')).toHaveAttribute('title', /1 espectador/);
    await expect(host.page.getByText('Ninguém assistindo ainda.')).toHaveCount(0);
    await expect(host.page.getByText('Áudio do sistema sem o Discord.')).toHaveCount(0);

    // own preview: the title is the user's name, and the upload info sits behind the signal icon (hover)
    await host.page.locator('.peer.live', { hasText: 'Ana' }).click();
    await expect(host.page.locator('.player-title')).toHaveText('Ana');
    await expect(host.page.locator('.volume')).toBeHidden(); // no volume control for your own screen
    await expect(host.page.getByText('Prévia da sua tela')).toHaveCount(0);
    await expect(host.page.locator('.netinfo-tip')).toBeHidden();
    await host.page.locator('.netinfo').hover();
    await expect(host.page.locator('.netinfo-tip')).toContainText('1 espectador');
    await expect(host.page.locator('.netinfo-tip')).toContainText('Mbps');
    await host.page.mouse.move(2, 2);
    await expect(host.page.locator('.netinfo-tip')).toBeHidden();

    // quality can be changed without dropping the stream
    await host.page.locator('.controls .select-btn').first().click();
    await host.page.getByRole('option', { name: '720p' }).click();
    await expect(host.page.locator('.controls .select-btn').first()).toHaveAttribute('data-value', '720p');
    await expect(guest.page.locator('.peer', { hasText: 'Ana' })).toContainText('720p');

    // the stop-watching button: icon only, red, centered at the bottom of the picture, shown only while the pointer is over it
    const hoverables = guest.page.locator('.pb-hover');
    await guest.page.mouse.move(2, 300);
    await expect(hoverables.first()).toHaveCSS('opacity', '0');
    await expect(hoverables.last()).toHaveCSS('opacity', '0');
    await hoverPicture();
    await expect(hoverables.first()).toHaveCSS('opacity', '1');
    await expect(hoverables.last()).toHaveCSS('opacity', '1');
    const stop = guest.page.locator('.stop-btn');
    await expect(stop).toHaveAttribute('aria-label', 'Parar de assistir');
    await expect(stop).toHaveText('');
    await expect(stop).toHaveCSS('color', 'rgb(255, 90, 54)');
    const pictureBox = (await guest.page.locator('.player').boundingBox())!;
    const stopBox = (await stop.boundingBox())!;
    expect(Math.abs(stopBox.x + stopBox.width / 2 - (pictureBox.x + pictureBox.width / 2))).toBeLessThan(3);
    expect(stopBox.y + stopBox.height).toBeGreaterThan(pictureBox.y + pictureBox.height * 0.75);
    expect(stopBox.y + stopBox.height).toBeLessThanOrEqual(pictureBox.y + pictureBox.height);
    await stop.click();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.srcObject === null)).toBe(true);
    await expect(host.page.locator('.viewers-count')).toHaveText('0');

    await host.page.getByRole('button', { name: 'Parar de compartilhar' }).click();
    await expect(guest.page.locator('.peer.live')).toHaveCount(0);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.srcObject === null)).toBe(true);
  } finally {
    await guest.close();
    await host.close();
  }
});
