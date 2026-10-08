import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, TestApp } from './app';
import { OWNER_KEY, startWorker, WORKER_URL } from './worker';

// These tests use a Worker started locally (no Cloudflare account): the app is pointed at it with JACA_WORKER_URL.
let stopWorker: (() => void) | undefined;
test.beforeAll(async () => {
  test.setTimeout(150_000);
  stopWorker = await startWorker();
});
test.afterAll(() => stopWorker?.());

const env = { JACA_WORKER_URL: WORKER_URL };
const readConfig = (a: TestApp) => JSON.parse(fs.readFileSync(path.join(a.dir, 'config.json'), 'utf8'));

async function openRede(a: TestApp) {
  await a.page.getByRole('button', { name: 'Configurações' }).click();
  await expect(a.page.getByRole('heading', { name: 'Rede', exact: true })).toBeVisible();
}

/** Switches to Cloudflare mode and saves the (local) Worker. */
async function configureWorker(a: TestApp, subdomain = 'ramon') {
  await openRede(a);
  await a.page.getByRole('radio', { name: 'Cloudflare' }).click();
  await a.page.getByPlaceholder('sua-conta').fill(subdomain);
  await a.page.getByPlaceholder('Cole a chave do dono').fill(OWNER_KEY);
  await a.page.getByRole('button', { name: 'Salvar e testar' }).click();
  await expect(a.page.getByText('Worker conectado.')).toBeVisible({ timeout: 20_000 });
}

test('the connection mode defaults to Direto; Cloudflare shows its own fields and the network test, and is not kept until it is set up', async () => {
  const a = await launchApp('mode', { name: 'Ramon' }, env);
  try {
    await openRede(a);
    await expect(a.page.getByRole('radio', { name: 'Direto (VPN)' })).toHaveAttribute('aria-checked', 'true');
    await expect(a.page.getByText('Porta do servidor')).toBeVisible();
    await expect(a.page.getByPlaceholder('sua-conta')).toBeHidden();
    await expect(a.page.getByRole('button', { name: 'Testar minha rede' })).toBeHidden(); // only for Cloudflare
    expect(readConfig(a).connectionMode ?? 'direct').toBe('direct');

    await a.page.getByRole('radio', { name: 'Cloudflare' }).click();
    await expect(a.page.getByRole('radio', { name: 'Cloudflare' })).toHaveAttribute('aria-checked', 'true');
    await expect(a.page.locator('.seg')).toHaveAttribute('data-pos', '1');
    await expect(a.page.getByPlaceholder('sua-conta')).toBeVisible();
    await expect(a.page.getByText('Porta do servidor')).toBeHidden(); // the direct-mode fields get out of the way
    await expect(a.page.getByRole('button', { name: 'Testar minha rede' })).toBeVisible();
    await expect(a.page.getByText('Preencha o nome da conta e a chave do dono')).toBeVisible();
    expect(readConfig(a).connectionMode ?? 'direct').toBe('direct'); // not saved: it is not set up yet

    await a.page.getByRole('radio', { name: 'Direto (VPN)' }).click();
    await expect(a.page.getByRole('button', { name: 'Testar minha rede' })).toBeHidden();
  } finally {
    await a.close();
  }
});

test('leaving Settings with Cloudflare selected but not filled in goes back to Direto and warns', async () => {
  const a = await launchApp('leave-incomplete', { name: 'Ramon' }, env);
  try {
    await openRede(a);
    await a.page.getByRole('radio', { name: 'Cloudflare' }).click();
    await a.page.getByPlaceholder('sua-conta').fill('ramon'); // only half of it, and not even saved
    await a.page.getByRole('button', { name: 'Voltar' }).click();
    await expect(a.page.locator('.toast', { hasText: 'Voltei para o modo Direto' })).toBeVisible();
    await expect(a.page.getByText('Conexão: Direto')).toBeVisible();
    expect(readConfig(a).connectionMode ?? 'direct').toBe('direct');

    // coming back, the app shows Direto
    await openRede(a);
    await expect(a.page.getByRole('radio', { name: 'Direto (VPN)' })).toHaveAttribute('aria-checked', 'true');
  } finally {
    await a.close();
  }
});

test('a completed Cloudflare setup is kept: no warning when leaving, and the home screen says Cloudflare', async () => {
  const a = await launchApp('leave-complete', { name: 'Ramon' }, env);
  try {
    await configureWorker(a, 'ramon');
    await expect.poll(() => readConfig(a).connectionMode).toBe('cloudflare');
    await a.page.getByRole('button', { name: 'Voltar' }).click();
    await expect(a.page.getByText('Conexão: Cloudflare')).toBeVisible();
    await expect(a.page.locator('.toast', { hasText: 'Voltei para o modo Direto' })).toHaveCount(0);
  } finally {
    await a.close();
  }
});

