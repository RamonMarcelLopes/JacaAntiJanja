import { expect, Page, test } from '@playwright/test';
import { OWNER_KEY, startWorker, WORKER_URL } from '../e2e/worker';
import { closeSettings, createRoom, enterCode, launchNext, modal, NextApp, openCreateDialog, openSettings, pick, readConfig, sounds } from './app';

// Fixed rooms, favorites, taking a room back and the Discord switch, against a Worker started locally (no Cloudflare account).
let stopWorker: (() => void) | undefined;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  stopWorker = await startWorker();
});
test.afterAll(() => stopWorker?.());

const env = { JACA_WORKER_URL: WORKER_URL };
const ROOM_ONE = 'JACANEXT01';
const ROOM_TWO = 'JACANEXT02';
const ROOM_THREE = 'JACANEXT03'; // each test that opens a room uses its own id: a room left open by one test stays "open" for a minute on the Worker
const ROOM_FOUR = 'JACANEXT04';
const ROOM_FIVE = 'JACANEXT05';
const ROOM_SIX = 'JACANEXT06';
const ROOM_SEVEN = 'JACANEXT07';
const ROOM_EIGHT = 'JACANEXT08';
const fixed = (id: string, name: string) => ({ id, name, discordWebhookEnc: '' });

/** Switches to Cloudflare mode, saves the (local) Worker and goes back to the home screen. */
async function configureWorker(a: NextApp) {
  const layer = await openSettings(a.page, 'Rede');
  await layer.getByRole('tab', { name: 'Cloudflare' }).click();
  await layer.getByPlaceholder('sua-conta').fill('ramon');
  await layer.getByPlaceholder('Cole a chave do dono').fill(OWNER_KEY);
  await layer.getByRole('button', { name: 'Salvar e testar' }).click();
  await expect(layer.getByText('Worker conectado.')).toBeVisible({ timeout: 20_000 });
  await closeSettings(a.page);
}

/** Opens the create dialog and picks a kind of room in the "Tipo de sala" dropdown. */
async function startKind(page: Page, kind: string | RegExp) {
  const dialog = await openCreateDialog(page);
  await pick(page, 'Tipo de sala', kind);
  return dialog;
}

const webhookField = (d: ReturnType<typeof modal>) => d.getByLabel('Webhook desta sala');
const code = (page: Page) => page.getByRole('button', { name: 'Copiar código da sala' });

