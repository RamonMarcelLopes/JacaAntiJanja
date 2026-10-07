import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { copyStatic, targets } from './build-config.mjs';

rmSync('dist', { recursive: true, force: true });

await Promise.all(Object.values(targets).map((t) => build(t)));
copyStatic();