test('saving the Worker checks the key, stores it encrypted and never shows it again', async () => {
  const a = await launchApp('worker-save', { name: 'Ramon' }, env);
  try {
    await openRede(a);
    await a.page.getByRole('radio', { name: 'Cloudflare' }).click();
    await a.page.getByPlaceholder('sua-conta').fill('ramon');

    await a.page.getByPlaceholder('Cole a chave do dono').fill('a-wrong-owner-key-0123456789');
    await a.page.getByRole('button', { name: 'Salvar e testar' }).click();
    await expect(a.page.getByText('A chave do dono não confere')).toBeVisible({ timeout: 20_000 });
    expect(readConfig(a).workerOwnerKeyEnc ?? '').toBe(''); // nothing stored for a wrong key

    await a.page.getByPlaceholder('Cole a chave do dono').fill('short');
    await a.page.getByRole('button', { name: 'Salvar e testar' }).click();
    await expect(a.page.getByText('parece incompleta')).toBeVisible();

    await a.page.getByPlaceholder('sua-conta').fill('Nome Inválido!');
    await a.page.getByPlaceholder('Cole a chave do dono').fill(OWNER_KEY);
    await a.page.getByRole('button', { name: 'Salvar e testar' }).click();
    await expect(a.page.getByText('só pode ter letras minúsculas')).toBeVisible();

    await a.page.getByPlaceholder('sua-conta').fill('ramon');
    await a.page.getByRole('button', { name: 'Salvar e testar' }).click();
    await expect(a.page.getByText('Worker conectado.')).toBeVisible({ timeout: 20_000 });

    const stored = readConfig(a);
    expect(stored.workerSubdomain).toBe('ramon');
    expect(stored.workerOwnerKeyEnc.length).toBeGreaterThan(20);
    expect(JSON.stringify(stored)).not.toContain(OWNER_KEY); // encrypted at rest
    // the UI only ever gets a flag, never the key
    expect(await a.page.evaluate(async () => (await window.jaca.getConfig()).workerOwnerKeyEnc)).toBe('set');
    await expect(a.page.getByPlaceholder('Chave guardada (cole outra para trocar)')).toHaveValue('');
    await expect(a.page.getByRole('button', { name: 'Testar de novo' })).toBeVisible();

    // the UI cannot overwrite the Worker settings through the generic config call
    await a.page.evaluate(() => window.jaca.setConfig({ workerSubdomain: 'attacker', workerOwnerKeyEnc: 'x' } as never));
    expect(readConfig(a).workerSubdomain).toBe('ramon');

    await a.page.getByRole('button', { name: 'Remover' }).click();
    await expect(a.page.locator('.toast', { hasText: 'Worker removido deste PC' })).toBeVisible();
    await expect.poll(() => readConfig(a).workerOwnerKeyEnc).toBe('');
    await expect(a.page.getByRole('radio', { name: 'Direto (VPN)' })).toHaveAttribute('aria-checked', 'true');
  } finally {
    await a.close();
  }
});

test('a room created through Cloudflare: short code with the account, guest only pastes it', async () => {
  const host = await launchApp('cf-host', { name: 'Ana' }, env);
  const guest = await launchApp('cf-guest', { name: 'Bia' }, env); // no Worker configured: joining needs nothing
  try {
    await configureWorker(host, 'ramon');
    await host.page.getByRole('button', { name: 'Voltar' }).click();
    await host.page.getByPlaceholder('Nome da sala (opcional)').fill('Noite de filmes');
    await host.page.getByRole('button', { name: 'Criar sala' }).click();
    const code = host.page.locator('.code-chip code');
    await expect(code).toBeVisible({ timeout: 20_000 });
    const text = (await code.textContent())!.trim();
    // the Worker writes the account into the code from its own address (jaca-sala.<account>.workers.dev); a local Worker has none, so it says "local"
    expect(text).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}@local$/);
    await expect(host.page.getByRole('heading', { name: 'Noite de filmes' })).toBeVisible();

    await guest.page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(text.toLowerCase());
    await guest.page.getByRole('button', { name: 'Entrar' }).click();
    await expect(guest.page.getByRole('heading', { name: 'Participantes' })).toBeVisible({ timeout: 20_000 });
    await expect(guest.page.getByRole('heading', { name: 'Noite de filmes' })).toBeVisible();
    await expect(guest.page.locator('.code-chip code')).toHaveText(text); // everyone sees the same canonical code
    await expect(host.page.locator('.peer-name')).toHaveText(['Ana (você)', 'Bia']);
    await expect(guest.page.locator('.peer-name')).toHaveText(['Bia (você)', 'Ana']);
    await expect(guest.page.locator('.room-timer-text')).toHaveText(/^\d{2}:\d{2}$/);

    // the owner leaving ends the room for everybody
    await host.page.getByRole('button', { name: 'Encerrar sala' }).click();
    await expect(guest.page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible({ timeout: 15_000 });
    await expect(guest.page.locator('.toast')).toContainText('A sala foi encerrada pelo host.');

    // the room is gone for good
    await guest.page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(text);
    await guest.page.getByRole('button', { name: 'Entrar' }).click();
    await expect(guest.page.locator('.toast.error').last()).toContainText('A sala não existe ou já foi encerrada');
  } finally {
    await guest.close();
    await host.close();
  }
});

