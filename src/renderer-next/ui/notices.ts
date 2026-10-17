// Room notices: the chip at the top of the room (only while at least one notice is showing), the list it opens, and the dialog that pins a new one
// (opened only by the megaphone of the top bar).
import { Megaphone, Minus, Plus, Trash2, X } from 'lucide';
import { MAX_NOTICE_TEXT, MAX_NOTICES_PER_PEER } from '../../shared/protocol';
import { dismiss, h, icon, reducedMotion } from '../dom';
import { subscribe, S } from '../state';
import { modal } from './dialogs';

type Notice = NonNullable<typeof S.session>['notices'][number];

/** "1 h 20 min", "45 min", "menos de 1 min". */
export function timeLeft(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  if (ms <= 0 || min < 1) return 'menos de 1 min';
  const hours = Math.floor(min / 60);
  return hours ? `${hours} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`;
}

/** How much of its time a notice still has, 0-100. */
const percentLeft = (n: Notice): number => Math.max(0, Math.min(100, ((n.endsAt - Date.now()) / Math.max(1, n.totalMs)) * 100));

/** The size of the bar for a share of time left (a transform: changing the width left a painted trail where the bar had been). */
const barScale = (n: Notice) => `scaleX(${(percentLeft(n) / 100).toFixed(4)})`;

/** The thin bar of time left, in its own track at the bottom of its parent; it shrinks smoothly between the updates of every second. */
const timeBar = (n: Notice) => h('i', { class: 'notice-track', 'aria-hidden': 'true' }, h('i', { class: 'notice-bar', 'data-bar': n.id, style: { transform: barScale(n) } }));

const authorOf = (n: Notice): string => (n.ownerId === S.session?.selfId ? 'você' : (S.session?.peers.get(n.ownerId)?.name ?? 'alguém'));

/** The chip under the top bar of the room: the newest notice, how many more there are, the time left and its bar. Click opens the list. */
export function noticeChip(): { el: HTMLElement; update(): void } {
  const el = h('div', { class: 'flex justify-center' });
  let shown = '';
  let timeEl: HTMLElement | null = null;
  let barEl: HTMLElement | null = null;
  const update = () => {
    const list = S.session?.visibleNotices ?? [];
    const newest = list[list.length - 1];
    const sig = list.map((n) => n.id).join('|');
    if (!newest) {
      shown = '';
      timeEl = barEl = null;
      for (const c of Array.from(el.children) as HTMLElement[]) if (!c.classList.contains('closing')) dismiss(c, 220);
      return;
    }
    const left = timeLeft(newest.endsAt - Date.now());
    if (sig === shown && timeEl && barEl) {
      // only the countdown changes each second: nothing is rebuilt, so nothing restarts its animation
      if (timeEl.textContent !== left) timeEl.textContent = left;
      barEl.style.transform = barScale(newest);
      return;
    }
    const first = !shown;
    shown = sig;
    timeEl = h('span', { class: 'text-muted text-xs flex-none tabular-nums' }, left);
    const track = timeBar(newest);
    barEl = track.firstElementChild as HTMLElement;
    const chip = h('button', { class: `notice-chip relative overflow-hidden pointer-events-auto flex items-center gap-2.5 max-w-[min(520px,90%)] h-10 pl-3 pr-4 rounded-full bg-s2/90 backdrop-blur border border-line hover:border-accent transition-colors ${first ? 'animate-pop' : ''}`, 'data-testid': 'notice-chip', 'aria-label': 'Ver os avisos da sala', onclick: () => openNotices() },
      icon(Megaphone, 16, 'text-accent flex-none'),
      h('span', { class: 'truncate text-[13px] font-semibold' }, newest.text),
      list.length > 1 ? h('span', { class: 'flex-none h-5 px-1.5 rounded-full bg-accent/20 text-accent text-[11px] font-bold grid place-items-center' }, `+${list.length - 1}`) : null,
      timeEl,
      track,
    );
    el.replaceChildren(chip);
  };
  return { el, update };
}

const dialogHead = (title: string, sub: string, close: () => void) =>
  h('div', { class: 'flex items-start gap-3 mb-4' },
    h('div', { class: 'grid place-items-center w-10 h-10 rounded-xl bg-accent/20 text-accent flex-none' }, icon(Megaphone, 20)),
    h('div', { class: 'flex-1' }, h('h2', { class: 'font-display text-xl font-bold' }, title), h('p', { class: 'text-muted text-[13px] mt-0.5' }, sub)),
    h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, icon(X, 18)));

