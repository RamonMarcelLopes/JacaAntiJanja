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
  /** Peer in focus, the one the player shows large (own id = local preview). Always one of `watched`, or null. */
  viewing: string | null = null;
  /** Everybody being watched at the same time (screens and cameras), the focused one included; own id = local preview. */
  watched = new Set<string>();
  /** Incoming pictures by person, filled when their connection delivers it. */
  private streams = new Map<string, MediaStream>();
  shareInfo: ShareInfo | null = null;
  audioNote = '';
  roomName = '';
  inviteCode = '';
  private roomAgeMs: number | null = null;
  private joinedAt = 0;
  /** True when the shared audio cannot contain this app's own playback (single-window capture). */
  audioIsolated = false;
  /** True while the connection to the room is down and the app is trying to get back in. */
  reconnecting = false;
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
          s.streams.set(id, stream);
          if (!s.viewing) s.viewing = id;
        } else {
          s.streams.delete(id);
          s.watched.delete(id);
          if (s.viewing === id) s.viewing = s.watched.values().next().value ?? null; // another one being watched takes the focus
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
      onWatchersChanged: (count) => {
        // everybody sees how many people watch you, so the count travels with the share announcement
        if (s.shareInfo && s.shareInfo.viewers !== count) {
          s.shareInfo = { ...s.shareInfo, viewers: count };
          s.me().share = s.shareInfo;
          s.pm.announce(s.shareInfo);
        }
        s.onChange();
      },
    });
    s.pm.setCodec(cfg.codec);
    sig.onMessage = (m) => void s.handle(m);
    sig.onClose = (reason) => s.finish(reason);
    sig.onReconnecting = (active) => {
      s.reconnecting = active;
      if (active) s.onNotice('Conexão com a sala caiu. Reconectando…', 'error');
      s.onChange();
    };
    sig.onResumed = (w) => s.reconcile(w.peers);
    return s;
  }

  /**
   * After the connection to the room came back: messages sent during the gap were lost, so the participant list is
   * brought in line with what the room says now.
   */
  private reconcile(current: PeerInfo[]): void {
    const ids = new Set(current.map((p) => p.peerId));
    for (const id of [...this.peers.keys()]) {
      if (id === this.selfId || ids.has(id)) continue;
      this.peers.delete(id);
      this.pm.peerLeft(id);
    }
    for (const p of current) {
      const known = this.peers.get(p.peerId);
      if (known) Object.assign(known, { name: p.name, avatar: p.avatar, share: p.share });
      else this.peers.set(p.peerId, { ...p, quality: 'unknown', rtt: null });
    }
    for (const id of [...this.watched]) if (id !== this.selfId && !this.peers.get(id)?.share) this.removeView(id);
    this.onNotice('Reconectado à sala.', 'info');
    this.onChange();
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
    // entering and leaving always sound: a short blip in the stream is a fair price for knowing who comes and goes while you share
    if (this.muteIncoming && name !== 'peer-join' && name !== 'peer-leave') return;
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

  /** The picture to show for somebody being watched (your own preview is the local capture); null while it has not arrived. */
  streamOf(peerId: string): MediaStream | null {
    return peerId === this.selfId ? this.local : (this.streams.get(peerId) ?? null);
  }

  /** The picture in focus. */
  get stream(): MediaStream | null {
    return this.viewing ? this.streamOf(this.viewing) : null;
  }

  /** Click on a participant card: watch only their stream (or preview only your own), leaving everything else. */
  view(peerId: string): void {
    if (!this.canWatch(peerId)) return;
    for (const id of [...this.watched]) if (id !== peerId) this.removeView(id);
    this.addView(peerId);
    this.viewing = peerId;
    this.onChange();
  }

  /** Watch one more screen or camera without leaving the ones already open. The first one watched takes the focus. */
  addView(peerId: string): void {
    if (!this.canWatch(peerId) || this.watched.has(peerId)) return;
    this.watched.add(peerId);
    if (peerId !== this.selfId) this.pm.watch(peerId);
    if (!this.viewing) this.viewing = peerId;
    this.onChange();
  }

  /** Puts somebody who is already being watched in focus. */
  focus(peerId: string): void {
    if (!this.watched.has(peerId)) return;
    this.viewing = peerId;
    this.onChange();
  }

  /** Stops watching one person; when it was the focused one, another one being watched takes the focus. */
  removeView(peerId: string): void {
    if (!this.watched.delete(peerId)) return;
    if (peerId === this.selfId) {
      if (this.viewing === peerId) this.viewing = this.watched.values().next().value ?? null;
    } else {
      this.pm.unwatch(peerId); // answers with onStream(null), which picks the next focus
    }
    this.onChange();
  }

  /** Stops watching everybody. */
  stopViewing(): void {
    for (const id of [...this.watched]) this.removeView(id);
    this.viewing = null;
    this.onChange();
  }

  private canWatch(peerId: string): boolean {
    return peerId === this.selfId ? this.sharing : !!this.peers.get(peerId)?.share;
  }

  private local: MediaStream | null = null;

  /** Id of the screen or window being shared (null when not sharing). */
  sharedSourceId: string | null = null;

  async startSharing(sourceId: string, requested: ShareInfo): Promise<void> {
    const info: ShareInfo = { ...requested, source: sourceId.startsWith('camera:') ? 'camera' : 'screen', viewers: 0 };
    const stream = await this.capture(sourceId, info, () => playSound('self-share-start'));
    this.local = stream;
    this.sharedSourceId = sourceId;
    this.shareInfo = info;
    this.me().share = info;
    this.pm.startShare(stream, info);
    if (!this.viewing) this.view(this.selfId); // nobody being watched: your own screen opens by itself
    this.onChange();
  }

  /**
   * Swaps the screen or window being shared for another one without stopping the transmission: viewers keep their connection and
   * just see the new picture. When the new capture cannot start, the current one keeps running.
   */
  async switchSource(sourceId: string): Promise<void> {
    const info = this.shareInfo;
    if (!this.sharing || !info || sourceId === this.sharedSourceId) return;
    const old = this.local;
    const stream = await this.capture(sourceId, info, async () => {
      // the old capture is released only now that the new one was granted
      old?.getVideoTracks().forEach((t) => (t.onended = null));
      this.native?.stop();
      this.native = null;
      await window.jaca.stopAudio();
    });
    this.pm.replaceStream(stream);
    old?.getTracks().forEach((t) => t.stop());
    this.local = stream;
    this.sharedSourceId = sourceId;
    const source = sourceId.startsWith('camera:') ? 'camera' : 'screen';
    if (info.source !== source) {
      // everybody's list of participants shows the icon of what is being shared, so the change is announced
      const next: ShareInfo = { ...info, source };
      this.shareInfo = next;
      this.me().share = next;
      this.pm.announce(next);
    }
    this.onChange(); // the own preview follows the new picture (streamOf reads the local capture)
  }

  /** Asks for the capture of a screen or window and builds the stream (video + the audio without Discord when available). */
  private async capture(sourceId: string, info: ShareInfo, afterGrant: () => void | Promise<void>): Promise<MediaStream> {
    if (sourceId.startsWith('camera:')) return this.captureCamera(sourceId.slice('camera:'.length), info, afterGrant);
    await window.jaca.selectSource(sourceId);
    // getDisplayMedia needs a recent user gesture, so it is called before anything slow.
    // It asks for the full system audio (loopback) as the fallback track.
    const { width, height } = RESOLUTIONS[info.resolution];
    const stream = await navigator.mediaDevices.getDisplayMedia({
      // cursor 'motion': the pointer shows only while it moves, so it disappears when another app hides it (a full-screen video does so after a moment)
      video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: info.fps }, cursor: 'motion' } as MediaTrackConstraints,
      audio: true,
    });
    // Capture is granted. The helper that records the audio only starts after this, so the cue does not end up in the stream.
    await afterGrant();
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
    } else if (audio.message) {
      this.onNotice(`${audio.message} Pode haver eco do Discord; use fones.`, 'info');
    }
    const video = stream.getVideoTracks()[0];
    video.contentHint = info.mode === 'detail' ? 'detail' : 'motion';
    video.onended = () => this.stopSharing();
    return stream;
  }

  /** A camera instead of a screen: video only (a camera has no system sound). */
  private async captureCamera(deviceId: string, info: ShareInfo, afterGrant: () => void | Promise<void>): Promise<MediaStream> {
    const { width, height } = RESOLUTIONS[info.resolution];
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: info.fps } },
      audio: false,
    });
    await afterGrant();
    // no sound of this app can end up in a camera picture, so incoming audio does not need to be muted
    this.audioNote = '';
    this.audioIsolated = true;
    const video = stream.getVideoTracks()[0];
    video.contentHint = info.mode === 'detail' ? 'detail' : 'motion';
    video.onended = () => this.stopSharing(); // unplugged camera
    return stream;
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
    this.sharedSourceId = null;
    this.shareInfo = null;
    this.audioNote = '';
    this.audioIsolated = false;
    this.me().share = null;
    this.removeView(this.selfId);
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
