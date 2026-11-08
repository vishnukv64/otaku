// DASH playback via shaka-player (hls.js cannot play MPD). The manifest and every
// segment request is rewritten to the local video-server /proxy, so no MPD
// rewriting is needed: shaka resolves relative segment URLs against the real
// upstream manifest URL, then the request filter swaps the host for the proxy.

interface VideoServerLike {
  proxy_base_url: string
  token: string
}

export const isDashUrl = (url: string) => /\.mpd(\?|$)/i.test(url)

export interface DashHandle {
  destroy: () => Promise<void>
}

export function proxyUri(videoServer: VideoServerLike, url: string, referrer?: string): string {
  if (url.startsWith(videoServer.proxy_base_url)) return url
  const referrerParam = referrer ? `&referrer=${encodeURIComponent(referrer)}` : ''
  return `${videoServer.proxy_base_url}?token=${videoServer.token}&url=${encodeURIComponent(url)}${referrerParam}`
}

export async function attachDash(
  video: HTMLVideoElement,
  url: string,
  opts: { videoServer: VideoServerLike; referrer?: string; startTime?: number }
): Promise<DashHandle> {
  const shaka = (await import('shaka-player')).default
  shaka.polyfill.installAll()
  const player = new shaka.Player()
  const handle: DashHandle = { destroy: () => player.destroy() }
  await player.attach(video)
  player.getNetworkingEngine()?.registerRequestFilter((_type, request) => {
    request.uris = request.uris.map((u) => proxyUri(opts.videoServer, u, opts.referrer))
  })
  try {
    await player.load(url, opts.startTime && opts.startTime > 0 ? opts.startTime : null)
  } catch (err) {
    await player.destroy()
    throw err
  }
  return handle
}