/** The notices of the room (from the chip). It only lists them: a new one is pinned from the megaphone of the top bar. Follows the room while open. */
export function openNotices(): void {
  const session = S.session;
  if (!session) return;
  const list = h('div', { class: 'flex flex-col gap-2' });

  const draw = () => {
    const notices = session.visibleNotices;
    list.replaceChildren(
      ...(notices.length
        ? notices.map((n, i) => {
            const own = n.ownerId === session.selfId;
            // the author takes it down for everybody; everybody else only closes it for themselves
            const action = own
              ? h('button', { class: 'icon-btn flex-none hover:!bg-live hover:!text-white', 'data-tip': 'Remover para todos', 'aria-label': 'Remover o aviso para todos', onclick: () => session.removeNotice(n.id) }, icon(Trash2, 16))
              : h('button', { class: 'icon-btn flex-none', 'data-tip': 'Fechar só para mim', 'aria-label': 'Fechar o aviso só para mim', onclick: () => session.dismissNotice(n.id) }, icon(X, 16));
            return h('div', { class: 'notice-row relative overflow-hidden flex items-start gap-3 rounded-xl bg-s3 border border-line p-3 animate-fade-up', style: { animationDelay: `${i * 50}ms` }, 'data-notice': n.id },
              icon(Megaphone, 16, 'text-accent mt-0.5 flex-none'),
              h('div', { class: 'flex-1 min-w-0' },
                h('div', { class: 'font-semibold break-words' }, n.text),
                h('div', { class: 'text-[12px] text-muted mt-0.5' }, `por ${authorOf(n)} · faltam `, h('span', { class: 'tabular-nums', 'data-left': n.id }, timeLeft(n.endsAt - Date.now())))),
              action,
              timeBar(n));
          })
        : [h('div', { class: 'text-muted text-[13px] py-3 text-center animate-fade-in' }, 'Nenhum aviso agora.')]),
    );
  };

  const close = modal(
    h('div', { class: 'p-6' }, dialogHead('Avisos da sala', 'Todo mundo na sala vê. Cada aviso some quando o tempo dele acaba.', () => close()), list),
    { width: '480px', onClose: () => { stop(); window.clearInterval(timer); } },
  );
  draw();
  // the list follows the room (somebody adds or removes one); rows are rebuilt only when the notices change, the countdowns run in place
  let sig = session.visibleNotices.map((n) => n.id).join('|');
  const stop = subscribe((what) => {
    if (what !== 'session') return;
    const next = session.visibleNotices.map((n) => n.id).join('|');
    if (next !== sig) {
      sig = next;
      draw();
    }
  });
  const timer = window.setInterval(() => {
    for (const n of session.visibleNotices) {
      const left = list.querySelector<HTMLElement>(`[data-left="${n.id}"]`);
      if (left) left.textContent = timeLeft(n.endsAt - Date.now());
      const bar = list.querySelector<HTMLElement>(`[data-bar="${n.id}"]`);
      if (bar) bar.style.transform = barScale(n);
    }
  }, 1000);
}

/**
 * A number picked with − and + (hold to repeat) or typed: big digits, its unit beside them. The value is kept between `min` and `max`;
 * the buttons move by `step` (and land on its multiples).
 */
