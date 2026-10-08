// Starts the room Worker locally (wrangler dev, no Cloudflare account needed), runs room.test.mjs against it, and stops it.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 8799;
const OWNER_KEY = 'test-owner-key-0123456789';
const HTTP = `http://127.0.0.1:${PORT}`;

const wrangler = spawn(
  'npx',
  ['wrangler', 'dev', '--config', 'worker/wrangler.toml', '--var', `OWNER_KEY:${OWNER_KEY}`, '--port', String(PORT), '--ip', '127.0.0.1', '--log-level', 'error'],
  { shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
// a second Worker WITHOUT the OWNER_KEY secret, to test the first-claim ownership used by the "Deploy to Cloudflare" button (own state folder)
const CLAIM_PORT = 8797;
fs.rmSync('.wrangler/state-claim', { recursive: true, force: true }); // a fresh Worker, nobody owns it yet
const claimer = spawn(
  'npx',
  ['wrangler', 'dev', '--config', 'worker/wrangler.toml', '--port', String(CLAIM_PORT), '--ip', '127.0.0.1', '--log-level', 'error', '--persist-to', '.wrangler/state-claim'],
  { shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let output = '';
claimer.stdout.on('data', (d) => (output += d));
claimer.stderr.on('data', (d) => (output += d));
wrangler.stdout.on('data', (d) => (output += d));
wrangler.stderr.on('data', (d) => (output += d));

function stop() {
  for (const p of [wrangler, claimer]) {
    try {
      execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      p.kill();
    }
  }
}

async function ready(timeoutMs, base = HTTP) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${base}/health`)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (!(await ready(120_000)) || !(await ready(120_000, `http://127.0.0.1:${CLAIM_PORT}`))) {
  console.error('The Worker did not start. Output:\n' + output);
  stop();
  process.exit(1);
}

const tests = spawn(process.execPath, ['--test', 'worker/test/room.test.mjs', 'worker/test/claim.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, WORKER_URL: `ws://127.0.0.1:${PORT}`, OWNER_KEY, CLAIM_URL: `http://127.0.0.1:${CLAIM_PORT}` },
});
tests.on('exit', (code) => {
  stop();
  process.exit(code ?? 1);
});
