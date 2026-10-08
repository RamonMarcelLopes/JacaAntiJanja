import { AppConfig, RoomInfo } from '../shared/protocol';
import { toast } from './dom';
import { playSound, setDisabledSounds, setSoundVolume } from './sounds';
import { renderHome } from './screens/home';
import { renderRoom } from './screens/room';
import { renderSettings } from './screens/settings';
import { Session } from './session';
import { initTitlebar } from './titlebar';
import { initUpdateBanner, setInRoom } from './update-banner';

const root = document.getElementById('app')!;
let cfg: AppConfig;
let dispose: (() => void) | null = null;
let current: 'home' | 'settings' | 'room' | null = null; // which screen is showing, to pick the slide direction

type Direction = 'forward' | 'back' | 'none';
let finishTransition: (() => void) | null = null;

/**
 * Shows a screen. With a direction the new screen slides in (from the right going forward, from the left going back) while the old
 * one slides out the other way; both share the root only during the slide. Skipped for the first screen and for reduced motion.
 */
function mount(el: HTMLElement, onUnmount?: () => void, direction: Direction = 'none'): void {
  finishTransition?.(); // a previous slide still running is completed first
  dispose?.();
  dispose = onUnmount ?? null;
  const old = root.firstElementChild as HTMLElement | null;
  if (!old || direction === 'none' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.replaceChildren(el);
    return;
  }
  const forward = direction === 'forward';
  root.classList.add('transitioning');
  old.classList.add(forward ? 'leave-to-left' : 'leave-to-right');
  el.classList.add(forward ? 'enter-from-right' : 'enter-from-left');
  root.append(el);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    old.remove();
    el.classList.remove('enter-from-right', 'enter-from-left');
    root.classList.remove('transitioning');
    finishTransition = null;
  };
  finishTransition = finish;
  el.addEventListener('animationend', (e) => {
    if (e.target === el) finish();
  });
  window.setTimeout(finish, 600); // safety net
}

async function update(patch: Partial<AppConfig>): Promise<AppConfig> {
  cfg = await window.jaca.setConfig(patch);
  setSoundVolume(cfg.soundVolume);
  setDisabledSounds(cfg.disabledSounds);
  return cfg;
}

function showHome(): void {
  setInRoom(false);
  // Settings sits to the LEFT of Home: coming back from it Home slides in from the right. From a room Home slides in from the left.
  const direction: Direction = current === 'settings' ? 'forward' : 'back';
  current = 'home';
  mount(
    renderHome({
      // getter: `update` replaces the config object, so screens must always read the current one
      get cfg() {
        return cfg;
      },
      update,
      openSettings: showSettings,
      openRoom: showRoom,
    }),
    undefined,
    direction,
  );
}

function showSettings(): void {
  const view = renderSettings({
    get cfg() {
      return cfg;
    },
    update,
    back: showHome,
  });
  current = 'settings';
  mount(view.el, view.dispose, 'back'); // Settings comes in from the left (left to right)
}

function showRoom(session: Session, room: RoomInfo | null): void {
  setInRoom(true);
  const view = renderRoom({
    get cfg() {
      return cfg;
    },
    session,
    room,
    update,
    leave: () => session.leave(),
  });
  session.onEnded = async (reason) => {
    playSound('self-leave'); // leaving, the room being closed or the connection dropping
    if (session.isHost) await window.jaca.closeRoom();
    if (reason === 'room-closed') toast('A sala foi encerrada pelo host.');
    else if (reason === 'lost') toast('Conexão com a sala perdida.', 'error');
    showHome();
  };
  current = 'room';
  mount(view.el, view.dispose, 'forward'); // the room comes in from the right
  playSound('self-join');
}

async function boot(): Promise<void> {
  cfg = await window.jaca.getConfig();
  setSoundVolume(cfg.soundVolume);
  setDisabledSounds(cfg.disabledSounds);
  initTitlebar();
  initUpdateBanner();
  showHome();
}

void boot();
