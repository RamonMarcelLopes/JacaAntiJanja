import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAIM_URL, OWNER_KEY, startWorker, WORKER_URL } from '../e2e/worker';
import { closeSettings, createRoom, enterCode, launchNext, NextApp, openSettings, readConfig } from './app';

// These tests use a Worker started locally (no Cloudflare account): the app is pointed at it with JACA_WORKER_URL.
let stopWorker: (() => void) | undefined;
let stopClaimable: (() => void) | undefined;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  stopWorker = await startWorker();
  stopClaimable = await startWorker(true);
});
test.afterAll(() => {
  stopWorker?.();
  stopClaimable?.();
});

const env = { JACA_WORKER_URL: WORKER_URL };
const modeBadge = (a: NextApp) => a.page.getByRole('button', { name: /Modo de conexão/ });

async function openRede(a: NextApp) {
  const layer = await openSettings(a.page, 'Rede');
  await expect(layer.getByRole('heading', { name: 'Rede', exact: true })).toBeVisible();
  return layer;
}

/** Switches to Cloudflare mode and saves the (local) Worker. */
async function configureWorker(a: NextApp, subdomain = 'ramon') {
  const layer = await openRede(a);
  await layer.getByRole('tab', { name: 'Cloudflare' }).click();
  await layer.getByPlaceholder('sua-conta').fill(subdomain);
  await layer.getByPlaceholder('Cole a chave do dono').fill(OWNER_KEY);
  await layer.getByRole('button', { name: 'Salvar e testar' }).click();
  await expect(layer.getByText('Worker conectado.')).toBeVisible({ timeout: 20_000 });
  return layer;
}

test('the connection mode defaults to Direto; Cloudflare shows its own fields and the network test, and is not kept until it is set up', async () => {
  const a = await launchNext('mode', { name: 'Ramon' }, env);
  try {
    const layer = await openRede(a);
    await expect(layer.getByRole('tab', { name: 'Direto (VPN)' })).toHaveAttribute('aria-selected', 'true');
    await expect(layer.getByLabel('Porta do servidor')).toBeVisible();
    await expect(layer.getByPlaceholder('sua-conta')).toHaveCount(0);
    await expect(layer.getByRole('button', { name: 'Testar minha rede' })).toHaveCount(0); // only for Cloudflare
    expect(readConfig(a).connectionMode ?? 'direct').toBe('direct');

    await layer.getByRole('tab', { name: 'Cloudflare' }).click();
    await expect(layer.getByRole('tab', { name: 'Cloudflare' })).toHaveAttribute('aria-selected', 'true');
    await expect(layer.getByPlaceholder('sua-conta')).toBeVisible();
    await expect(layer.getByLabel('Porta do servidor')).toHaveCount(0); // the direct-mode fields get out of the way
    await expect(layer.getByRole('button', { name: 'Testar minha rede' })).toBeVisible();
    await expect(layer.getByText('Cole o endereço do seu Worker')).toBeVisible();
    expect(readConfig(a).connectionMode ?? 'direct').toBe('direct'); // not saved: it is not set up yet

    await layer.getByRole('tab', { name: 'Direto (VPN)' }).click();
    await expect(layer.getByRole('button', { name: 'Testar minha rede' })).toHaveCount(0);
  } finally {
    await a.close();
  }
});

test('leaving Settings with Cloudflare selected but not filled in goes back to Direto and warns', async () => {
  const a = await launchNext('leave-incomplete', { name: 'Ramon' }, env);
  try {
    const layer = await openRede(a);
    await layer.getByRole('tab', { name: 'Cloudflare' }).click();
    await layer.getByPlaceholder('sua-conta').fill('ramon'); // only half of it, and not even saved
    await closeSettings(a.page);
    await expect(a.page.locator('.toast', { hasText: 'Voltei para o modo Direto' })).toBeVisible();
    await expect(modeBadge(a)).toContainText('Direto (VPN)');
    expect(readConfig(a).connectionMode ?? 'direct').toBe('direct');

    // coming back, the app shows Direto
    const again = await openRede(a);
    await expect(again.getByRole('tab', { name: 'Direto (VPN)' })).toHaveAttribute('aria-selected', 'true');
  } finally {
    await a.close();
  }
});

test('a completed Cloudflare setup is kept: no warning when leaving, and the home screen says Cloudflare', async () => {
  const a = await launchNext('leave-complete', { name: 'Ramon' }, env);
  try {
    await configureWorker(a, 'ramon');
    await expect.poll(() => readConfig(a).connectionMode).toBe('cloudflare');
    await closeSettings(a.page);
    await expect(modeBadge(a)).toContainText('Cloudflare');
    await expect(a.page.locator('.toast', { hasText: 'Voltei para o modo Direto' })).toHaveCount(0);
  } finally {
    await a.close();
  }
});

