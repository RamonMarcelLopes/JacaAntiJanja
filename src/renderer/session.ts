import { AppConfig, Message, PeerInfo, RESOLUTIONS, ShareInfo } from '../shared/protocol';
import { startNativeAudio, NativeAudio } from './rtc/native-audio';
import { PeerManager, Quality } from './rtc/peer-manager';
import { SignalingClient } from './signaling-client';
import { playSound, SoundName } from './sounds';

export interface PeerView extends PeerInfo {
  quality: Quality;
  rtt: number | null;
}

export type EndReason = 'room-closed' | 'lost' | 'left';

/** One joined room: signaling connection, participants, and sharing state. */
export class Session {
  peers = new Map<string, PeerView>();
  /** Peer whose stream is shown in the player (own id = local preview). */
  viewing: string | null = null;
  stream: MediaStream | null = null;
  shareInfo: ShareInfo | null = null;
  audioNote = '';
  roomName = '';
  inviteCode = '';
  private roomAgeMs: number | null = null;
  private joinedAt = 0;
  /** True when the shared audio cannot contain this app's own playback (single-window capture). */
  audioIsolated = false;
  onChange: () => void = () => undefined;
  onEnded: (reason: EndReason) => void = () => undefined;
  onNotice: (text: string, kind: 'info' | 'error') => void = () => undefined;

  private pm!: PeerManager;
  private native: NativeAudio | null = null;
  private ended = false;

  private constructor(
    private sig: SignalingClient,
    readonly selfId: string,
    readonly isHost: boolean,
  ) {}

  static async join(url: string, token: number, cfg: AppConfig, isHost: boolean, joinCode = '', options: { roomName?: string } = {}): Promise<Session> {
    const sig = new SignalingClient();
    const welcome = await sig.connect(url, token, cfg.name, cfg.avatar, options);
    const s = new Session(sig, welcome.peerId, isHost);
    s.roomName = welcome.roomName ?? '';
    // older hosts do not send the code: fall back to the one this person typed to get in
    s.inviteCode = welcome.inviteCode || joinCode;
    s.roomAgeMs = typeof welcome.roomAgeMs === 'number' ? welcome.roomAgeMs : null;
    s.joinedAt = performance.now(); // monotonic: immune to clock changes and to clock differences between PCs
    s.peers.set(welcome.peerId, { peerId: welcome.peerId, name: cfg.name, avatar: cfg.avatar, share: null, quality: 'unknown', rtt: null });
    for (const p of welcome.peers) s.peers.set(p.peerId, { ...p, quality: 'unknown', rtt: null });
    s.pm = new PeerManager(sig, welcome.peerId, {
      onStream: (id, stream) => {
        if (stream) {
          s.viewing = id;
          s.stream = stream;
        } else if (s.viewing === id) {
          s.viewing = null;
          s.stream = null;
        }
        s.onChange();
      },
      onQuality: (id, quality, rtt) => {
        const p = s.peers.get(id);
        if (p) {
          p.quality = quality;
          p.rtt = rtt;
          s.onChange();
        }
      },
      onConnectionFailed: (id) => s.onNotice(`Não foi possível conectar com ${s.peers.get(id)?.name ?? 'o participante'}.`, 'error'),
      onWatchersChanged: () => s.onChange(),
    });
    s.pm.setCodec(cfg.codec);
    sig.onMessage = (m) => void s.handle(m);
    sig.onClose = (reason) => s.finish(reason);
    return s;
  }

  /** Time the room has been open, or null when the host did not report it. */
  roomElapsedMs(): number | null {
    return this.roomAgeMs === null ? null : this.roomAgeMs + (performance.now() - this.joinedAt);
  }

  get watcherCount(): number {
    return this.pm.watcherCount;
  }

  get sharing(): boolean {
    return this.pm.sharing;
  }

  /**
   * While sharing a whole screen the capture includes this app's own output, so incoming audio is
   * muted to avoid a feedback loop. Sharing a single window isolates the audio and lifts the mute.
   */
  get muteIncoming(): boolean {
    return this.sharing && !this.audioIsolated;
  }

  /**
   * Sound cue for something somebody else did. Muted while you share a whole screen: the capture includes this app's own output, so the
   * cue would travel to everybody in the stream (sharing a single window isolates the audio and lifts this).
   */
  private cue(name: SoundName): void {
    if (this.muteIncoming) return;
    playSound(name);
  }

  me(): PeerView {
    return this.peers.get(this.selfId)!;
  }

