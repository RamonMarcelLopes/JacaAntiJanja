// Publishes the room Worker (worker/) to YOUR Cloudflare account and prints the two values to paste in the app.
//   pnpm worker:deploy
// Running it again publishes the latest Worker and creates a NEW owner key (the old one stops working).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const config = ['--config', 'worker/wrangler.toml'];

/** Runs wrangler. `capture` also keeps the output so it can be parsed; `input` is written to its stdin (used for the secret). */
function wrangler(args, { input, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', ...args], { shell: true, stdio: [input ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit', 'inherit'] });
    let out = '';
    if (capture) {
      child.stdout.on('data', (d) => {
        process.stdout.write(d);
        out += d;
      });
    }
    if (input) {
      child.stdin.write(input + '\n');
      child.stdin.end();
    }
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`wrangler ${args[0]} failed (exit code ${code})`))));
  });
}

console.log('1/3  Checking your Cloudflare login...');
let who = '';
try {
  who = await wrangler(['whoami'], { capture: true });
} catch {
  /* not logged in */
}
if (!who || /not authenticated/i.test(who)) {
  console.log('You are not logged in. A browser window will open: log in to your free Cloudflare account and allow wrangler.');
  await wrangler(['login']);
}

console.log('\n2/3  Publishing the Worker "jaca-sala"...');
const deployOutput = await wrangler(['deploy', ...config], { capture: true });
const match = /https:\/\/jaca-sala\.([a-z0-9-]+)\.workers\.dev/.exec(deployOutput);

console.log('\n3/3  Creating the owner key...');
const ownerKey = randomBytes(24).toString('base64url');
await wrangler(['secret', 'put', 'OWNER_KEY', ...config], { input: ownerKey });

console.log('\n========================================================');
console.log('Done. Paste these two values in the app:');
console.log('Settings > Rede > Cloudflare\n');
console.log(`  Account name (workers.dev): ${match ? match[1] : '(the part before ".workers.dev" in the address printed above)'}`);
console.log(`  Owner key:                  ${ownerKey}`);
console.log('\nKeep the owner key private: it lets whoever has it create rooms on your Worker.');
console.log('Friends who only join rooms need none of this: they just paste the room code.');
console.log('========================================================');
