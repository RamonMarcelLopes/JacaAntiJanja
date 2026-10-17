// The settings, as a full-screen layer. Every control animates; the theme grid changes the accent of the whole app.
import { ArrowLeft, Bell, Cast, Check, CircleAlert, CircleCheck, Cloud, Copy, Download, FileText, FolderOpen, Info, LayoutTemplate, LoaderCircle, MapPin, Megaphone, Palette, Pencil, Play, Plus, RefreshCw, Trash2, Video, Volume2, VolumeX, Wifi, type IconNode } from 'lucide';
import { encodeCloudInvite } from '../../shared/invite';
import { AppConfig, CaptureSource, DEFAULT_PORT, Fps, Resolution, RoomStatus, ShareMode, SOUND_NAMES, SoundName } from '../../shared/protocol';
import { listCameras } from '../../renderer/cameras';
import { playSound, setDisabledSounds, setNoticeSoundVolume, setSoundVolume } from '../../renderer/sounds';
import { h, icon } from '../dom';
import { toast } from '../fx';
import { currentTheme, setTheme, THEMES } from '../themes';
import { emit, hueOf, iconOf, S, subscribe, updateConfig } from '../state';
import { gradient, row, ROOM_ICONS, sectionTitle, segmented, select, slider, toggle } from './controls';
import { confirmDialog, deleteFixedRoom, editFixedRoom, openCreateRoom } from './dialogs';
import { switchInterface } from '../interface';

export type Cat = 'Rede' | 'Salas fixas' | 'Áudio' | 'Notificações' | 'Transmissão' | 'Câmera' | 'Aparência' | 'Interface' | 'Sobre';
const CATS: Array<{ id: Cat; icon: IconNode }> = [
  { id: 'Rede', icon: Wifi }, { id: 'Salas fixas', icon: MapPin }, { id: 'Áudio', icon: Volume2 }, { id: 'Notificações', icon: Bell },
  { id: 'Transmissão', icon: Cast }, { id: 'Câmera', icon: Video }, { id: 'Aparência', icon: Palette }, { id: 'Interface', icon: LayoutTemplate }, { id: 'Sobre', icon: Info },
];

let openLayer: HTMLElement | null = null;
let lastCat: Cat = 'Rede';
/** Panels that poll or listen while they are on screen register their cleanup here; it runs when another panel opens or the layer closes. */
let cleanups: Array<() => void> = [];

