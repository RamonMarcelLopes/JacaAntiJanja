# Recovering access to your Cloudflare Worker

For when someone deleted or lost the connection to the room server (the `jaca-sala` Worker) by accident: uninstalled the app, switched PCs, deleted a folder, or the app said **"Esse Worker já tem um dono"** ("this Worker already has an owner") or **"A chave do dono não confere"** ("the owner key does not match").

People who only **join** rooms (never create them) never need this. Only the owner of the Worker does.

(Em português: [cloudflare-recuperar-acesso.md](cloudflare-recuperar-acesso.md).)

## What the app keeps, and where

- **Account name and owner key** live in the app (Settings > Rede > Cloudflare). The key is created by the app, stored encrypted and **never shown on screen**.
- **A copy** is kept in `%LOCALAPPDATA%\JacaAntiJanja-Backup\cloudflare.json`, **outside** the folder the uninstaller deletes. The key in that copy is protected by Windows itself (only your Windows user can read it). When you install the app again it finds the copy and **restores the connection by itself**, in the same mode it was in.
- The **Remover** button (Settings > Rede > Cloudflare) deletes the connection **and** the copy, on purpose.

The copy does **not** help if: you deleted the `JacaAntiJanja-Backup` folder by hand, you are on **another PC**, you are signed in as **another Windows user**, or Windows was reinstalled. Use the steps below in those cases.

## First, find out which situation you are in

1. Open `https://jaca-sala.YOUR-ACCOUNT.workers.dev/health` in a browser (replace `YOUR-ACCOUNT` with your account name; Ramon's is `ramonlopesdev`).
   - You see `{"ok":true,"service":"jaca-sala"}`: the Worker **exists**. Go to **Case A**.
   - An error or "not found": the Worker was deleted. Go to **Case B**.
2. Do not remember the account name? Go to **Case C**.

## Case A: the Worker exists but the owner key is lost (the most common)

The Worker accepts **one** owner key, registered the first time. Since the old one is lost, you set a new one directly in the Cloudflare dashboard. Nothing needs to be published again.

1. **Create a new key.** In PowerShell (paste the whole line and press Enter):

   ```
   $r=[Security.Cryptography.RandomNumberGenerator]::Create(); $b=New-Object byte[] 24; $r.GetBytes($b); [Convert]::ToBase64String($b)
   ```

   It prints a string of letters and numbers. That is the key. Copy it.
2. **Put the key on the Worker.** In the Cloudflare dashboard (dash.cloudflare.com): **Workers & Pages** > **jaca-sala** > **Settings** > **Variables and Secrets** > **Add**.
   - Type: **Secret**
   - Name: `OWNER_KEY` (exactly like that, capital letters)
   - Value: the key from step 1
   - Save and **deploy**.
3. **In the app:** Settings > Rede > Cloudflare.
   - Address: the account name (or `jaca-sala.YOUR-ACCOUNT.workers.dev`)
   - Owner key ("Chave do dono"): paste the key from step 1
   - Press **Salvar e testar**. You should see "Worker conectado".

From then on the app stores the key again, including in the copy that survives uninstalling.

> **Careful:** the key is a secret. Do not paste it into chats, e-mail or screenshots. Whoever has it can create rooms on your Worker (this uses up your free limits, but gives no access to your Cloudflare account or your PC). If it leaks, repeat steps 1 and 2 with a new key: the old one stops working immediately.
> Keep the key in a password manager so you do not depend on the app to have it.

## Case B: the Worker was deleted

1. In the app: Settings > Rede > Cloudflare > **Publicar na minha conta Cloudflare**. Do the same as the first time: log in to Cloudflare, confirm the GitHub connection (if asked), create it directly, keep the name `jaca-sala` and wait for "Success".
2. Copy the address shown at the end of the log (`https://jaca-sala.YOUR-ACCOUNT.workers.dev`).
3. In the app, paste the address and press **Salvar e testar** with the key field **empty**: the app creates and registers a new key.
4. In the dashboard (Workers & Pages > jaca-sala > Settings > Domains & Routes) check that **workers.dev** is **Enabled**.

Your account does not change, so the address and the end of the room codes stay the same.

## Case C: I do not remember the account name

In the Cloudflare dashboard open **Workers & Pages** > **jaca-sala**. The Worker address is shown at the top (`jaca-sala.YOUR-ACCOUNT.workers.dev`). The `YOUR-ACCOUNT` part is the account name. It is also shown under **Workers & Pages** > **Overview** as "workers.dev subdomain".

## Case D: I deleted the `jaca-sala` repository on GitHub

No problem: the Worker **keeps working**. The repository is only a copy of the code that Cloudflare uses to redeploy. You only need it to update the Worker, and then you can use the **Publicar na minha conta Cloudflare** button again (Case B).

## Case E: my friend cannot join

- Ask them to use app version **0.1.12 or newer**. Versions 0.1.5 to 0.1.8 cut off the end of the code when pasting (the field accepted only 24 characters), so the account name came out wrong, like `ramonlopesde` instead of `ramonlopesdev`.
- A room only exists while its **owner is in it**. If the owner left, the code no longer works.
- The app now explains the reason in the error message itself. If it is still unclear: Settings > Sobre > **Abrir pasta do registro** and send the `jaca.log` file (it has no key and not the whole room code).

## The app's messages at a glance

| Message | What to do |
|---|---|
| "Esse Worker já tem um dono (outra chave)" | The stored key was lost: **Case A**. |
| "A chave do dono não confere" | The pasted key is not the Worker's. If you lost the right one: **Case A**. |
| "Não consegui alcançar o Worker" | Check the account name, the internet and that the Worker exists (`/health`): **Case B** if it was deleted. |
| "O endereço ... não existe. O código tem a conta errada ou cortada" | Ask the owner for the code again and paste it whole (**Case E**). |
| "A sala não existe ou já foi encerrada" | The owner left the room, or the code is from an old room. |