test('saving the Worker checks the key, stores it encrypted and never shows it again', async () => {
  const a = await launchNext('worker-save', { name: 'Ramon' }, env);
  try {
    const layer = await openRede(a);
    await layer.getByRole('tab', { name: 'Cloudflare' }).click();
    await layer.getByPlaceholder('sua-conta').fill('ramon');

    await layer.getByPlaceholder('Cole a chave do dono').fill('a-wrong-owner-key-0123456789');
    await layer.getByRole('button', { name: 'Salvar e testar' }).click();
    await expect(layer.getByText('A chave do dono não confere')).toBeVisible({ timeout: 20_000 });
    expect(readConfig(a).workerOwnerKeyEnc ?? '').toBe(''); // nothing stored for a wrong key

    await layer.getByPlaceholder('Cole a chave do dono').fill('short');
    await layer.getByRole('button', { name: 'Salvar e testar' }).click();
    await expect(layer.getByText('parece incompleta')).toBeVisible();

    await layer.getByPlaceholder('sua-conta').fill('Nome Inválido!');
    await layer.getByPlaceholder('Cole a chave do dono').fill(OWNER_KEY);
    await layer.getByRole('button', { name: 'Salvar e testar' }).click();
    await expect(layer.getByText('só pode ter letras minúsculas')).toBeVisible();

    await layer.getByPlaceholder('sua-conta').fill('ramon');
    await layer.getByRole('button', { name: 'Salvar e testar' }).click();
    await expect(layer.getByText('Worker conectado.')).toBeVisible({ timeout: 20_000 });

    const stored = readConfig(a);
    expect(stored.workerSubdomain).toBe('ramon');
    expect(stored.workerOwnerKeyEnc.length).toBeGreaterThan(20);
    expect(JSON.stringify(stored)).not.toContain(OWNER_KEY); // encrypted at rest
    // the UI only ever gets a flag, never the key
    expect(await a.page.evaluate(async () => (await window.jaca.getConfig()).workerOwnerKeyEnc)).toBe('set');
    await expect(layer.getByPlaceholder('Chave guardada (cole outra para trocar)')).toHaveValue('');
    await expect(layer.getByRole('button', { name: 'Testar de novo' })).toBeVisible();

    // the UI cannot overwrite the Worker settings through the generic config call
    await a.page.evaluate(() => window.jaca.setConfig({ workerSubdomain: 'attacker', workerOwnerKeyEnc: 'x' } as never));
    expect(readConfig(a).workerSubdomain).toBe('ramon');

    await layer.getByRole('button', { name: 'Remover' }).click();
    await expect(a.page.locator('.toast', { hasText: 'Worker removido deste PC' })).toBeVisible();
    await expect.poll(() => readConfig(a).workerOwnerKeyEnc).toBe('');
    await expect(layer.getByRole('tab', { name: 'Direto (VPN)' })).toHaveAttribute('aria-selected', 'true');
  } finally {
    await a.close();
  }
});

test('a room created through Cloudflare: short code with the account, guest only pastes it', async () => {
  const host = await launchNext('cf-host', { name: 'Ana' }, env);
  const guest = await launchNext('cf-guest', { name: 'Bia' }, env); // no Worker configured: joining needs nothing
  try {
    await configureWorker(host, 'ramon');
    await closeSettings(host.page);
    const code = await createRoom(host.page, 'Noite de filmes');
    // the Worker writes the account into the code from its own address (jaca-sala.<account>.workers.dev); a local Worker has none, so it says "local"
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}@local$/);
    await expect(host.page.getByTestId('room-title')).toHaveText('Noite de filmes');

    await enterCode(guest.page, code.toLowerCase());
    await expect(guest.page.getByTestId('stage')).toBeVisible({ timeout: 20_000 });
    await expect(guest.page.getByTestId('room-title')).toHaveText('Noite de filmes');
    await expect(guest.page.getByRole('button', { name: 'Copiar código da sala' })).toHaveAttribute('data-code', code); // everyone sees the same canonical code
    await expect(host.page.locator('#sidebar')).toContainText('Bia');
    await expect(guest.page.locator('#sidebar')).toContainText('Ana');
    await expect(guest.page.getByTestId('room-timer')).toHaveText(/^\d{2}:\d{2}$/);

    // the owner leaving ends the room for everybody
    await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(guest.page.getByTestId('home')).toBeVisible({ timeout: 15_000 });
    await expect(guest.page.locator('.toast').last()).toContainText('A sala foi encerrada pelo host.');

    // the room is gone for good
    await enterCode(guest.page, code);
    await expect(guest.page.locator('.toast[data-kind="warn"]').last()).toContainText('A sala não existe ou já foi encerrada');
  } finally {
    await guest.close();
    await host.close();
  }
});

