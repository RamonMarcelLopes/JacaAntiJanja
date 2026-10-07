import { AppConfig, BITRATE_MBPS, CaptureSource, Fps, Resolution, RoomInfo, ShareInfo, ShareMode } from '../../shared/protocol';
import { avatarEl, h, resizeAvatar, toast } from '../dom';
import { PeerView, Session } from '../session';

export interface RoomContext {
  cfg: AppConfig;
  session: Session;
  room: RoomInfo | null;
  update(patch: Partial<AppConfig>): Promise<AppConfig>;
  leave(): void;
}

const QUALITY_LABEL = { good: 'Boa', ok: 'Média', bad: 'Ruim', unknown: '' } as const;

function selectOf<T extends string | number>(value: T, options: Array<[T, string]>, onChange: (v: string) => void): HTMLSelectElement {
  const el = h(
    'select',
    { onchange: () => onChange(el.value) },
    ...options.map(([v, text]) => h('option', { value: String(v), selected: v === value }, text)),
  );
  return el;
}

function uploadEstimate(info: ShareInfo, viewers: number): string {
  const mbps = BITRATE_MBPS[info.resolution][info.fps] * viewers;
  return `${viewers} espectador${viewers === 1 ? '' : 'es'} × ${BITRATE_MBPS[info.resolution][info.fps]} Mbps ≈ ${mbps.toFixed(1)} Mbps de upload`;
}

