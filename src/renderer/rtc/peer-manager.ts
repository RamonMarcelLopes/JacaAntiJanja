import { AppConfig, BITRATE_MBPS, Message, ShareInfo } from '../../shared/protocol';
import { SignalingClient } from '../signaling-client';

export type Quality = 'good' | 'ok' | 'bad' | 'unknown';

export interface PeerManagerEvents {
  onStream(peerId: string, stream: MediaStream | null): void;
  onQuality(peerId: string, quality: Quality, rttMs: number | null): void;
  onConnectionFailed(peerId: string): void;
  onWatchersChanged(count: number): void;
}

interface Conn {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  senders: RTCRtpSender[];
  /** The stream the tracks of this connection were added with: a track added later (renegotiation) must belong to the same stream, or the viewer would swap its picture for the new one. */
  sendStream: MediaStream | null;
  remoteStream: MediaStream | null;
  lastLost: number;
  lastReceived: number;
  lastSendLog: number;
  lastBytesSent: number;
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export class PeerManager {
  private conns = new Map<string, Conn>();
  private watchers = new Set<string>();
  private local: MediaStream | null = null;
  private localInfo: ShareInfo | null = null;
  private statsTimer: number | null = null;
  private codec: AppConfig['codec'] = 'auto';
  /** Everybody whose screen or camera this PC is watching right now (several at once). */
  watching = new Set<string>();

  constructor(
    private sig: SignalingClient,
    private selfId: string,
    private events: PeerManagerEvents,
  ) {
    this.statsTimer = window.setInterval(() => void this.pollStats(), 2000);
  }

  setCodec(codec: AppConfig['codec']): void {
    this.codec = codec;
  }

  get sharing(): boolean {
    return this.local !== null;
  }

  get watcherCount(): number {
    return this.watchers.size;
  }

  // ------------------------------------------------------------------ viewer side

  watch(peerId: string): void {
    if (this.watching.has(peerId)) return;
    this.watching.add(peerId);
    this.sig.send('watch', peerId);
  }

  /** Stops watching one person, or everybody when no id is given. */
  unwatch(peerId?: string): void {
    for (const id of peerId ? [peerId] : [...this.watching]) {
      if (!this.watching.delete(id)) continue;
      this.sig.send('unwatch', id);
      this.events.onStream(id, null);
    }
  }

  // ------------------------------------------------------------------ sharer side

  startShare(stream: MediaStream, info: ShareInfo): void {
    this.local = stream;
    this.localInfo = info;
    this.sig.send('share-started', null, info);
  }

  /** Applies new quality settings without interrupting the transmission. */
  async updateQuality(info: ShareInfo, constraints: MediaTrackConstraints): Promise<void> {
    if (!this.local) return;
    this.localInfo = info;
    const video = this.local.getVideoTracks()[0];
    if (video) {
      video.contentHint = info.mode === 'detail' ? 'detail' : 'motion';
      await video.applyConstraints(constraints).catch(() => undefined);
    }
    for (const conn of this.conns.values()) for (const s of conn.senders) await this.applyParams(s);
    this.sig.send('share-started', null, info);
  }

  /** Tells the room that what is shared changed (screen / camera) without touching the connections. */
  announce(info: ShareInfo): void {
    if (!this.local) return;
    this.localInfo = info;
    this.sig.send('share-started', null, info);
  }

  /** Puts the tracks of a new capture on the connections that are already sending, so viewers see the new picture without reconnecting. */
  replaceStream(stream: MediaStream): void {
    if (!this.local) return;
    this.local = stream;
    // a sender whose track was taken away (a camera has no audio) still knows its kind through its transceiver
    const kindOf = (conn: { pc: RTCPeerConnection }, sender: RTCRtpSender) => sender.track?.kind ?? conn.pc.getTransceivers().find((t) => t.sender === sender)?.receiver.track.kind;
    for (const conn of this.conns.values()) {
      if (!conn.senders.length) continue; // this peer is not watching
      for (const track of stream.getTracks()) {
        const sender = conn.senders.find((s) => kindOf(conn, s) === track.kind);
        if (sender) {
          void sender.replaceTrack(track).catch(() => undefined);
        } else {
          // the old capture had no track of this kind (a camera has no audio, a screen does): a new one is added, which renegotiates
          const added = conn.pc.addTrack(track, conn.sendStream ?? stream);
          conn.senders.push(added);
          if (track.kind === 'video') void this.applyParams(added);
        }
      }
      for (const sender of conn.senders) {
        const kind = kindOf(conn, sender);
        if (kind && !stream.getTracks().some((t) => t.kind === kind)) void sender.replaceTrack(null).catch(() => undefined); // the new capture has none: the old track must not linger
      }
    }
  }

  stopShare(): void {
    if (!this.local) return;
    for (const id of this.watchers) this.removeTracksFrom(id);
    this.local.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.localInfo = null;
    this.watchers.clear();
    this.events.onWatchersChanged(0);
    this.sig.send('share-stopped', null);
  }

  private addTracksTo(peerId: string): void {
    if (!this.local) return;
    const conn = this.ensure(peerId);
    if (conn.senders.length) return;
    conn.sendStream = this.local;
    for (const track of this.local.getTracks()) {
      const sender = conn.pc.addTrack(track, this.local);
      conn.senders.push(sender);
      if (track.kind === 'video') {
        const tr = conn.pc.getTransceivers().find((t) => t.sender === sender);
        this.preferCodec(tr);
        void this.applyParams(sender);
      }
    }
  }

  private removeTracksFrom(peerId: string): void {
    const conn = this.conns.get(peerId);
    if (!conn) return;
    for (const s of conn.senders) {
      try {
        conn.pc.removeTrack(s);
      } catch {
        /* connection already closed */
      }
    }
    conn.senders = [];
  }

  private preferCodec(tr: RTCRtpTransceiver | undefined): void {
    if (!tr || this.codec === 'auto' || !tr.setCodecPreferences) return;
    const mime = { vp9: 'video/VP9', h264: 'video/H264', av1: 'video/AV1' }[this.codec];
    const caps = RTCRtpSender.getCapabilities('video');
    if (!caps) return;
    const preferred = caps.codecs.filter((c) => c.mimeType.toLowerCase() === mime.toLowerCase());
    if (!preferred.length) return;
    const rest = caps.codecs.filter((c) => !preferred.includes(c));
    try {
      tr.setCodecPreferences([...preferred, ...rest]);
    } catch {
      /* unsupported combination, keep defaults */
    }
  }

  private async applyParams(sender: RTCRtpSender): Promise<void> {
    if (sender.track?.kind !== 'video' || !this.localInfo) return;
    const info = this.localInfo;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = BITRATE_MBPS[info.resolution][info.fps] * 1_000_000;
      params.encodings[0].maxFramerate = info.fps;
      params.encodings[0].scaleResolutionDownBy = 1;
      params.encodings[0].networkPriority = 'high';
      params.encodings[0].priority = 'high';
      (params as any).degradationPreference = info.mode === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
      await sender.setParameters(params);
    } catch {
      /* parameters may not be settable before negotiation; re-applied on connect */
    }
  }