  private async handle(msg: Message): Promise<void> {
    switch (msg.type) {
      case 'peer-joined': {
        const p = msg.payload as PeerInfo;
        this.peers.set(p.peerId, { ...p, quality: 'unknown', rtt: null });
        this.onNotice(`${p.name} entrou na sala.`, 'info');
        this.cue('peer-join');
        break;
      }
      case 'peer-left': {
        const id = msg.payload?.peerId as string;
        const name = this.peers.get(id)?.name;
        this.peers.delete(id);
        this.pm.peerLeft(id);
        if (name) {
          this.onNotice(`${name} saiu da sala.`, 'info');
          this.cue('peer-leave');
        }
        break;
      }
      case 'peer-updated': {
        const u = msg.payload as { peerId: string; name: string; avatar: string | null };
        const p = this.peers.get(u.peerId);
        if (p) {
          p.name = u.name;
          p.avatar = u.avatar;
        }
        break;
      }
      case 'share-started': {
        const p = msg.from ? this.peers.get(msg.from) : undefined;
        if (p) {
          const started = !p.share; // the same message also announces quality changes, which must stay silent
          p.share = msg.payload as ShareInfo;
          if (started) this.cue('peer-share-start');
        }
        break;
      }
      case 'share-stopped': {
        const p = msg.from ? this.peers.get(msg.from) : undefined;
        if (p) {
          if (p.share) this.cue('peer-share-stop');
          p.share = null;
        }
        if (msg.from) this.pm.peerStoppedSharing(msg.from);
        break;
      }
      case 'room-closed':
        this.finish('room-closed');
        return;
      default:
        await this.pm.handleMessage(msg);
    }
    this.onChange();
  }

  /** Applies a new name/avatar locally and tells everyone in the room right away. */
  updateProfile(name: string, avatar: string | null): void {
    const me = this.me();
    me.name = name;
    me.avatar = avatar;
    this.sig.send('profile-update', null, { name, avatar });
    this.onChange();
  }

  /** Click on a participant card: watch their stream (or preview your own). */
  view(peerId: string): void {
    if (peerId === this.selfId) {
      if (!this.sharing) return;
      this.pm.unwatch();
      this.viewing = peerId;
      this.stream = this.local;
      this.onChange();
      return;
    }
    if (!this.peers.get(peerId)?.share) return;
    this.pm.watch(peerId);
    this.viewing = peerId;
    this.stream = null;
    this.onChange();
  }

  stopViewing(): void {
    this.pm.unwatch();
    this.viewing = null;
    this.stream = null;
    this.onChange();
  }

  private local: MediaStream | null = null;

  async startSharing(sourceId: string, info: ShareInfo): Promise<void> {
    await window.jaca.selectSource(sourceId);
    // getDisplayMedia needs a recent user gesture, so it is called before anything slow.
    // It asks for the full system audio (loopback) as the fallback track.
    const { width, height } = RESOLUTIONS[info.resolution];
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: info.fps } },
      audio: true,
    });
    // Capture is granted. The helper that records the audio only starts after this, so the cue does not end up in the stream.
    playSound('self-share-start');
    const audio = await window.jaca.startAudio(sourceId);
    // only problems are shown next to the controls; a working capture needs no announcement
    this.audioNote = audio.ok ? '' : audio.message;
    this.audioIsolated = audio.ok && audio.isolated;
    if (audio.ok) {
      // Replace the loopback track (which includes Discord) with the one that excludes it.
      try {
        this.native = await startNativeAudio();
        for (const t of stream.getAudioTracks()) {
          t.stop();
          stream.removeTrack(t);
        }
        stream.addTrack(this.native.track);
      } catch {
        this.audioNote = 'Falha ao iniciar a captura de áudio sem Discord.';
        this.audioIsolated = false;
        await window.jaca.stopAudio();
      }
    } else {
      this.onNotice(`${audio.message} Pode haver eco do Discord; use fones.`, 'info');
    }
    const video = stream.getVideoTracks()[0];
    video.contentHint = info.mode === 'detail' ? 'detail' : 'motion';
    video.onended = () => this.stopSharing();
    this.local = stream;
    this.shareInfo = info;
    this.me().share = info;
    this.pm.startShare(stream, info);
    this.onChange();
  }

  async updateQuality(info: ShareInfo): Promise<void> {
    const { width, height } = RESOLUTIONS[info.resolution];
    this.shareInfo = info;
    this.me().share = info;
    await this.pm.updateQuality(info, { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: info.fps } });
    this.onChange();
  }

  stopSharing(silent = false): void {
    if (!this.sharing) return;
    this.pm.stopShare();
    this.native?.stop();
    this.native = null;
    void window.jaca.stopAudio();
    this.local = null;
    this.shareInfo = null;
    this.audioNote = '';
    this.audioIsolated = false;
    this.me().share = null;
    if (this.viewing === this.selfId) {
      this.viewing = null;
      this.stream = null;
    }
    if (!silent) playSound('self-share-stop'); // not when leaving the room: the leave sound covers that
    this.onChange();
  }

  leave(): void {
    this.finish('left');
  }

  private finish(reason: EndReason): void {
    if (this.ended) return;
    this.ended = true;
    this.stopSharing(true);
    this.pm.close();
    this.sig.close();
    this.onEnded(reason);
  }
}
