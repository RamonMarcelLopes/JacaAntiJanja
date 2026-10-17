// The details panel on the right: how the connection and each transmission are doing.
import { Activity, Cpu, Eye, Gauge, Signal, X } from 'lucide';
import { BITRATE_MBPS } from '../../shared/protocol';
import { h, icon } from '../dom';
import { emit, isMe, peers, S } from '../state';
import { chip, personAvatar } from './controls';

const QUALITY_TEXT = { good: 'Boa', ok: 'Média', bad: 'Ruim', unknown: '—' } as const;
const latencyText = (p: { name: string; rtt: number | null }) => (p.rtt !== null ? `Latência até ${p.name}: ${p.rtt} ms` : '');

export function panel(): HTMLElement & { draw(): void; tick(): void; open(on: boolean): void } {
  const root = h('aside', { id: 'details-panel', class: 'flex-none bg-s1 border-l border-line overflow-hidden transition-[width] duration-500 ease-[var(--ease-out-expo)]', style: { width: '0px' } });
  const inner = h('div', { class: 'w-[320px] h-full flex flex-col overflow-y-auto' });
  root.append(inner);
  const history: number[] = [];
  const canvas = h('canvas', { width: 280, height: 90, class: 'w-full rounded-lg bg-s0/60' });
  const msText = h('span', { class: 'font-display text-2xl font-extrabold tabular-nums', 'data-testid': 'avg-ms' }, '—');
  const qualityChip = h('span', {});

  /** Average round trip to the people of the room that answered a measurement. */
  const averageMs = (): number | null => {
    const list = peers().filter((p) => !isMe(p) && p.rtt !== null).map((p) => p.rtt as number);
    return list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;
  };

  const spark = () => {
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, 280, 90);
    if (history.length < 2) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#9cff8c';
    const max = Math.max(140, ...history);
    c.beginPath();
    history.forEach((v, i) => {
      const x = (i / (history.length - 1)) * 280;
      const y = 84 - (v / max) * 76;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.strokeStyle = accent;
    c.lineWidth = 2;
    c.lineJoin = 'round';
    c.stroke();
    c.lineTo(280, 90);
    c.lineTo(0, 90);
    const g = c.createLinearGradient(0, 0, 0, 90);
    g.addColorStop(0, accent + '55');
    g.addColorStop(1, 'transparent');
    c.fillStyle = g;
    c.fill();
  };

  const stat = (ico: typeof Gauge, label: string, value: string) =>
    h('div', { class: 'rounded-xl bg-s2 p-2.5' }, h('div', { class: 'flex items-center gap-1 text-muted mb-0.5' }, icon(ico, 12), label), h('div', { class: 'font-semibold tabular-nums' }, value));

  let shown = '';
  const draw = (force = false) => {
    const session = S.session;
    if (!session) return;
    const live = peers().filter((p) => p.share);
    const worst = peers().filter((p) => !isMe(p)).reduce<'good' | 'ok' | 'bad' | 'unknown'>((w, p) => (p.quality === 'bad' || w === 'bad' ? 'bad' : p.quality === 'ok' || w === 'ok' ? 'ok' : p.quality === 'good' || w === 'good' ? 'good' : 'unknown'), 'unknown');
    // rebuilt only when what it shows changed (the latencies are updated in place by tick): rebuilding replayed its animations and moved the buttons under the pointer
    const sig = JSON.stringify([session.selfId, worst, live.map((p) => [p.peerId, p.name, p.avatar?.length ?? 0, p.share])]);
    if (sig === shown && !force) return;
    shown = sig;
    qualityChip.replaceChildren(chip([icon(Signal, 12, worst === 'bad' ? 'text-live' : worst === 'ok' ? 'text-warn' : 'text-ok'), QUALITY_TEXT[worst]]));
    inner.replaceChildren(
      h('div', { class: 'h-12 px-4 flex items-center justify-between border-b border-line flex-none' }, h('div', { class: 'font-display font-bold flex items-center gap-2' }, icon(Activity, 17, 'text-accent'), 'Detalhes'), h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: () => { S.panel = false; emit('panel'); } }, icon(X, 16))),
      h('div', { class: 'p-4 space-y-4' },
        h('div', { class: 'rounded-2xl bg-s3 border border-line p-4 animate-fade-up' },
          h('div', { class: 'flex items-center justify-between mb-2' }, h('span', { class: 'text-[11px] font-extrabold tracking-[0.1em] text-muted uppercase' }, 'Sua conexão com a sala'), qualityChip),
          h('div', { class: 'flex items-baseline gap-1 mb-2' }, msText, h('span', { class: 'text-muted text-sm' }, 'ms (média)')),
          canvas,
        ),
        ...live.map((p, i) => {
          const info = p.share!;
          const mbps = BITRATE_MBPS[info.resolution][info.fps];
          const viewers = info.viewers ?? 0;
          return h('div', { class: 'rounded-2xl bg-s3 border border-line p-4 animate-fade-up', 'data-stats': p.name, style: { animationDelay: `${(i + 1) * 80}ms` } },
            h('div', { class: 'flex items-center gap-3 mb-3' }, personAvatar(p, 32), h('div', { class: 'flex-1 min-w-0' }, h('div', { class: 'font-semibold truncate' }, isMe(p) ? `${p.name} (você)` : p.name), h('div', { class: 'text-[12px] text-muted' }, info.source === 'camera' ? 'Câmera' : 'Tela')), h('span', { class: 'badge-live' }, 'AO VIVO')),
            h('div', { class: 'grid grid-cols-2 gap-2 text-[12px]' },
              stat(Gauge, 'Vídeo', `${info.resolution} · ${info.fps} fps`),
              stat(Cpu, 'Modo', info.mode === 'detail' ? 'Detalhe' : 'Movimento'),
              stat(Activity, 'Referência', `${mbps} Mbps por pessoa`),
              stat(Eye, 'Assistindo', String(viewers)),
            ),
            isMe(p) ? h('div', { class: 'mt-3 text-[12px] text-muted' }, viewers === 0 ? 'Ninguém assistindo agora.' : `${viewers} espectador${viewers === 1 ? '' : 'es'} × ${mbps} Mbps ≈ ${(viewers * mbps).toFixed(1)} Mbps de upload`) : h('div', { class: 'mt-3 text-[12px] text-muted', 'data-latency': p.peerId }, latencyText(p)),
          );
        }),
        live.length === 0 ? h('div', { class: 'text-center text-muted py-8 animate-fade-in' }, 'Ninguém está transmitindo agora.') : null,
      ),
    );
    spark();
  };

  const tick = () => {
    const ms = averageMs();
    if (ms !== null) {
      history.push(ms);
      if (history.length > 48) history.shift();
    }
    msText.textContent = ms === null ? '—' : String(ms);
    inner.querySelectorAll<HTMLElement>('[data-latency]').forEach((n) => {
      const p = S.session?.peers.get(n.dataset.latency!);
      if (p) n.textContent = latencyText(p);
    });
    spark();
  };
  const open = (on: boolean) => {
    root.style.width = on ? '320px' : '0px';
    root.inert = !on;
    if (on) draw(true);
  };
  root.inert = true;
  return Object.assign(root, { draw, tick, open });
}
