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