  // ------------------------------------------------------------------ signaling

  async handleMessage(msg: Message): Promise<void> {
    const from = msg.from;
    if (!from) return;
    switch (msg.type) {
      case 'watch':
        if (this.local) {
          this.watchers.add(from);
          this.addTracksTo(from);
          this.events.onWatchersChanged(this.watchers.size);
        }
        break;
      case 'unwatch':
        if (this.watchers.delete(from)) {
          this.removeTracksFrom(from);
          this.events.onWatchersChanged(this.watchers.size);
        }
        break;
      case 'offer':
      case 'answer':
        await this.onDescription(from, msg.payload?.sdp as RTCSessionDescriptionInit);
        break;
      case 'ice':
        await this.onIce(from, msg.payload?.candidate as RTCIceCandidateInit | null);
        break;
    }
  }

  peerLeft(peerId: string): void {
    this.watchers.delete(peerId);
    this.events.onWatchersChanged(this.watchers.size);
    if (this.watching.delete(peerId)) this.events.onStream(peerId, null);
    this.conns.get(peerId)?.pc.close();
    this.conns.delete(peerId);
  }

  peerStoppedSharing(peerId: string): void {
    if (this.watching.delete(peerId)) this.events.onStream(peerId, null);
    const conn = this.conns.get(peerId);
    if (conn) conn.remoteStream = null;
  }

  // ------------------------------------------------------------------ connections

