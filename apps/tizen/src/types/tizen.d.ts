// Samsung Tizen Web API type stubs
// For full types, install @types/tizen-web-device (unofficial) or reference Samsung docs.

declare const tizen: {
  systeminfo: {
    getPropertyValue(
      prop: 'CPU' | 'STORAGE' | 'DISPLAY' | 'NETWORK',
      ok: (info: unknown) => void,
      err: (e: unknown) => void,
    ): void;
  };
  filesystem: {
    resolve(
      path: string,
      ok: (dir: FileSystemDirectory) => void,
      err: (e: unknown) => void,
      mode?: 'r' | 'rw',
    ): void;
  };
  download: {
    start(request: TizenDownloadRequest, listener?: TizenDownloadListener): number;
    pause(id: number): void;
    resume(id: number): void;
    cancel(id: number): void;
  };
};

interface FileSystemDirectory {
  resolve(name: string): FileSystemFile | FileSystemDirectory;
  createFile(name: string): FileSystemFile;
  createDirectory(name: string): FileSystemDirectory;
  deleteFile(file: FileSystemFile, ok: () => void, err: (e: unknown) => void): void;
  deleteDirectory(path: string, recursive: boolean, ok: () => void, err: (e: unknown) => void): void;
  listFiles(ok: (files: FileSystemFile[]) => void, err: (e: unknown) => void): void;
  toURI(): string;
}

interface FileSystemFile {
  fullPath: string;
  name: string;
  fileSize: number;
  toURI(): string;
  openStream(mode: 'r' | 'w' | 'rw', ok: (stream: FileStream) => void, err: (e: unknown) => void, encoding?: string): void;
}

interface FileStream {
  readAll(): string;
  readBytes(byteCount: number): number[];
  write(data: string): void;
  writeBytes(bytes: number[]): void;
  close(): void;
  eof: boolean;
}

interface TizenDownloadRequest {
  new(url: string, destination: string, fileName: string): TizenDownloadRequest;
  url: string;
  destination: string;
  fileName: string;
}

interface TizenDownloadListener {
  onprogress?(id: number, receivedSize: number, totalSize: number): void;
  onpaused?(id: number): void;
  oncanceled?(id: number): void;
  oncompleted?(id: number, fullPath: string): void;
  onfailed?(id: number, error: unknown): void;
}

declare const webapis: {
  productinfo: {
    getDuid(): string;
    getModel(): string;
    getModelCode(): string;
    getFirmware(): string;
  };
  widgetdata: {
    read(key: string): string;
    write(key: string, value: string): void;
    remove(key: string): void;
  };
  avplaystore: {
    getPlayer(): AVPlayObject;
  };
  document: {
    open(opts: { docpath: string; rect: { left: number; top: number; right: number; bottom: number } }): void;
    play(slideTimeMs: number): void;
    stop(): void;
    close(): void;
    gotoPage(page: number): void;
  };
  systemcontrol: {
    rebootDevice(): void;
    getSerialNumber(): string;
    captureScreen(fileName: string): void;
    setIRLock(lock: boolean): void;
    setButtonLock(lock: boolean): void;
    setAutoPowerOn(on: boolean): void;
    setMessageDisplay(show: boolean): void;
    setSafetyLock(lock: boolean): void;
    getOnScreenMenuOrientation(): string;
    updateFirmware(): void;
    getTemperature(): number;
  };
  timer: {
    setNTP(server: string, timezone: string): void;
    getNTP(): { server: string; timezone: string };
    setOnTimer(slot: number, time: string): void;
    setOffTimer(slot: number, time: string): void;
    clearOnTimer(slot: number): void;
    clearOffTimer(slot: number): void;
  };
  network: {
    getMac(): string;
    getGateway(): string;
    getDns(): string;
    getActiveConnectionType(): 'WIFI' | 'ETHERNET' | 'NONE';
    getWiFiSsid(): string;
    getWiFiSignalStrengthLevel(): number;
    getIp(): string;
  };
  syncplay: {
    createPlaylist(groupId: number, playlist: string[]): void;
    start(opts: { groupID: number; rect: { left: number; top: number; right: number; bottom: number } }): void;
    stop(): void;
    removePlaylist(groupId: number): void;
  };
};

interface AVPlayObject {
  open(url: string): void;
  setDisplayRect(x: number, y: number, w: number, h: number): void;
  prepare(): void;
  play(): void;
  stop(): void;
  close(): void;
  setListener(listener: {
    onbufferingstart?(): void;
    onbufferingprogress?(percent: number): void;
    onbufferingcomplete?(): void;
    oncurrentplaytime?(ms: number): void;
    onstreamcompleted?(): void;
    onerror?(errMsg: string): void;
  }): void;
  setVideoStillMode(mode: boolean): void;
  getDuration(): number;
  getCurrentTime(): number;
}
