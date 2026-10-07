import { AppConfig, DEFAULT_PORT, Fps, Resolution, ShareMode, UpdateState } from '../../shared/protocol';
import { h } from '../dom';
import { customSelect } from '../select';
import { currentState, onUpdateChange } from '../update-banner';

export interface SettingsContext {
  cfg: AppConfig;
  update(patch: Partial<AppConfig>): Promise<AppConfig>;
  back(): void;
}

type Category = 'rede' | 'audio' | 'transmissao' | 'sobre';

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
    id: 'audio',
    label: 'Áudio',
    icon: svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'),
  },
  {
    id: 'transmissao',
    label: 'Transmissão',
    icon: svg('<path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><line x1="2" y1="20" x2="2.01" y2="20"/>'),
  },
  {
    id: 'sobre',
    label: 'Sobre',
    icon: svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
  },
];

/** Remembers the last category while the app is open, so coming back to Settings lands where you were. */
let lastCategory: Category = 'rede';

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
      return `A versão ${st.version} está disponível. Use o aviso no topo para atualizar.`;
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
  const drawUpdate = (st: UpdateState) => {
    updateText.textContent = updateTexts(st);
    updateText.className = `test-result ${st.status === 'error' ? 'bad' : 'muted'}`;
    checkBtn.disabled = st.status === 'checking' || st.status === 'downloading' || st.status === 'ready';
  };
  drawUpdate(currentState());
  const unsubscribe = onUpdateChange(drawUpdate);

  const panels: Record<Category, HTMLElement> = {
    rede: h(
      'section',
      {},
      h('h2', {}, 'Rede do host'),
      field('Porta do servidor', port, `Padrão ${DEFAULT_PORT}. Libere essa porta TCP no roteador/firewall.`),
      field('Endereço manual (opcional)', override, 'Use o IP da VPN mesh (Tailscale, ZeroTier, Radmin) se estiver atrás de CGNAT.'),
      testBtn,
      result,
    ),
    audio: h(
      'section',
      {},
      h('h2', {}, 'Áudio'),
      field('Excluir do áudio compartilhado', exclude, 'Processo cujo som não vai para a transmissão (evita o eco do Discord). Deixe vazio para compartilhar o som completo do sistema.'),
    ),
    transmissao: h(
      'section',
      {},
      h('h2', {}, 'Transmissão'),
      field('Codec preferido', select(cfg.codec, [['auto', 'Automático'], ['vp9', 'VP9'], ['h264', 'H.264'], ['av1', 'AV1']], (v) => void ctx.update({ codec: v as AppConfig['codec'] })), 'Vale para as próximas transmissões.'),
      field('Resolução padrão', select<Resolution>(cfg.resolution, [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], (v) => void ctx.update({ resolution: v as Resolution }))),
      field('FPS padrão', select<number>(cfg.fps, [[30, '30'], [60, '60']], (v) => void ctx.update({ fps: Number(v) as Fps }))),
      field('Modo padrão', select<ShareMode>(cfg.mode, [['motion', 'Movimento (jogos/vídeo)'], ['detail', 'Detalhe (texto/código)']], (v) => void ctx.update({ mode: v as ShareMode }))),
    ),
    sobre: h('section', {}, h('h2', {}, 'Sobre'), versionText, checkBtn, updateText),
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

  return { el: root, dispose: unsubscribe };
}
