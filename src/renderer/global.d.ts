import type { AppConfig, AudioStartResult, CaptureSource, ConnectivityResult, RoomInfo, UpdateState } from '../shared/protocol';

declare global {
  interface Window {
    jaca: {
      getConfig(): Promise<AppConfig>;
      setConfig(patch: Partial<AppConfig>): Promise<AppConfig>;
      createRoom(roomName: string): Promise<RoomInfo>;
      closeRoom(): Promise<void>;
      testConnectivity(): Promise<ConnectivityResult>;
      listSources(kind?: 'screens' | 'windows'): Promise<CaptureSource[]>;
      startAudio(sourceId: string | null): Promise<AudioStartResult>;
      stopAudio(): Promise<void>;
      onAudioData(cb: (chunk: Uint8Array) => void): void;
      copyText(text: string): Promise<void>;
      minimizeWindow(): Promise<void>;
      toggleMaximizeWindow(): Promise<void>;
      closeWindow(): Promise<void>;
      isWindowMaximized(): Promise<boolean>;
      onWindowMaximized(cb: (maximized: boolean) => void): void;
      getVersion(): Promise<string>;
      getUpdateState(): Promise<UpdateState>;
      checkForUpdates(): Promise<UpdateState>;
      installUpdate(): Promise<void>;
      onUpdateState(cb: (state: UpdateState) => void): void;
      selectSource(id: string): Promise<void>;
    };
  }
}

export {};
