import { app } from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AudioStartResult } from '../shared/protocol';

let proc: ChildProcess | null = null;

function helperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'audio', 'jaca-audio.exe')
    : path.join(app.getAppPath(), 'resources', 'audio', 'jaca-audio.exe');
}

export function stopAudio(): void {
  proc?.kill();
  proc = null;
}

const fail = (message: string): AudioStartResult => ({ ok: false, isolated: false, message });

/**
 * Starts the native helper (WASAPI process loopback). PCM chunks (s16le, 48 kHz, stereo) go to `onData`.
 * - Sharing a window: captures only that window's process tree, which leaves out Discord and also this
 *   app's own playback, so received audio can never loop back into the stream ("isolated").
 * - Sharing a screen (or if the window capture fails): captures everything except `processName`'s tree.
 */
export async function startAudio(processName: string, sourceId: string | null, onData: (chunk: Buffer) => void): Promise<AudioStartResult> {
  stopAudio();
  const exe = helperPath();
  if (!fs.existsSync(exe)) return fail('Helper de áudio não encontrado.');

  const hwnd = /^window:(\d+):/.exec(sourceId ?? '')?.[1];
  if (hwnd) {
    const r = await runHelper(exe, ['--include-hwnd', hwnd], onData, 'Áudio só da janela compartilhada.', true);
    if (r.ok) return r;
  }

  const name = processName.trim().replace(/\.exe$/i, '');
  if (!name || !/^[\w .-]+$/.test(name)) return fail('Nenhum processo para excluir do áudio configurado.');
  return runHelper(exe, ['--exclude-name', name], onData, `Áudio do sistema sem o ${name}.`, false, name);
}

function runHelper(exe: string, args: string[], onData: (chunk: Buffer) => void, okMessage: string, isolated: boolean, name = ''): Promise<AudioStartResult> {
  stopAudio();
  return new Promise((resolve) => {
    const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    proc = child;
    let settled = false;
    const finish = (r: AudioStartResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(fail('O helper de áudio não respondeu.'));
    }, 8000);

    child.stdout!.on('data', onData);
    let errBuf = '';
    child.stderr!.on('data', (d) => {
      errBuf += d.toString();
      if (/^READY/m.test(errBuf)) finish({ ok: true, isolated, message: okMessage });
      const err = /^ERR (.*)$/m.exec(errBuf);
      if (err) {
        finish(
          fail(
            /not found/.test(err[1])
              ? `${name || 'O processo'} não está aberto; usando o áudio completo do sistema.`
              : `Captura de áudio isolada indisponível (${err[1]}).`,
          ),
        );
      }
    });
    child.on('error', (e) => finish(fail(`Falha ao iniciar o helper de áudio: ${e.message}`)));
    child.on('exit', () => {
      if (proc === child) proc = null;
      finish(fail('O helper de áudio encerrou inesperadamente.'));
    });
  });
}
