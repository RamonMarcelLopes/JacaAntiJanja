import type { AppConfig, AudioStartResult, CaptureSource, ConnectivityResult, NatTestResult, RoomInfo, UpdateState, VpnCandidate, WorkerSaveResult, WorkerStatus } from '../shared/protocol';

declare global {
  interface Window {
    jaca: {
      getConfig(): Promise<AppConfig>;
      setConfig(patch: Partial<AppConfig>): Promise<AppConfig>;
      createRoom(roomName: string): Promise<RoomInfo>;
      closeRoom(): Promise<void>;
      testConnectivity(): Promise<ConnectivityResult>;
      detectVpns(): Promise<VpnCandidate[]>;
      natTest(): Promise<NatTestResult>;
      workerStatus(): Promise<WorkerStatus>;
      saveWorker(subdomain: string, key: string): Promise<WorkerSaveResult>;
      testWorker(): Promise<WorkerSaveResult>;
      openWorkerDeploy(): Promise<void>;
      clearWorker(): Promise<void>;
      workerWsBase(subdomain: string): Promise<string | null>;
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
