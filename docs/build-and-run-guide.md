# Jaca anti Janja — build and run guide

P2P screen sharing (video + system audio) between friends, no cloud backend. The host's PC runs the
signaling server; media flows directly between peers over WebRTC.

## Stack (differs from the original spec)

Electron replaced Tauri/Rust because Rust and the MSVC build tools are not installed. Everything the spec
assigned to Rust now lives in the Electron main process (Node):

| Spec (Rust) | Implementation |
|---|---|
| Signaling server | `src/main/signaling.ts` (`ws`) |
| STUN / UPnP / port test | `src/main/network.ts` (own implementation, no extra deps) |
| Invite code | `src/shared/invite.ts` (Crockford Base32, 10 bytes -> 16 chars) |
| WASAPI process loopback (Discord echo fix) | `helper/AudioCapture` (C# / .NET 8, `jaca-audio.exe`) |

## Commands

```
pnpm install
node node_modules/electron/install.js   # pnpm skips Electron's postinstall download
pnpm build:audio                        # builds the C# audio helper into resources/audio (needs .NET SDK)
pnpm start                              # build + run
pnpm test                               # invite, STUN parsing and signaling server tests
pnpm typecheck
pnpm dist                               # NSIS installer in release/
```

## Discord echo / self-capture

The system audio contains Discord's voices and, if the app plays someone's stream, that stream too.
`jaca-audio.exe` uses WASAPI process loopback (Windows 10 2004+):

- **Sharing a window:** captures only that window's process tree. Discord and the app itself are left out.
- **Sharing a screen:** captures everything except the Discord process tree (name configurable in
  Settings). The WASAPI API accepts a single process, so the app's own playback cannot be excluded as well;
  incoming audio is therefore muted while sharing a screen (share a window to hear others).
- **Helper unavailable / Discord closed:** falls back to Chromium's full system loopback, same mute rule.

## Host network

Open TCP 47800 (or the configured port). The app tries UPnP automatically. Behind CGNAT, use IPv6 or a VPN
mesh (Tailscale, ZeroTier, Radmin) and put the VPN IP in Settings > Endereço manual. "Testar conectividade"
checks reachability (it can report a false negative on routers without hairpin NAT).

## Protocol additions

Besides the spec's messages, `watch` / `unwatch` (client -> client, relayed) let a viewer ask a sharer for the
stream, so upload is only spent on people actually watching.

## Auto-update and releases

Same idea as Jaca Downloader: the app checks GitHub Releases at startup (after 8 s) and every 6 h, and shows a
banner with "Atualizar agora". It uses `electron-updater` (`src/main/updater.ts`, banner in
`src/renderer/update-banner.ts`, manual check in Settings > Sobre). It only works in the installed app
(packaged build); `pnpm start` and the unpacked folder never update. The banner button is disabled while a room is
open, because updating restarts the app.

The feed is `RamonMarcelLopes/JacaAntiJanja` (set in `package.json` > `build.publish`); change it there if the
repository lives elsewhere. The repository must be public (or the app would need a token).

The installer is one-click and per-user (`%LocalAppData%\Programs\jaca-anti-janja`). Uninstalling removes the app
data as well. It is unsigned, so SmartScreen shows "editor desconhecido".

### Publishing a version

1. Bump `version` in `package.json` (this is the version the updater compares).
2. `pnpm build:audio` (only if `helper/` changed; the helper is gitignored, so build it on a fresh clone), then `pnpm dist`.
3. Create the release with the same tag as the version and upload exactly these three files from `release/`:
   - `JacaAntiJanja-Setup-X.Y.Z.exe`
   - `JacaAntiJanja-Setup-X.Y.Z.exe.blockmap`
   - `latest.yml`

   ```
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file notes.md release/JacaAntiJanja-Setup-X.Y.Z.exe release/JacaAntiJanja-Setup-X.Y.Z.exe.blockmap release/latest.yml
   ```
4. Installed apps pick it up within 6 h or on "Verificar atualizações".

Do not rename the installer: `latest.yml` references the file name, and GitHub replaces spaces in asset names, which
is why `artifactName` has none. The `appId` and the repository must not change, or installed apps stop finding
updates. Updates download only the changed blocks when the previous `.blockmap` exists.

### Testing an update without GitHub

Build two versions, serve the newer folder (`latest.yml` + `.exe` + `.blockmap`) over HTTP, install the older one
with `/S`, and point only the installed copy at the local feed by editing
`<install dir>\resources\app-update.yml` to `provider: generic` and `url: http://127.0.0.1:PORT/`. No test feed
belongs in the source code.

## Icon and installer splash

- App icon: `build/icon-source.png` is the original artwork. `node_modules/electron/dist/electron.exe scripts/make-app-icon.cjs`
  removes the black outside the rounded square and writes `build/icon.ico` (16-256 px) and `build/icon.png`.
  `package.json` uses the `.ico` for the exe, the installer and the uninstaller.
- Installer splash: `scripts/make-installer-splash.cjs` renders `build/installer-splash.bmp` (wordmark + icon on the
  hex skin); `build/installer.nsh` shows it for 2.5 s and skips it on silent installs (auto-update).
- Re-run the scripts only when the artwork or the splash design changes; the generated files are committed.

## End-to-end tests (Playwright)

`pnpm test:e2e` builds the app and runs `e2e/*.spec.ts` with Playwright's Electron support. Each test starts real
app windows (a host and a guest) with separate user-data folders and talks to them through the UI, so do not touch
the mouse during a run. Specs: `home.spec.ts` (first run, name check, text selection, avatar, settings),
`room.spec.ts` (room name, join errors, three-dot menu, live profile changes, leave/close) and `share.spec.ts` (real
screen capture, watching with audio, quality change). They use ports 47851-47853, so they do not clash with a room
open on the default port. `pnpm test` still runs the fast unit tests (invite code, STUN, signaling server).

## Live-reload development (`pnpm dev`)

`pnpm dev` builds in watch mode and opens the app with live reload, so edits show up while the app is open:

- CSS (`src/renderer/styles`): swapped in place, you keep your place (even inside a room).
- Renderer code or `index.html`: the window reloads (back to the home screen).
- Main process or preload: the app restarts.

It uses its own profile in `%LOCALAPPDATA%\jaca-anti-janja-dev` and port 47803, separate from the installed app and from the e2e tests.
F12 (or Ctrl+Shift+I) opens the DevTools. Stop it with Ctrl+C or by closing the app window. The hook that does the reloading
(`setupDevReload` in `src/main/main.ts`) only runs when `JACA_DEV` is set and the app is not packaged.

`pnpm dev:room` is the same with `--room`: after every reload or restart the window goes to the room screen by itself (it
creates a room, typing the name "Jaca" first if the dev profile has none). The dev window also listens on the DevTools port 9333
(localhost only), which is what the script uses to do that.

### Release notes format

Same layout as the Jaca Downloader releases (markdown, English first, no emojis, high level):

```
## What's new

- one short bullet per change

One closing sentence (installed apps update inside the app; new users install the Setup).

## Novidades (pt-BR)

- the same bullets in Portuguese

The same closing sentence in Portuguese.
```

Without the `##` headings GitHub shows one dense block of text, which is what the first releases looked like.

Every release also carries a **How to install** section (English) and **Como instalar** (under the pt-BR block): 1) download
`JacaAntiJanja-Setup-X.Y.Z.exe` (use the real version) from the Assets, 2) run it (one click, per user, no administrator), 3) the Setup is unsigned so
SmartScreen may warn: More info, then Run anyway (Mais informacoes, Executar assim mesmo), 4) already installed: nothing to
download, the app updates itself; then a requirements line (Windows 10 2004+ or 11, 64-bit; the first room asks once for the
firewall permission; how to uninstall, which also removes the app data). Use the real file name of that version.

## Cloudflare room server (optional mode)

Rooms can also connect through a Worker published in the room owner's own Cloudflare account, so no VPN is needed (the default stays
"Direto"). Everything about it is in [cloudflare-room-server.md](cloudflare-room-server.md). Developer commands:

- `pnpm worker:dev`: runs the Worker locally on http://127.0.0.1:8799 (no account needed).
- `pnpm test:worker`: starts it and runs the protocol tests (`worker/test`) against the real Workers runtime.
- `pnpm typecheck:worker` and `pnpm worker:build` (a dry-run bundle, nothing is published).
- `pnpm worker:sync`: copies `src/shared/invite.ts` and `protocol.ts` into `worker/src/shared` (the Deploy button publishes `worker/` alone).
- `pnpm worker:deploy`: publishes it to the logged-in Cloudflare account and prints the account name and the owner key to paste in the app.
- `e2e/cloudflare.spec.ts` starts its own local Worker (port 8798) and points the app at it with `JACA_WORKER_URL`; `JACA_FAKE_VPNS`
  fakes the network adapters list. Both only work in development builds, never in the installed app.
