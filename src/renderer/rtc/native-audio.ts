// Turns the PCM stream from the native helper (s16le, 48 kHz, stereo, system audio without
// Discord) into a MediaStreamTrack that can be sent over WebRTC.

const WORKLET = `
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(48000);
    this.right = new Float32Array(48000);
    this.read = 0;
    this.write = 0;
    this.size = 48000;
    this.port.onmessage = (e) => {
      const pcm = new Int16Array(e.data);
      const frames = pcm.length >> 1;
      // Keep latency bounded: if more than ~250 ms is queued, drop the oldest audio.
      const queued = (this.write - this.read + this.size) % this.size;
      if (queued + frames > 12000) this.read = this.write;
      for (let i = 0; i < frames; i++) {
        this.left[this.write] = pcm[2 * i] / 32768;
        this.right[this.write] = pcm[2 * i + 1] / 32768;
        this.write = (this.write + 1) % this.size;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    for (let i = 0; i < out[0].length; i++) {
      if (this.read !== this.write) {
        out[0][i] = this.left[this.read];
        out[1][i] = this.right[this.read];
        this.read = (this.read + 1) % this.size;
      } else {
        out[0][i] = 0;
        out[1][i] = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-player', PcmPlayer);
`;

export interface NativeAudio {
  track: MediaStreamTrack;
  stop(): void;
}

export async function startNativeAudio(): Promise<NativeAudio> {
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
  const dest = ctx.createMediaStreamDestination();
  node.connect(dest);

  // Pipe chunks can end mid-frame (a frame is 4 bytes: 2 channels x s16), so keep the remainder.
  let carry = new Uint8Array(0);
  window.jaca.onAudioData((chunk) => {
    const data = new Uint8Array(carry.length + chunk.length);
    data.set(carry, 0);
    data.set(chunk, carry.length);
    const usable = data.length - (data.length % 4);
    carry = data.slice(usable);
    if (!usable) return;
    const out = data.slice(0, usable).buffer;
    node.port.postMessage(out, [out]);
  });

  return {
    track: dest.stream.getAudioTracks()[0],
    stop: () => {
      node.disconnect();
      void ctx.close();
    },
  };
}
