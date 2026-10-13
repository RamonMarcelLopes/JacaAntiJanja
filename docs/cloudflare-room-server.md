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

### With the button (no command)

1. In the app: Settings > Rede > **Cloudflare** > "Publicar na minha conta Cloudflare". Cloudflare's own page opens in the browser.
2. Log in (or create the free account). Cloudflare asks to connect **GitHub**: allow it, then pick the Git account where the copy will live. If the page closes after connecting, open the button again.
3. Choose to create it directly. Cloudflare creates a repository called `jaca-sala` in your GitHub (public by default; you can make it private later in the repository's Settings > Danger Zone, it holds only a copy of the code, no secrets), then opens the **Implantações** (deployments) view and builds and publishes it. It takes under a minute and ends with "Success".
4. The log ends with the Worker address, `https://jaca-sala.your-account.workers.dev`. Copy it. In the Cloudflare dashboard (Workers e Pages > jaca-sala > Configurações > Domínios e rotas) the **workers.dev** route must say "Habilitado": the room address does not exist without it. If it says "Desabilitado", enable it.
5. In the app, paste the address (the whole address or only `your-account`) and press "Salvar e testar", leaving the owner key **empty**.
6. The app creates a random owner key, registers it on your Worker and stores it encrypted with Windows. It is never shown.

How ownership works without a secret: **the first app that registers a key owns the Worker**. Only a hash of the key is stored on the Worker, and once registered it can never be replaced
(a second key gets "Esse Worker já tem um dono"). Register right after publishing: until then, anyone who knew your address could register first, and the address is not published anywhere.
If that ever happens, delete the Worker in the Cloudflare dashboard and publish it again.

### With a command (also an option)

1. Create a free account at cloudflare.com.
2. In this repository, install and publish:

   ```
   pnpm install
   pnpm worker:deploy
   ```

   The command logs you in (a browser window opens), publishes the Worker `jaca-sala`, creates a random **owner key** as a secret and prints
   two values: the **account name** (the part before `.workers.dev`) and the **owner key**.
3. In the app: Settings > Rede > **Cloudflare**, paste both and press "Salvar e testar". The key is stored encrypted with Windows
   (never in plain text, never shown again).
4. Create a room as usual. The code looks like `K7QM2-XRA9T@your-account`. Send it to your friends: they paste it and enter.

Running `pnpm worker:deploy` again updates the Worker and creates a **new** owner key (the old one stops working); paste the new one
in the app. A Worker that has the `OWNER_KEY` secret never accepts a first-use registration.

## The invite code

`K7QM2-XRA9T@your-account` = a random 10-character room id + the owner's account name. The app derives the room server address from it:
`jaca-sala.your-account.workers.dev`. Codes are only accepted when the account name is a plain `a-z0-9-` label, so a code can never
point the app anywhere but a `workers.dev` address.

The older long codes (`XXXX-XXXX-XXXX-XXXX`) still work: they are the direct mode.

## Fixed rooms, favorites and the Discord notice

**Fixed rooms.** A normal room gets a new code every time. In *Iniciar sala* (home screen) the dropdown *Tipo de sala* also offers
*+ Nova sala fixa* and the fixed rooms you already have. A fixed room keeps its name and its code: opening it again gives the same code,
so friends can save it. They are managed in Settings > *Salas fixas* (search, open/closed filter, edit the name, new code, delete) and,
for one room at a time, with the three dots inside the dropdown. *Novo código* gives the room another id: the old code (and the
favorites made from it) stop leading anywhere. Up to 10 fixed rooms.

**If the app closed without ending the room.** The room stays open on the Worker for up to a minute. Opening the fixed room again then
asks what to do: *Reabrir esta sala* (the owner takes the room id back: the Worker ends the old room, tells whoever was in it, and creates
it again with the same code) or *Criar temporária* (another code, same name). Only the owner key can take a room back
(`/ws/<id>?create=1&key=...&takeover=1`); without `takeover` an id in use is still refused with 409.

**Favorites.** Inside a Cloudflare room a guest can star it. The list *Salas favoritas* on the home screen shows each favorite as open,
closed or unknown, with the host and how many people are in it, and has a search and an open/closed filter. The name is always the one
the host gave (the guest cannot rename it; it follows the host's name). The app asks every favorite's Worker `GET /api/room/<id>`, which
answers `{ "open": true, "name": "...", "hostName": "...", "count": 2 }` or `{ "open": false }` (the list refreshes every 20 s while the
home screen is open; a notice appears when a closed favorite opens). The same question tells the owner which fixed rooms are open. It only
reveals what joining would reveal. Workers older than this version do not know the question: the state is then shown as *Sem resposta*.

**Discord notice (per fixed room).** In *Nova sala fixa* and in *Editar sala* the switch *Avisar no Discord* shows a field for the webhook
of a channel (channel settings > Integrations > Webhooks). When that room opens, the app posts an embed in that channel (green): who opened it
with their photo, the room name, the room code, *Status: Aberta* and a counter ("Tempo aberta", which Discord keeps updating itself). When
the room ends, **the same message is edited**: grey, *Status: Fechada* and *Ficou aberta por* with how long it was open. Opening the room again
posts a new message, so the channel keeps one message per time the room opened. If the app dies with the room open (crash, killed process,
power loss) the notice stays "Aberta" until the next start, when the app edits it to "Fechada" and writes *Desconhecido* as the time open (the
pending notices are kept in `discord-notices.json` in the app's data folder; one that cannot be reached because there is no internet is tried
again at the next start, for up to a week). If somebody deleted the webhook or the message in Discord, the app just ignores that and goes on.
Each fixed room has its own webhook (or none). The address is tested when saved (a test
message is sent), stored encrypted with Windows (safeStorage) inside that room, and never shown again; only
`https://discord.com/api/webhooks/...` addresses (also `discordapp.com`, `canary.`, `ptb.`) are accepted, names are escaped and nobody is
pinged (`allowed_mentions` is empty). The code is visible to everybody who sees the channel, which is the point of the notice: use a channel
you trust. In the direct mode (no Worker) there are no fixed rooms, so there is no notice.

**Updating a Worker you already published.** These features need the new Worker. If you published it with the button, Cloudflare copied
`worker/` into your own GitHub repository: replace `src/index.ts`, `src/shared/` and `wrangler.toml` there with the ones from this
repository's `worker/` folder and commit; Cloudflare deploys it again by itself. Rooms and the owner key are not lost (the owner is stored
in the Worker, not in the code).

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
- "Não consegui alcançar o servidor da sala" / the app explains the cause itself after a failed join: the room is closed, the connection of the room (WebSocket) is blocked by an antivirus web protection, firewall or network, or workers.dev is unreachable (try another network such as a phone hotspot, or set the Windows DNS to 1.1.1.1).
- "Esse Worker já tem um dono": another app (or an earlier install of this one) already registered a key. Paste that key, or define a new one as the `OWNER_KEY` secret in the Cloudflare dashboard. Step by step, with the other lost-access cases, in [cloudflare-recover-access.md](cloudflare-recover-access.md) (English) and [cloudflare-recuperar-acesso.md](cloudflare-recuperar-acesso.md) (Portuguese).
- The connection to your Worker (account + key) is also kept in `%LOCALAPPDATA%\JacaAntiJanja-Backup`, outside the app's data folder, with the key protected by Windows (DPAPI, this Windows user). Uninstalling and installing again restores it by itself; "Remover" in Settings deletes it.
- "Não consegui alcançar o Worker": check the account name (letters, numbers and hyphens only), your internet, and that the deploy finished.
- A friend gets "A sala não existe ou já foi encerrada": the room only exists while its owner is in it.

## Working on the Worker locally

```
pnpm worker:dev      # runs it on http://127.0.0.1:8799 with a test owner key
pnpm test:worker     # starts it and runs the protocol tests against it
pnpm typecheck:worker
```

`worker/src/shared` is a copy of `src/shared/invite.ts` and `protocol.ts` (the sharing of a screen or a camera is announced with `source: 'screen' | 'camera'`, which the Worker passes on) (the button publishes `worker/` alone). After changing those two files run `pnpm worker:sync`; `pnpm test` fails when the copies differ.

No Cloudflare account is needed for these. In a development build, set `JACA_WORKER_URL=http://127.0.0.1:8799` to make the app talk to that
local Worker instead of `workers.dev`.