function stepper(label: string, unit: string, initial: number, min: number, max: number, step: number, onChange: (v: number) => void): { el: HTMLElement; set(v: number): void } {
  let value = initial;
  const input = h('input', { class: 'w-11 bg-transparent text-center font-display text-[22px] font-bold tabular-nums outline-none', inputMode: 'numeric', maxLength: 2, value: String(initial), 'aria-label': label }) as HTMLInputElement;
  const set = (v: number, bump = false) => {
    const next = Math.max(min, Math.min(max, Math.round(v)));
    if (bump && next !== value && !reducedMotion()) input.animate([{ transform: `translateY(${next > value ? 6 : -6}px)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' });
    value = next;
    input.value = String(next);
    minus.disabled = next <= min;
    plus.disabled = next >= max;
    onChange(next);
  };
  const move = (dir: 1 | -1) => set(dir > 0 ? Math.floor(value / step) * step + step : Math.ceil(value / step) * step - step, true);
  const button = (dir: 1 | -1) => {
    const b = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `${dir > 0 ? 'Mais' : 'Menos'} ${unit === 'h' ? 'horas' : 'minutos'}` }, icon(dir > 0 ? Plus : Minus, 16)) as HTMLButtonElement;
    // a click moves one step; holding the button keeps moving, faster after a moment
    let hold: number | undefined;
    const stopHold = () => window.clearTimeout(hold);
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      move(dir);
      let delay = 380;
      const again = () => {
        move(dir);
        delay = Math.max(60, delay * 0.75);
        hold = window.setTimeout(again, delay);
      };
      hold = window.setTimeout(again, delay);
    });
    b.addEventListener('pointerup', stopHold);
    b.addEventListener('pointerleave', stopHold);
    b.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), move(dir)));
    return b;
  };
  const minus = button(-1);
  const plus = button(1);
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
    if (input.value !== '') set(Number(input.value));
  });
  input.addEventListener('blur', () => set(Number(input.value) || 0));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(e.key === 'ArrowUp' ? 1 : -1);
    }
  });
  const el = h('div', { class: 'stepper' }, minus, h('label', { class: 'flex items-baseline gap-1 px-1 cursor-text' }, input, h('span', { class: 'text-muted text-sm font-semibold' }, unit)), plus);
  set(initial);
  return { el, set: (v) => set(v, true) };
}

/** Pins a new notice for everybody (the megaphone of the top bar). Closes as soon as it is published. */
export function openNewNotice(): void {
  const session = S.session;
  if (!session) return;
  let hours = 0;
  let minutes = 30;
  const text = h('input', { class: 'field', placeholder: 'Ex.: voltamos às 21h', maxLength: MAX_NOTICE_TEXT, 'aria-label': 'Texto do aviso' }) as HTMLInputElement;
  const count = h('span', { class: 'text-[12px] text-muted tabular-nums' }, `0/${MAX_NOTICE_TEXT}`);
  text.addEventListener('input', () => (count.textContent = `${text.value.length}/${MAX_NOTICE_TEXT}`));
  const note = h('p', { class: 'text-[13px] text-live min-h-5 mt-3' });

  const presets: Array<[string, number]> = [['15 min', 15], ['30 min', 30], ['1 h', 60], ['2 h', 120], ['4 h', 240]];
  const presetBtns = presets.map(([label, total]) => h('button', { type: 'button', class: 'notice-preset', 'data-total': String(total), onclick: () => { hStep.set(Math.floor(total / 60)); mStep.set(total % 60); } }, label));
  const paintPresets = () => presetBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.total) === hours * 60 + minutes)));
  const hStep = stepper('Horas', 'h', hours, 0, 24, 1, (v) => { hours = v; paintPresets(); });
  const mStep = stepper('Minutos', 'min', minutes, 0, 59, 5, (v) => { minutes = v; paintPresets(); });
  paintPresets();

  const publish = h('button', { class: 'btn btn-primary ripple', 'data-testid': 'notice-publish' }, icon(Megaphone, 16), 'Publicar aviso') as HTMLButtonElement;
  const full = session.notices.filter((n) => n.ownerId === session.selfId).length >= MAX_NOTICES_PER_PEER;
  if (full) {
    publish.disabled = true;
    note.textContent = `Você já tem ${MAX_NOTICES_PER_PEER} avisos ativos. Remova um para publicar outro.`;
  }
  const submit = () => {
    const total = Math.min(24 * 60, hours * 60 + minutes);
    if (!text.value.trim()) return void text.focus();
    if (total < 1) return void (note.textContent = 'Escolha por quanto tempo o aviso fica (pelo menos 1 minuto).');
    if (session.addNotice(text.value, total)) close();
  };
  publish.onclick = submit;
  text.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

  const close = modal(
    h('div', { class: 'p-6' },
      dialogHead('Novo aviso', 'Aparece para todo mundo na sala até o tempo acabar.', () => close()),
      h('div', { class: 'flex items-center justify-between mb-1.5' }, h('span', { class: 'text-xs font-bold tracking-wide text-muted uppercase' }, 'Aviso'), count),
      text,
      h('span', { class: 'block text-xs font-bold tracking-wide text-muted uppercase mt-5 mb-1.5' }, 'Por quanto tempo'),
      h('div', { class: 'flex items-center gap-3' }, hStep.el, mStep.el),
      h('div', { class: 'flex flex-wrap gap-2 mt-3' }, ...presetBtns),
      note,
      h('div', { class: 'flex justify-end gap-2 mt-2' }, h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancelar'), publish)),
    { width: '460px' },
  );
  text.focus();
}
