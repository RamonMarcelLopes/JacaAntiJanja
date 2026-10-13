import { expect, Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRoom, enterCode, launchApp, openCreateDialog, smallDialog, sounds, TestApp } from './app';
import { OWNER_KEY, startWorker, WORKER_URL } from './worker';

// Fixed rooms, favorites, taking a room back and the Discord switch, against a Worker started locally (no Cloudflare account).
let stopWorker: (() => void) | undefined;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  stopWorker = await startWorker();
});
test.afterAll(() => stopWorker?.());

const env = { JACA_WORKER_URL: WORKER_URL };
const readConfig = (a: TestApp) => JSON.parse(fs.readFileSync(path.join(a.dir, 'config.json'), 'utf8'));
const ROOM_ONE = 'JACATESTE1';
const ROOM_TWO = 'JACATESTE2';
const ROOM_THREE = 'JACATESTE3'; // each test that opens a room uses its own id: a room left open by one test stays "open" for a minute on the Worker
const ROOM_FOUR = 'JACATESTE4';
const ROOM_FIVE = 'JACATESTE5';
const fixed = (id: string, name: string) => ({ id, name, discordWebhookEnc: '' });

/** Switches to Cloudflare mode, saves the (local) Worker and goes back to the home screen. */
async function configureWorker(a: TestApp) {
  await a.page.getByRole('button', { name: 'Configurações' }).click();
  await a.page.getByRole('radio', { name: 'Cloudflare' }).click();
  await a.page.getByPlaceholder('sua-conta').fill('ramon');
  await a.page.getByPlaceholder('Cole a chave do dono').fill(OWNER_KEY);
  await a.page.getByRole('button', { name: 'Salvar e testar' }).click();
  await expect(a.page.getByText('Worker conectado.')).toBeVisible({ timeout: 20_000 });
  await a.page.getByRole('button', { name: 'Voltar' }).click();
  await expect(a.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible();
}

/** Picks a kind of room in the "Tipo de sala" dropdown of the create dialog. */
async function pickKind(page: Page, label: string | RegExp) {
  await smallDialog(page).first().getByRole('combobox', { name: 'Tipo de sala' }).click();
  await page.getByRole('option').filter({ hasText: label }).first().click();
}

const editDialog = (page: Page) => page.locator('.overlay:not(.closing) .dialog.small', { has: page.getByRole('heading', { name: 'Editar sala' }) });

test('a new fixed room: the Discord switch starts off, a wrong webhook stops everything, and the room comes back with the same code', async () => {
  const host = await launchApp('fx-new', { name: 'Ana' }, env);
  try {
    await configureWorker(host);
    const dialog = await openCreateDialog(host.page);

    // a temporary room is the default: no Discord, and the name is suggested
    await expect(dialog.getByRole('combobox', { name: 'Tipo de sala' })).toHaveAttribute('data-value', 'temporary');
    await expect(dialog.locator('.discord-section')).toBeHidden();

    // "+ Nova sala fixa": the Discord notice is a switch, off, and the webhook field only shows while it is on
    await pickKind(host.page, '+ Nova sala fixa');
    const toggle = dialog.getByRole('switch', { name: /Avisar no Discord/ });
    const field = dialog.getByPlaceholder(/discord\.com\/api\/webhooks/);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(field).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(field).toBeVisible();

    // on, but nothing pasted
    await dialog.getByPlaceholder('Nome da sala').fill('Sala fixa A');
    await dialog.getByRole('button', { name: 'Criar sala' }).click();
    await expect(host.page.locator('.toast.error').last()).toContainText('Cole o webhook do canal ou desligue');
    await expect(dialog).toBeVisible();

    // something that is not a Discord webhook: nothing is created and nothing is kept
    await field.fill('https://exemplo.com/api/webhooks/123/abc');
    await dialog.getByRole('button', { name: 'Criar sala' }).click();
    await expect(host.page.locator('.toast.error').last()).toContainText('não parece um webhook do Discord');
    await expect(host.page.locator('.code-chip')).toHaveCount(0);
    expect(readConfig(host).fixedRooms ?? []).toHaveLength(0);

    // switch off again: the room is created and remembered, without any webhook
    await toggle.click();
    await expect(field).toBeHidden();
    await dialog.getByRole('button', { name: 'Criar sala' }).click();
    const code = host.page.locator('.code-chip code');
    await expect(code).toBeVisible({ timeout: 20_000 });
    const firstCode = (await code.textContent())!.trim();
    const saved = readConfig(host).fixedRooms;
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Sala fixa A');
    expect(saved[0].discordWebhookEnc).toBe('');
    await expect(host.page.getByRole('heading', { name: 'Sala fixa A' })).toBeVisible();

    // end it and open it again from the list: same code, name locked, and the dialog says "Iniciar sala"
    await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(host.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible({ timeout: 15_000 });
    const again = await openCreateDialog(host.page);
    await pickKind(host.page, 'Sala fixa: Sala fixa A');
    await expect(again.getByRole('heading', { name: 'Iniciar sala' })).toBeVisible();
    await expect(again.getByRole('button', { name: 'Iniciar sala' })).toBeVisible();
    await expect(again.getByPlaceholder('Nome da sala')).toBeDisabled();
    await expect(again.getByPlaceholder('Nome da sala')).toHaveValue('Sala fixa A');
    await expect(again.locator('.discord-section')).toBeHidden(); // for an existing room the Discord notice is edited in "Editar sala"
    await again.getByRole('button', { name: 'Iniciar sala' }).click();
    await expect(code).toBeVisible({ timeout: 20_000 });
    expect((await code.textContent())!.trim()).toBe(firstCode);

    // back to a temporary room: the dialog is "Criar sala" again and a new code is made
    await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(host.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible({ timeout: 15_000 });
    const temp = await openCreateDialog(host.page);
    await pickKind(host.page, 'Sala fixa: Sala fixa A');
    await pickKind(host.page, 'Sala temporária');
    await expect(temp.getByRole('heading', { name: 'Criar sala' })).toBeVisible();
    await expect(temp.getByPlaceholder('Nome da sala')).toBeEnabled();
  } finally {
    await host.close();
  }
});

test('the dropdown of the create dialog: three dots per fixed room open edit / delete over the list, and a second click closes only them', async () => {
  const host = await launchApp('fx-dots', { name: 'Ana', fixedRooms: [fixed(ROOM_ONE, 'Sala Um'), fixed(ROOM_TWO, 'Sala Dois')] }, env);
  try {
    await configureWorker(host);
    const dialog = await openCreateDialog(host.page);
    await dialog.getByRole('combobox', { name: 'Tipo de sala' }).click();
    const list = host.page.getByRole('listbox');
    await expect(list).toBeVisible();

    // only the fixed rooms have the dots; the selected option has the yellow outline instead of a check mark
    await expect(list.locator('.opt-kebab')).toHaveCount(2);
    await expect(list.locator('.select-option.selected')).toContainText('Sala temporária');
    await expect(list.locator('.select-option.selected .select-check')).toBeHidden();
    const dots = list.getByRole('button', { name: /Opções de Sala fixa: Sala Um/ });
    const optionBox = (await list.locator('.select-option', { hasText: 'Sala fixa: Sala Um' }).boundingBox())!;
    const dotsBox = (await dots.boundingBox())!;
    expect(dotsBox.x + dotsBox.width).toBeGreaterThan(optionBox.x + optionBox.width - 16); // at the far right of the row

    // the menu opens above the list (which stays open) and a second click on the same dots closes only the menu
    await dots.click();
    const menu = host.page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Editar sala', 'Apagar']);
    await expect(list).toBeVisible();
    const onTop = await menu.getByRole('menuitem', { name: 'Editar sala' }).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    });
    expect(onTop).toBe(true); // not hidden under the dropdown list
    await dots.click();
    await expect(menu).toHaveCount(0);
    await expect(list).toBeVisible();

    // edit: the Discord switch is off, the field is hidden, a duplicate name is refused, a new name is saved
    await dots.click();
    await menu.getByRole('menuitem', { name: 'Editar sala' }).click();
    const edit = editDialog(host.page);
    await expect(edit).toBeVisible();
    await expect(edit.getByPlaceholder('Nome da sala fixa')).toHaveValue('Sala Um');
    const toggle = edit.getByRole('switch', { name: /Avisar no Discord/ });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(edit.locator('.discord-field')).toBeHidden();
    await edit.getByPlaceholder('Nome da sala fixa').fill('sala dois'); // same name as the other room, in another case
    await edit.getByRole('button', { name: 'Salvar' }).click();
    await expect(edit).toContainText('Você já tem uma sala fixa com esse nome.');
    await toggle.click();
    await edit.getByPlaceholder('Nome da sala fixa').fill('Sala Renomeada');
    await edit.getByRole('button', { name: 'Salvar' }).click();
    await expect(edit).toContainText('Cole o webhook do canal ou desligue');
    await toggle.click();
    await edit.getByRole('button', { name: 'Salvar' }).click();
    await expect(edit).toHaveCount(0);
    await expect.poll(() => readConfig(host).fixedRooms.map((r: { name: string }) => r.name)).toEqual(['Sala Renomeada', 'Sala Dois']);
    expect(readConfig(host).fixedRooms[0].id).toBe(ROOM_ONE); // the code does not change with the name

    // delete: asks first; cancel keeps it, confirm removes it and the dropdown goes back to a temporary room
    await dialog.getByRole('combobox', { name: 'Tipo de sala' }).click();
    await host.page.getByRole('listbox').getByRole('button', { name: /Opções de Sala fixa: Sala Dois/ }).click();
    await host.page.getByRole('menuitem', { name: 'Apagar' }).click();
    const confirm = host.page.locator('.overlay:not(.closing) .dialog.small', { has: host.page.getByRole('heading', { name: 'Apagar sala fixa' }) });
    await expect(confirm).toContainText('Sala Dois');
    await confirm.getByRole('button', { name: 'Cancelar' }).click();
    expect(readConfig(host).fixedRooms).toHaveLength(2);
    await dialog.getByRole('combobox', { name: 'Tipo de sala' }).click();
    await host.page.getByRole('listbox').getByRole('button', { name: /Opções de Sala fixa: Sala Dois/ }).click();
    await host.page.getByRole('menuitem', { name: 'Apagar' }).click();
    await confirm.getByRole('button', { name: 'Apagar' }).click();
    await expect.poll(() => readConfig(host).fixedRooms.map((r: { name: string }) => r.name)).toEqual(['Sala Renomeada']);
  } finally {
    await host.close();
  }
});

test('Configurações > Salas fixas: search and open/closed filter, edit, new code and delete', async () => {
  const host = await launchApp('fx-settings', { name: 'Ana', fixedRooms: [fixed(ROOM_ONE, 'Filmes de Sexta'), fixed(ROOM_TWO, 'Jogos do João')] }, env);
  try {
    await configureWorker(host);
    await host.page.getByRole('button', { name: 'Configurações' }).click();
    await host.page.getByRole('tab', { name: 'Salas fixas' }).click();
    const rows = host.page.locator('.settings-content .fav-row');
    await expect(rows).toHaveCount(2);
    await expect(host.page.getByText('Sem aviso no Discord')).toHaveCount(0); // the Discord state is not repeated on every room

    // search by name, ignoring accents and case
    const search = host.page.getByPlaceholder('Buscar sala pelo nome');
    await search.fill('joao');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Jogos do João');
    await search.fill('zzz');
    await expect(host.page.getByText('Nenhuma sala encontrada com esse filtro.')).toBeVisible();
    await search.fill('');
    await expect(rows).toHaveCount(2);

    // both are closed (the local Worker answers): "Fechadas" shows them, "Abertas" none
    await host.page.getByRole('radio', { name: 'Fechadas' }).click();
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    await expect(rows.first()).toHaveAttribute('data-state', 'closed');
    await host.page.getByRole('radio', { name: 'Abertas' }).click();
    await expect(rows).toHaveCount(0);
    await expect(host.page.getByText('Nenhuma sala encontrada com esse filtro.')).toBeVisible();
    await host.page.getByRole('radio', { name: 'Todas' }).click();
    await expect(rows).toHaveCount(2);

    // edit the name here too
    await rows.first().getByRole('button', { name: 'Editar sala' }).click();
    await editDialog(host.page).getByPlaceholder('Nome da sala fixa').fill('Cinema');
    await editDialog(host.page).getByRole('button', { name: 'Salvar' }).click();
    await expect(rows.first()).toContainText('Cinema');
    await expect.poll(() => readConfig(host).fixedRooms[0].name).toBe('Cinema');

    // a new code replaces the id of that room only
    const before = readConfig(host).fixedRooms.map((r: { id: string }) => r.id);
    await rows.first().getByRole('button', { name: 'Novo código' }).click();
    await expect.poll(() => readConfig(host).fixedRooms[0].id).not.toBe(before[0]);
    expect(readConfig(host).fixedRooms[1].id).toBe(before[1]);
    expect(readConfig(host).fixedRooms[0].name).toBe('Cinema');

    // delete with confirmation
    await rows.nth(1).getByRole('button', { name: 'Apagar' }).click();
    await host.page.locator('.overlay:not(.closing) .dialog.small').getByRole('button', { name: 'Apagar' }).click();
    await expect(rows).toHaveCount(1);
    await expect.poll(() => readConfig(host).fixedRooms.length).toBe(1);
  } finally {
    await host.close();
  }
});

test('an open fixed room shows as open in the settings drawer inside the room', async () => {
  const host = await launchApp('fx-drawer', { name: 'Ana', fixedRooms: [fixed(ROOM_FIVE, 'Filmes de Sexta'), fixed(ROOM_TWO, 'Jogos')] }, env);
  try {
    await configureWorker(host);
    await openCreateDialog(host.page);
    await pickKind(host.page, 'Sala fixa: Filmes de Sexta');
    await smallDialog(host.page).getByRole('button', { name: 'Iniciar sala' }).click();
    await expect(host.page.locator('.code-chip code')).toBeVisible({ timeout: 20_000 });

    await host.page.locator('.topbar').getByRole('button', { name: 'Configurações' }).click(); // (the home screen may still be sliding out)
    const drawer = host.page.locator('.settings-drawer');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('tab', { name: 'Salas fixas' }).click();
    await drawer.getByRole('radio', { name: 'Abertas' }).click();
    const rows = drawer.locator('.fav-row');
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
    await expect(rows.first()).toContainText('Filmes de Sexta');
    await expect(rows.first()).toContainText('Aberta');
    await expect(rows.first()).toContainText('1 pessoa');
  } finally {
    await host.close();
  }
});

test('the app closed without ending its fixed room: asks to reopen the same room or to open a temporary one', async () => {
  const seed = { name: 'Ana', fixedRooms: [fixed(ROOM_THREE, 'Sala Fixa Teste')] };
  const first = await launchApp('fx-busy-a', seed, env);
  const second = await launchApp('fx-busy-b', { ...seed, name: 'Ana (outro PC)' }, env);
  try {
    await configureWorker(first);
    await configureWorker(second);

    // the first app opens the fixed room and stays in it (this is the "app closed" room that still looks open)
    await openCreateDialog(first.page);
    await pickKind(first.page, 'Sala fixa: Sala Fixa Teste');
    await smallDialog(first.page).getByRole('button', { name: 'Iniciar sala' }).click();
    const code = first.page.locator('.code-chip code');
    await expect(code).toBeVisible({ timeout: 20_000 });
    const fixedCode = (await code.textContent())!.trim();

    // the second one tries the same room: it is told the room is still open and chooses to take it back
    await openCreateDialog(second.page);
    await pickKind(second.page, 'Sala fixa: Sala Fixa Teste');
    await smallDialog(second.page).first().getByRole('button', { name: 'Iniciar sala' }).click();
    const busy = second.page.locator('.overlay:not(.closing) .dialog.small', { has: second.page.getByRole('heading', { name: 'A sala ainda aparece aberta' }) });
    await expect(busy).toBeVisible({ timeout: 20_000 });
    await expect(busy).toContainText('Sala Fixa Teste');
    await busy.getByRole('button', { name: 'Cancelar' }).click(); // cancelling opens nothing
    await expect(second.page.locator('.code-chip')).toHaveCount(0);

    await smallDialog(second.page).first().getByRole('button', { name: 'Iniciar sala' }).click();
    await busy.getByRole('button', { name: 'Reabrir esta sala' }).click();
    const secondCode = second.page.locator('.code-chip code');
    await expect(secondCode).toBeVisible({ timeout: 20_000 });
    expect((await secondCode.textContent())!.trim()).toBe(fixedCode); // the same room, the same code
    // whoever was in the old room is told it ended
    await expect(first.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible({ timeout: 20_000 });
    await expect(first.page.locator('.toast')).toContainText('A sala foi encerrada pelo host.');

    // now the first app wants it again, and prefers a temporary room: other code, same name
    await openCreateDialog(first.page);
    await pickKind(first.page, 'Sala fixa: Sala Fixa Teste');
    await smallDialog(first.page).first().getByRole('button', { name: 'Iniciar sala' }).click();
    const busy2 = first.page.locator('.overlay:not(.closing) .dialog.small', { has: first.page.getByRole('heading', { name: 'A sala ainda aparece aberta' }) });
    await expect(busy2).toBeVisible({ timeout: 20_000 });
    await busy2.getByRole('button', { name: 'Criar temporária' }).click();
    const tempCode = first.page.locator('.code-chip code');
    await expect(tempCode).toBeVisible({ timeout: 20_000 });
    expect((await tempCode.textContent())!.trim()).not.toBe(fixedCode);
    await expect(first.page.getByRole('heading', { name: 'Sala Fixa Teste' })).toBeVisible();
    // the second app still has the fixed room, untouched
    await expect(secondCode).toHaveText(fixedCode);
  } finally {
    await first.close();
    await second.close();
  }
});

test('favorites: the star in the room, the list on the home screen with open / closed, the Entrar button, filters and the three dots', async () => {
  test.setTimeout(180_000);
  const host = await launchApp('fav-host', { name: 'Ana', fixedRooms: [fixed(ROOM_FOUR, 'Sala Fixa Teste')] }, env);
  const guest = await launchApp('fav-guest', { name: 'Bia' }, env); // no Worker of its own: joining and favoriting need nothing
  try {
    await configureWorker(host);
    await openCreateDialog(host.page);
    await pickKind(host.page, 'Sala fixa: Sala Fixa Teste');
    await smallDialog(host.page).first().getByRole('button', { name: 'Iniciar sala' }).click();
    const hostCode = host.page.locator('.code-chip code');
    await expect(hostCode).toBeVisible({ timeout: 20_000 });
    const code = (await hostCode.textContent())!.trim();
    await expect(host.page.locator('.fav-star')).toHaveCount(0); // the owner does not favorite their own room

    // the guest has no favorites yet: the section shows an explanation, with the filters already there
    await expect(guest.page.getByRole('heading', { name: 'Salas favoritas' })).toBeVisible();
    await expect(guest.page.getByText('Você ainda não favoritou nenhuma sala')).toBeVisible();
    await expect(guest.page.getByPlaceholder('Buscar sala pelo nome')).toBeVisible();
    await expect(guest.page.getByRole('radio')).toHaveText(['Todas', 'Abertas', 'Fechadas']);

    // joins and favorites it from the star in the room: the name is the one the host gave
    await enterCode(guest.page, code);
    await expect(guest.page.getByRole('heading', { name: 'Participantes' })).toBeVisible({ timeout: 20_000 });
    const star = guest.page.getByRole('button', { name: 'Favoritar esta sala' });
    await star.click();
    await expect(guest.page.locator('.toast')).toContainText('Sala favoritada');
    await expect(guest.page.getByRole('button', { name: 'Remover a sala dos favoritos' })).toBeVisible();
    expect(readConfig(guest).favoriteRooms).toEqual([{ code, name: 'Sala Fixa Teste' }]);

    // leaves: the list shows the room as open, with the host and how many people are in it
    await guest.page.getByRole('button', { name: 'Sair' }).click();
    await expect(guest.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible({ timeout: 15_000 });
    const row = guest.page.locator('.fav-row');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-state', 'open', { timeout: 15_000 });
    await expect(row).toContainText('Sala Fixa Teste');
    await expect(row).toContainText('Aberta · Ana · 1 pessoa');
    const enter = row.getByRole('button', { name: 'Entrar' });
    await expect(enter).toBeEnabled();

    // the filters: by name (also without accents) and by state
    const search = guest.page.getByPlaceholder('Buscar sala pelo nome');
    await search.fill('xyz');
    await expect(row).toHaveCount(0);
    await expect(guest.page.getByText('Nenhuma sala encontrada com esse filtro.')).toBeVisible();
    await search.fill('FIXA');
    await expect(row).toHaveCount(1);
    await search.fill('');
    await guest.page.getByRole('radio', { name: 'Fechadas' }).click();
    await expect(row).toHaveCount(0);
    await guest.page.getByRole('radio', { name: 'Abertas' }).click();
    await expect(row).toHaveCount(1);
    await guest.page.getByRole('radio', { name: 'Todas' }).click();

    // the three dots take no room until the pointer is over the row; then they push "Entrar" to the left
    const kebab = row.locator('.fav-kebab');
    await guest.page.mouse.move(2, 2);
    await expect(kebab).toHaveCSS('opacity', '0');
    const enterAtRest = (await enter.boundingBox())!;
    await row.hover();
    await expect(kebab).toHaveCSS('opacity', '1');
    await expect.poll(async () => (await enter.boundingBox())!.x).toBeLessThan(enterAtRest.x);
    await kebab.click();
    await expect(guest.page.getByRole('menuitem')).toHaveText(['Copiar código', 'Remover dos favoritos']);
    await guest.page.getByRole('menuitem', { name: 'Copiar código' }).click();
    expect(await guest.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(code);

    // "Entrar" of the row gets into the room without typing the code
    await enter.click();
    await expect(guest.page.getByRole('heading', { name: 'Participantes' })).toBeVisible({ timeout: 20_000 });
    await expect(host.page.locator('.peer-name')).toHaveText(['Ana (você)', 'Bia']);
    await guest.page.getByRole('button', { name: 'Sair' }).click();
    await expect(guest.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible({ timeout: 15_000 });

    // the host closes the room: the row turns closed and its button is off (the list asks the Worker every 20 s)
    await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(host.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveAttribute('data-state', 'closed', { timeout: 40_000 });
    await expect(row.getByRole('button', { name: 'Entrar' })).toBeDisabled();
    await expect(row).toContainText('Fechada');

    // the host opens it again: the guest is told, and the button works again
    await openCreateDialog(host.page);
    await pickKind(host.page, 'Sala fixa: Sala Fixa Teste');
    await smallDialog(host.page).first().getByRole('button', { name: 'Iniciar sala' }).click();
    await expect(hostCode).toBeVisible({ timeout: 20_000 });
    await expect(row).toHaveAttribute('data-state', 'open', { timeout: 40_000 });
    await expect(guest.page.locator('.toast')).toContainText('abriu');
    expect(await sounds(guest.page)).not.toContain('peer-join'); // the notice has no sound
    await expect(row.getByRole('button', { name: 'Entrar' })).toBeEnabled();

    // removing it from the favorites
    await row.hover();
    await row.locator('.fav-kebab').click();
    await guest.page.getByRole('menuitem', { name: 'Remover dos favoritos' }).click();
    await expect(guest.page.locator('.fav-row')).toHaveCount(0);
    await expect(guest.page.getByText('Você ainda não favoritou nenhuma sala')).toBeVisible();
    await expect.poll(() => readConfig(guest).favoriteRooms).toEqual([]);
  } finally {
    await guest.close();
    await host.close();
  }
});

test('a temporary room does not add a fixed room', async () => {
  const host = await launchApp('fx-temp', { name: 'Ana', fixedRooms: [fixed(ROOM_ONE, 'Sala Um')] }, env);
  try {
    await configureWorker(host);
    const code = await createRoom(host.page, 'Só hoje');
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}@local$/);
    expect(readConfig(host).fixedRooms).toHaveLength(1); // a temporary room does not add a fixed one
  } finally {
    await host.close();
  }
});
