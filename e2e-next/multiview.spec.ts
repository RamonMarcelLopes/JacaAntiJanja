import { expect, Page, test } from '@playwright/test';
import { createRoom, joinRoom, launchNext } from './app';

// Two friends share a (fake) camera each and a third person watches both at once. No real camera or screen is needed.
const FAKE_CAMERA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

const tile = (page: Page, name: string) => page.locator(`.tile[data-person="${name}"]`);
const layout = (page: Page) => page.getByTestId('stage').locator('[data-layout]');

test('watching two people at once: the grid shows both live pictures, a click puts one in focus, the X stops only that one, and each sharer counts its viewers', async () => {
  test.slow();
  const ana = await launchNext('mv-ana', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47886 });
  const bia = await launchNext('mv-bia', { name: 'Bia' }, {}, FAKE_CAMERA);
  const caio = await launchNext('mv-caio', { name: 'Caio' }, {}, FAKE_CAMERA);
  try {
    const code = await createRoom(ana.page);
    await joinRoom(bia.page, code);
    await joinRoom(caio.page, code);
    for (const friend of [bia, caio]) {
      await friend.page.locator('.callbar button[aria-label="Câmera"]').click();
      await expect(friend.page.locator('.callbar button[aria-label="Câmera"]')).toHaveClass(/\bon\b/, { timeout: 20_000 });
    }

    // nothing open: a tile per person, the live ones marked and clickable
    await expect(ana.page.locator('.tile.live')).toHaveCount(2, { timeout: 15_000 });
    await expect(tile(ana.page, 'Bia').locator('.badge-live')).toBeVisible();
    await expect(layout(ana.page)).toHaveAttribute('data-layout', 'grid');

    // "Assistir" on a live tile watches that person, in focus
    await tile(ana.page, 'Bia').getByRole('button', { name: 'Assistir Bia' }).click();
    const videos = ana.page.locator('.tile video');
    await expect(layout(ana.page)).toHaveAttribute('data-layout', 'focus');
    await expect(ana.page.locator('.tile.big')).toHaveAttribute('data-person', 'Bia');
    await expect.poll(() => videos.first().evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);

    // a click on the picture shows everybody again; Bia keeps playing inside her own tile
    await tile(ana.page, 'Bia').click();
    await expect(layout(ana.page)).toHaveAttribute('data-layout', 'grid');
    await expect(ana.page.locator('.tile')).toHaveCount(3);
    await expect(videos).toHaveCount(1);

    // a live tile that is not watched yet adds one more picture to the grid; the first one stays and the grid stays (like the original interface)
    await tile(ana.page, 'Caio').getByRole('button', { name: 'Assistir Caio' }).click();
    await expect(videos).toHaveCount(2, { timeout: 20_000 });
    await expect(layout(ana.page)).toHaveAttribute('data-layout', 'grid');
    for (const index of [0, 1]) {
      await expect.poll(() => videos.nth(index).evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    }

    // each sharer shows one viewer (the count travels with the share)
    for (const name of ['Bia', 'Caio']) {
      await expect(tile(ana.page, name).getByLabel('1 assistindo')).toBeVisible({ timeout: 15_000 });
    }
    // REGRESSION: the viewer count must not push the latency numbers out of the column
    for (const name of ['Bia', 'Caio']) {
      const row = ana.page.locator('#sidebar [data-live="' + name + '"]');
      await expect(row).toBeVisible();
      const box = (await row.boundingBox())!;
      const side = (await ana.page.locator('#sidebar').boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(side.x + side.width);
    }

    // the X on a tile stops only that person
    await tile(ana.page, 'Caio').hover();
    await tile(ana.page, 'Caio').getByRole('button', { name: /Parar de assistir Caio/ }).click();
    await expect(videos).toHaveCount(1);
    await expect(tile(caio.page, 'Caio').getByLabel('0 assistindo')).toBeVisible({ timeout: 15_000 });
    await expect(tile(bia.page, 'Bia').getByLabel('1 assistindo')).toBeVisible();

    // X on a tile never changes the layout: still the grid. A click on the tile of the person being watched goes to the focus view
    await expect(layout(ana.page)).toHaveAttribute('data-layout', 'grid');
    await tile(ana.page, 'Bia').click();
    await expect(layout(ana.page)).toHaveAttribute('data-layout', 'focus');

    // in focus the picture has its own X too: closing the last one brings the grid back with nobody watched
    await tile(ana.page, 'Bia').hover();
    await tile(ana.page, 'Bia').getByRole('button', { name: /Parar de assistir Bia/ }).click();
    await expect(videos).toHaveCount(0);
    await expect(layout(ana.page)).toHaveAttribute('data-layout', 'grid');
  } finally {
    await caio.close();
    await bia.close();
    await ana.close();
  }
});
