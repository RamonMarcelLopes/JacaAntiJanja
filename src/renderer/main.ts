import { AppConfig, RoomInfo } from '../shared/protocol';
import { toast } from './dom';
import { renderHome } from './screens/home';
import { renderRoom } from './screens/room';
import { renderSettings } from './screens/settings';
import { Session } from './session';
import { initUpdateBanner, setInRoom } from './update-banner';

const root = document.getElementById('app')!;
let cfg: AppConfig;
let dispose: (() => void) | null = null;

function mount(el: HTMLElement, onUnmount?: () => void): void {
  dispose?.();
  dispose = onUnmount ?? null;
  root.replaceChildren(el);
}

async function update(patch: Partial<AppConfig>): Promise<AppConfig> {
  cfg = await window.jaca.setConfig(patch);
  return cfg;
}

function showHome(): void {
  setInRoom(false);
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
  mount(view.el, view.dispose);
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
    if (session.isHost) await window.jaca.closeRoom();
    if (reason === 'room-closed') toast('A sala foi encerrada pelo host.');
    else if (reason === 'lost') toast('Conexão com a sala perdida.', 'error');
    showHome();
  };
  mount(view.el, view.dispose);
}

async function boot(): Promise<void> {
  cfg = await window.jaca.getConfig();
  initUpdateBanner();
  showHome();
}

void boot();
