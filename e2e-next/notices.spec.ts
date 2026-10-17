import { expect, Page, test } from '@playwright/test';
import { createRoom, joinRoom, launchNext, modal, sounds } from './app';

const chip = (page: Page) => page.getByTestId('notice-chip');
/** The list of notices: only the chip opens it, and it has no form. */
const openList = async (page: Page) => {
  await chip(page).click();
  await expect(modal(page).getByRole('heading', { name: 'Avisos da sala' })).toBeVisible();
  await expect(modal(page).getByLabel('Texto do aviso')).toHaveCount(0); // a notice is never created from here
  return modal(page);
};
const closeDialog = async (page: Page) => {
  await modal(page).getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.locator('.backdrop')).toHaveCount(0);
};
/** Pins a notice from the megaphone of the top bar; the dialog closes by itself once it is published. */
const publish = async (page: Page, text: string, hours: string, minutes: string) => {
  await page.getByRole('button', { name: 'Novo aviso', exact: true }).click();
  const d = modal(page);
  await expect(d.getByRole('heading', { name: 'Novo aviso' })).toBeVisible();
  await d.getByLabel('Texto do aviso').fill(text);
  await d.getByLabel('Horas', { exact: true }).fill(hours);
  await d.getByLabel('Minutos', { exact: true }).fill(minutes);
  await d.getByTestId('notice-publish').click();
  await expect(page.locator('.backdrop')).toHaveCount(0);
};

