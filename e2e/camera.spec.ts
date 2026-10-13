import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, launchApp } from './app';

// The camera is a fake one made by Chromium itself (no real camera needed); the screen part needs a real desktop session, like share.spec.ts.
const FAKE_CAMERA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

test('sharing the camera: the tab with the camera, its own quality defaults, the icon for everybody, and switching to a screen and back without stopping', async () => {
  test.slow();
  // the camera defaults differ from the screen defaults, so the dialog can be seen changing between them
  const host = await launchApp('cam-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47853, cameraResolution: '720p', cameraFps: 30, cameraMode: 'detail', resolution: '1080p', fps: 60, mode: 'motion' }, {}, FAKE_CAMERA);
  const guest = await launchApp('cam-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);

    await host.page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
    const dialog = host.page.locator('.dialog.share-dialog');
    const quality = dialog.locator('.row.wrap .select-btn');

    // screens first, with the screen defaults
    await expect(dialog.getByRole('tab')).toHaveText(['Telas', 'Janelas', 'Câmeras']);
    await expect(quality.nth(0)).toHaveAttribute('data-value', '1080p');
    await expect(quality.nth(1)).toHaveAttribute('data-value', '60');
    await expect(quality.nth(2)).toHaveAttribute('data-value', 'motion');

    // the camera tab lists the camera (a card with an icon, no picture) and brings the camera defaults
    await dialog.getByRole('tab', { name: 'Câmeras' }).click();
    await expect(dialog.locator('.seg')).toHaveAttribute('data-pos', '2');
    const cameraCard = dialog.locator('.source-panel:not([inert]) .source');
    await expect(cameraCard.first()).toBeVisible({ timeout: 15_000 });
    await expect(cameraCard.first().locator('.cam-icon')).toBeVisible();
    await expect(cameraCard.first().locator('img')).toHaveCount(0);
    await expect(dialog.locator('.source.selected')).toHaveCount(1);
    await expect(quality.nth(0)).toHaveAttribute('data-value', '720p');
    await expect(quality.nth(1)).toHaveAttribute('data-value', '30');
    await expect(quality.nth(2)).toHaveAttribute('data-value', 'detail');
    // going back to the screens brings the screen defaults back
    await dialog.getByRole('tab', { name: 'Telas' }).click();
    await expect(quality.nth(0)).toHaveAttribute('data-value', '1080p');
    await dialog.getByRole('tab', { name: 'Câmeras' }).click();
    await expect(quality.nth(0)).toHaveAttribute('data-value', '720p');

    await dialog.getByRole('button', { name: 'Compartilhar', exact: true }).click();
    await expect(host.page.getByRole('button', { name: 'Parar de compartilhar' })).toBeVisible({ timeout: 20_000 });

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

    // the participants list: the selected live card (icon + quality + AO VIVO) fits inside the list, with no sideways scroll
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
    const selected = (await guest.page.locator('.peer.selected').boundingBox())!;
    const guestSidebar = (await guest.page.locator('.sidebar').boundingBox())!;
    expect(selected.x + selected.width).toBeLessThan(guestSidebar.x + guestSidebar.width - 4); // the yellow border keeps a margin to the edge

    // the host looks at their own picture; the switch button sits next to "stop watching" and only exists while sharing
    await anaOnHost.click();
    await host.page.locator('.player').hover();
    const switchBtn = host.page.getByRole('button', { name: 'Trocar a tela ou a câmera' });
    await expect(switchBtn).toBeVisible();
    await expect(host.page.getByRole('button', { name: 'Parar de assistir' })).toBeVisible();
    const stopBox = (await host.page.getByRole('button', { name: 'Parar de assistir' }).boundingBox())!;
    const switchBox = (await switchBtn.boundingBox())!;
    expect(switchBox.x).toBeGreaterThan(stopBox.x); // to the right of the stop button
    expect(Math.abs(switchBox.y - stopBox.y)).toBeLessThan(6); // on the same line

    // switch to the screen: the others keep watching (same connection), the icon turns into a monitor and the audio track appears
    await switchBtn.click();
    const switchDialog = host.page.locator('.dialog.share-dialog');
    await expect(switchDialog.getByRole('heading', { name: 'Trocar o que você compartilha' })).toBeVisible();
    await expect(switchDialog.locator('.row.wrap .select-btn')).toHaveCount(0); // quality stays as it is
    await switchDialog.getByRole('tab', { name: 'Telas' }).click();
    await expect(switchDialog.locator('.source-panel:not([inert]) .source').first()).toBeVisible();
    await switchDialog.getByRole('button', { name: 'Trocar', exact: true }).click();
    await expect(switchDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(anaOnGuest.locator('.share-kind')).toHaveAttribute('title', 'Tela', { timeout: 15_000 });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).getAudioTracks().filter((t) => t.readyState === 'live').length), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect(host.page.locator('.viewers-count')).toHaveText('1'); // still the same single viewer

    // and back to the camera
    await host.page.locator('.player').hover();
    await host.page.getByRole('button', { name: 'Trocar a tela ou a câmera' }).click();
    await switchDialog.getByRole('tab', { name: 'Câmeras' }).click();
    await expect(switchDialog.locator('.source-panel:not([inert]) .source').first()).toBeVisible({ timeout: 15_000 });
    await switchDialog.getByRole('button', { name: 'Trocar', exact: true }).click();
    await expect(switchDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(anaOnGuest.locator('.share-kind')).toHaveAttribute('title', 'Câmera', { timeout: 15_000 });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);

    // stopping: the list goes back to "Sem transmissão"
    await host.page.getByRole('button', { name: 'Parar de compartilhar' }).click();
    await expect(anaOnGuest).toHaveCount(0);
  } finally {
    await guest.close();
    await host.close();
  }
});
