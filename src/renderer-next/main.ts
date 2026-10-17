// Entry point of the new interface: builds the frame, wires the views to the store and keeps the data (config, rooms, updates) alive.
import { h } from './dom';
import { initFx } from './fx';
import { pollRooms, startPolling } from './flows';
import { emit, loadConfig, roomEntries, S, subscribe } from './state';
import { loadTheme } from './themes';
import { setDisabledSounds, setSoundVolume } from '../renderer/sounds';
import { home } from './ui/home';
import { panel } from './ui/panel';
import { captureFly, playFly, rail, sidebar, titlebar, updateBanner } from './ui/shell';
import { notifySettings } from './ui/settings';
import { stage } from './ui/stage';

// errors nobody caught in the window go to the log file too (see "Registro de erros" in Settings > Sobre)
window.addEventListener('error', (e) => void window.jaca.log('erro', `erro na janela: ${e.message} (${e.filename?.split('/').pop() ?? ''}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => void window.jaca.log('erro', `promessa rejeitada na janela: ${String((e.reason as Error)?.stack ?? e.reason)}`));

/** What the rail, the column and the cards show about the saved rooms: when it is the same, nothing needs redrawing. */
function roomsSignature(): string {
  return JSON.stringify([S.view, roomEntries().map((r) => [r.key, r.name, r.state, r.host, r.count, r.icon]), S.cfg.favoriteRooms.length, S.session?.inviteCode ?? '']);
}

async function boot(): Promise<void> {
  loadTheme();
  initFx();
  try {
    if (localStorage.getItem('jaca-ui-aurora') === 'off') document.documentElement.classList.add('no-aurora');
    if (localStorage.getItem('jaca-ui-motion') === 'off') document.documentElement.classList.add('no-motion');
  } catch { /* storage may be unavailable */ }

  await loadConfig();
  setSoundVolume(S.cfg.soundVolume);
  setDisabledSounds(S.cfg.disabledSounds);
  S.version = await window.jaca.getVersion();
  S.update = await window.jaca.getUpdateState();
  void window.jaca.log('app', 'interface nova aberta');

  const app = document.getElementById('app')!;
  const banner = updateBanner();
  const railEl = rail();
  const sideEl = sidebar();
  const homeEl = home();
  const stageEl = stage();
  const panelEl = panel();
  const main = h('div', { class: 'flex-1 min-w-0 flex min-h-0 relative' });

  app.className = 'flex flex-col h-full bg-s0';
  app.append(titlebar(), banner, h('div', { class: 'flex flex-1 min-h-0' }, railEl, sideEl, main, panelEl));

  function mountMain(animate: boolean): void {
    main.replaceChildren(S.view === 'home' ? homeEl : stageEl);
    if (S.view === 'home') {
      homeEl.classList.remove('view-enter');
      void homeEl.offsetWidth;
      homeEl.classList.add('view-enter');
      homeEl.draw();
    } else {
      stageEl.draw(animate);
    }
  }
  mountMain(true);

  let lastRoomsSig = roomsSignature();
  subscribe((what) => {
    switch (what) {
      case 'route':
        railEl.draw(false);
        sideEl.draw(true);
        banner.draw();
        mountMain(true);
        panelEl.open(S.panel && S.view === 'room');
        if (S.view === 'home') void pollRooms();
        break;
      case 'session':
        if (S.view === 'room' && S.session) {
          stageEl.draw(false);
          sideEl.draw(false);
          railEl.draw(false);
          if (S.panel) panelEl.draw();
        }
        break;
      case 'people':
      case 'rooms':
        // the status check of the saved rooms (every 20 s) finds the same answers most of the time: then nothing is redrawn at all
        if (what === 'rooms') {
          const sig = roomsSignature();
          if (sig === lastRoomsSig) break;
          lastRoomsSig = sig;
        }
        if (S.view === 'room') sideEl.draw(false);
        else {
          homeEl.drawList();
          sideEl.draw(false);
        }
        railEl.draw(false);
        break;
      case 'config':
        if (S.view === 'home') {
          homeEl.draw();
          sideEl.draw(false);
        } else {
          stageEl.draw(false);
          sideEl.draw(false);
        }
        railEl.draw(false);
        break;
      case 'panel':
        stageEl.draw(false);
        panelEl.open(S.panel);
        break;
      case 'settings':
        if (S.view === 'home') homeEl.draw(); // the connection mode badge follows what was chosen in Rede
        break;
      case 'layout': {
        const flying = captureFly();
        railEl.draw(false, true);
        sideEl.fold();
        playFly(flying);
        break;
      }
      case 'update':
        banner.draw();
        railEl.draw(false);
        notifySettings('update');
        break;
    }
  });

  window.jaca.onUpdateState((s) => {
    S.update = s;
    emit('update');
  });

  // the timer of the room, the latency numbers and the details panel are refreshed every second
  window.setInterval(() => {
    if (S.view !== 'room' || !S.session) return;
    sideEl.tick();
    stageEl.tick();
    if (S.panel) panelEl.tick();
  }, 1000);

  startPolling();
}

void boot();