test('room notices: anybody pins one for everybody, a newcomer receives it, others close it only for themselves, the author removes it for all', async () => {
  test.slow();
  const host = await launchNext('notice-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47891 });
  const guest = await launchNext('notice-guest', { name: 'Bia' });
  const late = await launchNext('notice-late', { name: 'Caio' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);

    // the chip only exists while there is at least one notice
    await expect(chip(host.page)).toHaveCount(0);
    await expect(chip(guest.page)).toHaveCount(0);

    // a guest (not the host) pins one: 1 h 30 min
    await publish(guest.page, 'Voltamos às 21h', '1', '30');

    // everybody sees the chip, with the text, the time left and its bar
    for (const p of [host.page, guest.page]) {
      await expect(chip(p)).toContainText('Voltamos às 21h');
      await expect(chip(p)).toContainText(/1 h 2\d min|1 h 30 min/);
      await expect(chip(p).locator('.notice-bar')).toBeAttached();
      await expect.poll(() => sounds(p)).toContain('notice'); // a new notice sounds for everybody, its author too
    }

    // somebody who comes in later gets it from its author, without the sound (it is not new)
    await joinRoom(late.page, code);
    await expect(chip(late.page)).toContainText('Voltamos às 21h');
    expect(await sounds(late.page)).not.toContain('notice');

    // a second one: the chip shows the newest and counts the others
    await publish(host.page, 'Pizza chegando', '0', '45');
    await expect(chip(guest.page)).toContainText('Pizza chegando');
    await expect(chip(guest.page)).toContainText('+1');

    // the list: the host owns "Pizza" (remove for all); "Voltamos" is Bia's (only close for me)
    const l2 = await openList(host.page);
    await expect(l2.locator('.notice-row')).toHaveCount(2);
    await expect(l2.locator('.notice-row .notice-bar')).toHaveCount(2);
    await expect(l2.locator('.notice-row', { hasText: 'Pizza chegando' }).getByRole('button', { name: 'Remover o aviso para todos' })).toBeVisible();
    await expect(l2.locator('.notice-row', { hasText: 'Voltamos' }).getByRole('button', { name: 'Fechar o aviso só para mim' })).toBeVisible();
    await expect(l2.locator('.notice-row', { hasText: 'Voltamos' }).getByRole('button', { name: 'Remover o aviso para todos' })).toHaveCount(0);
    await closeDialog(host.page);

    // Caio closes "Pizza" only for himself: it stays for the others
    const l3 = await openList(late.page);
    await l3.locator('.notice-row', { hasText: 'Pizza chegando' }).getByRole('button', { name: 'Fechar o aviso só para mim' }).click();
    await expect(l3.locator('.notice-row')).toHaveCount(1);
    await closeDialog(late.page);
    await expect(chip(late.page)).toContainText('Voltamos às 21h');
    await expect(chip(guest.page)).toContainText('Pizza chegando');

    // the author removes "Pizza" for everybody
    const l4 = await openList(host.page);
    await l4.locator('.notice-row', { hasText: 'Pizza chegando' }).getByRole('button', { name: 'Remover o aviso para todos' }).click();
    await expect(l4.locator('.notice-row')).toHaveCount(1);
    await closeDialog(host.page);
    await expect(chip(guest.page)).toContainText('Voltamos às 21h');
    await expect(chip(guest.page)).not.toContainText('+1');

    // Caio closes the last one for himself: his chip goes away, the others keep it
    const l5 = await openList(late.page);
    await l5.getByRole('button', { name: 'Fechar o aviso só para mim' }).click();
    await closeDialog(late.page);
    await expect(chip(late.page)).toHaveCount(0);
    await expect(chip(host.page)).toContainText('Voltamos às 21h');

    // the author leaves: her notice goes away with her
    await guest.page.getByRole('button', { name: 'Sair da sala' }).first().click();
    await expect(chip(host.page)).toHaveCount(0);
  } finally {
    await late.close();
    await guest.close();
    await host.close();
  }
});

test('the time picker of a new notice: − and + move by steps and stop at the limits, the shortcuts fill it, typing works too', async () => {
  const host = await launchNext('notice-picker', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47902 });
  try {
    await createRoom(host.page);
    await host.page.getByRole('button', { name: 'Novo aviso', exact: true }).click();
    const d = modal(host.page);
    const hours = d.getByLabel('Horas', { exact: true });
    const minutes = d.getByLabel('Minutos', { exact: true });
    await expect(hours).toHaveValue('0');
    await expect(minutes).toHaveValue('30');
    await expect(d.getByRole('button', { name: '30 min' })).toHaveAttribute('aria-pressed', 'true');

    await d.getByRole('button', { name: 'Mais minutos' }).click();
    await expect(minutes).toHaveValue('35');
    // already at 0 hours: the minus button is off
    await expect(hours).toHaveValue('0');
    await expect(d.getByRole('button', { name: 'Menos horas' })).toBeDisabled();

    await d.getByRole('button', { name: '2 h' }).click();
    await expect(hours).toHaveValue('2');
    await expect(minutes).toHaveValue('0');
    await expect(d.getByRole('button', { name: '2 h' })).toHaveAttribute('aria-pressed', 'true');

    await minutes.fill('99'); // typing above the limit stops at 59
    await expect(minutes).toHaveValue('59');
    await expect(d.getByRole('button', { name: 'Mais minutos' })).toBeDisabled();
  } finally {
    await host.close();
  }
});

test('a notice disappears for everybody when its time is over', async () => {
  test.setTimeout(150_000);
  const host = await launchNext('notice-end-host', { name: 'Ana', hostAddressOverride: '127.0.0.1', port: 47892 });
  const guest = await launchNext('notice-end-guest', { name: 'Bia' });
  try {
    const code = await createRoom(host.page);
    await joinRoom(guest.page, code);
    await publish(host.page, 'Dura um minuto', '0', '1');
    await expect(chip(guest.page)).toContainText('Dura um minuto');
    await expect(chip(host.page)).toContainText('Dura um minuto');
    // the bar shrinks as the time goes
    await expect.poll(() => chip(host.page).locator('.notice-bar').evaluate((b) => Number(/scaleX\(([\d.]+)\)/.exec((b as HTMLElement).style.transform)?.[1] ?? 1) * 100), { timeout: 15_000 }).toBeLessThan(95);
    await expect(chip(guest.page)).toHaveCount(0, { timeout: 80_000 });
    await expect(chip(host.page)).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await guest.close();
    await host.close();
  }
});