export function renderRoom(ctx: RoomContext): { el: HTMLElement; dispose(): void } {
  const { session, room, cfg } = ctx;
  let draft: ShareInfo = { resolution: cfg.resolution, fps: cfg.fps, mode: cfg.mode };

  // ---- player (kept alive across renders so playback is not interrupted)
  const video = h('video', { autoplay: true, playsInline: true });
  const volume = h('input', { type: 'range', min: 0, max: 100, value: '100', class: 'volume', title: 'Volume' });
  volume.oninput = () => (video.volume = Number(volume.value) / 100);
  const playerTitle = h('span', { class: 'player-title' });
  const placeholder = h('div', { class: 'player-empty' }, 'Quando alguém estiver ao vivo, clique no nome dele para assistir.');
  const playerBar = h(
    'div',
    { class: 'player-bar' },
    playerTitle,
    h('span', { class: 'spacer' }),
    volume,
    h('button', { class: 'ghost', onclick: () => void video.requestFullscreen?.() }, 'Tela cheia'),
    h('button', { class: 'ghost', onclick: () => session.stopViewing() }, 'Parar de assistir'),
  );
  const player = h('div', { class: 'player' }, video, placeholder, playerBar);

  const list = h('div', { class: 'peer-list' });
  const controls = h('div', { class: 'controls' });
  const root = h('div', { class: 'screen room' });

  const codeChip = room
    ? h(
        'div',
        { class: 'code-chip' },
        h('span', { class: 'muted' }, 'Código'),
        h('code', {}, room.code),
        h(
          'button',
          {
            class: 'ghost',
            onclick: async () => {
              await navigator.clipboard.writeText(room.code);
              toast('Código copiado.');
            },
          },
          'Copiar código',
        ),
      )
    : null;

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('h1', {}, session.isHost ? 'Sua sala' : 'Sala'),
      codeChip,
      h('span', { class: 'spacer' }),
      h('button', { class: 'ghost', onclick: () => openProfileDialog() }, 'Editar perfil'),
      h('button', { class: 'danger', onclick: ctx.leave }, session.isHost ? 'Encerrar sala' : 'Sair'),
    ),
    h('main', { class: 'room-body' }, h('section', { class: 'stage' }, player, controls), h('aside', { class: 'sidebar' }, h('h2', {}, 'Participantes'), list)),
  );

  function peerCard(p: PeerView): HTMLElement {
    const isMe = p.peerId === session.selfId;
    const live = !!p.share;
    const selected = session.viewing === p.peerId;
    const clickable = live && (!isMe || session.sharing);
    return h(
      'button',
      {
        class: `peer ${live ? 'live' : ''} ${selected ? 'selected' : ''}`,
        disabled: !clickable,
        title: clickable ? (isMe ? 'Ver prévia da sua tela' : 'Assistir') : '',
        onclick: () => session.view(p.peerId),
      },
      avatarEl(p.name, p.avatar, 44),
      h(
        'div',
        { class: 'peer-info' },
        h('div', { class: 'peer-name' }, isMe ? `${p.name} (você)` : p.name),
        h(
          'div',
          { class: 'peer-meta muted' },
          live ? `${p.share!.resolution} · ${p.share!.fps} fps` : 'Sem transmissão',
          !isMe && p.quality !== 'unknown' ? h('span', { class: `dot ${p.quality}`, title: `${QUALITY_LABEL[p.quality]}${p.rtt !== null ? ` · ${p.rtt} ms` : ''}` }) : null,
          !isMe && p.rtt !== null ? ` ${p.rtt} ms` : null,
        ),
      ),
      live ? h('span', { class: 'badge-live' }, 'AO VIVO') : null,
    );
  }

  /** Name/photo changes are saved and sent to everyone in the room as soon as they are made. */
  function openProfileDialog(): void {
    const preview = h('div', { class: 'avatar-holder' });
    const nameInput = h('input', { type: 'text', maxLength: 24, value: session.me().name });
    const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    const draw = () => preview.replaceChildren(avatarEl(session.me().name, session.me().avatar, 88));
    const commit = async (name: string, avatar: string | null) => {
      const saved = await ctx.update({ name, avatar });
      session.updateProfile(saved.name, saved.avatar);
      draw();
    };
    nameInput.onchange = async () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.value = session.me().name;
        return;
      }
      await commit(name, session.me().avatar);
    };
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        await commit(session.me().name, await resizeAvatar(file));
      } catch {
        toast('Não foi possível ler essa imagem.', 'error');
      }
    };
    draw();
    const overlay = h(
      'div',
      { class: 'overlay' },
      h(
        'div',
        { class: 'dialog profile-dialog' },
        h('h2', {}, 'Editar perfil'),
        h(
          'div',
          { class: 'profile' },
          preview,
          h(
            'div',
            { class: 'profile-fields' },
            nameInput,
            h(
              'div',
              { class: 'row' },
              h('button', { onclick: () => fileInput.click() }, 'Escolher imagem'),
              h('button', { class: 'ghost', onclick: () => void commit(session.me().name, null) }, 'Remover'),
            ),
            fileInput,
          ),
        ),
        h('p', { class: 'muted' }, 'As mudanças aparecem na hora para todos na sala.'),
        h('div', { class: 'row end' }, h('button', { class: 'primary', onclick: () => overlay.remove() }, 'Pronto')),
      ),
    );
    document.body.append(overlay);
  }

  async function openShareDialog(): Promise<void> {
    let sources: CaptureSource[];
    try {
      sources = await window.jaca.listSources();
    } catch {
      toast('Não foi possível listar as telas e janelas.', 'error');
      return;
    }
    let chosen: string | null = sources.find((s) => s.isScreen)?.id ?? null;
    const estimate = h('div', { class: 'muted' });
    const grid = h('div', { class: 'source-grid' });
    const startBtn = h('button', { class: 'primary' }, 'Compartilhar');

    const drawEstimate = () => {
      const viewers = Math.max(session.peers.size - 1, 1);
      estimate.textContent = `Pior caso: ${uploadEstimate(draft, viewers)}. Só quem clicar para assistir recebe o vídeo.`;
    };
    const drawSources = () => {
      grid.replaceChildren(
        ...sources.map((s) =>
          h(
            'button',
            { class: `source ${s.id === chosen ? 'selected' : ''}`, onclick: () => { chosen = s.id; drawSources(); } },
            h('img', { src: s.thumbnail, alt: '' }),
            h('span', {}, s.name),
          ),
        ),
      );
    };
    drawSources();
    drawEstimate();

    const overlay = h(
      'div',
      { class: 'overlay' },
      h(
        'div',
        { class: 'dialog' },
        h('h2', {}, 'Compartilhar tela'),
        grid,
        h(
          'div',
          { class: 'row wrap' },
          selectOf<Resolution>(draft.resolution, [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], (v) => { draft = { ...draft, resolution: v as Resolution }; drawEstimate(); }),
          selectOf<number>(draft.fps, [[30, '30 fps'], [60, '60 fps']], (v) => { draft = { ...draft, fps: Number(v) as Fps }; drawEstimate(); }),
          selectOf<ShareMode>(draft.mode, [['motion', 'Movimento'], ['detail', 'Detalhe']], (v) => { draft = { ...draft, mode: v as ShareMode }; }),
        ),
        estimate,
        h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => overlay.remove() }, 'Cancelar'), startBtn),
      ),
    );
    startBtn.onclick = async () => {
      if (!chosen) return;
      startBtn.disabled = true;
      startBtn.textContent = 'Iniciando...';
      try {
        await session.startSharing(chosen, draft);
        overlay.remove();
      } catch (e: any) {
        toast(`Não foi possível iniciar o compartilhamento: ${e?.message ?? e}`, 'error');
        startBtn.disabled = false;
        startBtn.textContent = 'Compartilhar';
      }
    };
    document.body.append(overlay);
  }

  function drawControls(): void {
    if (!session.sharing || !session.shareInfo) {
      controls.replaceChildren(h('button', { class: 'primary', onclick: () => void openShareDialog() }, 'Compartilhar tela'));
      return;
    }
    const info = session.shareInfo;
    const change = (patch: Partial<ShareInfo>) => {
      void session.updateQuality({ ...info, ...patch });
    };
    controls.replaceChildren(
      h('button', { class: 'danger', onclick: () => session.stopSharing() }, 'Parar de compartilhar'),
      selectOf<Resolution>(info.resolution, [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], (v) => change({ resolution: v as Resolution })),
      selectOf<number>(info.fps, [[30, '30 fps'], [60, '60 fps']], (v) => change({ fps: Number(v) as Fps })),
      selectOf<ShareMode>(info.mode, [['motion', 'Movimento'], ['detail', 'Detalhe']], (v) => change({ mode: v as ShareMode })),
      h('span', { class: 'muted' }, session.watcherCount ? uploadEstimate(info, session.watcherCount) : 'Ninguém assistindo ainda.'),
      ...(session.audioNote ? [h('span', { class: 'muted' }, session.audioNote)] : []),
    );
  }

  function render(): void {
    list.replaceChildren(...[...session.peers.values()].map(peerCard));
    // Rebuild controls only when something relevant changed, so open dropdowns are not dismissed by stats updates.
    const sig = `${session.sharing}|${session.shareInfo?.resolution}|${session.shareInfo?.fps}|${session.shareInfo?.mode}|${session.watcherCount}|${session.audioNote}`;
    if (sig !== lastControlsSig) {
      lastControlsSig = sig;
      drawControls();
    }

    const viewing = session.viewing ? session.peers.get(session.viewing) : null;
    if (video.srcObject !== session.stream) video.srcObject = session.stream;
    video.muted = session.viewing === session.selfId || session.muteIncoming;
    placeholder.style.display = session.stream ? 'none' : 'flex';
    playerBar.style.display = session.viewing ? 'flex' : 'none';
    if (viewing) {
      playerTitle.textContent = viewing.peerId === session.selfId ? 'Prévia da sua tela' : `Assistindo ${viewing.name}`;
      placeholder.textContent = session.stream ? '' : 'Conectando à transmissão...';
      if (session.muteIncoming && viewing.peerId !== session.selfId) playerTitle.textContent += ' (sem áudio: compartilhe só uma janela para ouvir)';
    } else {
      placeholder.textContent = session.sharing
        ? 'Você está ao vivo. Clique no seu nome para ver a prévia.'
        : 'Quando alguém estiver ao vivo, clique no nome dele para assistir.';
    }
  }

  let lastControlsSig = '';
  session.onChange = render;
  session.onNotice = toast;
  render();

  return {
    el: root,
    dispose: () => {
      session.onChange = () => undefined;
      session.onNotice = () => undefined;
      video.srcObject = null;
    },
  };
}
