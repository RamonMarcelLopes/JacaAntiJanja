import { AppConfig, DEFAULT_PORT, Fps, Resolution, ShareMode, UpdateState } from '../../shared/protocol';
import { h } from '../dom';
import { currentState, onUpdateChange } from '../update-banner';

export interface SettingsContext {
  cfg: AppConfig;
  update(patch: Partial<AppConfig>): Promise<AppConfig>;
  back(): void;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'muted' }, hint) : null);
}

function select<T extends string | number>(value: T, options: Array<[T, string]>, onChange: (v: string) => void): HTMLSelectElement {
  const el = h(
    'select',
    { onchange: () => onChange(el.value) },
    ...options.map(([v, text]) => h('option', { value: String(v), selected: v === value }, text)),
  );
  return el;
}

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

  const root = h(
    'div',
    { class: 'screen settings' },
    h('header', { class: 'topbar' }, h('h1', {}, 'Configurações'), h('button', { class: 'ghost', onclick: ctx.back }, 'Voltar')),
    h(
      'main',
      { class: 'settings-grid' },
      h(
        'section',
        {},
        h('h2', {}, 'Rede do host'),
        field('Porta do servidor', port, `Padrão ${DEFAULT_PORT}. Libere essa porta TCP no roteador/firewall.`),
        field('Endereço manual (opcional)', override, 'Use o IP da VPN mesh (Tailscale, ZeroTier, Radmin) se estiver atrás de CGNAT.'),
        testBtn,
        result,
      ),
      h(
        'section',
        {},
        h('h2', {}, 'Áudio'),
        field('Excluir do áudio compartilhado', exclude, 'Processo cujo som não vai para a transmissão (evita o eco do Discord). Deixe vazio para compartilhar o som completo do sistema.'),
      ),
      h(
        'section',
        {},
        h('h2', {}, 'Transmissão'),
        field('Codec preferido', select(cfg.codec, [['auto', 'Automático'], ['vp9', 'VP9'], ['h264', 'H.264'], ['av1', 'AV1']], (v) => void ctx.update({ codec: v as AppConfig['codec'] })), 'Vale para as próximas transmissões.'),
        field('Resolução padrão', select<Resolution>(cfg.resolution, [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], (v) => void ctx.update({ resolution: v as Resolution }))),
        field('FPS padrão', select<number>(cfg.fps, [[30, '30'], [60, '60']], (v) => void ctx.update({ fps: Number(v) as Fps }))),
        field('Modo padrão', select<ShareMode>(cfg.mode, [['motion', 'Movimento (jogos/vídeo)'], ['detail', 'Detalhe (texto/código)']], (v) => void ctx.update({ mode: v as ShareMode }))),
      ),
      h('section', {}, h('h2', {}, 'Sobre'), versionText, checkBtn, updateText),
    ),
  );

  return { el: root, dispose: unsubscribe };
}