test('a new fixed room: the Discord switch starts off, a wrong webhook stops everything, and the room comes back with the same code', async () => {
  const host = await launchNext('fx-new', { name: 'Ana' }, env);
  try {
    await configureWorker(host);
    const dialog = await openCreateDialog(host.page);

    // a temporary room is the default: no Discord, and the name is suggested
    await expect(dialog.getByRole('combobox', { name: 'Tipo de sala' })).toContainText('Sala temporária');
    await expect(dialog.getByRole('switch')).toBeHidden();

    // "+ Nova sala fixa": the Discord notice is a switch, off, and the webhook field only shows while it is on
    await pick(host.page, 'Tipo de sala', '+ Nova sala fixa');
    const toggle = dialog.getByRole('switch', { name: /Avisar no Discord/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(webhookField(dialog)).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(webhookField(dialog)).toBeVisible();

    // on, but nothing pasted
    await dialog.getByLabel('Nome da sala').fill('Sala fixa A');
    await dialog.getByRole('button', { name: 'Criar sala' }).click();
    await expect(host.page.locator('.toast[data-kind="warn"]').last()).toContainText('Cole o webhook do canal ou desligue');
    await expect(dialog).toBeVisible();

    // something that is not a Discord webhook: nothing is created and nothing is kept
    await webhookField(dialog).fill('https://exemplo.com/api/webhooks/123/abc');
    // the notice of the step before sits over the corner of the dialog: the person closes it with its X
    await host.page.locator('.toast').last().hover();
    await host.page.locator('.toast').last().getByRole('button', { name: 'Fechar o aviso' }).click();
    await expect(host.page.locator('.toast')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Criar sala' }).click();
    await expect(host.page.locator('.toast[data-kind="warn"]').last()).toContainText('não parece um webhook do Discord');
    await expect(code(host.page)).toHaveCount(0);
    expect(readConfig(host).fixedRooms ?? []).toHaveLength(0);

    // switch off again: the room is created and remembered, without any webhook
    await toggle.click();
    await expect(webhookField(dialog)).toBeHidden();
    await dialog.getByRole('button', { name: 'Criar sala' }).click();
    await expect(code(host.page)).toBeVisible({ timeout: 20_000 });
    const firstCode = (await code(host.page).getAttribute('data-code'))!;
    const saved = readConfig(host).fixedRooms;
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Sala fixa A');
    expect(saved[0].discordWebhookEnc).toBe('');
    await expect(host.page.getByTestId('room-title')).toHaveText('Sala fixa A');

    // end it and open it again from the list: same code, name locked, and the button says "Iniciar sala"
    await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(host.page.getByTestId('home')).toBeVisible({ timeout: 15_000 });
    const again = await startKind(host.page, 'Sala fixa: Sala fixa A');
    await expect(again.getByRole('button', { name: 'Iniciar sala' })).toBeVisible();
    await expect(again.getByLabel('Nome da sala')).toBeDisabled();
    await expect(again.getByLabel('Nome da sala')).toHaveValue('Sala fixa A');
    await expect(again.getByRole('switch')).toBeHidden(); // for an existing room the Discord notice is edited in "Editar sala"
    await again.getByRole('button', { name: 'Iniciar sala' }).click();
    await expect(code(host.page)).toBeVisible({ timeout: 20_000 });
    expect(await code(host.page).getAttribute('data-code')).toBe(firstCode);

    // back to a temporary room: the button is "Criar sala" again and the name is free
    await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(host.page.getByTestId('home')).toBeVisible({ timeout: 15_000 });
    const temp = await startKind(host.page, 'Sala fixa: Sala fixa A');
    await pick(host.page, 'Tipo de sala', 'Sala temporária');
    await expect(temp.getByRole('button', { name: 'Criar sala' })).toBeVisible();
    await expect(temp.getByLabel('Nome da sala')).toBeEnabled();
  } finally {
    await host.close();
  }
});

test('the fixed rooms are on the rail and on the home: one click starts the room with its own code', async () => {
  const host = await launchNext('fx-rail', { name: 'Ana', fixedRooms: [fixed(ROOM_SIX, 'Sala Um'), fixed(ROOM_SEVEN, 'Sala Dois')] }, env);
  try {
    await configureWorker(host);
    const rail = host.page.getByRole('navigation', { name: 'Salas' });
    await expect(rail.getByRole('button', { name: 'Sala Um' })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Sala Dois' })).toBeVisible();
    const card = host.page.locator('[data-room-card="Sala Dois"]');
    await expect(card).toContainText('Sala fixa');
    await card.getByRole('button', { name: 'Iniciar Sala Dois' }).click();
    await expect(host.page.getByTestId('room-title')).toHaveText('Sala Dois', { timeout: 20_000 });
    expect(await code(host.page).getAttribute('data-code')).toContain(`@local`);
    // the room on screen is the lit one of the rail
    await expect(rail.getByRole('button', { name: 'Sala Dois' })).toHaveAttribute('aria-current', 'true');
  } finally {
    await host.close();
  }
});

test('Configurações > Salas fixas: search and open/closed filter, edit (name and icon), new code and delete', async () => {
  const host = await launchNext('fx-settings', { name: 'Ana', fixedRooms: [fixed(ROOM_ONE, 'Filmes de Sexta'), fixed(ROOM_TWO, 'Jogos do João')] }, env);
  try {
    await configureWorker(host);
    const layer = await openSettings(host.page, 'Salas fixas');
    const rows = layer.locator('[data-fixed]');
    await expect(rows).toHaveCount(2);

    // search by name, ignoring accents and case
    const search = layer.getByLabel('Buscar sala fixa pelo nome');
    await search.fill('joao');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Jogos do João');
    await search.fill('zzz');
    await expect(layer.getByText('Nenhuma sala encontrada com esse filtro.')).toBeVisible();
    await search.fill('');
    await expect(rows).toHaveCount(2);

    // both are closed (the local Worker answers): "Fechadas" shows them, "Abertas" none
    await layer.getByRole('tab', { name: 'Fechadas' }).click();
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    await layer.getByRole('tab', { name: 'Abertas' }).click();
    await expect(rows).toHaveCount(0);
    await expect(layer.getByText('Nenhuma sala encontrada com esse filtro.')).toBeVisible();
    await layer.getByRole('tab', { name: 'Todas' }).click();
    await expect(rows).toHaveCount(2);

    // edit: a duplicate name is refused, a new name and icon are saved (the code stays)
    await rows.first().getByRole('button', { name: 'Editar Filmes de Sexta' }).click();
    const edit = modal(host.page);
    await expect(edit.getByRole('heading', { name: 'Editar sala' })).toBeVisible();
    await expect(edit.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await edit.getByLabel('Nome da sala').fill('JOGOS DO JOÃO'); // same name as the other room, in another case
    await edit.getByRole('button', { name: 'Salvar' }).click();
    await expect(edit).toContainText('Você já tem uma sala fixa com esse nome.');
    await edit.getByLabel('Nome da sala').fill('Cinema');
    await edit.getByRole('radio', { name: 'Cinema' }).click();
    await edit.getByRole('button', { name: 'Salvar' }).click();
    await expect(modal(host.page)).toHaveCount(0);
    await expect(rows.first()).toContainText('Cinema');
    await expect.poll(() => readConfig(host).fixedRooms[0]).toMatchObject({ id: ROOM_ONE, name: 'Cinema', icon: 'popcorn' });

    // a new code replaces the id of that room only (after asking)
    const before = readConfig(host).fixedRooms.map((r: { id: string }) => r.id);
    await rows.first().getByRole('button', { name: 'Novo código para Cinema' }).click();
    await modal(host.page).getByRole('button', { name: 'Gerar código novo' }).click();
    await expect.poll(() => readConfig(host).fixedRooms[0].id).not.toBe(before[0]);
    expect(readConfig(host).fixedRooms[1].id).toBe(before[1]);
    expect(readConfig(host).fixedRooms[0].name).toBe('Cinema');
    expect(readConfig(host).fixedRooms[0].icon).toBe('popcorn');

    // delete with confirmation
    await rows.nth(1).getByRole('button', { name: 'Apagar Jogos do João' }).click();
    await modal(host.page).getByRole('button', { name: 'Cancelar' }).click();
    expect(readConfig(host).fixedRooms).toHaveLength(2);
    await rows.nth(1).getByRole('button', { name: 'Apagar Jogos do João' }).click();
    await modal(host.page).getByRole('button', { name: 'Apagar', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect.poll(() => readConfig(host).fixedRooms.length).toBe(1);
  } finally {
    await host.close();
  }
});

test('an open fixed room shows as open in Configurações > Salas fixas while the room is on screen', async () => {
  const host = await launchNext('fx-drawer', { name: 'Ana', fixedRooms: [fixed(ROOM_FIVE, 'Filmes de Sexta'), fixed(ROOM_EIGHT, 'Jogos')] }, env);
  try {
    await configureWorker(host);
    const dialog = await startKind(host.page, 'Sala fixa: Filmes de Sexta');
    await dialog.getByRole('button', { name: 'Iniciar sala' }).click();
    await expect(code(host.page)).toBeVisible({ timeout: 20_000 });

    const layer = await openSettings(host.page, 'Salas fixas');
    await layer.getByRole('tab', { name: 'Abertas' }).click();
    const rows = layer.locator('[data-fixed]');
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
  const first = await launchNext('fx-busy-a', seed, env);
  const second = await launchNext('fx-busy-b', { ...seed, name: 'Ana (outro PC)' }, env);
  try {
    await configureWorker(first);
    await configureWorker(second);

    // the first app opens the fixed room and stays in it (this is the "app closed" room that still looks open)
    await (await startKind(first.page, 'Sala fixa: Sala Fixa Teste')).getByRole('button', { name: 'Iniciar sala' }).click();
    await expect(code(first.page)).toBeVisible({ timeout: 20_000 });
    const fixedCode = (await code(first.page).getAttribute('data-code'))!;

    // the second one tries the same room: it is told the room is still open and chooses to take it back
    const dialog = await startKind(second.page, 'Sala fixa: Sala Fixa Teste');
    await dialog.getByRole('button', { name: 'Iniciar sala' }).click();
    const busy = modal(second.page).filter({ has: second.page.getByRole('heading', { name: 'A sala ainda aparece aberta' }) });
    await expect(busy).toBeVisible({ timeout: 20_000 });
    await expect(busy).toContainText('Sala Fixa Teste');
    await busy.getByRole('button', { name: 'Cancelar' }).click(); // cancelling opens nothing
    await expect(code(second.page)).toHaveCount(0);

    await modal(second.page).getByRole('button', { name: 'Iniciar sala' }).click();
    await modal(second.page).getByRole('button', { name: 'Reabrir esta sala' }).click();
    await expect(code(second.page)).toBeVisible({ timeout: 20_000 });
    expect(await code(second.page).getAttribute('data-code')).toBe(fixedCode); // the same room, the same code
    // whoever was in the old room is told it ended
    await expect(first.page.getByTestId('home')).toBeVisible({ timeout: 20_000 });
    await expect(first.page.locator('.toast').last()).toContainText('A sala foi encerrada pelo host.');

    // now the first app wants it again, and prefers a temporary room: other code, same name
    const again = await startKind(first.page, 'Sala fixa: Sala Fixa Teste');
    await again.getByRole('button', { name: 'Iniciar sala' }).click();
    await expect(modal(first.page).getByRole('heading', { name: 'A sala ainda aparece aberta' })).toBeVisible({ timeout: 20_000 });
    await modal(first.page).getByRole('button', { name: 'Criar temporária' }).click();
    await expect(code(first.page)).toBeVisible({ timeout: 20_000 });
    expect(await code(first.page).getAttribute('data-code')).not.toBe(fixedCode);
    await expect(first.page.getByTestId('room-title')).toHaveText('Sala Fixa Teste');
    // the second app still has the fixed room, untouched
    expect(await code(second.page).getAttribute('data-code')).toBe(fixedCode);
  } finally {
    await first.close();
    await second.close();
  }
});

test('favorites: the star in the room, the cards on the home with open / closed, the Entrar button, filters and the star that takes one out', async () => {
  test.setTimeout(180_000);
  const host = await launchNext('fav-host', { name: 'Ana', fixedRooms: [fixed(ROOM_FOUR, 'Sala Fixa Teste')] }, env);
  const guest = await launchNext('fav-guest', { name: 'Bia' }, env); // no Worker of its own: joining and favoriting need nothing
  try {
    await configureWorker(host);
    await (await startKind(host.page, 'Sala fixa: Sala Fixa Teste')).getByRole('button', { name: 'Iniciar sala' }).click();
    await expect(code(host.page)).toBeVisible({ timeout: 20_000 });
    const hostCode = (await code(host.page).getAttribute('data-code'))!;
    await expect(host.page.locator('#sidebar').getByRole('button', { name: /Favoritar/ })).toHaveCount(0); // the owner does not favorite their own room

    // the guest has no favorites yet: the section shows an explanation, with the filters already there
    const gHome = guest.page.getByTestId('home');
    await expect(gHome.getByRole('heading', { name: 'Salas favoritas' })).toBeVisible();
    await expect(gHome.getByText('Você ainda não favoritou nenhuma sala')).toBeVisible();
    await expect(gHome.getByLabel('Buscar sala pelo nome')).toBeVisible();
    await expect(gHome.getByRole('tab')).toHaveText(['Todas', 'Abertas', 'Fechadas']);

    // joins and favorites it from the star in the room: the name is the one the host gave
    await enterCode(guest.page, hostCode);
    await expect(guest.page.getByTestId('stage')).toBeVisible({ timeout: 20_000 });
    await guest.page.locator('#sidebar').getByRole('button', { name: 'Favoritar esta sala' }).click();
    await expect(guest.page.locator('.toast').last()).toContainText('Sala Fixa Teste entrou nos favoritos');
    await expect(guest.page.locator('#sidebar').getByRole('button', { name: 'Tirar dos favoritos' })).toBeVisible();
    expect(readConfig(guest).favoriteRooms).toEqual([{ code: hostCode, name: 'Sala Fixa Teste' }]);

    // leaves: the card shows the room as open, with the host and how many people are in it
    await guest.page.getByRole('button', { name: 'Sair da sala' }).first().click();
    await expect(gHome).toBeVisible({ timeout: 15_000 });
    const card = gHome.locator('[data-room-card]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Sala Fixa Teste');
    await expect(card).toContainText('Aberta', { timeout: 15_000 });
    await expect(card).toContainText('Ana · 1 pessoa');
    const enter = card.getByRole('button', { name: 'Entrar em Sala Fixa Teste' });
    await expect(enter).toBeEnabled();
    // the rail shows it as open too, with its green dot
    await expect(guest.page.getByRole('navigation', { name: 'Salas' }).getByRole('button', { name: 'Sala Fixa Teste' })).toHaveAttribute('data-open', 'true');

    // the filters: by name (also without accents) and by state
    const search = gHome.getByLabel('Buscar sala pelo nome');
    await search.fill('xyz');
    await expect(card).toHaveCount(0);
    await expect(gHome.getByText('Nenhuma sala encontrada com esse filtro.')).toBeVisible();
    await search.fill('FIXA');
    await expect(card).toHaveCount(1);
    await search.fill('');
    await gHome.getByRole('tab', { name: 'Fechadas' }).click();
    await expect(card).toHaveCount(0);
    await gHome.getByRole('tab', { name: 'Abertas' }).click();
    await expect(card).toHaveCount(1);
    await gHome.getByRole('tab', { name: 'Todas' }).click();

    // "Entrar" of the card gets into the room without typing the code
    await enter.click();
    await expect(guest.page.getByTestId('stage')).toBeVisible({ timeout: 20_000 });
    await expect(host.page.locator('#sidebar')).toContainText('Bia');
    await guest.page.getByRole('button', { name: 'Sair da sala' }).first().click();
    await expect(gHome).toBeVisible({ timeout: 15_000 });

    // the host closes the room: the card turns closed and its button is off (the list asks the Worker every 20 s)
    await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(host.page.getByTestId('home')).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('FECHADA', { timeout: 40_000 });
    await expect(card.getByRole('button', { name: 'Sala Fixa Teste está fechada' })).toHaveAttribute('aria-disabled', 'true');
    await card.getByRole('button', { name: 'Sala Fixa Teste está fechada' }).click({ force: true }); // aria-disabled, but it still answers with a notice
    await expect(guest.page.locator('.toast').last()).toContainText('Sala Fixa Teste está fechada agora');

    // the host opens it again: the guest is told, and the button works again
    await (await startKind(host.page, 'Sala fixa: Sala Fixa Teste')).getByRole('button', { name: 'Iniciar sala' }).click();
    await expect(code(host.page)).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Aberta', { timeout: 40_000 });
    await expect(guest.page.locator('.toast').filter({ hasText: 'abriu' })).toBeVisible();
    expect(await sounds(guest.page)).not.toContain('peer-join'); // the notice has no sound
    await expect(card.getByRole('button', { name: 'Entrar em Sala Fixa Teste' })).toBeEnabled();

    // taking it out of the favorites with the star of the card
    await card.getByRole('button', { name: 'Tirar Sala Fixa Teste dos favoritos' }).click();
    await expect(gHome.locator('[data-room-card]')).toHaveCount(0);
    await expect(gHome.getByText('Você ainda não favoritou nenhuma sala')).toBeVisible();
    await expect.poll(() => readConfig(guest).favoriteRooms).toEqual([]);
  } finally {
    await guest.close();
    await host.close();
  }
});

test('a temporary room does not add a fixed room', async () => {
  const host = await launchNext('fx-temp', { name: 'Ana', fixedRooms: [fixed(ROOM_ONE, 'Sala Um')] }, env);
  try {
    await configureWorker(host);
    const roomCode = await createRoom(host.page, 'Só hoje');
    expect(roomCode).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}@local$/);
    expect(readConfig(host).fixedRooms).toHaveLength(1); // a temporary room does not add a fixed one
  } finally {
    await host.close();
  }
});
