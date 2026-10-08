import { execFileSync, spawn } from 'node:child_process';

export const WORKER_PORT = 8798;
export const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
export const OWNER_KEY = 'e2e-owner-key-0123456789';

/** Starts the room Worker locally (no Cloudflare account needed) and returns a function that stops it. */
export async function startWorker(): Promise<() => void> {
  const child = spawn(
    'npx',
    ['wrangler', 'dev', '--config', 'worker/wrangler.toml', '--var', `OWNER_KEY:${OWNER_KEY}`, '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--log-level', 'error'],
    { shell: true, stdio: 'ignore' },
  );
  const stop = () => {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      child.kill();
    }
  };
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${WORKER_URL}/health`)).ok) return stop;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error('The local Worker did not start');
}