export function openSettings(cat?: Cat): void {
  if (openLayer) {
    if (cat) openLayer.dispatchEvent(new CustomEvent('goto', { detail: cat }));
    return;
  }
  if (cat) lastCat = cat;
  S.settingsOpen = true;
  // the panel itself never scrolls (the area around it does): a scrolling box here showed a horizontal bar for a pixel while the rows came in
  // (-mx-6 / px-6: the clipping edge sits 24 px outside the rows, so the shadow and the lift of a button at the left edge are not cut)
  const content = h('div', { class: 'overflow-x-clip -mx-6 px-6' });
  const nav = h('nav', { class: 'relative flex flex-col gap-1 px-3', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Categorias das configurações' });
  const marker = h('i', { class: 'absolute left-3 right-3 rounded-xl bg-accent/18 pointer-events-none transition-transform duration-500 ease-[var(--ease-spring)]', style: { height: '40px', top: '0', background: 'color-mix(in oklab, var(--accent) 20%, transparent)' } });
  nav.append(marker);
  const buttons = new Map<Cat, HTMLElement>();
  CATS.forEach((c, i) => {
    const b = h('button', { role: 'tab', class: 'relative z-[1] h-10 px-3 flex items-center gap-3 rounded-xl text-left font-semibold text-muted hover:text-fg transition-colors animate-slide-right', style: { animationDelay: `${i * 40}ms` }, onclick: () => show(c.id) }, icon(c.icon, 18), c.id);
    buttons.set(c.id, b);
    nav.append(b);
  });

  const close = () => {
    if (!openLayer) return;
    S.settingsOpen = false;
    document.removeEventListener('keydown', onKey);
    runCleanups();
    const layer = openLayer;
    openLayer = null;
    layer.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.04)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' }).onfinish = () => layer.remove();
    emit('settings');
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.backdrop') && !document.querySelector('.menu') && close();

  // the area that scrolls (when a panel is taller than the window); every panel starts at its top
  const scroller = h('div', { class: 'relative z-[1] h-full overflow-y-auto overflow-x-hidden px-14 pt-12 pb-8', style: { overflowAnchor: 'none' } }, h('div', { class: 'mx-auto max-w-[720px]' }, content)); // the panel sits in the middle of the free space
  const layer = h('div', { class: 'fixed inset-0 z-[70] flex bg-s2 animate-pop', 'data-testid': 'settings', role: 'dialog', 'aria-label': 'Configurações', style: { top: '32px', animationDuration: '0.5s' } },
    h('div', { class: 'w-[232px] bg-s1 border-r border-line flex flex-col items-center flex-none py-12 overflow-y-auto' },
      h('div', { class: 'w-[200px]' },
        h('div', { class: 'group flex items-center gap-3 pl-3 pb-5' },
          h('button', { class: 'grid place-items-center w-10 h-10 rounded-full border-2 border-line text-muted hover:text-accent-fg hover:bg-accent hover:border-accent hover:-translate-x-0.5 active:scale-90 transition-all duration-300', 'aria-label': 'Voltar', 'data-tip': 'Voltar · Esc', 'data-tip-side': 'bottom', onclick: close }, icon(ArrowLeft, 18)),
          h('span', { class: 'text-[11px] font-extrabold tracking-[0.12em] text-muted uppercase' }, 'Configurações'),
        ),
        nav,
      ),
    ),
    h('div', { class: 'flex-1 relative overflow-hidden' },
      h('div', { class: 'aurora' }, h('i'), h('i'), h('i')),
      scroller,
    ),
  );
  layer.addEventListener('goto', (e) => show((e as CustomEvent<Cat>).detail));
  document.body.append(layer);
  openLayer = layer;
  document.addEventListener('keydown', onKey);

  function show(id: Cat): void {
    lastCat = id;
    runCleanups();
    const i = CATS.findIndex((c) => c.id === id);
    marker.style.transform = `translateY(${i * 44}px)`;
    buttons.forEach((b, k) => {
      b.classList.toggle('!text-fg', k === id);
      b.setAttribute('aria-selected', String(k === id));
    });
    content.replaceChildren(PANELS[id]());
    scroller.scrollTop = 0; // a panel never inherits the scroll of the one before it
  }
  setTimeout(() => show(lastCat), 30);
}

function runCleanups(): void {
  const list = cleanups;
  cleanups = [];
  list.forEach((fn) => fn());
}

// ---------------------------------------------------------------------------------------------------------------- panels
const note = (text: string) => h('p', { class: 'text-muted text-[13px] leading-relaxed' }, text);
const input = (value: string, placeholder = '', width = 260, extra: Record<string, unknown> = {}) => h('input', { class: 'field', value, placeholder, spellcheck: false, style: { width: `${width}px` }, ...extra }) as HTMLInputElement;

/** A result line that turns green or red under a button. */
function resultLine(): { el: HTMLElement; say(text: string, kind?: 'ok' | 'bad' | 'muted'): void } {
  const el = h('div', { class: 'text-[13px] mt-2 min-h-5 text-muted', 'aria-live': 'polite' });
  return {
    el,
    say(text, kind = 'muted') {
      el.className = `text-[13px] mt-2 min-h-5 animate-row-in ${kind === 'ok' ? 'text-ok font-medium' : kind === 'bad' ? 'text-live font-medium' : 'text-muted'}`;
      el.textContent = text;
    },
  };
}

/** A button that shows a loading state while `run` works. */
function actionButton(text: string, run: () => Promise<void>, kind: 'btn-ghost' | 'btn-primary' = 'btn-ghost', ico?: IconNode): HTMLButtonElement {
  const btn = h('button', { class: `btn ${kind} ripple` }, ...(ico ? [icon(ico, 16)] : []), text);
  btn.onclick = async () => {
    btn.disabled = true;
    btn.replaceChildren(icon(LoaderCircle, 16, 'animate-spin'), 'Aguarde...');
    try {
      await run();
    } finally {
      btn.disabled = false;
      btn.replaceChildren(...(ico ? [icon(ico, 16)] : []), text);
    }
  };
  return btn;
}

const GUIDE_URL = 'https://github.com/RamonMarcelLopes/JacaAntiJanja/blob/main/docs/cloudflare-room-server.md';

const PANELS: Record<Cat, () => HTMLElement> = {
  Rede() {
    const pane = h('div', {});
    type Mode = 'direct' | 'cloudflare';
    let mode: Mode = S.cfg.connectionMode;
    let workerConfigured = S.cfg.connectionMode === 'cloudflare'; // refreshed from the main process below; Cloudflare is only kept when the Worker is set up

    // ---- Direto
    const port = input(String(S.cfg.port), '', 120, { type: 'number', min: 1024, max: 65535, 'aria-label': 'Porta do servidor' });
    port.onchange = async () => {
      const saved = await updateConfig({ port: Number(port.value) });
      port.value = String(saved.port);
    };
    const override = input(S.cfg.hostAddressOverride, 'ex.: 100.101.102.103', 220, { 'aria-label': 'Endereço manual' });
    override.onchange = () => void updateConfig({ hostAddressOverride: override.value.trim() });
    const vpnList = h('div', { class: 'mt-3 space-y-2', role: 'radiogroup', 'aria-label': 'Redes encontradas neste PC' });
    const vpnResult = resultLine();
    const markVpn = () => vpnList.querySelectorAll<HTMLElement>('[data-ip]').forEach((n) => n.setAttribute('aria-checked', String(n.dataset.ip === override.value.trim())));
    override.addEventListener('input', markVpn);
    const vpnBtn = actionButton('Verificar VPN/mesh disponível', async () => {
      vpnResult.say('Procurando...');
      try {
        const found = await window.jaca.detectVpns();
        vpnList.replaceChildren(
          ...found.map((v) => {
            const option = h('button', { role: 'radio', 'aria-checked': 'false', class: 'w-full text-left px-3 py-2 rounded-xl bg-s3 border border-line hover:border-accent transition-colors aria-checked:border-accent', onclick: async () => {
              override.value = v.ip;
              await updateConfig({ hostAddressOverride: v.ip });
              markVpn();
              vpnResult.say(`Endereço preenchido: ${v.ip}. As salas que você criar usam esse endereço.`, 'ok');
            } }, h('strong', {}, v.kind), h('span', { class: 'text-muted ml-2' }, `${v.ip}  ·  ${v.name}`));
            option.dataset.ip = v.ip;
            return option;
          }),
        );
        markVpn();
        if (found.length) vpnResult.say(`Encontrei ${found.length === 1 ? 'esta rede' : 'estas redes'} neste PC. Escolha qual usar:`);
        else vpnResult.say('Não encontrei nenhuma VPN ou mesh neste PC (Radmin VPN, Tailscale, ZeroTier, Hamachi...). Instale uma e abra o programa, ou use o modo Cloudflare.', 'bad');
      } catch {
        vpnResult.say('Não consegui procurar as redes deste PC.', 'bad');
      }
    });
    const connResult = resultLine();
    const connBtn = actionButton('Testar conectividade', async () => {
      connResult.say('Testando...');
      try {
        const r = await window.jaca.testConnectivity();
        connResult.say(r.message, r.ok ? 'ok' : 'bad');
      } catch {
        connResult.say('O teste falhou inesperadamente.', 'bad');
      }
    });

    // ---- Cloudflare
    const sub = input('', 'sua-conta', 260, { autocomplete: 'off', 'aria-label': 'Endereço do Worker ou nome da conta' });
    const key = input('', 'Cole a chave do dono', 260, { type: 'password', autocomplete: 'off', 'aria-label': 'Chave do dono' });
    const cloudResult = resultLine();
    const testWorker = actionButton('Testar de novo', async () => {
      cloudResult.say('Testando...');
      const r = await window.jaca.testWorker();
      cloudResult.say(r.message, r.ok ? 'ok' : 'bad');
    });
    const clearWorker = h('button', { class: 'btn btn-ghost !text-muted', onclick: async () => {
      await window.jaca.clearWorker(); // also puts the app back on the Direto mode
      mode = 'direct';
      drawMode();
      await refreshWorker();
      await updateConfig({});
      draw();
      toast('Worker removido deste PC. A conexão voltou para o modo Direto.', 'warn');
    } }, 'Remover');
    const saveWorker = actionButton('Salvar e testar', async () => {
      cloudResult.say('Testando...');
      const r = await window.jaca.saveWorker(sub.value, key.value);
      if (r.ok) {
        await refreshWorker();
        await updateConfig({ connectionMode: 'cloudflare' }); // now it is complete, so the choice is kept
      }
      cloudResult.say(r.message, r.ok ? 'ok' : 'bad');
    }, 'btn-primary');
    async function refreshWorker(): Promise<void> {
      const st = await window.jaca.workerStatus();
      workerConfigured = st.configured;
      sub.value = st.subdomain;
      key.value = '';
      key.placeholder = st.configured ? 'Chave guardada (cole outra para trocar)' : 'Cole a chave do dono';
      testWorker.hidden = clearWorker.hidden = !st.configured;
      if (st.configured) cloudResult.say(`Worker configurado: jaca-sala.${st.subdomain}.workers.dev`);
    }
    const natResult = resultLine();
    const natBtn = actionButton('Testar minha rede', async () => {
      natResult.say('Testando...');
      try {
        const r = await window.jaca.natTest();
        natResult.say(r.message, r.kind === 'cone' ? 'ok' : r.kind === 'symmetric' ? 'bad' : 'muted');
      } catch {
        natResult.say('O teste falhou inesperadamente.', 'bad');
      }
    });

    /** The choice of mode; redrawn from `mode` so it also follows changes made by the code (Remover goes back to Direto). */
    const modeHolder = h('div', {});
    const drawMode = () =>
      modeHolder.replaceChildren(
        segmented<Mode>([['direct', 'Direto (VPN)'], ['cloudflare', 'Cloudflare']], mode, (v) => {
          mode = v;
          draw();
          if (v === 'direct') void updateConfig({ connectionMode: 'direct' });
          else if (workerConfigured) void updateConfig({ connectionMode: 'cloudflare' });
          else cloudResult.say('Cole o endereço do seu Worker e toque em "Salvar e testar" (a chave do dono o app cria sozinho; deixe o campo dela vazio). Se sair sem fazer isso, o app volta para o modo Direto (VPN).', 'bad');
        }),
      );
    const draw = () => {
      pane.replaceChildren(
        mode === 'direct'
          ? h('div', { class: 'animate-row-in' },
              row('Porta', `Padrão ${DEFAULT_PORT}. Libere essa porta TCP no roteador/firewall.`, port, 40),
              row('Endereço manual', 'Deixe vazio para o app descobrir. Preencha com o IP da VPN (Radmin, Tailscale) para amigos fora da sua rede.', override, 90),
              h('div', { class: 'py-4 border-b border-line' }, h('div', { class: 'font-semibold mb-1' }, 'VPN ou rede mesh'), note('Mostra as redes virtuais deste PC.'), h('div', { class: 'mt-3' }, vpnBtn), vpnList, vpnResult.el),
              h('div', { class: 'py-4 border-b border-line' }, h('div', { class: 'font-semibold mb-1' }, 'Testar conectividade'), note('Confere se os amigos conseguem chegar até este PC.'), h('div', { class: 'mt-3' }, connBtn), connResult.el),
            )
          : h('div', { class: 'animate-row-in' },
              h('div', { class: 'py-4 border-b border-line' },
                h('div', { class: 'font-semibold mb-1' }, 'Servidor da sala'),
                note('Neste modo a sala passa pelo Worker da SUA conta grátis da Cloudflare, sem VPN. Quem entra só cola o código da sala. O vídeo e o áudio continuam indo direto entre vocês.'),
                h('ol', { class: 'list-decimal pl-5 mt-2 text-muted text-[13px] leading-relaxed space-y-1' },
                  h('li', {}, 'Toque em "Publicar na minha conta Cloudflare". Entre (ou crie uma conta grátis) e confirme. Não mude o nome jaca-sala.'),
                  h('li', {}, 'Quando terminar, copie o endereço do Worker (jaca-sala.sua-conta.workers.dev) e cole abaixo.'),
                  h('li', {}, 'Toque em "Salvar e testar": o app cria a chave do dono sozinho. Prefere usar um comando? Veja o ', h('a', { href: GUIDE_URL, target: '_blank', rel: 'noreferrer', class: 'text-accent underline' }, 'guia'), '.')),
                h('div', { class: 'mt-3' }, h('button', { class: 'btn btn-primary ripple', onclick: () => void window.jaca.openWorkerDeploy() }, icon(Cloud, 16), 'Publicar na minha conta Cloudflare'))),
              row('Endereço do Worker ou nome da conta', 'Pode colar o endereço inteiro (jaca-sala.sua-conta.workers.dev) ou só o trecho "sua-conta".', sub, 40),
              row('Chave do dono (opcional)', 'Deixe vazio para o app criar a chave sozinho. Fica guardada criptografada neste PC e nunca aparece na tela. Não é a chave da sua conta da Cloudflare.', key, 90),
              h('div', { class: 'py-4 border-b border-line' },
                h('div', { class: 'flex flex-wrap gap-2' }, saveWorker, testWorker, clearWorker),
                cloudResult.el,
                h('div', { class: 'mt-3' }, note('Se você desinstalar o app, a conexão com o seu Worker fica guardada neste PC e volta sozinha quando instalar de novo. "Remover" apaga de vez.'))),
              h('div', { class: 'py-4 border-b border-line' }, h('div', { class: 'font-semibold mb-1' }, 'Testar minha rede'), note('Mostra se uma conexão direta com seus amigos deve funcionar. Eles podem rodar o mesmo teste no PC deles.'), h('div', { class: 'mt-3' }, natBtn), natResult.el),
            ),
      );
    };
    drawMode();
    draw();
    void refreshWorker();
    cleanups.push(() => {
      // leaving with Cloudflare selected but not set up: it was never saved as the mode, so the app stays on Direto; say so
      if (mode === 'cloudflare' && !workerConfigured) {
        void updateConfig({ connectionMode: 'direct' });
        toast('O modo Cloudflare precisa do seu Worker conectado, e isso não foi feito. Voltei para o modo Direto (VPN).', 'warn');
      }
    });
    return h('div', {},
      sectionTitle('Rede', 'Como os amigos chegam até a sua sala.'),
      row('Modo de conexão', 'Cloudflare funciona sem abrir portas; Direto usa o seu IP ou uma VPN.', modeHolder, 0),
      pane);
  },

  'Salas fixas'() {
    type Filter = 'all' | 'open' | 'closed';
    let filter: Filter = 'all';
    let q = '';
    const statuses = new Map<string, RoomStatus>();
    const list = h('div', { class: 'space-y-2 mt-4', 'data-testid': 'fixed-rooms' });
    const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const statusText = (st: RoomStatus | undefined) => (!st || st.state === 'unknown' ? '' : st.state === 'closed' ? 'Fechada' : `Aberta · ${st.count === 1 ? '1 pessoa' : `${st.count ?? '?'} pessoas`}`);
    let listSig = '';
    const drawList = () => {
      const rooms = S.cfg.fixedRooms;
      const code = (id: string) => (S.cfg.workerSubdomain ? encodeCloudInvite(id, S.cfg.workerSubdomain) : '');
      const shown = rooms.filter((r) => (!q || plain(r.name).includes(plain(q))) && (filter === 'all' || statuses.get(r.id)?.state === filter));
      // the status check every 20 s mostly finds the same answers: then the rows stay (rebuilding them under the pointer made them jump)
      const sig = JSON.stringify([q, filter, S.cfg.workerSubdomain, rooms.map((r) => [r.id, r.name, r.icon, !!r.discordWebhookEnc, statusText(statuses.get(r.id))])]);
      if (sig === listSig) return;
      listSig = sig;
      if (!rooms.length) return void list.replaceChildren(h('div', { class: 'text-muted py-6' }, 'Nenhuma ainda. Use "Nova sala fixa" para criar a primeira.'));
      if (!shown.length) return void list.replaceChildren(h('div', { class: 'text-muted py-6' }, 'Nenhuma sala encontrada com esse filtro.'));
      list.replaceChildren(
        ...shown.map((r, i) => {
          const st = statuses.get(r.id);
          return h('div', { class: 'rounded-2xl bg-s3 border border-line hover:border-accent transition-colors animate-row-in', 'data-fixed': r.name, style: { animationDelay: `${i * 60}ms` } },
            h('div', { class: 'spot flex items-center gap-3 p-3' },
              h('div', { class: 'grid place-items-center w-10 h-10 rounded-xl flex-none', style: { background: gradient(hueOf(r.id)) } }, icon(ROOM_ICONS[iconOf(r.icon)], 20, 'text-white')),
              h('div', { class: 'flex-1 min-w-0' }, h('div', { class: 'font-semibold truncate' }, r.name), h('div', { class: 'text-[12px] text-muted font-mono truncate' }, code(r.id) || '—'), statusText(st) ? h('div', { class: 'text-[12px] text-muted' }, statusText(st)) : null),
              r.discordWebhookEnc ? h('span', { class: 'text-[12px] text-muted' }, 'Discord ligado') : null,
              h('button', { class: 'icon-btn', 'aria-label': `Editar ${r.name}`, 'data-tip': 'Editar sala', onclick: async () => { if (await editFixedRoom(r)) drawList(); } }, icon(Pencil, 16)),
              h('button', { class: 'icon-btn', 'aria-label': `Copiar o código de ${r.name}`, 'data-tip': 'Copiar código', onclick: async () => {
                try {
                  await window.jaca.copyText(code(r.id));
                  toast('Código copiado', 'ok');
                } catch {
                  toast('Não foi possível copiar o código', 'warn');
                }
              } }, icon(Copy, 16)),
              h('button', { class: 'icon-btn', 'aria-label': `Novo código para ${r.name}`, 'data-tip': 'Gerar código novo', onclick: () => confirmDialog('Gerar código novo', `O código antigo de "${r.name}", e os favoritos feitos com ele, deixam de funcionar. Quem a tinha nos favoritos precisa entrar com o código novo e favoritar de novo.`, 'Gerar código novo', async () => {
                await window.jaca.newFixedRoomCode(r.id);
                await updateConfig({});
                drawList();
                toast(`A sala ${r.name} ganhou um código novo`, 'ok');
              }, true, RefreshCw) }, icon(RefreshCw, 16)),
              h('button', { class: 'icon-btn hover:!text-live', 'aria-label': `Apagar ${r.name}`, 'data-tip': 'Apagar', onclick: () => deleteFixedRoom(r) }, icon(Trash2, 16)),
            ),
          );
        }),
      );
    };
    const poll = async () => {
      const rooms = S.cfg.fixedRooms;
      if (document.hidden || !rooms.length) return;
      const worker = await window.jaca.workerStatus();
      if (!worker.configured) return;
      const codes = rooms.map((r) => encodeCloudInvite(r.id, worker.subdomain));
      const results = await window.jaca.roomsStatus(codes);
      rooms.forEach((r, i) => {
        const st = results.find((x) => x.code === codes[i]);
        if (st) statuses.set(r.id, st);
      });
      drawList();
    };
    const timer = window.setInterval(() => void poll(), 20_000);
    window.setTimeout(() => void poll(), 100);
    // the list follows the config (a room deleted or renamed from a dialog)
    const stop = subscribe((what) => what === 'config' && drawList());
    cleanups.push(() => window.clearInterval(timer), stop);
    drawList();
    return h('div', {},
      sectionTitle('Salas fixas', 'Salas que abrem sempre com o mesmo código. Seus amigos podem favoritá-las. Só funcionam no modo Cloudflare.'),
      h('div', { class: 'flex items-center gap-3 mt-4' },
        h('input', { class: 'field flex-1', placeholder: 'Buscar sala fixa', 'aria-label': 'Buscar sala fixa pelo nome', maxLength: 32, spellcheck: false, oninput: (e: Event) => { q = (e.target as HTMLInputElement).value; drawList(); } }),
        segmented<Filter>([['all', 'Todas'], ['open', 'Abertas'], ['closed', 'Fechadas']], filter, (v) => { filter = v; drawList(); }),
        h('button', { class: 'btn btn-primary ripple', onclick: () => { openLayerClose(); openCreateRoom(); } }, icon(Plus, 16), 'Nova sala fixa')),
      list);
  },

  Áudio() {
    const exclude = input(S.cfg.excludeAudioProcess, 'Discord', 200, { 'aria-label': 'Processo excluído do áudio' });
    exclude.onchange = () => void updateConfig({ excludeAudioProcess: exclude.value.trim() });
    return h('div', {}, sectionTitle('Áudio', 'O som que vai junto com a sua tela.'),
      row('Excluir do áudio compartilhado', 'Processo cujo som não vai para a transmissão (evita o eco do Discord). Deixe vazio para compartilhar o som completo do sistema.', exclude, 40));
  },

  Notificações() {
    let vol = S.cfg.soundVolume;
    let before = vol > 0 ? vol : 60;
    const pct = h('span', { class: 'tabular-nums text-muted w-10 text-right' }, `${vol}%`);
    const btn = h('button', { class: 'icon-btn', 'aria-label': vol === 0 ? 'Ativar as notificações' : 'Silenciar as notificações' }, icon(vol === 0 ? VolumeX : Volume2, 18));
    const sl = slider(vol, (v) => {
      vol = v;
      setSoundVolume(v);
      pct.textContent = `${v}%`;
      btn.replaceChildren(icon(v === 0 ? VolumeX : Volume2, 18));
      btn.setAttribute('aria-label', v === 0 ? 'Ativar as notificações' : 'Silenciar as notificações');
      if (v > 0) before = v;
    }, 0, 100, (v) => {
      void updateConfig({ soundVolume: v });
      playSound('peer-join', true); // hear the new level (even if that cue is switched off)
    });
    btn.onclick = () => {
      sl.value = String(Number(sl.value) === 0 ? before : 0);
      sl.dispatchEvent(new Event('input'));
      void updateConfig({ soundVolume: Number(sl.value) });
      if (Number(sl.value) > 0) playSound('peer-join', true);
    };
    const disabled = new Set<string>(S.cfg.disabledSounds);
    type Group = 'Você' | 'Outras pessoas' | 'Avisos';
    const SOUND_TEXT: Record<SoundName, [string, Group]> = {
      'self-join': ['Você entra na sala', 'Você'], 'self-leave': ['Você sai da sala', 'Você'], 'self-share-start': ['Você começa a compartilhar', 'Você'], 'self-share-stop': ['Você para de compartilhar', 'Você'],
      'peer-join': ['Alguém entra na sala', 'Outras pessoas'], 'peer-leave': ['Alguém sai da sala', 'Outras pessoas'], 'peer-share-start': ['Alguém começa a compartilhar', 'Outras pessoas'], 'peer-share-stop': ['Alguém para de compartilhar', 'Outras pessoas'],
      notice: ['Um aviso é publicado na sala', 'Avisos'],
    };
    // the notice sound has its own volume, on top of the general one (it is the only cue that can be made quieter or louder than the others)
    const nPct = h('span', { class: 'tabular-nums text-muted w-10 text-right' }, `${S.cfg.noticeSoundVolume ?? 100}%`);
    const nSlider = slider(S.cfg.noticeSoundVolume ?? 100, (v) => {
      setNoticeSoundVolume(v);
      nPct.textContent = `${v}%`;
    }, 0, 100, (v) => {
      void updateConfig({ noticeSoundVolume: v });
      playSound('notice', true); // hear the new level
    });
    nSlider.setAttribute('aria-label', 'Volume do som de aviso');
    const noticeVolume = row('Volume do som de aviso', 'Em relação ao volume dos sons acima.', h('div', { class: 'flex items-center gap-3 w-[260px]' }, icon(Megaphone, 18, 'text-muted flex-none'), nSlider, nPct), 0);
    const group = (g: Group) =>
      h('div', { class: 'mt-6' }, h('div', { class: 'text-[11px] font-extrabold tracking-[0.1em] text-muted uppercase mb-1' }, g),
        ...SOUND_NAMES.filter((n) => SOUND_TEXT[n][1] === g).map((n, i) =>
          row(SOUND_TEXT[n][0], null, h('div', { class: 'flex items-center gap-3' },
            h('button', { class: 'icon-btn', 'aria-label': `Ouvir: ${SOUND_TEXT[n][0]}`, 'data-tip': 'Ouvir', onclick: (e: Event) => { playSound(n, true); (e.currentTarget as HTMLElement).animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 400 }); } }, icon(Play, 16)),
            toggle(!disabled.has(n), (on) => {
              if (on) disabled.delete(n);
              else disabled.add(n);
              setDisabledSounds([...disabled]);
              void updateConfig({ disabledSounds: [...disabled] as SoundName[] }); // the switch is silent: only the play button plays
            }, SOUND_TEXT[n][0])), i * 40)),
        g === 'Avisos' ? noticeVolume : null);
    return h('div', {}, sectionTitle('Notificações', 'Sons de entrada, saída, compartilhamento e avisos.'),
      row('Volume dos sons', null, h('div', { class: 'flex items-center gap-3 w-[260px]' }, btn, sl, pct), 0), group('Você'), group('Outras pessoas'), group('Avisos'),
      h('div', { class: 'mt-6' }, note('Enquanto você compartilha a tela inteira, as notificações de outras pessoas ficam mudas para não irem para a transmissão. Compartilhando uma janela, elas tocam normalmente.')));
  },

  Transmissão() {
    return h('div', {}, sectionTitle('Transmissão', 'Padrões usados quando você compartilha a tela ou uma janela.'),
      row('Codec preferido', 'Vale para as próximas transmissões. H.264 usa a placa de vídeo e pesa menos no processador.', select<AppConfig['codec']>([['auto', 'Automático'], ['vp9', 'VP9'], ['h264', 'H.264'], ['av1', 'AV1']], S.cfg.codec, (v) => void updateConfig({ codec: v }), 180, 'Codec preferido'), 40),
      row('Resolução padrão', null, select<Resolution>([['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], S.cfg.resolution, (v) => void updateConfig({ resolution: v }), 140, 'Resolução padrão da tela'), 90),
      row('FPS padrão', null, select<number>([[30, '30'], [60, '60']], S.cfg.fps, (v) => void updateConfig({ fps: v as Fps }), 140, 'FPS padrão da tela'), 140),
      row('Modo padrão', 'Movimento para jogos e vídeo; Detalhe para texto e código.', select<ShareMode>([['motion', 'Movimento (jogos/vídeo)'], ['detail', 'Detalhe (texto/código)']], S.cfg.mode, (v) => void updateConfig({ mode: v }), 240, 'Modo padrão da tela'), 190));
  },

  Câmera() {
    const holder = h('div', {});
    const draw = (cameras: CaptureSource[] | null) => {
      const saved = S.cfg.defaultCameraId;
      const options: Array<[string, string]> = [['', 'Nenhuma escolhida']];
      for (const c of cameras ?? []) options.push([c.id, c.name]);
      if (saved && !options.some(([id]) => id === saved)) options.push([saved, cameras ? 'Câmera não encontrada' : 'Câmera escolhida']);
      holder.replaceChildren(select<string>(options, saved, (v) => void updateConfig({ defaultCameraId: v }), 260, 'Câmera padrão'));
    };
    draw(null);
    let closed = false;
    cleanups.push(() => (closed = true));
    // the list is read when this panel opens (listing may ask for the camera permission)
    listCameras().then(async (list) => {
      if (!S.cfg.defaultCameraId && list.length) await updateConfig({ defaultCameraId: list[0].id }); // the first camera is the default until another is picked
      if (!closed) draw(list);
    }).catch(() => toast('Não foi possível listar as câmeras.', 'warn'));
    return h('div', {}, sectionTitle('Câmera', 'Padrões usados quando você liga a câmera. A tela e as janelas usam os da aba Transmissão.'),
      row('Câmera padrão', 'O botão de câmera da sala transmite direto essa câmera. Por padrão é a primeira que o Windows lista; troque aqui se não for a certa.', holder, 40),
      row('Resolução padrão', 'Se a câmera não tiver essa resolução, o Windows usa a mais próxima.', select<Resolution>([['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], S.cfg.cameraResolution, (v) => void updateConfig({ cameraResolution: v }), 140, 'Resolução padrão da câmera'), 90),
      row('FPS padrão', null, select<number>([[30, '30'], [60, '60']], S.cfg.cameraFps, (v) => void updateConfig({ cameraFps: v as Fps }), 140, 'FPS padrão da câmera'), 140),
      row('Modo padrão', null, select<ShareMode>([['motion', 'Movimento (rosto, gestos)'], ['detail', 'Detalhe (objetos, texto)']], S.cfg.cameraMode, (v) => void updateConfig({ cameraMode: v }), 240, 'Modo padrão da câmera'), 190));
  },

  Aparência() {
    const grid = h('div', { class: 'grid grid-cols-5 gap-3 mt-4' });
    const paint = () => {
      grid.replaceChildren(
        ...THEMES.map((t, i) => {
          const on = currentTheme().toLowerCase() === t.value.toLowerCase();
          const b = h('button', { class: `group relative flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 animate-pop ${on ? 'border-accent bg-accent/10' : 'border-line bg-s3 hover:border-accent/60'}`, style: { animationDelay: `${i * 45}ms` }, 'aria-pressed': String(on), 'aria-label': t.label },
            h('span', { class: 'grid place-items-center w-11 h-11 rounded-full transition-transform duration-300 group-hover:scale-110', style: { background: t.value, boxShadow: on ? `0 0 0 4px color-mix(in oklab, ${t.value} 30%, transparent)` : '' } }, on ? icon(Check, 20, 'text-black/70') : null),
            h('span', { class: 'text-[11px] font-semibold text-center leading-tight' }, t.label),
          );
          b.onclick = (e) => {
            setTheme(t.value, { x: e.clientX, y: e.clientY });
            setTimeout(paint, 60);
          };
          return b;
        }),
      );
    };
    paint();
    return h('div', {}, sectionTitle('Aparência', 'Escolha a cor principal do aplicativo. Ela muda botões, destaques e as superfícies.'), grid,
      h('div', { class: 'mt-6' },
        row('Fundo animado', 'As luzes que se movem devagar atrás das salas.', toggle(!document.documentElement.classList.contains('no-aurora'), (v) => {
          document.documentElement.classList.toggle('no-aurora', !v);
          try { localStorage.setItem('jaca-ui-aurora', v ? 'on' : 'off'); } catch { /* storage may be unavailable */ }
        }, 'Fundo animado'), 300),
        row('Reduzir animações', 'Tira os movimentos do aplicativo. Também segue a configuração do Windows.', toggle(document.documentElement.classList.contains('no-motion'), (v) => {
          document.documentElement.classList.toggle('no-motion', v);
          try { localStorage.setItem('jaca-ui-motion', v ? 'off' : 'on'); } catch { /* storage may be unavailable */ }
        }, 'Reduzir animações'), 350)));
  },

  Interface() {
    const inRoom = S.view === 'room';
    const result = resultLine();
    /** A tiny drawing of the screen of each interface. */
    const preview = (value: 'legacy' | 'next') => {
      if (value === 'legacy') {
        return h('div', { 'aria-hidden': 'true', class: 'grid h-[110px] rounded-xl overflow-hidden border border-line', style: { gridTemplateColumns: '44% 1fr', background: '#17130e' } },
          h('i', { style: { background: 'linear-gradient(135deg, #4f6a2a, #3d5420)' } }),
          h('span', { class: 'grid content-center gap-2 px-3' }, ...[0, 1, 2, 3].map((k) => h('b', { class: 'h-3 rounded-md', style: { background: k === 2 ? '#f2b83c' : '#2a3119' } }))));
      }
      return h('div', { 'aria-hidden': 'true', class: 'grid h-[110px] rounded-xl overflow-hidden border border-line', style: { gridTemplateColumns: '14% 24% 1fr', background: '#14151a' } },
        h('i', { style: { background: '#0b0c10' } }),
        h('i', { style: { background: '#1a1b21' } }),
        h('span', { class: 'grid grid-cols-2 gap-1.5 p-2.5', style: { background: 'linear-gradient(160deg, #1e2120, #14151a)' } }, ...[0, 1, 2, 3].map((k) => h('b', { class: 'rounded-md', style: { background: k === 0 ? 'var(--accent)' : '#262a2a', opacity: k === 0 ? '0.9' : '1' } }))));
    };
    const option = (value: 'legacy' | 'next', title: string, desc: string, delay: number) => {
      const on = S.cfg.ui === value;
      return h('button', { 'aria-pressed': String(on), 'aria-label': title, 'data-ui': value, style: { animationDelay: `${delay}ms` }, class: `group text-left p-3.5 rounded-2xl border-2 transition-all duration-300 animate-row-in ${on ? 'border-accent bg-accent/10 shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_18%,transparent)]' : 'border-line bg-s3 hover:border-accent/60 hover:-translate-y-1'} ${on || inRoom ? 'cursor-default' : ''}`, disabled: on || inRoom, onclick: async () => {
        result.say('Trocando a interface...');
        if (!(await switchInterface(value))) result.say('Não foi possível trocar agora. Saia da sala e tente de novo.', 'bad');
      } },
        preview(value),
        h('div', { class: 'flex items-center gap-2 mt-3' }, h('span', { class: 'font-display font-bold text-[17px]' }, title), on ? h('span', { class: 'px-2 h-5 inline-flex items-center rounded-full bg-accent text-accent-fg text-[11px] font-extrabold tracking-wide uppercase' }, 'Em uso') : null),
        h('div', { class: 'text-muted text-[13px] mt-1 leading-snug' }, desc));
    };
    return h('div', {}, sectionTitle('Interface', 'Escolha como o Jaca anti Janja se parece. As duas fazem as mesmas coisas, e você pode trocar quando quiser.'),
      // inside a room the choice is blocked: a box that cannot be missed says why (switching reloads the window and would end the room)
      inRoom ? h('div', { role: 'alert', class: 'mt-4 flex items-start gap-3 p-4 rounded-2xl border border-live/60 bg-live/10 animate-row-in' }, icon(CircleAlert, 20, 'text-live flex-none mt-0.5'), h('div', {}, h('div', { class: 'font-semibold' }, 'Saia da sala para trocar de interface.'), h('div', { class: 'text-muted text-[13px] mt-0.5 leading-relaxed' }, 'Trocar recarrega a janela, e isso encerraria a sala em que você está. Saia dela primeiro e escolha de novo.'))) : null,
      h('div', { class: `grid grid-cols-2 gap-4 mt-5 ${inRoom ? 'opacity-60' : ''}` },
        option('legacy', 'Clássica', 'A de sempre: simples, leve e direta.', 40),
        option('next', 'Moderna', 'Barra de salas, cores à sua escolha e animações.', 110)),
      result.el);
  },

  Sobre() {
    const status = h('div', {});
    const version = h('span', { class: 'text-muted' }, `Versão ${S.version}`);
    let statusSig = '';
    const drawStatus = () => {
      const st = S.update;
      const inRoom = S.view === 'room';
      // rebuilt only when it says something else (the download percentage alone used to replay its entrance)
      const sig = JSON.stringify([st, inRoom]);
      if (sig === statusSig) return;
      const sameKind = statusSig !== '' && JSON.parse(statusSig)[0].status === st.status;
      statusSig = sig;
      if (sameKind && st.status === 'downloading') {
        const line = status.querySelector('[data-progress]');
        if (line) return void (line.textContent = `Baixando a versão ${st.version}... ${st.percent ?? 0}%`);
      }
      status.replaceChildren(
        st.status === 'available'
          ? h('div', { class: 'p-4 rounded-2xl border border-accent/50 bg-accent/10 animate-row-in' },
              h('div', { class: 'flex items-center gap-3' }, icon(Download, 20, 'text-accent'), h('div', { class: 'flex-1' }, h('div', { class: 'font-semibold' }, `Há uma atualização: a versão ${st.version} está disponível.`), h('div', { class: 'text-[13px] text-muted' }, 'Ela só é instalada quando você apertar o botão.')),
                h('button', { class: 'btn btn-primary ripple', disabled: inRoom, title: inRoom ? 'Atualizar reinicia o app: saia da sala primeiro.' : '', onclick: () => void window.jaca.installUpdate() }, inRoom ? 'Saia da sala para instalar' : `Instalar a versão ${st.version}`)))
          : h('div', { class: 'p-4 rounded-2xl border border-line bg-s3 flex items-center gap-3 animate-row-in' }, icon(CircleCheck, 20, st.status === 'error' ? 'text-live' : 'text-ok'),
              h('span', { 'data-progress': '' }, st.status === 'checking' ? 'Verificando...' : st.status === 'downloading' ? `Baixando a versão ${st.version}... ${st.percent ?? 0}%` : st.status === 'ready' ? 'Instalando a atualização...' : st.status === 'error' ? `Não foi possível verificar: ${st.message ?? 'erro desconhecido'}` : st.status === 'disabled' ? (st.message ?? '') : 'Você está na versão mais recente.')),
      );
    };
    drawStatus();
    const unsub = ((what: string) => (what === 'update' ? drawStatus() : undefined));
    updateListeners.add(unsub);
    cleanups.push(() => updateListeners.delete(unsub));
    return h('div', {}, sectionTitle('Sobre'),
      h('div', { class: 'flex items-center gap-4 mt-3 mb-4' }, h('img', { src: 'icon.png', alt: '', class: 'w-14 h-14 rounded-2xl' }), h('div', {}, h('div', { class: 'font-display font-bold text-lg' }, 'Jaca anti Janja'), version),
        h('button', { class: 'btn btn-ghost ripple', onclick: () => void window.jaca.checkForUpdates() }, icon(RefreshCw, 15), 'Verificar atualizações')),
      status,
      h('div', { class: 'mt-6 p-5 rounded-2xl bg-s3 border border-line animate-row-in', style: { animationDelay: '120ms' } },
        h('div', { class: 'flex items-center gap-2 font-display font-bold mb-1' }, icon(FileText, 18, 'text-accent'), 'Registro de erros'),
        note('Quando algo dá errado (entrar numa sala, criar uma sala, quedas de conexão, rede), o app anota num arquivo de texto neste PC. Nunca vão chaves nem o código inteiro da sala. Se precisar de ajuda, mande esse arquivo.'),
        h('button', { class: 'btn btn-ghost mt-3 ripple', onclick: () => void window.jaca.openLogFolder() }, icon(FolderOpen, 15), 'Abrir pasta do registro')));
  },
};

/** Panels that show the update status listen here; main.ts calls it when the status changes. */
const updateListeners = new Set<(what: string) => void>();
export const notifySettings = (what: string): void => updateListeners.forEach((fn) => fn(what));

/** Closes the settings layer (used when a button inside it opens a dialog of the rest of the app). */
function openLayerClose(): void {
  const layer = openLayer;
  if (!layer) return;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}
