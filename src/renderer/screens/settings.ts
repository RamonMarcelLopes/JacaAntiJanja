import { encodeCloudInvite } from '../../shared/invite';
import { listCameras } from '../cameras';
import { AppConfig, CaptureSource, DEFAULT_PORT, Fps, Resolution, RoomStatus, ShareMode, UpdateState } from '../../shared/protocol';
import { h, toast } from '../dom';
import { speakerSvg } from '../icons';
import { deleteFixedRoom, editFixedRoom } from '../fixed-rooms';
import { customSelect } from '../select';
import { playSound, setDisabledSounds, setSoundVolume, SoundName } from '../sounds';
import { currentState, isInRoom, onUpdateChange } from '../update-banner';

export interface SettingsContext {
  cfg: AppConfig;
  update(patch: Partial<AppConfig>): Promise<AppConfig>;
  back(): void;
}

type Category = 'rede' | 'salas' | 'audio' | 'notificacoes' | 'transmissao' | 'camera' | 'interface' | 'sobre';

const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

// Static markup (no user data): wifi, speaker, cast and info icons.
const CATEGORIES: Array<{ id: Category; label: string; icon: string }> = [
  {
    id: 'rede',
    label: 'Rede',
    icon: svg('<path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>'),
  },
  {
    id: 'salas',
    label: 'Salas fixas',
    icon: svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'), // pin
  },
  {
    id: 'audio',
    label: 'Áudio',
    icon: svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'),
  },
  {
    id: 'notificacoes',
    label: 'Notificações',
    icon: svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'), // bell
  },
  {
    id: 'transmissao',
    label: 'Transmissão',
    icon: svg('<path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><line x1="2" y1="20" x2="2.01" y2="20"/>'),
  },
  {
    id: 'camera',
    label: 'Câmera',
    icon: svg('<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
  },
  {
    id: 'interface',
    label: 'Interface',
    icon: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>'), // layout
  },
  {
    id: 'sobre',
    label: 'Sobre',
    icon: svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
  },
];

/** Remembers the last category while the app is open, so coming back to Settings lands where you were. */
let lastCategory: Category = 'rede';

/** The next time Settings opens it lands on the Interface category (the notice about the new interface leads there). */
export function openSettingsOnInterface(): void {
  lastCategory = 'interface';
}

/** Round icon button with a left arrow, placed before the page title. */
function backButton(onclick: () => void): HTMLButtonElement {
  const btn = h('button', { class: 'back-btn', title: 'Voltar', 'aria-label': 'Voltar', onclick });
  // static markup, no user data
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
  return btn;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'muted' }, hint) : null);
}

const select = customSelect; // custom dropdown, see select.ts

function updateTexts(st: UpdateState): string {
  switch (st.status) {
    case 'disabled':
      return st.message ?? '';
    case 'checking':
      return 'Verificando...';
    case 'none':
      return 'Você está na versão mais recente.';
    case 'available':
      return `Há uma atualização: a versão ${st.version} está disponível. Ela só é instalada quando você apertar o botão abaixo.`;
    case 'downloading':
      return `Baixando a versão ${st.version}... ${st.percent ?? 0}%`;
    case 'ready':
      return 'Instalando a atualização...';
    case 'error':
      return `Não foi possível verificar: ${st.message ?? 'erro desconhecido'}`;
    default:
      return '';
  }
}

