import { app } from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AudioStartResult } from '../shared/protocol';

let proc: ChildProcess | null = null;

/** The audio helper writes to the same jaca.log as the rest of the app (file only, never shown on screen). */
function alog(text: string): void {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'jaca.log'), `${new Date().toISOString()} v${app.getVersion()} [captura] áudio: ${text.split(/[\r\n]+/).join(' | ').slice(0, 2500)}${os.EOL}`);
  } catch {
    /* logging must never break the app */
  }
}

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
  alog(`iniciando (fonte ${sourceId ? sourceId.split(':')[0] : 'nenhuma'}, processo a excluir "${processName}", helper ${fs.existsSync(exe) ? 'encontrado' : 'NÃO ENCONTRADO'} em ${exe})`);
  if (!fs.existsSync(exe)) return fail('Helper de áudio não encontrado.');

  const hwnd = /^window:(\d+):/.exec(sourceId ?? '')?.[1];
  if (hwnd) {
    const r = await runHelper(exe, ['--include-hwnd', hwnd], onData, 'Áudio só da janela compartilhada.', true);
    alog(`captura só da janela: ${r.ok ? 'funcionou' : 'falhou, tentando o áudio do sistema'} — ${r.message}`);
    if (r.ok) return r;
  }

  const name = processName.trim().replace(/\.exe$/i, '');
  if (!name || !/^[\w .-]+$/.test(name)) {
    alog(`nenhum processo válido para excluir ("${processName}")`);
    return fail('Nenhum processo para excluir do áudio configurado.');
  }
  const result = await runHelper(exe, ['--exclude-name', name], onData, `Áudio do sistema sem o ${name}.`, false, name);
  alog(`captura do sistema sem "${name}": ${result.ok ? 'funcionou' : 'falhou'} — ${result.message || '(sem aviso: o processo não está aberto)'}`);
  return result;
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
      alog(`o helper não respondeu em 8 s (argumentos ${args.join(' ')}); saída de erro até agora: "${errBuf.slice(0, 300)}"`);
      child.kill();
      finish(fail('O helper de áudio não respondeu.'));
    }, 8000);

    child.stdout!.on('data', onData);
    let errBuf = '';
    child.stderr!.on('data', (d) => {
      errBuf += d.toString();
      alog(`o helper disse: ${d.toString().trim().slice(0, 300)}`);
      if (/^READY/m.test(errBuf)) finish({ ok: true, isolated, message: okMessage });
      const err = /^ERR (.*)$/m.exec(errBuf);
      if (err) {
        finish(
          fail(
            /not found/.test(err[1])
              ? '' // the excluded app is not running: the whole system audio is shared and there is nothing to warn about
              : `Captura de áudio isolada indisponível (${err[1]}).`,
          ),
        );
      }
    });
    child.on('error', (e) => {
      alog(`não consegui iniciar o helper: ${e.name} ${(e as any).code ?? ''} ${e.message}`);
      finish(fail(`Falha ao iniciar o helper de áudio: ${e.message}`));
    });
    child.on('exit', (code, signal) => {
      alog(`o helper terminou (código ${code}, sinal ${signal ?? 'nenhum'}; argumentos ${args.join(' ')})`);
      if (proc === child) proc = null;
      finish(fail('O helper de áudio encerrou inesperadamente.'));
    });
  });
}
