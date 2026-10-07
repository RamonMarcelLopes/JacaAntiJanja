// Renders build/installer-splash.bmp (shown by the NSIS installer) with Electron, using the app's own
// fonts and hex skin texture. Run: node_modules/electron/dist/electron.exe scripts/make-installer-splash.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const W = 480;
const H = 300;
const root = path.join(__dirname, '..');
const url = (p) => 'file:///' + path.join(root, p).replace(/\\/g, '/');

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: B; src: url('${url('src/renderer/fonts/bricolage.woff2')}'); font-weight: 200 800; }
@font-face { font-family: H; src: url('${url('src/renderer/fonts/hanken.woff2')}'); font-weight: 100 900; }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
body { position: relative; background: #4f6a2a url('${url('src/renderer/styles/skin.svg')}') 0 0 / 60px 104px repeat; }
.shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(23,19,14,.15), rgba(23,19,14,.72)); }
.wrap { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 44px; }
.big { font: 800 104px/0.85 B; letter-spacing: -0.045em; color: #fff6d8; text-shadow: 0 3px 0 rgba(0,0,0,.25); }
.small { font: 600 36px/1.1 B; letter-spacing: -0.03em; color: #f2b83c; text-shadow: 0 2px 0 rgba(0,0,0,.3); margin-top: 6px; }
.logo { position: absolute; right: 34px; top: 38px; width: 178px; height: 178px; filter: drop-shadow(0 6px 10px rgba(0,0,0,.45)); }
.msg { position: absolute; left: 44px; bottom: 26px; font: 500 16px H; color: #e8ead9; }
.bar { position: absolute; left: 44px; right: 44px; bottom: 14px; height: 4px; border-radius: 4px; background: rgba(255,255,255,.18); }
.bar i { display: block; width: 38%; height: 100%; border-radius: 4px; background: #f2b83c; }
</style><div class="shade"></div><div class="wrap"><div class="big">Jaca</div><div class="small">anti Janja</div></div>
<img class="logo" src="${url('build/icon.png')}"><div class="msg">Instalando...</div><div class="bar"><i></i></div>`;

function writeBmp(file, bitmap, w, h) {
  // 24-bit uncompressed BMP, rows bottom-up and padded to 4 bytes. `bitmap` is BGRA top-down.
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const out = Buffer.alloc(54 + rowSize * h);
  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowSize * h, 34);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((h - 1 - y) * w + x) * 4;
      const dst = 54 + y * rowSize + x * 3;
      out[dst] = bitmap[src];
      out[dst + 1] = bitmap[src + 1];
      out[dst + 2] = bitmap[src + 2];
    }
  }
  fs.writeFileSync(file, out);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, frame: false, webPreferences: { offscreen: false } });
  win.webContents.setZoomFactor(1);
  // A data: page cannot read file:// fonts/images, so render from a temporary file.
  const tmp = path.join(root, 'build', '.splash.html');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 1200)); // fonts + texture
  const shot = (await win.webContents.capturePage()).resize({ width: W, height: H, quality: 'best' });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'installer-splash.png'), shot.toPNG());
  writeBmp(path.join(root, 'build', 'installer-splash.bmp'), shot.toBitmap(), W, H);
  fs.rmSync(tmp, { force: true });
  app.quit();
});