test('a config that says Cloudflare but has no Worker is treated as Direto', async () => {
  const a = await launchNext('cf-nokey', { name: 'Ana', connectionMode: 'cloudflare' }, env);
  try {
    await expect(modeBadge(a)).toContainText('Direto (VPN)');
    const layer = await openRede(a);
    await expect(layer.getByRole('tab', { name: 'Direto (VPN)' })).toHaveAttribute('aria-selected', 'true');
  } finally {
    await a.close();
  }
});

test('Cloudflare codes that could point anywhere else are refused before connecting', async () => {
  const a = await launchNext('cf-bad', { name: 'Bia' }, env);
  try {
    for (const bad of ['ABCDE-FGHJK@evil.com', 'ABCDE-FGHJK@localhost:8080', 'ABCDE-FGHJK@', 'ABCDE-FGHJK@-x', 'SHORT@ramon']) {
      await enterCode(a.page, bad);
      await expect(a.page.locator('.toast[data-kind="warn"]').last()).toContainText('Código de convite inválido');
    }
  } finally {
    await a.close();
  }
});

test('"Verificar VPN/mesh disponível" lists the networks of this PC and fills the address you pick', async () => {
  const fake = JSON.stringify([
    { name: 'Radmin VPN', ip: '26.1.2.3', kind: 'Radmin VPN' },
    { name: 'Tailscale', ip: '100.64.0.9', kind: 'Tailscale' },
  ]);
  const a = await launchNext('vpn', { name: 'Ramon' }, { ...env, JACA_FAKE_VPNS: fake });
  try {
    const layer = await openRede(a);
    const address = layer.getByLabel('Endereço manual');
    await expect(address).toHaveValue('');
    await layer.getByRole('button', { name: 'Verificar VPN/mesh disponível' }).click();
    await expect(layer.getByRole('radio', { name: /Radmin VPN/ })).toBeVisible();
    await expect(layer.getByRole('radio', { name: /Tailscale/ })).toBeVisible();
    await expect(layer.getByText('Escolha qual usar')).toBeVisible();
    for (const o of await layer.getByRole('radio').all()) await expect(o).toHaveAttribute('aria-checked', 'false'); // none is chosen for you

    await layer.getByRole('radio', { name: /Tailscale/ }).click();
    await expect(address).toHaveValue('100.64.0.9'); // filled in automatically
    await expect(layer.getByText('Endereço preenchido: 100.64.0.9')).toBeVisible();
    await expect(layer.getByRole('radio', { name: /Tailscale/ })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => readConfig(a).hostAddressOverride).toBe('100.64.0.9');

    await layer.getByRole('radio', { name: /Radmin VPN/ }).click();
    await expect(address).toHaveValue('26.1.2.3');
    await expect(layer.getByRole('radio', { name: /Tailscale/ })).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => readConfig(a).hostAddressOverride).toBe('26.1.2.3');
  } finally {
    await a.close();
  }
});

test('with no VPN or mesh on the PC the button says so', async () => {
  const a = await launchNext('vpn-none', { name: 'Ramon' }, { ...env, JACA_FAKE_VPNS: '[]' });
  try {
    const layer = await openRede(a);
    await layer.getByRole('button', { name: 'Verificar VPN/mesh disponível' }).click();
    await expect(layer.getByText('Não encontrei nenhuma VPN ou mesh')).toBeVisible();
    await expect(layer.getByRole('radio')).toHaveCount(0);
  } finally {
    await a.close();
  }
});

test('"Testar minha rede" gives an answer', async () => {
  const a = await launchNext('nat', { name: 'Ramon' }, env);
  try {
    const layer = await openRede(a);
    await layer.getByRole('tab', { name: 'Cloudflare' }).click(); // the test lives in the Cloudflare pane
    await layer.getByRole('button', { name: 'Testar minha rede' }).click();
    // it asks real STUN servers, so the verdict depends on the machine; it must always end with one of the three messages
    await expect(layer.getByText(/Boa notícia: sua rede deve fechar conexão direta|Atenção: sua rede muda o endereço público|Não consegui concluir o teste/)).toBeVisible({ timeout: 20_000 });
  } finally {
    await a.close();
  }
});