test('a config that says Cloudflare but has no Worker is treated as Direto', async () => {
  const a = await launchApp('cf-nokey', { name: 'Ana', connectionMode: 'cloudflare' }, env);
  try {
    await expect(a.page.getByText('Conexão: Direto')).toBeVisible();
    await openRede(a);
    await expect(a.page.getByRole('radio', { name: 'Direto (VPN)' })).toHaveAttribute('aria-checked', 'true');
  } finally {
    await a.close();
  }
});

test('Cloudflare codes that could point anywhere else are refused before connecting', async () => {
  const a = await launchApp('cf-bad', { name: 'Bia' }, env);
  try {
    for (const bad of ['ABCDE-FGHJK@evil.com', 'ABCDE-FGHJK@localhost:8080', 'ABCDE-FGHJK@', 'ABCDE-FGHJK@-x', 'SHORT@ramon']) {
      await a.page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(bad);
      await a.page.getByRole('button', { name: 'Entrar' }).click();
      await expect(a.page.locator('.toast.error').last()).toContainText('Código de convite inválido');
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
  const a = await launchApp('vpn', { name: 'Ramon' }, { ...env, JACA_FAKE_VPNS: fake });
  try {
    await openRede(a);
    const address = a.page.getByPlaceholder('ex.: 100.101.102.103 (IP da VPN)');
    await expect(address).toHaveValue('');
    await a.page.getByRole('button', { name: 'Verificar VPN/mesh disponível' }).click();
    const options = a.page.getByRole('radio');
    await expect(a.page.getByRole('radio', { name: /Radmin VPN/ })).toBeVisible();
    await expect(a.page.getByRole('radio', { name: /Tailscale/ })).toBeVisible();
    await expect(a.page.getByText('Escolha qual usar')).toBeVisible();
    for (const o of await options.all()) if ((await o.getAttribute('class'))?.includes('vpn-option')) await expect(o).toHaveAttribute('aria-checked', 'false'); // none is chosen for you

    await a.page.getByRole('radio', { name: /Tailscale/ }).click();
    await expect(address).toHaveValue('100.64.0.9'); // filled in automatically
    await expect(a.page.getByText('Endereço preenchido: 100.64.0.9')).toBeVisible();
    await expect(a.page.getByRole('radio', { name: /Tailscale/ })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => readConfig(a).hostAddressOverride).toBe('100.64.0.9');

    await a.page.getByRole('radio', { name: /Radmin VPN/ }).click();
    await expect(address).toHaveValue('26.1.2.3');
    await expect(a.page.getByRole('radio', { name: /Tailscale/ })).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => readConfig(a).hostAddressOverride).toBe('26.1.2.3');
  } finally {
    await a.close();
  }
});

test('with no VPN or mesh on the PC the button says so', async () => {
  const a = await launchApp('vpn-none', { name: 'Ramon' }, { ...env, JACA_FAKE_VPNS: '[]' });
  try {
    await openRede(a);
    await a.page.getByRole('button', { name: 'Verificar VPN/mesh disponível' }).click();
    await expect(a.page.getByText('Não encontrei nenhuma VPN ou mesh')).toBeVisible();
    await expect(a.page.locator('.vpn-option')).toHaveCount(0);
  } finally {
    await a.close();
  }
});

test('"Testar minha rede" gives an answer', async () => {
  const a = await launchApp('nat', { name: 'Ramon' }, env);
  try {
    await openRede(a);
    await a.page.getByRole('radio', { name: 'Cloudflare' }).click(); // the test lives in the Cloudflare pane
    await a.page.getByRole('button', { name: 'Testar minha rede' }).click();
    // it asks real STUN servers, so the verdict depends on the machine; it must always end with one of the three messages
    await expect(a.page.getByText(/Boa notícia: sua rede deve fechar conexão direta|Atenção: sua rede muda o endereço público|Não consegui concluir o teste/)).toBeVisible({ timeout: 20_000 });
  } finally {
    await a.close();
  }
});
