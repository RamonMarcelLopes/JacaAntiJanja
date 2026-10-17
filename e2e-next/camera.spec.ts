import { expect, Page, test } from '@playwright/test';
import { createRoom, joinRoom, launchNext, modal, readConfig } from './app';

// The camera is a fake one made by Chromium itself (no real camera needed); the screen part needs a real desktop session, like share.spec.ts.
const FAKE_CAMERA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

const tile = (page: Page, name: string) => page.locator(`.tile[data-person="${name}"]`);
const live = (page: Page, name: string) => page.locator(`#sidebar [data-live="${name}"]`);
const overStage = (page: Page) => page.getByTestId('stage').hover();
const cameraBtn = (page: Page) => page.locator('.callbar button[aria-label="Câmera"]');

test('the camera button: the first camera becomes the default and is shared at once, its own menu changes the quality, and the screen button switches without stopping', async () => {
  test.slow();
  // the camera defaults differ from the screen defaults, so the quality of the camera can be told apart
  const host = await launchNext('cam-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47884, cameraResolution: '720p', cameraFps: 30, cameraMode: 'detail', resolution: '1080p', fps: 60, mode: 'motion' }, {}, FAKE_CAMERA);
  const guest = await launchNext('cam-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);

    // nothing picked yet: the camera button shares the first camera at once, with the camera defaults, and remembers it
    await expect(cameraBtn(host.page)).not.toHaveClass(/\bon\b/);
    await cameraBtn(host.page).click();
    await expect(cameraBtn(host.page)).toHaveClass(/\bon\b/, { timeout: 20_000 }); // lit while the camera is what is shared
    await expect.poll(() => readConfig(host).defaultCameraId, { timeout: 10_000 }).toMatch(/^camera:/);

    // the own preview opens by itself; the screen button is not red (a camera transmission leaves it as it was) and its arrow is dimmed
    await expect(host.page.locator('.tile.big')).toHaveAttribute('data-person', 'Ana');
    await expect(host.page.locator('.callbar button[aria-label="Compartilhar tela"]')).not.toHaveClass(/\bstop\b/);
    await expect(host.page.locator('.callbar button[aria-label="Compartilhar tela"] .chev')).toHaveClass(/opacity-45/);

    // everybody sees the camera with the quality of the camera
    await expect(live(guest.page, 'Ana')).toContainText('720p · 30 fps');
    await expect(live(host.page, 'Ana')).toContainText('Ana (você)');

    // a person who is live has the profile menu too (REGRESSION: only the people without a transmission had it)
    const liveRow = live(guest.page, 'Ana').locator('..');
    await liveRow.hover();
    await liveRow.getByRole('button', { name: 'Opções do perfil de Ana' }).click();
    await guest.page.locator('.peer-menu').getByRole('menuitem', { name: 'Ver perfil' }).click();
    await expect(modal(guest.page).getByRole('heading', { name: 'Ana' })).toBeVisible();
    await modal(guest.page).getByRole('button', { name: 'Fechar' }).click();
    await expect(modal(guest.page)).toHaveCount(0);

    // the guest watches: a picture arrives, and there is no audio track (a camera has no system sound)
    await tile(guest.page, 'Ana').getByRole('button', { name: 'Assistir Ana' }).click();
    const video = tile(guest.page, 'Ana').locator('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(await video.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).getAudioTracks().length)).toBe(0);
    await expect(host.page.getByLabel('1 assistindo')).toBeVisible({ timeout: 15_000 }); // the host's tile counts the viewer

    // the column fits its width, with no sideways scroll
    for (const page of [guest.page, host.page]) {
      expect(await page.locator('#sidebar .scroll-fade').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }

    // the camera menu: Mudar câmera and, while the camera is live, Qualidade (resolution, fps, mode) applied to the transmission
    await overStage(host.page);
    await cameraBtn(host.page).locator('.chev').click();
    await expect(host.page.getByRole('menuitem', { name: /Mudar câmera/ })).toBeVisible();
    await host.page.getByRole('menuitem', { name: /Qualidade/ }).click();
    await host.page.getByRole('menuitem', { name: /Resolução/ }).click();
    await host.page.getByRole('menuitem', { name: '1080p' }).click();
    await expect(live(guest.page, 'Ana')).toContainText('1080p', { timeout: 15_000 });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);

    // the screen button: while the camera is shared it picks a screen and switches without stopping (the others keep the same connection)
    await overStage(host.page);
    await host.page.locator('.callbar button[aria-label="Compartilhar tela"]').click();
    const switchDialog = modal(host.page);
    await expect(switchDialog.getByRole('heading', { name: 'Trocar a tela ou janela que você compartilha' })).toBeVisible();
    await expect(switchDialog.getByRole('tab')).toHaveText(['Telas', 'Janelas']); // cameras are not in this dialog
    await expect(switchDialog.getByRole('radiogroup')).toHaveCount(0); // quality stays as it is
    await expect(switchDialog.locator('.source').first()).toBeVisible({ timeout: 20_000 });
    await switchDialog.getByRole('button', { name: 'Trocar', exact: true }).click();
    await expect(modal(host.page)).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).getAudioTracks().filter((t) => t.readyState === 'live').length), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(host.page.getByLabel('1 assistindo')).toBeVisible(); // still the same single viewer
    await expect(cameraBtn(host.page)).not.toHaveClass(/\bon\b/);

    // and back to the camera: the camera button asks first, because the screen share ends
    await overStage(host.page);
    await cameraBtn(host.page).click();
    const confirm = modal(host.page);
    await expect(confirm.getByRole('heading', { name: 'Trocar a tela pela câmera' })).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancelar' }).click();
    await expect(modal(host.page)).toHaveCount(0); // gone once the exit animation finishes
    await expect(cameraBtn(host.page)).not.toHaveClass(/\bon\b/); // cancelled: nothing changed
    await overStage(host.page);
    await cameraBtn(host.page).click();
    await modal(host.page).getByRole('button', { name: 'Trocar para a câmera' }).click();
    await expect(cameraBtn(host.page)).toHaveClass(/\bon\b/, { timeout: 20_000 });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);

    // pressing the camera button again stops the camera transmission: nobody is live any more
    await overStage(host.page);
    await cameraBtn(host.page).click();
    await expect(live(guest.page, 'Ana')).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await guest.close();
    await host.close();
  }
});