export function renderSettings(ctx: SettingsContext): { el: HTMLElement; dispose(): void } {
  const { cfg } = ctx;
  const result = h('div', { class: 'test-result muted' }, 'Verifica se a porta do host está acessível pela internet.');

  const port = h('input', { type: 'number', min: 1024, max: 65535, value: String(cfg.port) });
  port.onchange = async () => {
    const saved = await ctx.update({ port: Number(port.value) });
    port.value = String(saved.port);
  };
  const override = h('input', { type: 'text', placeholder: 'ex.: 100.101.102.103 (IP da VPN)', value: cfg.hostAddressOverride });
  override.onchange = () => void ctx.update({ hostAddressOverride: override.value.trim() });
  const exclude = h('input', { type: 'text', placeholder: 'Discord', value: cfg.excludeAudioProcess });
  exclude.onchange = () => void ctx.update({ excludeAudioProcess: exclude.value.trim() });

  const testBtn = h(
    'button',
    {
      onclick: async () => {
        testBtn.disabled = true;
        result.className = 'test-result muted';
        result.textContent = 'Testando...';
        try {
          const r = await window.jaca.testConnectivity();
          result.className = `test-result ${r.ok ? 'ok' : 'bad'}`;
          result.textContent = r.message;
        } catch {
          result.className = 'test-result bad';
          result.textContent = 'O teste falhou inesperadamente.';
        } finally {
          testBtn.disabled = false;
        }
      },
    },
    'Testar conectividade',
  );

  const versionText = h('span', { class: 'muted' }, 'Versão ...');
  void window.jaca.getVersion().then((v) => (versionText.textContent = `Versão ${v}`));
  const updateText = h('div', { class: 'test-result muted' });
  const checkBtn = h('button', { onclick: () => void window.jaca.checkForUpdates() }, 'Verificar atualizações');
  // Only while an update is waiting: installs it (the app restarts), unless a room is open
  const installBtn = h('button', { class: 'primary', onclick: () => void window.jaca.installUpdate() });
  const drawUpdate = (st: UpdateState) => {
    updateText.textContent = updateTexts(st);
    updateText.className = `test-result ${st.status === 'error' ? 'bad' : 'muted'}`;
    checkBtn.disabled = st.status === 'checking' || st.status === 'downloading' || st.status === 'ready';
    installBtn.style.display = st.status === 'available' ? '' : 'none';
    installBtn.disabled = isInRoom();
    installBtn.textContent = isInRoom() ? 'Saia da sala para instalar' : `Instalar a versão ${st.version ?? ''}`.trim();
    installBtn.title = isInRoom() ? 'Atualizar reinicia o app: saia da sala primeiro.' : '';
  };
  drawUpdate(currentState());
  const unsubscribe = onUpdateChange(drawUpdate);

  // ---- Sons: volume of the sound effects and a button to hear each one
  const initialVolume = ctx.cfg.soundVolume;
  let volumeBeforeMute = initialVolume > 0 ? initialVolume : 60;
  const soundSlider = h('input', { type: 'range', min: 0, max: 100, value: String(initialVolume), class: 'volume', 'aria-label': 'Volume das notificações' });
  const soundPct = h('span', { class: 'volume-pct' }, String(initialVolume) + '%');
  const soundBtn = h('button', { class: 'ghost icon-btn' });
  const applySoundVolume = () => {
    const v = Number(soundSlider.value);
    setSoundVolume(v);
    soundSlider.style.setProperty('--v', String(v) + '%'); // filled part of the slider
    soundPct.textContent = String(v) + '%';
    soundBtn.innerHTML = speakerSvg(v); // static markup, no user data
    const label = v === 0 ? 'Ativar as notificações' : 'Silenciar as notificações';
    soundBtn.title = label;
    soundBtn.setAttribute('aria-label', label);
    if (v > 0) volumeBeforeMute = v;
  };
  const saveSoundVolume = (preview: boolean) => {
    void ctx.update({ soundVolume: Number(soundSlider.value) });
    if (preview) playSound('peer-join', true); // hear the new level (even if that cue is switched off)
  };
  soundSlider.oninput = applySoundVolume;
  soundSlider.onchange = () => saveSoundVolume(true);
  soundBtn.onclick = () => {
    soundSlider.value = Number(soundSlider.value) === 0 ? String(volumeBeforeMute) : '0';
    applySoundVolume();
    saveSoundVolume(Number(soundSlider.value) > 0);
  };
  applySoundVolume();

  const PLAY_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
  // one row per notification: its name, a play button (always plays, to preview it) and a switch to turn that notification off
  const disabledSounds = new Set<string>(ctx.cfg.disabledSounds);
  const soundRow = (name: SoundName, label: string) => {
    const play = h('button', { class: 'sound-play', title: 'Ouvir: ' + label, 'aria-label': 'Ouvir: ' + label, onclick: () => playSound(name, true) });
    play.innerHTML = PLAY_SVG; // static markup, no user data
    const toggle = h('button', { class: 'switch', role: 'switch', 'aria-label': label, title: 'Ligar ou desligar esta notificação' });
    const row = h('div', { class: 'sound-row' }, h('span', {}, label), h('div', { class: 'sound-actions' }, play, toggle));
    const draw = () => {
      const on = !disabledSounds.has(name);
      toggle.setAttribute('aria-checked', String(on));
      row.classList.toggle('off', !on);
    };
    toggle.onclick = () => {
      if (disabledSounds.has(name)) disabledSounds.delete(name);
      else disabledSounds.add(name);
      draw();
      setDisabledSounds([...disabledSounds]);
      void ctx.update({ disabledSounds: [...disabledSounds] as SoundName[] }); // the switch is silent: only the play button plays
    };
    draw();
    return row;
  };
  const soundsPanel = h(
    'section',
    {},
    h('h2', {}, 'Notificações'),
    h('p', { class: 'muted' }, 'Notificações sonoras de entrada, saída e compartilhamento.'),
    h('div', { class: 'sound-volume' }, soundBtn, soundSlider, soundPct),
    h('h3', { class: 'sound-group-title' }, 'Você'),
    soundRow('self-join', 'Você entra na sala'),
    soundRow('self-leave', 'Você sai da sala'),
    soundRow('self-share-start', 'Você começa a compartilhar'),
    soundRow('self-share-stop', 'Você para de compartilhar'),
    h('h3', { class: 'sound-group-title' }, 'Outras pessoas'),
    soundRow('peer-join', 'Alguém entra na sala'),
    soundRow('peer-leave', 'Alguém sai da sala'),
    soundRow('peer-share-start', 'Alguém começa a compartilhar'),
    soundRow('peer-share-stop', 'Alguém para de compartilhar'),
    h('p', { class: 'muted sound-hint' }, 'Enquanto você compartilha a tela inteira, as notificações de outras pessoas ficam mudas para não irem para a transmissão. Compartilhando uma janela, elas tocam normalmente.'),
  );

  // ---- Rede: how rooms connect. "Direto" (Radmin/VPN, the default) or "Cloudflare" (the owner's own Worker), plus a network test
  const GUIDE_URL = 'https://github.com/RamonMarcelLopes/JacaAntiJanja/blob/main/docs/cloudflare-room-server.md';
  type Mode = 'direct' | 'cloudflare';
  let mode: Mode = ctx.cfg.connectionMode;
  let workerConfigured = ctx.cfg.connectionMode === 'cloudflare'; // refreshed from the main process below; Cloudflare is only kept when the Worker is set up

  // Direto: find the mesh/VPN networks of this PC, let the user pick one, and fill the address in
  const vpnList = h('div', { class: 'vpn-list', role: 'radiogroup', 'aria-label': 'Redes encontradas neste PC' });
  const vpnStatus = h('div', { class: 'test-result muted' });
  const markVpn = () =>
    vpnList.querySelectorAll<HTMLElement>('.vpn-option').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.ip === override.value.trim())));
  override.addEventListener('input', markVpn);
  const pickVpn = async (ip: string) => {
    override.value = ip;
    await ctx.update({ hostAddressOverride: ip });
    markVpn();
    vpnStatus.className = 'test-result ok';
    vpnStatus.textContent = 'Endereço preenchido: ' + ip + '. As salas que você criar usam esse endereço.';
  };
  const vpnBtn = h(
    'button',
    {
      onclick: async () => {
        vpnBtn.disabled = true;
        vpnStatus.className = 'test-result muted';
        vpnStatus.textContent = 'Procurando...';
        try {
          const found = await window.jaca.detectVpns();
          vpnList.replaceChildren(
            ...found.map((v) => {
              const option = h(
                'button',
                { class: 'vpn-option', role: 'radio', 'aria-checked': 'false', onclick: () => void pickVpn(v.ip) },
                h('strong', {}, v.kind),
                h('span', { class: 'muted' }, v.ip + '  ·  ' + v.name),
              );
              option.dataset.ip = v.ip;
              return option;
            }),
          );
          if (found.length) {
            markVpn();
            vpnStatus.textContent = 'Encontrei ' + (found.length === 1 ? 'esta rede' : 'estas redes') + ' neste PC. Escolha qual usar:';
          } else {
            vpnStatus.className = 'test-result bad';
            vpnStatus.textContent = 'Não encontrei nenhuma VPN ou mesh neste PC (Radmin VPN, Tailscale, ZeroTier, Hamachi...). Instale uma e abra o programa, ou use o modo Cloudflare.';
          }
        } catch {
          vpnStatus.className = 'test-result bad';
          vpnStatus.textContent = 'Não consegui procurar as redes deste PC.';
        } finally {
          vpnBtn.disabled = false;
        }
      },
    },
    'Verificar VPN/mesh disponível',
  );
  const directPane = h(
    'div',
    { class: 'mode-pane' },
    field('Porta do servidor', port, `Padrão ${DEFAULT_PORT}. Libere essa porta TCP no roteador/firewall.`),
    field('Endereço manual (opcional)', override, 'IP da sua VPN ou mesh (Radmin, Tailscale, ZeroTier). Use o botão abaixo para o app achar a rede e preencher sozinho.'),
    vpnBtn,
    vpnList,
    vpnStatus,
    testBtn,
    result,
  );

  // Cloudflare: the Worker of the room owner (this PC), checked and saved with the owner key (kept encrypted by the main process)
  const subInput = h('input', { type: 'text', placeholder: 'sua-conta', spellcheck: false, autocomplete: 'off' });
  const keyInput = h('input', { type: 'password', placeholder: 'Cole a chave do dono', autocomplete: 'off' });
  const deployBtn = h('button', { class: 'primary', onclick: () => void window.jaca.openWorkerDeploy() }, 'Publicar na minha conta Cloudflare');
  const cloudStatus = h('div', { class: 'test-result muted' });
  const say = (r: { ok: boolean; message: string }) => {
    cloudStatus.className = 'test-result ' + (r.ok ? 'ok' : 'bad');
    cloudStatus.textContent = r.message;
  };
  const saveWorkerBtn = h('button', { class: 'primary' }, 'Salvar e testar');
  const testWorkerBtn = h('button', {}, 'Testar de novo');
  const clearWorkerBtn = h('button', { class: 'ghost' }, 'Remover');
  const refreshWorker = async () => {
    const st = await window.jaca.workerStatus();
    workerConfigured = st.configured;
    subInput.value = st.subdomain;
    keyInput.value = '';
    keyInput.placeholder = st.configured ? 'Chave guardada (cole outra para trocar)' : 'Cole a chave do dono';
    testWorkerBtn.hidden = clearWorkerBtn.hidden = !st.configured;
    if (st.configured) {
      cloudStatus.className = 'test-result muted';
      cloudStatus.textContent = 'Worker configurado: jaca-sala.' + st.subdomain + '.workers.dev';
    }
  };
  saveWorkerBtn.onclick = async () => {
    saveWorkerBtn.disabled = true;
    cloudStatus.className = 'test-result muted';
    cloudStatus.textContent = 'Testando...';
    try {
      const r = await window.jaca.saveWorker(subInput.value, keyInput.value);
      if (r.ok) {
        await refreshWorker();
        await ctx.update({ connectionMode: 'cloudflare' }); // now it is complete, so the choice is kept
      }
      say(r);
    } finally {
      saveWorkerBtn.disabled = false;
    }
  };
  testWorkerBtn.onclick = async () => {
    testWorkerBtn.disabled = true;
    cloudStatus.className = 'test-result muted';
    cloudStatus.textContent = 'Testando...';
    try {
      say(await window.jaca.testWorker());
    } finally {
      testWorkerBtn.disabled = false;
    }
  };
  clearWorkerBtn.onclick = async () => {
    await window.jaca.clearWorker(); // also puts the app back on the Direto mode
    mode = 'direct';
    drawMode();
    await refreshWorker();
    toast('Worker removido deste PC. A conexão voltou para o modo Direto.'); // a toast: the Cloudflare pane is hidden now
  };
  const cloudPane = h(
    'div',
    { class: 'mode-pane' },
    h(
      'div',
      { class: 'cloud-intro' },
      h('p', { class: 'muted' }, 'Neste modo a sala passa pelo Worker da SUA conta grátis da Cloudflare, sem VPN. Quem entra só cola o código da sala, sem configurar nada. O vídeo e o áudio continuam indo direto entre vocês.'),
      h(
        'ol',
        { class: 'steps muted' },
        h('li', {}, 'Toque em "Publicar na minha conta Cloudflare". Abre a página da Cloudflare: entre (ou crie uma conta grátis) e confirme. Não mude o nome jaca-sala.'),
        h('li', {}, 'Quando terminar, copie o endereço do Worker (jaca-sala.sua-conta.workers.dev) e cole abaixo.'),
        h('li', {}, 'Toque em "Salvar e testar": o app cria a chave do dono sozinho. Prefere usar um comando? Veja o ', h('a', { href: GUIDE_URL, target: '_blank', rel: 'noreferrer' }, 'guia'), '.'),
      ),
    ),
    deployBtn,
    field('Endereço do Worker ou nome da conta', subInput, 'Pode colar o endereço inteiro (jaca-sala.sua-conta.workers.dev) ou só o trecho "sua-conta".'),
    field('Chave do dono (opcional)', keyInput, 'Deixe vazio para o app criar a chave sozinho. Preencha só se você publicou pelo comando ou já tem uma chave. Fica guardada criptografada neste PC e nunca aparece na tela. Não é a chave da sua conta da Cloudflare.'),
    h('div', { class: 'row wrap' }, saveWorkerBtn, testWorkerBtn, clearWorkerBtn),
    cloudStatus,
    h('p', { class: 'muted' }, 'Se você desinstalar o app, a conexão com o seu Worker fica guardada neste PC (protegida pelo seu usuário do Windows) e volta sozinha quando instalar de novo. "Remover" apaga de vez.'),
  );

  // the mode choice: a segmented control with a sliding highlight, like Telas / Janelas
  const modeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Como a sala conecta' });
  const modeButtons = new Map<Mode, HTMLButtonElement>();
  const drawMode = () => {
    modeSeg.dataset.pos = mode === 'cloudflare' ? '1' : '0';
    for (const [m, b] of modeButtons) b.setAttribute('aria-checked', String(m === mode));
    directPane.hidden = mode !== 'direct';
    cloudPane.hidden = mode !== 'cloudflare';
  };
  for (const [m, label] of [['direct', 'Direto (VPN)'], ['cloudflare', 'Cloudflare']] as Array<[Mode, string]>) {
    const b = h(
      'button',
      {
        class: 'seg-btn',
        role: 'radio',
        onclick: () => {
          mode = m;
          drawMode();
          if (m === 'direct') void ctx.update({ connectionMode: 'direct' });
          else if (workerConfigured) void ctx.update({ connectionMode: 'cloudflare' });
          else {
            // not saved as the mode yet: it needs the account name and the owner key
            cloudStatus.className = 'test-result bad';
            cloudStatus.textContent = 'Cole o endereço do seu Worker e toque em "Salvar e testar" (a chave do dono o app cria sozinho; deixe o campo dela vazio). Se sair sem fazer isso, o app volta para o modo Direto (VPN).';
          }
        },
      },
      label,
    );
    modeButtons.set(m, b);
    modeSeg.append(b);
  }

  // network test: can a direct connection with a friend work from this PC?
  const natResult = h('div', { class: 'test-result muted' }, 'Mostra se uma conexão direta com seus amigos deve funcionar. Eles podem rodar o mesmo teste no PC deles.');
  const natBtn = h(
    'button',
    {
      onclick: async () => {
        natBtn.disabled = true;
        natResult.className = 'test-result muted';
        natResult.textContent = 'Testando...';
        try {
          const r = await window.jaca.natTest();
          natResult.className = 'test-result ' + (r.kind === 'cone' ? 'ok' : r.kind === 'symmetric' ? 'bad' : 'muted');
          natResult.textContent = r.message;
        } catch {
          natResult.className = 'test-result bad';
          natResult.textContent = 'O teste falhou inesperadamente.';
        } finally {
          natBtn.disabled = false;
        }
      },
    },
    'Testar minha rede',
  );

  const redePanel = h(
    'section',
    {},
    h('h2', {}, 'Rede'),
    h('p', { class: 'muted' }, 'Como as salas que você cria se conectam com seus amigos.'),
    modeSeg,
    directPane,
    cloudPane,
  );
  // the network test only matters for Cloudflare rooms (it tells whether the direct connection after the handshake can work), so it lives in that pane
  cloudPane.append(h('h3', { class: 'sound-group-title' }, 'Diagnóstico'), natBtn, natResult);

  // fixed rooms: created from the home screen (kind of room > "+ Nova sala fixa"); here they are renamed, get a new code or are deleted.
  // Filters like the favorites list on the home screen: by name and by open / closed (asked to the host's own Worker every 20 s).
  type FixedFilter = 'all' | 'open' | 'closed';
  let fixedFilter: FixedFilter = 'all';
  const fixedStatuses = new Map<string, RoomStatus>(); // by room id
  const fixedList = h('div', { class: 'fav-list' });
  const fixedSearch = h('input', { type: 'search', class: 'fav-search', placeholder: 'Buscar sala pelo nome', maxLength: 32, 'aria-label': 'Buscar sala fixa pelo nome', spellcheck: false });
  fixedSearch.addEventListener('input', () => drawFixedRooms());
  const fixedSeg = h('div', { class: 'seg seg3', role: 'radiogroup', 'aria-label': 'Filtrar salas fixas por estado' });
  fixedSeg.dataset.pos = '0';
  const fixedFilterButtons = new Map<FixedFilter, HTMLButtonElement>();
  for (const [value, label] of [['all', 'Todas'], ['open', 'Abertas'], ['closed', 'Fechadas']] as Array<[FixedFilter, string]>) {
    const btn = h('button', { class: 'seg-btn', role: 'radio', 'aria-checked': String(value === fixedFilter) }, label);
    btn.onclick = () => {
      fixedFilter = value;
      fixedSeg.dataset.pos = String(['all', 'open', 'closed'].indexOf(value));
      for (const [v, b] of fixedFilterButtons) b.setAttribute('aria-checked', String(v === value));
      drawFixedRooms();
    };
    fixedFilterButtons.set(value, btn);
    fixedSeg.append(btn);
  }
  /** Lower case without accents, so "sala do joao" finds "Sala do João". */
  const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fixedStatusText = (st: RoomStatus | undefined): string => {
    if (!st || st.state === 'unknown') return '';
    if (st.state === 'closed') return 'Fechada';
    return `Aberta · ${st.count === 1 ? '1 pessoa' : `${st.count ?? '?'} pessoas`}`;
  };
  let fixedSig = '';
  let fixedDrawn = false;
  const drawFixedRooms = () => {
    const rooms = ctx.cfg.fixedRooms;
    const query = plain(fixedSearch.value.trim());
    const visible = rooms.filter((r) => (!query || plain(r.name).includes(query)) && (fixedFilter === 'all' || fixedStatuses.get(r.id)?.state === fixedFilter));
    // redraw only when something changed, so the rows do not replay their entrance while typing or on every status check
    const sig = JSON.stringify([rooms.length, fixedFilter, query, visible.map((r) => [r.id, r.name, fixedStatuses.get(r.id)?.state, fixedStatuses.get(r.id)?.count])]);
    if (sig === fixedSig) return;
    fixedSig = sig;
    fixedList.classList.toggle('static', fixedDrawn);
    fixedDrawn = true;
    if (!rooms.length) {
      fixedList.replaceChildren(h('p', { class: 'muted' }, 'Nenhuma ainda. Na tela inicial, em "Iniciar sala", escolha "+ Nova sala fixa" no seletor.'));
      return;
    }
    if (!visible.length) {
      fixedList.replaceChildren(h('p', { class: 'muted' }, 'Nenhuma sala encontrada com esse filtro.'));
      return;
    }
    fixedList.replaceChildren(
      ...visible.map((room) => {
        const edit = h('button', { class: 'ghost', onclick: async () => { if (await editFixedRoom(ctx, room)) drawFixedRooms(); } }, 'Editar sala');
        const newCode = h('button', {
          class: 'ghost',
          title: 'Gera um código novo: o antigo, e os favoritos feitos com ele, deixam de funcionar',
          onclick: async () => {
            await window.jaca.newFixedRoomCode(room.id);
            await ctx.update({});
            drawFixedRooms();
            toast(`A sala ${room.name} ganhou um código novo. Quem a tinha nos favoritos precisa entrar com o código novo e favoritar de novo.`);
          },
        }, 'Novo código');
        const remove = h('button', { class: 'ghost danger-text', onclick: async () => { if (await deleteFixedRoom(ctx, room)) drawFixedRooms(); } }, 'Apagar');
        const st = fixedStatuses.get(room.id);
        return h(
          'div',
          { class: 'fav-row', 'data-state': st?.state ?? 'unknown' },
          h('span', { class: 'fav-dot', 'aria-hidden': 'true' }),
          h('div', { class: 'fav-info' }, h('strong', {}, room.name), fixedStatusText(st) ? h('small', { class: 'muted' }, fixedStatusText(st)) : null),
          edit,
          newCode,
          remove,
        );
      }),
    );
  };
  drawFixedRooms();
  // which of the host's fixed rooms are open now (the same question the guests' favorites ask)
  let settingsClosed = false;
  const pollFixed = async () => {
    const rooms = ctx.cfg.fixedRooms;
    if (settingsClosed || document.hidden || !rooms.length) return;
    const worker = await window.jaca.workerStatus();
    if (!worker.configured) return;
    const codes = rooms.map((r) => encodeCloudInvite(r.id, worker.subdomain));
    const results = await window.jaca.roomsStatus(codes);
    if (settingsClosed) return;
    rooms.forEach((r, i) => {
      const st = results.find((x) => x.code === codes[i]);
      if (st) fixedStatuses.set(r.id, st);
    });
    drawFixedRooms();
  };
  window.setTimeout(() => void pollFixed(), 100);
  const fixedPollTimer = window.setInterval(() => void pollFixed(), 20_000);
  drawMode();
  void refreshWorker();

  // Default camera of the room's camera button. The list is read the first time the Câmera tab opens (listing may ask for the camera permission).
  const cameraHolder = h('div', { class: 'camera-pick' });
  const drawCameraSelect = (cameras: CaptureSource[] | null) => {
    const saved = ctx.cfg.defaultCameraId;
    const options: Array<[string, string]> = [['', 'Nenhuma escolhida']];
    for (const c of cameras ?? []) options.push([c.id, c.name]);
    if (saved && !options.some(([id]) => id === saved)) options.push([saved, cameras ? 'Câmera não encontrada' : 'Câmera escolhida']);
    cameraHolder.replaceChildren(select<string>(saved, options, (v) => void ctx.update({ defaultCameraId: v })));
  };
  drawCameraSelect(null);
  let camerasLoaded = false;
  const loadCameraList = () => {
    if (camerasLoaded) return;
    camerasLoaded = true;
    listCameras()
      .then(async (list) => {
        if (!ctx.cfg.defaultCameraId && list.length) await ctx.update({ defaultCameraId: list[0].id }); // the first camera is the default until another is picked
        if (!settingsClosed) drawCameraSelect(list);
      })
      .catch(() => {
        camerasLoaded = false;
        toast('Não foi possível listar as câmeras.', 'error');
      });
  };

  // Interface: the classic one (this) or the modern one. Switching reloads the window, so it is refused while a room is open.
  const interfaceNote = h('div', { class: 'test-result muted' }, '');
  /** A tiny drawing of the screen of each interface. */
  const preview = (kind: 'legacy' | 'next') => {
    const el = h('div', { class: `ui-prev ui-prev-${kind}`, 'aria-hidden': 'true' });
    el.innerHTML =
      kind === 'legacy'
        ? '<i class="a"></i><span class="b"><b></b><b></b><b class="hot"></b><b></b></span>'
        : '<i class="r"></i><i class="s"></i><span class="m"><b></b><b></b><b></b><b></b></span>'; // static markup, no user data
    return el;
  };
  const interfaceOption = (value: 'legacy' | 'next', title: string, text: string) => {
    const selected = ctx.cfg.ui === value;
    return h(
      'button',
      {
        class: 'ui-option',
        role: 'radio',
        'aria-checked': String(selected),
        'aria-label': title,
        'data-ui': value,
        disabled: selected || isInRoom(),
        onclick: async () => {
          interfaceNote.className = 'test-result muted';
          interfaceNote.textContent = 'Trocando a interface...';
          if (!(await window.jaca.setUi(value))) {
            interfaceNote.className = 'test-result bad';
            interfaceNote.textContent = 'Não foi possível trocar agora. Saia da sala e tente de novo.';
          }
        },
      },
      preview(value),
      h('span', { class: 'ui-option-title' }, h('strong', {}, title), selected ? h('em', {}, 'Em uso') : null),
      h('span', { class: 'muted ui-option-text' }, text),
    );
  };
  // inside a room the choice is blocked: say so in a box that cannot be missed (switching reloads the window and would end the room)
  const roomWarning = isInRoom()
    ? h('div', { class: 'ui-room-warning', role: 'alert' }, h('strong', {}, 'Saia da sala para trocar de interface.'), h('span', {}, 'Trocar recarrega a janela, e isso encerraria a sala em que você está. Saia dela primeiro e escolha de novo.'))
    : null;
  const interfacePicker = h(
    'div',
    {},
    roomWarning,
    h('div', { class: 'ui-list', role: 'radiogroup', 'aria-label': 'Interface do aplicativo' },
      interfaceOption('legacy', 'Clássica', 'A de sempre: simples, leve e direta.'),
      interfaceOption('next', 'Moderna', 'Barra de salas, cores à sua escolha e animações.'),
    ),
    interfaceNote,
  );

  const panels: Record<Category, HTMLElement> = {
    rede: redePanel,
    salas: h(
      'section',
      {},
      h('h2', {}, 'Salas fixas'),
      h('p', { class: 'muted' }, 'Salas que abrem sempre com o mesmo código. Seus amigos podem favoritá-las para ver quando estão abertas. Só funcionam no modo Cloudflare.'),
      h('div', { class: 'fav-filters' }, fixedSearch, fixedSeg),
      fixedList,
    ),
    audio: h(
      'section',
      {},
      h('h2', {}, 'Áudio'),
      field('Excluir do áudio compartilhado', exclude, 'Processo cujo som não vai para a transmissão (evita o eco do Discord). Deixe vazio para compartilhar o som completo do sistema.'),
    ),
    notificacoes: soundsPanel,
    transmissao: h(
      'section',
      {},
      h('h2', {}, 'Transmissão'),
      field('Codec preferido', select(cfg.codec, [['auto', 'Automático'], ['vp9', 'VP9'], ['h264', 'H.264'], ['av1', 'AV1']], (v) => void ctx.update({ codec: v as AppConfig['codec'] })), 'Vale para as próximas transmissões.'),
      field('Resolução padrão', select<Resolution>(cfg.resolution, [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], (v) => void ctx.update({ resolution: v as Resolution }))),
      field('FPS padrão', select<number>(cfg.fps, [[30, '30'], [60, '60']], (v) => void ctx.update({ fps: Number(v) as Fps }))),
      field('Modo padrão', select<ShareMode>(cfg.mode, [['motion', 'Movimento (jogos/vídeo)'], ['detail', 'Detalhe (texto/código)']], (v) => void ctx.update({ mode: v as ShareMode }))),
    ),
    camera: h(
      'section',
      {},
      h('h2', {}, 'Câmera'),
      h('p', { class: 'muted' }, 'Padrões usados quando você compartilha a câmera. A tela e as janelas usam os da aba Transmissão. O codec é o mesmo para as duas.'),
      field('Câmera padrão', cameraHolder, 'O ícone de câmera dentro da sala transmite direto essa câmera. Por padrão é a primeira que o Windows lista; troque aqui se não for a certa.'),
      field('Resolução padrão', select<Resolution>(cfg.cameraResolution, [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], (v) => void ctx.update({ cameraResolution: v as Resolution })), 'Se a câmera não tiver essa resolução, o Windows usa a mais próxima.'),
      field('FPS padrão', select<number>(cfg.cameraFps, [[30, '30'], [60, '60']], (v) => void ctx.update({ cameraFps: Number(v) as Fps }))),
      field('Modo padrão', select<ShareMode>(cfg.cameraMode, [['motion', 'Movimento (rosto, gestos)'], ['detail', 'Detalhe (objetos, texto)']], (v) => void ctx.update({ cameraMode: v as ShareMode }))),
    ),
    interface: h(
      'section',
      {},
      h('h2', {}, 'Interface'),
      h('p', { class: 'muted' }, 'Escolha como o Jaca anti Janja se parece. As duas fazem as mesmas coisas, e você pode voltar quando quiser.'),
      interfacePicker,
    ),
    sobre: h(
      'section',
      {},
      h('h2', {}, 'Sobre'),
      versionText,
      checkBtn,
      installBtn,
      updateText,
      h(
        'div',
        { class: 'about-card' },
        h('h3', {}, 'Registro de erros'),
        h('p', { class: 'muted' }, 'Quando algo dá errado (entrar numa sala, criar uma sala, quedas de conexão, rede), o app anota num arquivo de texto neste PC. Nunca vão chaves nem o código inteiro da sala. Se precisar de ajuda, mande esse arquivo.'),
        h('button', { onclick: () => void window.jaca.openLogFolder() }, 'Abrir pasta do registro'),
      ),
    ),
  };

  // ---- sidebar (left): icon + category name; one panel visible at a time
  const tabs = new Map<Category, HTMLButtonElement>();
  const show = (id: Category) => {
    lastCategory = id;
    for (const [key, panel] of Object.entries(panels) as Array<[Category, HTMLElement]>) panel.hidden = key !== id;
    for (const [key, tab] of tabs) {
      tab.setAttribute('aria-selected', String(key === id));
      tab.tabIndex = key === id ? 0 : -1;
    }
    content.scrollTop = 0;
    if (id === 'camera') loadCameraList();
  };

  const nav = h('nav', { class: 'settings-nav', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Categorias das configurações' });
  for (const cat of CATEGORIES) {
    const tab = h('button', { class: 'settings-tab', role: 'tab', id: `tab-${cat.id}`, 'aria-controls': `panel-${cat.id}`, onclick: () => show(cat.id) });
    tab.innerHTML = cat.icon;
    tab.append(h('span', {}, cat.label));
    tabs.set(cat.id, tab);
    nav.append(tab);
  }
  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const ids = CATEGORIES.map((c) => c.id);
    const next = ids[(ids.indexOf(lastCategory) + (e.key === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length];
    show(next);
    tabs.get(next)!.focus();
  });

  const content = h('main', { class: 'settings-content' });
  for (const cat of CATEGORIES) {
    const panel = panels[cat.id];
    panel.setAttribute('role', 'tabpanel');
    panel.id = `panel-${cat.id}`;
    panel.setAttribute('aria-labelledby', `tab-${cat.id}`);
    content.append(panel);
  }
  show(lastCategory);

  const root = h(
    'div',
    { class: 'screen settings' },
    h('header', { class: 'topbar' }, backButton(ctx.back), h('h1', {}, 'Configurações')),
    h('div', { class: 'settings-layout' }, nav, content),
  );

  return {
    el: root,
    dispose: () => {
      unsubscribe();
      settingsClosed = true;
      window.clearInterval(fixedPollTimer);
      // leaving with Cloudflare selected but not set up: it was never saved as the mode, so the app stays on Direto; say so
      if (mode === 'cloudflare' && !workerConfigured) {
        void ctx.update({ connectionMode: 'direct' });
        toast('O modo Cloudflare precisa do seu Worker conectado, e isso não foi feito. Voltei para o modo Direto (VPN).');
      }
    },
  };
}