test('a Worker published with the button: pasting its address with no key makes the app create and register the owner key; a second PC is refused', async () => {
  const claimEnv = { JACA_WORKER_URL: CLAIM_URL };
  const a = await launchNext('claim-a', { name: 'Ramon' }, claimEnv);
  const b = await launchNext('claim-b', { name: 'Outro' }, claimEnv);
  try {
    const layer = await openRede(a);
    await layer.getByRole('tab', { name: 'Cloudflare' }).click();
    await layer.getByPlaceholder('sua-conta').fill('https://jaca-sala.ramon.workers.dev/'); // the whole address is accepted
    await layer.getByRole('button', { name: 'Salvar e testar' }).click(); // key left empty
    await expect(layer.getByText('O app criou a chave do dono')).toBeVisible({ timeout: 20_000 });
    await expect(layer.getByPlaceholder('sua-conta')).toHaveValue('ramon'); // the field shows the account, not the pasted URL
    const cfg = readConfig(a);
    expect(cfg.workerSubdomain).toBe('ramon');
    expect(cfg.workerOwnerKeyEnc).toBeTruthy();
    expect(JSON.stringify(cfg)).not.toContain('"key"');
    await expect.poll(() => readConfig(a).connectionMode).toBe('cloudflare');

    // pressing "Salvar e testar" again with the field still empty only tests the saved key: no new key, no "já tem um dono"
    const savedKey = readConfig(a).workerOwnerKeyEnc;
    await layer.getByRole('button', { name: 'Salvar e testar' }).click();
    await expect(layer.getByText('A chave guardada neste PC está valendo.')).toBeVisible({ timeout: 20_000 });
    await expect(layer.getByText('Esse Worker já tem um dono')).toHaveCount(0);
    expect(readConfig(a).workerOwnerKeyEnc).toBe(savedKey);

    // another PC pointing at the same Worker cannot take it over
    const other = await openRede(b);
    await other.getByRole('tab', { name: 'Cloudflare' }).click();
    await other.getByPlaceholder('sua-conta').fill('ramon');
    await other.getByRole('button', { name: 'Salvar e testar' }).click();
    await expect(other.getByText('Esse Worker já tem um dono')).toBeVisible({ timeout: 20_000 });
    expect(readConfig(b).workerOwnerKeyEnc ?? '').toBe('');
  } finally {
    await a.close();
    await b.close();
  }
});

test('the Cloudflare connection survives a reinstall (a copy kept outside the app data), and "Remover" forgets it for good', async () => {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'jaj-backup-'));
  const keepEnv = { JACA_WORKER_URL: WORKER_URL, JACA_BACKUP_DIR: backup };
  try {
    const a = await launchNext('keep-a', { name: 'Ramon' }, keepEnv);
    try {
      await configureWorker(a, 'ramon');
      await expect.poll(() => readConfig(a).connectionMode).toBe('cloudflare');
    } finally {
      await a.close(); // its whole data folder is deleted, like uninstalling
    }
    const copy = fs.readFileSync(path.join(backup, 'cloudflare.json'), 'utf8');
    expect(copy).not.toContain(OWNER_KEY); // the key in the copy is protected by Windows, never plain text

    // "reinstalled": a new app with empty data finds the copy and has the Worker again, in the same mode
    const b = await launchNext('keep-b', { name: 'Ramon' }, keepEnv);
    try {
      expect(readConfig(b).workerSubdomain).toBe('ramon');
      expect(readConfig(b).connectionMode).toBe('cloudflare');
      await expect(modeBadge(b)).toContainText('Cloudflare');
      const layer = await openRede(b);
      await expect(layer.getByText('Worker configurado: jaca-sala.ramon.workers.dev')).toBeVisible();
      await layer.getByRole('button', { name: 'Remover' }).click();
      await expect(b.page.locator('.toast', { hasText: 'Worker removido' })).toBeVisible();
    } finally {
      await b.close();
    }
    expect(fs.existsSync(path.join(backup, 'cloudflare.json'))).toBe(false);

    // removed on purpose: a later install starts clean
    const c = await launchNext('keep-c', { name: 'Ramon' }, keepEnv);
    try {
      expect(readConfig(c).workerSubdomain ?? '').toBe('');
      await expect(modeBadge(c)).toContainText('Direto (VPN)');
    } finally {
      await c.close();
    }
  } finally {
    fs.rmSync(backup, { recursive: true, force: true });
  }
});