test('the camera menu lists the cameras and the one picked becomes the default', async () => {
  const host = await launchNext('cam-menu', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47885 }, {}, FAKE_CAMERA);
  try {
    await createRoom(host.page);
    await cameraBtn(host.page).locator('.chev').click();
    await host.page.getByRole('menuitem', { name: /Mudar câmera/ }).click();
    // the fake device is listed beside the first menu
    const list = host.page.locator('.menu').nth(1);
    await expect(list).toBeVisible({ timeout: 15_000 });
    await expect(list.getByRole('menuitem')).not.toHaveCount(0);
    await list.getByRole('menuitem').first().click();
    await expect.poll(() => readConfig(host).defaultCameraId, { timeout: 10_000 }).toMatch(/^camera:/);
    await expect(host.page.locator('.menu')).toHaveCount(0); // the menu closes after the choice
  } finally {
    await host.close();
  }
});

test('Configurações > Câmera lists the cameras and keeps the default that was picked', async () => {
  const a = await launchNext('cam-settings', { name: 'Ana' }, {}, FAKE_CAMERA);
  try {
    await a.page.getByRole('button', { name: 'Configurações' }).first().click();
    await a.page.getByTestId('settings').getByRole('tab', { name: 'Câmera' }).click();
    // the first camera becomes the default as soon as the list is read
    await expect.poll(() => readConfig(a).defaultCameraId, { timeout: 15_000 }).toMatch(/^camera:/);
    await expect(a.page.getByRole('combobox', { name: 'Câmera padrão' })).not.toContainText('Nenhuma escolhida');
  } finally {
    await a.close();
  }
});

test('the camera has its own Qualidade menu, even with the camera off: it changes the camera defaults and leaves the screen ones alone', async () => {
  const host = await launchNext('cam-quality', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47889, resolution: '720p', fps: 30, mode: 'motion', cameraResolution: '720p', cameraFps: 30, cameraMode: 'motion' }, {}, FAKE_CAMERA);
  try {
    await createRoom(host.page);
    await host.page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    await cameraBtn(host.page).locator('.chev').click();
    await expect(host.page.getByRole('menuitem', { name: /Mudar câmera/ })).toBeVisible();
    await host.page.getByRole('menuitem', { name: /Qualidade/ }).click();
    await expect(host.page.getByRole('menuitem', { name: /Resolução/ })).toContainText('720p');
    await host.page.getByRole('menuitem', { name: /Resolução/ }).click();
    await host.page.getByRole('menuitem', { name: '1080p' }).click();
    await expect.poll(() => readConfig(host).cameraResolution).toBe('1080p');
    expect(readConfig(host).resolution).toBe('720p'); // the screen default is another setting

    // the other two choices of the camera (the menu that was closed finishes its exit animation first)
    await expect(host.page.locator('.menu')).toHaveCount(0);
    await cameraBtn(host.page).locator('.chev').click();
    await host.page.getByRole('menuitem', { name: /Qualidade/ }).click();
    await host.page.getByRole('menuitem', { name: /FPS/ }).click();
    await host.page.getByRole('menuitem', { name: '60 fps' }).click();
    await expect.poll(() => readConfig(host).cameraFps).toBe(60);
    expect(readConfig(host).fps).toBe(30);
  } finally {
    await host.close();
  }
});
