// Shared by build.mjs (one-off build) and dev.mjs (watch mode with live reload).
import { cpSync, mkdirSync } from 'node:fs';

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022' };

export const targets = {
  main: {
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main/main.js',
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'electron-updater', 'bufferutil', 'utf-8-validate'],
  },
  preload: { ...common, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload/preload.js', platform: 'node', format: 'cjs', external: ['electron'] },
  renderer: { ...common, entryPoints: ['src/renderer/main.ts'], outfile: 'dist/renderer/main.js', platform: 'browser', format: 'iife' },
};

/** Static renderer files: source path -> dist path. Used whole by the build and file by file by the dev watcher. */
export const staticFiles = [
  { from: 'src/renderer/index.html', to: 'dist/renderer/index.html' },
  { from: 'src/renderer/styles', to: 'dist/renderer/styles', dir: true },
  { from: 'src/renderer/fonts', to: 'dist/renderer/fonts', dir: true },
  { from: 'build/icon.png', to: 'dist/renderer/icon.png' }, // shown in the custom title bar
];

export function copyStatic() {
  mkdirSync('dist/renderer/styles', { recursive: true });
  for (const f of staticFiles) cpSync(f.from, f.to, f.dir ? { recursive: true } : undefined);
}
