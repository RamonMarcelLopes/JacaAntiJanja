// The Worker is published from the worker/ folder alone (the "Deploy to Cloudflare" button copies only that folder), so it cannot import from ../../src.
// This copies the two shared files it needs. Run it after changing src/shared/invite.ts or protocol.ts (pnpm test fails when the copies differ).
import fs from 'node:fs';

for (const f of ['invite.ts', 'protocol.ts']) fs.copyFileSync(`src/shared/${f}`, `worker/src/shared/${f}`);
console.log('worker/src/shared is up to date');
