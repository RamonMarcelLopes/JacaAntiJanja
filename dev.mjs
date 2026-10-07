// Live-reload development mode:  pnpm dev
//  - CSS change            -> styles are swapped in place (you stay where you are, even inside a room)
//  - renderer code / HTML  -> the window reloads (you go back to the home screen)
//  - main process / preload -> the app restarts
//  Option --room: after every reload or restart the app goes back to the room screen by itself (it creates a room),
//  so the screen you are working on is always the one you see.
// Uses its own profile (name, photo, settings) in %LOCALAPPDATA%\jaca-anti-janja-dev and port 47803,
// so it never touches the installed app's data or a room open on the default port.
import { context } from 'esbuild';
import { chromium } from '@playwright/test';
import electronPath from 'electron';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, watch, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyStatic, targets } from './build-config.mjs';

const profile = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'jaca-anti-janja-dev');
mkdirSync(profile, { recursive: true });
if (!existsSync(path.join(profile, 'config.json'))) writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ port: 47803 }));

const signalFile = path.join('dist', '.dev-reload'); // the app watches this file (see setupDevReload in main.ts)
const signal = (kind) => writeFileSync(signalFile, `${kind}\n${Date.now()}`);

const DEBUG_PORT = 9333; // lets this script (and Claude) drive the dev window
const autoRoom = process.argv.includes('--room');

/** Creates a room in the dev window (typing a name first if the profile has none), unless it is already in one. */
async function goToRoom() {
  for (let attempt = 0; attempt < 8; attempt++) {
    let browser;
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
      const page = browser.contexts()[0]?.pages()[0];
      if (!page) throw new Error('window not ready');
      if (await page.locator('.code-chip').count()) return;
      const name = page.getByPlaceholder('Seu nome');
      await name.waitFor({ timeout: 4000 });
      if (!(await name.inputValue())) await name.fill('Jaca');
      await page.getByRole('button', { name: 'Criar sala' }).click();
      await page.locator('.code-chip code').waitFor({ timeout: 15000 });
      console.log('[dev] on the room screen');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }
  console.log('[dev] could not open the room screen automatically');
}

// ---------------------------------------------------------------- Electron process (restarted when main/preload change)
let child = null;
let restarting = false;

function startApp() {
  child = spawn(electronPath, ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`], { stdio: 'inherit', env: { ...process.env, JACA_DEV: '1' } });
  if (autoRoom) setTimeout(goToRoom, 2500);
  child.on('exit', (code) => {
    if (restarting) return;
    console.log(`[dev] the app closed (code ${code}); stopping`);
    shutdown(0);
  });
}

function killApp() {
  if (!child || child.exitCode !== null) return;
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    child.kill();
  }
}

let restartTimer;
function scheduleRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    console.log('[dev] main/preload changed -> restarting the app');
    restarting = true;
    killApp();
    await new Promise((r) => setTimeout(r, 700));
    restarting = false;
    startApp();
  }, 200);
}

let reloadTimer;
let pendingKind = 'css';
function scheduleReload(kind) {
  if (kind === 'full') pendingKind = 'full';
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    console.log(`[dev] ${pendingKind === 'css' ? 'styles updated in place' : 'reloading the window'}`);
    const kindNow = pendingKind;
    signal(kindNow);
    pendingKind = 'css';
    if (autoRoom && kindNow === 'full') setTimeout(goToRoom, 1800);
  }, 120);
}

// ---------------------------------------------------------------- esbuild in watch mode
const contexts = [];
async function watchTarget(name, onRebuilt) {
  let armed = false; // esbuild fires a build or two while starting up; only react to real edits after that
  const ctx = await context({
    ...targets[name],
    logLevel: 'warning',
    plugins: [
      {
        name: 'dev-signal',
        setup(b) {
          b.onEnd((result) => {
            if (!armed) return;
            if (result.errors.length) return console.log(`[dev] ${name}: build errors (fix them and save again)`);
            onRebuilt();
          });
        },
      },
    ],
  });
  contexts.push(ctx);
  await ctx.rebuild();
  await ctx.watch();
  setTimeout(() => (armed = true), 1500);
}

await watchTarget('main', scheduleRestart);
await watchTarget('preload', scheduleRestart);
await watchTarget('renderer', () => scheduleReload('full'));
copyStatic();

// ---------------------------------------------------------------- static files (HTML, CSS, fonts, icon), copied one by one
function watchStatic(dir, toDir, kindOf) {
  watch(dir, { recursive: true }, (_event, name) => {
    if (!name) return;
    const from = path.join(dir, name);
    const to = path.join(toDir, name);
    try {
      if (!existsSync(from)) return;
      mkdirSync(path.dirname(to), { recursive: true });
      copyFileSync(from, to);
      scheduleReload(kindOf(name));
    } catch {
      /* the editor may still be writing the file; the next event will copy it */
    }
  });
}
watchStatic('src/renderer/styles', 'dist/renderer/styles', (name) => (name.endsWith('.css') ? 'css' : 'full'));
watchStatic('src/renderer/fonts', 'dist/renderer/fonts', () => 'full');
watch('src/renderer', (_event, name) => {
  if (name !== 'index.html') return;
  try {
    copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
    scheduleReload('full');
  } catch {
    /* retry on the next event */
  }
});

// ---------------------------------------------------------------- go
signal('css');
startApp();
console.log(`[dev] running. Profile: ${profile} (port 47803). Edit the code; the app updates by itself. Ctrl+C to stop.`);

function shutdown(code) {
  for (const c of contexts) void c.dispose();
  killApp();
  rmSync(signalFile, { force: true });
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
