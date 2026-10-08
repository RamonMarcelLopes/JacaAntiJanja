# Cloudflare room server (no VPN needed)

By default Jaca anti Janja connects people **directly**: your PC runs the room and friends reach it through its address
(which needs a VPN such as Radmin when your internet provider uses CGNAT). The **Cloudflare mode** is an alternative that
needs no VPN: the room lives in a tiny Worker published in **your own free Cloudflare account**, and friends only paste the room code.

The default stays **Direto (VPN)**. Switch in the app: Settings > Rede > "Cloudflare". That mode only works with the account name and the owner key
filled in (and saved with "Salvar e testar"); until then the app keeps using Direto, and leaving Settings half-filled puts it back on Direto with a notice.

## What it is

- A small Worker (`worker/`), one Durable Object per room, that only relays signaling messages: who is in the room, names and photos,
  and the WebRTC offers/answers/candidates the PCs need to find each other.
- **Video and audio never go through it.** The PCs connect directly (WebRTC), exactly as before.
- It belongs to the person who creates rooms. Friends who only join need no account, no key and no setup.

## Who needs what

| | Needs a Cloudflare account | Needs the owner key | Needs |
|---|---|---|---|
| Creates rooms in Cloudflare mode | yes (free) | yes | the Worker published once |
| Joins a room | no | no | a version of the app that supports it, and the code |

## Publish your Worker (once)

1. Create a free account at cloudflare.com.
2. In this repository, install and publish:

   ```
   pnpm install
   pnpm worker:deploy
   ```

   The command logs you in (a browser window opens), publishes the Worker `jaca-sala`, creates a random **owner key** and prints
   two values: the **account name** (the part before `.workers.dev`) and the **owner key**.
3. In the app: Settings > Rede > **Cloudflare**, paste both and press "Salvar e testar". The key is stored encrypted with Windows
   (never in plain text, never shown again).
4. Create a room as usual. The code looks like `K7QM2-XRA9T@your-account`. Send it to your friends: they paste it and enter.

Running `pnpm worker:deploy` again updates the Worker and creates a **new** owner key (the old one stops working); paste the new one
in the app.

## The invite code

`K7QM2-XRA9T@your-account` = a random 10-character room id + the owner's account name. The app derives the room server address from it:
`jaca-sala.your-account.workers.dev`. Codes are only accepted when the account name is a plain `a-z0-9-` label, so a code can never
point the app anywhere but a `workers.dev` address.

The older long codes (`XXXX-XXXX-XXXX-XXXX`) still work: they are the direct mode.

## Security notes

- Creating a room needs the owner key; nobody else can use your Worker to create rooms or spend your free limits that way.
- Joining needs the full code. The room id is 50 random bits, so it cannot be guessed.
- The Worker sees room names, display names, photos and the network addresses exchanged by WebRTC. It does not see video or audio.
- Do **not** paste a Cloudflare API token or your account key anywhere in the app. The app never needs it.

## Free plan limits

Durable Objects on the free plan allow 100,000 requests and 13,000 GB-s of duration per day. Two people in a room for 8 hours use
a small fraction of that (at most about 3,600 GB-s even if the room never "sleeps", and a few thousand messages). The limits reset
at 00:00 UTC. See Cloudflare's pricing page for the current numbers.

If a friend's network cannot make a direct connection (some mobile networks), a relay (TURN) would be needed; it is not part of this
version. Settings > Rede > Cloudflare > "Testar minha rede" tells whether a direct connection should work from a given PC.

## Removing it

Settings > Rede > Cloudflare > "Remover" forgets the Worker in the app and goes back to Direto. To delete the Worker itself, remove
`jaca-sala` in the Cloudflare dashboard (Workers & Pages).

## Troubleshooting

- "A chave do dono não confere": paste the key printed by the last `pnpm worker:deploy`.
- "Não consegui alcançar o Worker": check the account name (letters, numbers and hyphens only), your internet, and that the deploy finished.
- A friend gets "A sala não existe ou já foi encerrada": the room only exists while its owner is in it.

## Working on the Worker locally

```
pnpm worker:dev      # runs it on http://127.0.0.1:8799 with a test owner key
pnpm test:worker     # starts it and runs the protocol tests against it
pnpm typecheck:worker
```

No Cloudflare account is needed for these. In a development build, set `JACA_WORKER_URL=http://127.0.0.1:8799` to make the app talk to that
local Worker instead of `workers.dev`.
