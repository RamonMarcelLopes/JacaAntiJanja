// Shared by build.mjs (one-off build) and dev.mjs (watch mode with live reload).
import { spawnSync } from 'node:child_process';
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
  // the new interface (version 2): its own page, script and stylesheet next to the original one
  rendererNext: { ...common, entryPoints: ['src/renderer-next/main.ts'], outfile: 'dist/renderer-next/main.js', platform: 'browser', format: 'iife' },
};

/** Static renderer files: source path -> dist path. Used whole by the build and file by file by the dev watcher. */
export const staticFiles = [
  { from: 'src/renderer/index.html', to: 'dist/renderer/index.html' },
  { from: 'src/renderer/styles', to: 'dist/renderer/styles', dir: true },
  { from: 'src/renderer/fonts', to: 'dist/renderer/fonts', dir: true },
  { from: 'build/icon.png', to: 'dist/renderer/icon.png' }, // shown in the custom title bar
  { from: 'src/renderer-next/index.html', to: 'dist/renderer-next/index.html' },
  { from: 'build/icon.png', to: 'dist/renderer-next/icon.png' },
];

/** Compiles the Tailwind styles of the new interface (src/renderer-next/styles.css -> dist/renderer-next/style.css). */
export function buildNextStyles(minify = true) {
  mkdirSync('dist/renderer-next', { recursive: true });
  const args = ['node_modules/@tailwindcss/cli/dist/index.mjs', '-i', 'src/renderer-next/styles.css', '-o', 'dist/renderer-next/style.css', ...(minify ? ['--minify'] : [])];
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('tailwind failed');
}

export function copyStatic() {
  mkdirSync('dist/renderer/styles', { recursive: true });
  mkdirSync('dist/renderer-next', { recursive: true });
  for (const f of staticFiles) cpSync(f.from, f.to, f.dir ? { recursive: true } : undefined);
}