  private ensure(peerId: string): Conn {
    const existing = this.conns.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const conn: Conn = {
      pc,
      polite: this.selfId > peerId,
      makingOffer: false,
      ignoreOffer: false,
      senders: [],
      sendStream: null,
      remoteStream: null,
      lastLost: 0,
      lastReceived: 0,
      lastSendLog: 0,
      lastBytesSent: 0,
    };
    this.conns.set(peerId, conn);

    pc.onnegotiationneeded = async () => {
      try {
        conn.makingOffer = true;
        await pc.setLocalDescription();
        this.sig.send('offer', peerId, { sdp: pc.localDescription });
      } catch {
        /* a collision will be resolved by perfect negotiation */
      } finally {
        conn.makingOffer = false;
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sig.send('ice', peerId, { candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      let stream = e.streams[0] ?? new MediaStream([e.track]);
      // a track that arrives later (audio added when the sender switches from a camera to a screen) joins the stream already being watched
      // instead of replacing it; the old apps send it with the stream of the first tracks, so this only matters for other senders
      if (conn.remoteStream && conn.remoteStream.active && stream !== conn.remoteStream && !conn.remoteStream.getTracks().some((t) => t.kind === e.track.kind)) {
        conn.remoteStream.addTrack(e.track);
        stream = conn.remoteStream;
      }
      conn.remoteStream = stream;
      if (this.watching.has(peerId)) this.events.onStream(peerId, stream);
    };
    pc.oniceconnectionstatechange = () => void window.jaca.log('sala', `ICE com ${peerId.slice(0, 4)}: ${pc.iceConnectionState}`);
    pc.onconnectionstatechange = () => {
      void window.jaca.log('sala', `conexão WebRTC com ${peerId.slice(0, 4)}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        this.events.onConnectionFailed(peerId);
        pc.restartIce();
      }
      if (pc.connectionState === 'connected') for (const s of conn.senders) void this.applyParams(s);
    };
    return conn;
  }

  private async onDescription(from: string, description: RTCSessionDescriptionInit): Promise<void> {
    if (!description) return;
    const conn = this.ensure(from);
    const { pc } = conn;
    try {
      const collision = description.type === 'offer' && (conn.makingOffer || pc.signalingState !== 'stable');
      conn.ignoreOffer = !conn.polite && collision;
      if (conn.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        this.sig.send('answer', from, { sdp: pc.localDescription });
      }
    } catch {
      this.events.onConnectionFailed(from);
    }
  }

  private async onIce(from: string, candidate: RTCIceCandidateInit | null): Promise<void> {
    const conn = this.conns.get(from);
    if (!conn || !candidate) return;
    try {
      await conn.pc.addIceCandidate(candidate);
    } catch {
      if (!conn.ignoreOffer) this.events.onConnectionFailed(from);
    }
  }

  // ------------------------------------------------------------------ stats

  /**
   * Every 10 s while sending, one line in jaca.log with what the encoder is doing: which codec and encoder (software or the graphics card),
   * the real frame rate and bitrate, and why the quality is being held back (cpu / bandwidth). It is the first thing to read when a friend
   * says the picture stutters.
   */
  private logSending(peerId: string, conn: Conn, report: RTCStatsReport, s: any): void {
    const now = performance.now();
    const bytes: number = s.bytesSent ?? 0;
    if (conn.lastSendLog && now - conn.lastSendLog < 10_000) return;
    const kbps = conn.lastSendLog ? Math.round(((bytes - conn.lastBytesSent) * 8) / (now - conn.lastSendLog)) : 0;
    conn.lastSendLog = now;
    conn.lastBytesSent = bytes;
    const codec = (report.get(s.codecId) as any)?.mimeType ?? '?';
    const encode = s.framesEncoded ? Math.round((s.totalEncodeTime / s.framesEncoded) * 1000) : 0;
    void window.jaca.log(
      'sala',
      `envio para ${peerId.slice(0, 4)}: ${codec} · encoder ${s.encoderImplementation ?? '?'}${s.powerEfficientEncoder ? ' (hardware)' : ''} · ${s.frameWidth ?? '?'}x${s.frameHeight ?? '?'} ${Math.round(s.framesPerSecond ?? 0)} fps · ${kbps} kbps · ${encode} ms/quadro · limite: ${s.qualityLimitationReason ?? '?'}`,
    );
  }

  private async pollStats(): Promise<void> {
    for (const [id, conn] of this.conns) {
      if (conn.pc.connectionState !== 'connected') continue;
      try {
        const report = await conn.pc.getStats();
        let rtt: number | null = null;
        let lost = 0;
        let received = 0;
        report.forEach((s: any) => {
          if (s.type === 'outbound-rtp' && s.kind === 'video') this.logSending(id, conn, report, s);
          if (s.type === 'candidate-pair' && s.nominated && typeof s.currentRoundTripTime === 'number') rtt = s.currentRoundTripTime * 1000;
          if (s.type === 'inbound-rtp') {
            lost += s.packetsLost ?? 0;
            received += s.packetsReceived ?? 0;
          }
          if (s.type === 'remote-inbound-rtp') {
            lost += s.packetsLost ?? 0;
            received += s.packetsReceived ?? 0;
          }
        });
        const dl = lost - conn.lastLost;
        const dr = received - conn.lastReceived;
        conn.lastLost = lost;
        conn.lastReceived = received;
        const lossPct = dl + dr > 0 ? (Math.max(dl, 0) / (dl + dr)) * 100 : 0;
        let q: Quality = 'good';
        if (rtt === null) q = 'unknown';
        else if (rtt > 250 || lossPct > 5) q = 'bad';
        else if (rtt > 120 || lossPct > 1.5) q = 'ok';
        this.events.onQuality(id, q, rtt === null ? null : Math.round(rtt));
      } catch {
        /* peer connection closed during polling */
      }
    }
  }

  close(): void {
    if (this.statsTimer !== null) clearInterval(this.statsTimer);
    this.stopShare();
    for (const c of this.conns.values()) c.pc.close();
    this.conns.clear();
  }
}
