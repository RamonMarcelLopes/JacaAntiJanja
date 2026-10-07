// Builds build/icon.ico (+ build/icon.png) from build/icon-source.png:
// the black area outside the rounded square becomes transparent, then the image is cropped to a square
// and downscaled to the standard Windows icon sizes (PNG-compressed ICO entries).
// Run: node_modules/electron/dist/electron.exe scripts/make-app-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const build = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const pageScript = (dataUrl, sizes) => `(async () => {
  const img = new Image();
  img.src = ${JSON.stringify(dataUrl)};
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  // flood fill the near-black background from the image border
  const isBg = (i) => Math.max(px[i], px[i + 1], px[i + 2]) <= 24;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => { const k = y * w + x; if (!seen[k] && isBg(k * 4)) { seen[k] = 1; stack.push(k); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const k = stack.pop(), x = k % w, y = (k / w) | 0;
    px[k * 4 + 3] = 0;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }
  ctx.putImageData(data, 0, 0);
  // bounding box of what is left, made square
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const sx = Math.round(cx - side / 2), sy = Math.round(cy - side / 2);
  const render = (size) => {
    // halve repeatedly for sharper small sizes
    let cur = c, cw = side, sxx = sx, syy = sy;
    let target = side;
    let src = document.createElement('canvas'); src.width = side; src.height = side;
    src.getContext('2d').drawImage(c, sx, sy, side, side, 0, 0, side, side);
    while (target / 2 >= size) {
      target = Math.floor(target / 2);
      const n = document.createElement('canvas'); n.width = n.height = target;
      const nctx = n.getContext('2d'); nctx.imageSmoothingQuality = 'high';
      nctx.drawImage(src, 0, 0, target, target); src = n;
    }
    const out = document.createElement('canvas'); out.width = out.height = size;
    const octx = out.getContext('2d'); octx.imageSmoothingQuality = 'high';
    octx.drawImage(src, 0, 0, size, size);
    return out.toDataURL('image/png').split(',')[1];
  };
  const result = {};
  for (const s of ${JSON.stringify(sizes)}.concat([512])) result[s] = render(s);
  return result;
})()`;

function buildIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + i * 16;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(buf.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.buf)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 300, height: 300 });
  await win.loadURL('about:blank');
  const src = fs.readFileSync(path.join(build, 'icon-source.png'));
  const result = await win.webContents.executeJavaScript(pageScript('data:image/png;base64,' + src.toString('base64'), SIZES));
  fs.writeFileSync(path.join(build, 'icon.png'), Buffer.from(result['512'], 'base64'));
  fs.writeFileSync(path.join(build, 'icon.ico'), buildIco(SIZES.map((size) => ({ size, buf: Buffer.from(result[size], 'base64') }))));
  app.quit();
});
