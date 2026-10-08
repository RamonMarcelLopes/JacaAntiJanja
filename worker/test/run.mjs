// Starts the room Worker locally (wrangler dev, no Cloudflare account needed), runs room.test.mjs against it, and stops it.
import { execFileSync, spawn } from 'node:child_process';

const PORT = 8799;
const OWNER_KEY = 'test-owner-key-0123456789';
const HTTP = `http://127.0.0.1:${PORT}`;

const wrangler = spawn(
  'npx',
  ['wrangler', 'dev', '--config', 'worker/wrangler.toml', '--var', `OWNER_KEY:${OWNER_KEY}`, '--port', String(PORT), '--ip', '127.0.0.1', '--log-level', 'error'],
  { shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let output = '';
wrangler.stdout.on('data', (d) => (output += d));
wrangler.stderr.on('data', (d) => (output += d));

function stop() {
  try {
    execFileSync('taskkill', ['/PID', String(wrangler.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    wrangler.kill();
  }
}

async function ready(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${HTTP}/health`)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (!(await ready(120_000))) {
  console.error('The Worker did not start. Output:\n' + output);
  stop();
  process.exit(1);
}

const tests = spawn(process.execPath, ['--test', 'worker/test/room.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, WORKER_URL: `ws://127.0.0.1:${PORT}`, OWNER_KEY },
});
tests.on('exit', (code) => {
  stop();
  process.exit(code ?? 1);
});
