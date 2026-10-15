import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRoom, joinRoom, launchApp, TestApp } from './app';

// The camera is a fake one made by Chromium itself (no real camera needed); the screen part needs a real desktop session, like share.spec.ts.
const FAKE_CAMERA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

const readConfig = (a: TestApp) => JSON.parse(fs.readFileSync(path.join(a.dir, 'config.json'), 'utf8'));

/** The dock sits in the player bar while a picture is open, and the bar only reacts while the pointer is over the picture. */
const overPicture = (page: Page) => page.locator('.player').hover();

test('the camera button: the first camera becomes the default and is shared at once, its own menu changes the quality, and the screen button switches without stopping', async () => {
  test.slow();
  // the camera defaults differ from the screen defaults, so the quality of the camera can be told apart
  const host = await launchApp('cam-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47853, cameraResolution: '720p', cameraFps: 30, cameraMode: 'detail', resolution: '1080p', fps: 60, mode: 'motion' }, {}, FAKE_CAMERA);
  const guest = await launchApp('cam-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);

    // nothing picked yet: the camera button shares the first camera at once, with the camera defaults, and remembers it
    const cameraBtn = host.page.locator('.dock-camera');
    await expect(cameraBtn).not.toHaveClass(/\bon\b/);
    await cameraBtn.click();
    await expect(cameraBtn).toHaveClass(/\bon\b/, { timeout: 20_000 }); // green while the camera is what is shared
    await expect.poll(() => readConfig(host).defaultCameraId, { timeout: 10_000 }).toMatch(/^camera:/);

    // the own preview opens by itself; the screen button is not red (a camera transmission leaves it as it was) and its menu is dimmed
    await expect(host.page.locator('.player-title')).toHaveText('Ana');
    await expect(host.page.locator('.dock-screen')).not.toHaveClass(/\bactive\b/);
    await expect(host.page.locator('.dock-screen')).toHaveClass(/no-menu/);

    // everybody sees the camera icon in the list, with the quality of the camera
    const anaOnGuest = guest.page.locator('.peer.live', { hasText: 'Ana' });
    await expect(anaOnGuest).toBeVisible();
    await expect(anaOnGuest.locator('.share-kind')).toHaveAttribute('title', 'Câmera');
    await expect(anaOnGuest).toContainText('720p · 30 fps');
    const anaOnHost = host.page.locator('.peer.live', { hasText: 'Ana (você)' });
    await expect(anaOnHost.locator('.share-kind')).toHaveAttribute('title', 'Câmera');

    // the guest watches: a picture arrives, and there is no audio track (a camera has no system sound)
    await anaOnGuest.click();
    const video = guest.page.locator('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(await video.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).getAudioTracks().length)).toBe(0);
    // the host's card counts the viewer
    await expect(anaOnHost.locator('.viewers-count')).toHaveText('1');

    // the participants list: the live card (icon + quality + viewers + AO VIVO) fits inside the list, with no sideways scroll
    for (const page of [guest.page, host.page]) {
      const sidebar = page.locator('.sidebar');
      expect(await sidebar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const list = (await sidebar.boundingBox())!;
      for (const card of await page.locator('.peer-row').all()) {
        const box = (await card.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(list.x + list.width + 0.5);
        expect(box.x).toBeGreaterThanOrEqual(list.x);
      }
    }

    // the camera menu: Mudar câmera and, while the camera is live, Qualidade (resolution, fps, mode) applied to the transmission
    await overPicture(host.page);
    await host.page.locator('.dock-camera .dock-chev').click();
    await expect(host.page.getByRole('menuitem', { name: /Mudar câmera/ })).toBeVisible();
    await host.page.getByRole('menuitem', { name: /Qualidade/ }).click();
    await host.page.getByRole('menuitem', { name: /Resolução/ }).click();
    await host.page.getByRole('menuitem', { name: '1080p' }).click();
    await expect(anaOnGuest).toContainText('1080p', { timeout: 15_000 });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);

    // the screen button: while the camera is shared it picks a screen and switches without stopping (the others keep the same connection)
    await overPicture(host.page);
    await host.page.locator('.dock-screen').click();
    const switchDialog = host.page.locator('.dialog.share-dialog');
    await expect(switchDialog.getByRole('heading', { name: 'Trocar a tela ou janela que você compartilha' })).toBeVisible();
    await expect(switchDialog.getByRole('tab')).toHaveText(['Telas', 'Janelas']); // cameras are not in this dialog
    await expect(switchDialog.locator('.row.wrap .select-btn')).toHaveCount(0); // quality stays as it is
    await expect(switchDialog.locator('.source-panel:not([inert]) .source').first()).toBeVisible();
    await switchDialog.getByRole('button', { name: 'Trocar', exact: true }).click();
    await expect(switchDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(anaOnGuest.locator('.share-kind')).toHaveAttribute('title', 'Tela', { timeout: 15_000 });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).getAudioTracks().filter((t) => t.readyState === 'live').length), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect(anaOnHost.locator('.viewers-count')).toHaveText('1'); // still the same single viewer
    await expect(cameraBtn).not.toHaveClass(/\bon\b/);

    // and back to the camera: the camera button asks first, because the screen share ends
    await overPicture(host.page);
    await cameraBtn.click();
    const confirm = host.page.locator('.dialog.small');
    await expect(confirm.getByRole('heading', { name: 'Trocar a tela pela câmera' })).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancelar' }).click();
    await expect(confirm).toHaveCount(0); // gone once the exit animation finishes
    await expect(anaOnGuest.locator('.share-kind')).toHaveAttribute('title', 'Tela'); // cancelled: nothing changed
    await overPicture(host.page);
    await cameraBtn.click();
    await confirm.getByRole('button', { name: 'Trocar para a câmera' }).click();
    await expect(anaOnGuest.locator('.share-kind')).toHaveAttribute('title', 'Câmera', { timeout: 15_000 });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);

    // pressing the camera button again stops the camera transmission: the list goes back to "Sem transmissão"
    await overPicture(host.page);
    await cameraBtn.click();
    await expect(anaOnGuest).toHaveCount(0);
  } finally {
    await guest.close();
    await host.close();
  }
});

test('the camera menu lists the cameras and the one picked becomes the default', async () => {
  const host = await launchApp('cam-menu', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47853 }, {}, FAKE_CAMERA);
  try {
    await createRoom(host.page);
    await host.page.locator('.dock-camera .dock-chev').click();
    await host.page.getByRole('menuitem', { name: /Mudar câmera/ }).click();
    // the fake device is listed beside the first menu, with the current default checked
    const list = host.page.locator('.dock-menu').nth(1);
    await expect(list).toBeVisible({ timeout: 15_000 });
    await expect(list.locator('.mi-check')).toHaveCount(1);
    await list.getByRole('menuitem').first().click();
    await expect.poll(() => readConfig(host).defaultCameraId, { timeout: 10_000 }).toMatch(/^camera:/);
    await expect(host.page.locator('.dock-menu')).toHaveCount(0); // the menu closes after the choice
  } finally {
    await host.close();
  }
});
