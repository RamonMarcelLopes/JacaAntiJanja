import http from 'node:http';

// A tiny server that plays Discord for the tests (the app is pointed at it with JACA_DISCORD_BASE, which only works outside the installed app).

export interface DiscordCall {
  method: string;
  path: string;
  /** The first (and only) embed of the message, as the app sent it. */
  embed: Record<string, any>;
  /** The names of the files attached to the message. */
  files: string[];
}

export const FAKE_WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL0123456789xyzABC';

export interface FakeDiscord {
  base: string;
  calls: DiscordCall[];
  /** From now on every request is answered like Discord answers a webhook that was deleted (404). */
  deleteWebhook(): void;
  /** Back to a webhook that exists, with no calls recorded. */
  reset(): void;
  stop(): Promise<void>;
}

export async function startFakeDiscord(port: number): Promise<FakeDiscord> {
  const calls: DiscordCall[] = [];
  let gone = false;
  let nextId = 1;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const json = /name="payload_json"\r\n\r\n([\s\S]*?)\r\n--/.exec(text)?.[1];
      let payload: { embeds?: Array<Record<string, any>> } = {};
      try {
        payload = JSON.parse(json ?? '{}');
      } catch {
        /* not a JSON message */
      }
      const files = [...text.matchAll(/filename="([^"]+)"/g)].map((m) => m[1]);
      calls.push({ method: req.method ?? '', path: req.url ?? '', embed: payload.embeds?.[0] ?? {}, files });
      res.setHeader('content-type', 'application/json');
      if (gone) {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: 'Unknown Webhook', code: 10015 }));
      } else if (req.method === 'POST') {
        res.end(JSON.stringify({ id: String(1000 + nextId++) }));
      } else {
        res.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${port}`,
    calls,
    deleteWebhook: () => {
      gone = true;
    },
    reset: () => {
      gone = false;
      nextId = 1;
      calls.length = 0;
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
