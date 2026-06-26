const MIN_DIRECT_VIDEO_BYTES = 1_000_000

export function isLocalHlsPlaylist(path: string): boolean {
  return path.toLowerCase().endsWith('.m3u8')
}

export function shouldUseLocalDownload(path: string, fileSize: number): boolean {
  return isLocalHlsPlaylist(path) || fileSize >= MIN_DIRECT_VIDEO_BYTES
}

export function getInitialPlaybackTime(
  resumeTime: number,
  options: { isLegacyTsDownload: boolean },
): number {
  return options.isLegacyTsDownload ? 0 : resumeTime
}

export function canSeekLocalDownload(options: { isLegacyTsDownload: boolean }): boolean {
  return !options.isLegacyTsDownload
}
