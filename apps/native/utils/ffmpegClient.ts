export type FfmpegLoadProgress = {
  receivedBytes: number;
  totalBytes?: number;
};

export type GetFFmpegOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: FfmpegLoadProgress) => void;
};

export type FFmpegClient = {
  on(event: "progress", handler: (data: { progress: number }) => void): void;
  off(event: "progress", handler: (data: { progress: number }) => void): void;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  readFile(name: string): Promise<Uint8Array>;
  deleteFile(name: string): Promise<void>;
  exec(args: string[]): Promise<void>;
};

export function isFFmpegSupported(): boolean {
  return false;
}

export async function estimateFfmpegDownloadSize(): Promise<
  number | undefined
> {
  return undefined;
}

export async function getFFmpeg(
  _options?: GetFFmpegOptions
): Promise<FFmpegClient> {
  throw new Error("FFmpeg client is not available");
}
