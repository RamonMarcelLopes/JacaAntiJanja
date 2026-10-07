import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/renderer/styles', { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022' };

await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js', platform: 'node', format: 'cjs', external: ['electron', 'electron-updater', 'bufferutil', 'utf-8-validate'] }),
  build({ ...common, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload/preload.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/renderer/main.ts'], outfile: 'dist/renderer/main.js', platform: 'browser', format: 'iife' }),
]);

cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/styles', 'dist/renderer/styles', { recursive: true });
cpSync('src/renderer/fonts', 'dist/renderer/fonts', { recursive: true });
