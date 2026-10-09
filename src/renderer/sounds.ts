// Sound effects, synthesized with Web Audio (no audio files, nothing to license). Each sound is a few short notes.
// Every call also fires a `jaca-sound` event on window (detail = sound name) so the tests can check which sound was triggered.

import { SoundName } from '../shared/protocol';
export type { SoundName };

// self-join: you enter the room, self-leave: you leave, peer-join / peer-leave: someone else enters / leaves,
// self-share-start / self-share-stop: you start / stop sharing, peer-share-start / peer-share-stop: a friend does.

interface Note {
  f: number; // start frequency (Hz)
  to?: number; // glide to this frequency over the note
  at: number; // start time (s)
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880, B5 = 987.77, C6 = 1046.5, E6 = 1318.5;

const SOUNDS: Record<SoundName, Note[]> = {
  // you: a warm two-note chime going up when you come in, the same going down when you leave
  'self-join': [{ f: E5, at: 0, dur: 0.18 }, { f: B5, at: 0.11, dur: 0.34 }],
  'self-leave': [{ f: B5, at: 0, dur: 0.18 }, { f: E5, at: 0.11, dur: 0.34 }],
  // someone else: one short blip gliding up (in) or down (out)
  'peer-join': [{ f: 700, to: 1050, at: 0, dur: 0.2, gain: 0.8 }],
  'peer-leave': [{ f: 950, to: 620, at: 0, dur: 0.22, gain: 0.8 }],
  // you share: a four-note rising arpeggio, and the same falling when you stop
  'self-share-start': [
    { f: C5, at: 0, dur: 0.16, type: 'triangle' },
    { f: E5, at: 0.08, dur: 0.16, type: 'triangle' },
    { f: G5, at: 0.16, dur: 0.16, type: 'triangle' },
    { f: C6, at: 0.24, dur: 0.38, type: 'triangle' },
  ],
  'self-share-stop': [
    { f: C6, at: 0, dur: 0.16 },
    { f: G5, at: 0.08, dur: 0.16 },
    { f: E5, at: 0.16, dur: 0.16 },
    { f: C5, at: 0.24, dur: 0.38 },
  ],
  // a friend shares: a bright repeated "ding-ding"; when they stop, a soft falling pair
  'peer-share-start': [{ f: E6, at: 0, dur: 0.12, gain: 0.8 }, { f: E6, at: 0.15, dur: 0.3, gain: 0.8 }],
  'peer-share-stop': [{ f: A5, at: 0, dur: 0.14, type: 'triangle', gain: 0.7 }, { f: E5, at: 0.13, dur: 0.3, type: 'triangle', gain: 0.7 }],
};

let ctx: AudioContext | null = null;
let volume = 0.6; // 0..1
// when audio devices come or go the old context may keep playing into nothing: drop it, the next sound builds a new one
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  void ctx?.close().catch(() => undefined);
  ctx = null;
});
const lastPlayed = new Map<SoundName, number>();
const disabled = new Set<string>();

/** The cues the user switched off (Settings > Notificações). */
export function setDisabledSounds(names: readonly string[]): void {
  disabled.clear();
  for (const n of names) disabled.add(n);
}

/** 0-100, as stored in the settings. */
export function setSoundVolume(percent: number): void {
  volume = Math.min(1, Math.max(0, percent / 100));
}

/** `preview` is for the play buttons in Settings: it plays even when that cue is switched off. */
export function playSound(name: SoundName, preview = false): void {
  if (!preview && disabled.has(name)) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -1000) < 100) return; // a burst of identical events plays once
  lastPlayed.set(name, now);
  window.dispatchEvent(new CustomEvent('jaca-sound', { detail: name }));
  if (volume <= 0) return;

  try {
    // a context left over from before the output device changed (headset plugged, VPN/audio driver restart) can stay silent for good: start a new one
    if (!ctx || ctx.state === 'closed' || ctx.state === ('interrupted' as AudioContextState)) {
      void ctx?.close().catch(() => undefined);
      ctx = new AudioContext();
    }
    if (ctx.state !== 'running') void ctx.resume();
    const t0 = ctx.currentTime + 0.01;

    const master = ctx.createGain();
    master.gain.value = Math.pow(volume, 1.5) * 0.5; // perceptual curve; leaves headroom for the layered notes
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 6000;
    master.connect(soften);
    soften.connect(ctx.destination);

    for (const n of SOUNDS[name]) {
      const start = t0 + n.at;
      const end = start + n.dur;
      const env = ctx.createGain(); // quick attack, smooth decay
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime((n.gain ?? 1) * 0.6, start + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, end + 0.18);
      env.connect(master);

      const osc = ctx.createOscillator();
      osc.type = n.type ?? 'sine';
      osc.frequency.setValueAtTime(n.f, start);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, end);
      osc.connect(env);
      osc.start(start);
      osc.stop(end + 0.2);

      // a quiet octave above gives the note a little bell-like body
      const body = ctx.createOscillator();
      body.type = 'sine';
      body.frequency.setValueAtTime(n.f * 2, start);
      if (n.to) body.frequency.exponentialRampToValueAtTime(n.to * 2, end);
      const bodyGain = ctx.createGain();
      bodyGain.gain.value = 0.2;
      body.connect(bodyGain);
      bodyGain.connect(env);
      body.start(start);
      body.stop(end + 0.2);
    }
  } catch {
    /* no audio device or the context could not start: sounds are optional, never break the app */
  }
}
