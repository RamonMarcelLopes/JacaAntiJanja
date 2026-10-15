import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, launchApp } from './app';

// Two friends share a (fake) camera each and a third person watches both at once. No real camera or screen is needed.
const FAKE_CAMERA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

test('watching two people at once: the grid shows both live pictures, a click puts one in focus, the X stops only that one, and each sharer counts its viewers', async () => {
  test.slow();
  const ana = await launchApp('mv-ana', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47856 });
  const bia = await launchApp('mv-bia', { name: 'Bia' }, {}, FAKE_CAMERA);
  const caio = await launchApp('mv-caio', { name: 'Caio' }, {}, FAKE_CAMERA);
  try {
    const code = await createRoom(ana.page);
    await joinRoom(bia.page, code);
    await joinRoom(caio.page, code);
    for (const friend of [bia, caio]) {
      await friend.page.locator('.dock-camera').click();
      await expect(friend.page.locator('.dock-camera')).toHaveClass(/\bon\b/, { timeout: 20_000 });
    }

    // nothing open: a tile per person, the live ones marked and clickable
    const live = ana.page.locator('.tile.live');
    await expect(live).toHaveCount(2, { timeout: 15_000 });
    await expect(ana.page.locator('.tile', { hasText: 'Bia' }).locator('.badge-live')).toBeVisible();

    // clicking a live tile watches that person, in focus
    await ana.page.locator('.tile', { hasText: 'Bia' }).click();
    const videos = ana.page.locator('video');
    await expect(ana.page.locator('.player-title')).toHaveText('Assistindo Bia');
    await expect.poll(() => videos.first().evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(ana.page.locator('.tiles')).toBeHidden();

    // a click on the picture shows everybody again; Bia keeps playing inside her own tile
    await videos.first().click();
    await expect(ana.page.locator('.tiles')).toBeVisible();
    await expect(ana.page.locator('.player-bar')).toBeHidden(); // no title / volume / fullscreen over the grid
    await expect(ana.page.locator('.tile.watching')).toHaveCount(1);

    // a live tile that is not watched yet adds one more picture; the first one stays
    await ana.page.locator('.tile', { hasText: 'Caio' }).click();
    await expect(ana.page.locator('.tile.watching')).toHaveCount(2, { timeout: 20_000 });
    await expect(videos).toHaveCount(2);
    for (const index of [0, 1]) {
      await expect.poll(() => videos.nth(index).evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    }

    // each sharer shows one viewer in the list (the count travels with the share)
    for (const name of ['Bia', 'Caio']) {
      await expect(ana.page.locator('.peer-row', { hasText: name }).locator('.viewers-count')).toHaveText('1', { timeout: 15_000 });
    }

    // the X on a tile stops only that person
    const caioTile = ana.page.locator('.tile', { hasText: 'Caio' });
    await caioTile.hover();
    await caioTile.getByRole('button', { name: /Parar de assistir Caio/ }).click();
    await expect(videos).toHaveCount(1);
    await expect(ana.page.locator('.tile.watching')).toHaveCount(1);
    await expect(ana.page.locator('.peer-row', { hasText: 'Caio' }).locator('.viewers-count')).toHaveText('0', { timeout: 15_000 });
    await expect(ana.page.locator('.peer-row', { hasText: 'Bia' }).locator('.viewers-count')).toHaveText('1');

    // a click on the tile of the person being watched goes back to the focus view
    await ana.page.locator('.tile.watching').click();
    await expect(ana.page.locator('.tiles')).toBeHidden();
    await expect(ana.page.locator('.player-title')).toHaveText('Assistindo Bia');

    // the stop button of the dock stops everything: the grid is back with nobody watched
    await ana.page.locator('.player').hover();
    await ana.page.locator('.dock-screen').click();
    await expect(videos).toHaveCount(0);
    await expect(ana.page.locator('.tiles')).toBeVisible();
    await expect(ana.page.locator('.tile.watching')).toHaveCount(0);
  } finally {
    await caio.close();
    await bia.close();
    await ana.close();
  }
});
