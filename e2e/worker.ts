import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

export const WORKER_PORT = 8798;
export const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
export const OWNER_KEY = 'e2e-owner-key-0123456789';

/** Starts the room Worker locally (no Cloudflare account needed) and returns a function that stops it. */
export const CLAIM_PORT = 8796;
export const CLAIM_URL = `http://127.0.0.1:${CLAIM_PORT}`;

/** `claimable` starts a Worker WITHOUT the OWNER_KEY secret (like the "Deploy to Cloudflare" button makes), where the first app to connect becomes the owner. */
export async function startWorker(claimable = false): Promise<() => void> {
  if (claimable) fs.rmSync('.wrangler/state-e2e-claim', { recursive: true, force: true }); // a fresh Worker, nobody owns it yet
  const port = claimable ? CLAIM_PORT : WORKER_PORT;
  const url = claimable ? CLAIM_URL : WORKER_URL;
  const args = ['wrangler', 'dev', '--config', 'worker/wrangler.toml', ...(claimable ? ['--persist-to', '.wrangler/state-e2e-claim'] : ['--var', `OWNER_KEY:${OWNER_KEY}`]), '--port', String(port), '--ip', '127.0.0.1', '--log-level', 'error'];
  const child = spawn('npx', args, { shell: true, stdio: 'ignore' });
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
      if ((await fetch(`${url}/health`)).ok) return stop;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error('The local Worker did not start');
}
