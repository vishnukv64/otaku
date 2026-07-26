import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoPlayer } from './VideoPlayer'

const hlsState = vi.hoisted(() => ({
  instances: [] as Array<{
    handlers: Map<string, (event: string, data: Record<string, unknown>) => void>
    recoverMediaError: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }>,
}))

const mpegtsState = vi.hoisted(() => ({
  supported: true,
  sources: [] as Array<Record<string, unknown>>,
  instances: [] as Array<{
    attachMediaElement: ReturnType<typeof vi.fn>
    load: ReturnType<typeof vi.fn>
    play: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('hls.js', () => {
  class MockHls {
    static Events = {
      MANIFEST_PARSED: 'manifestParsed',
      ERROR: 'error',
    }

    static ErrorTypes = {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
    }

    handlers = new Map<string, (event: string, data: Record<string, unknown>) => void>()
    recoverMediaError = vi.fn()
    startLoad = vi.fn()
    destroy = vi.fn()
    loadSource = vi.fn()
    attachMedia = vi.fn()

    constructor() {
      hlsState.instances.push(this)
    }

    static isSupported() {
      return true
    }

    on(event: string, handler: (event: string, data: Record<string, unknown>) => void) {
      this.handlers.set(event, handler)
    }
  }

  return { default: MockHls }
})

vi.mock('mpegts.js', () => ({
  default: {
    Events: { ERROR: 'error' },
    isSupported: () => mpegtsState.supported,
    createPlayer: (source: Record<string, unknown>) => {
      const player = {
        attachMediaElement: vi.fn(),
        load: vi.fn(),
        play: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn(),
        on: vi.fn(),
      }
      mpegtsState.sources.push(source)
      mpegtsState.instances.push(player)
      return player
    },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/store/playerStore', () => ({
  usePlayerStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      settings: {
        volume: 1,
        muted: false,
        videoFitMode: 'contain',
        preferredQuality: 'Auto',
        playbackSpeed: 1,
        autoPlayNext: false,
        subtitleFontScale: 100,
        subtitleFontFamily: 'system',
      },
      updateSettings: vi.fn(),
    }),
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      markWatchedThreshold: 85,
      defaultVolume: 1,
      autoDeleteWatched: false,
    }),
}))

vi.mock('@/store/pipStore', () => ({
  usePipStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      enterPip: vi.fn(),
      closePip: vi.fn(),
      isActive: false,
    }),
}))

vi.mock('@/utils/tauri-commands', () => ({
  getVideoServerInfo: vi.fn().mockResolvedValue({
    port: 19_876,
    token: 'test-token',
    proxy_base_url: 'http://127.0.0.1:19876/proxy',
  }),
  saveWatchProgress: vi.fn(),
  deleteEpisodeDownload: vi.fn(),
}))

vi.mock('./DownloadButton', () => ({
  DownloadButton: () => null,
}))

vi.mock('@/utils/notify', () => ({
  notifySuccess: vi.fn(),
}))

vi.mock('@/utils/platform', () => ({
  isMobile: () => false,
  isAndroid: () => false,
  isIOS: () => false,
}))

describe('VideoPlayer HLS error handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    hlsState.instances.length = 0
    mpegtsState.supported = true
    mpegtsState.sources.length = 0
    mpegtsState.instances.length = 0
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('WEBVTT'),
    }))
  })

  it('defaults to sub audio with English subtitles enabled', async () => {
    render(
      <VideoPlayer
        sources={[{
          url: 'https://media.example.test/sub/master.m3u8',
          quality: 'Auto',
          type: 'hls',
          server: 'Primary',
          audio_type: 'sub',
          subtitles: [{
            url: 'https://subs.example.test/es.vtt',
            label: 'Spanish',
            language: 'es',
          }, {
            url: 'https://subs.example.test/en.vtt',
            label: 'English',
            language: 'en',
          }],
        }, {
          url: 'https://media.example.test/dub/master.m3u8',
          quality: 'Auto',
          type: 'hls',
          server: 'Primary',
          audio_type: 'dub',
        }]}
      />
    )

    expect(await screen.findByText('SUB')).toBeInTheDocument()
    expect(await screen.findByText('English')).toBeInTheDocument()
  })

  it('resets a manual dub choice to sub for the next episode', async () => {
    const sources = [{
      url: 'https://media.example.test/sub/master.m3u8',
      quality: 'Auto',
      type: 'hls',
      server: 'Primary',
      audio_type: 'sub',
    }, {
      url: 'https://media.example.test/dub/master.m3u8',
      quality: 'Auto',
      type: 'hls',
      server: 'Primary',
      audio_type: 'dub',
    }]
    const view = render(<VideoPlayer sources={sources} episodeId="episode-1" />)

    fireEvent.click(await screen.findByText('SUB'))
    fireEvent.click(screen.getByText('DUB'))
    expect(await screen.findByText('DUB')).toBeInTheDocument()

    view.rerender(<VideoPlayer sources={sources} episodeId="episode-2" />)
    expect(await screen.findByText('SUB')).toBeInTheDocument()
  })

  it('keeps subtitles off when no English track is available', async () => {
    render(
      <VideoPlayer
        sources={[{
          url: 'https://media.example.test/sub/master.m3u8',
          quality: 'Auto',
          type: 'hls',
          server: 'Primary',
          audio_type: 'sub',
          subtitles: [{
            url: 'https://subs.example.test/es.vtt',
            label: 'Spanish',
            language: 'es',
          }],
        }]}
      />
    )

    expect(await screen.findByText('CC Off')).toBeInTheDocument()
  })

  it('plays and cleans up legacy MPEG-TS downloads through the MSE demuxer', async () => {
    const firstSource = 'http://127.0.0.1:19876/absolute?path=episode-1.otaku&token=test-token'
    const view = render(
      <VideoPlayer
        sources={[{
          url: firstSource,
          quality: 'Downloaded',
          type: 'video/mp4',
          server: 'Local',
        }]}
        disableSeeking
        isLegacyTsDownload
      />
    )

    await waitFor(() => expect(mpegtsState.instances).toHaveLength(1))
    const firstPlayer = mpegtsState.instances[0]!
    const video = document.querySelector('video')!

    expect(hlsState.instances).toHaveLength(0)
    expect(mpegtsState.sources).toEqual([{
      type: 'mpegts',
      isLive: false,
      url: firstSource,
    }])
    expect(firstPlayer.attachMediaElement).toHaveBeenCalledWith(video)
    expect(firstPlayer.load).toHaveBeenCalledOnce()
    expect(firstPlayer.play).toHaveBeenCalledOnce()

    view.rerender(
      <VideoPlayer
        sources={[{
          url: 'http://127.0.0.1:19876/absolute?path=episode-2.otaku&token=test-token',
          quality: 'Downloaded',
          type: 'video/mp4',
          server: 'Local',
        }]}
        disableSeeking
        isLegacyTsDownload
      />
    )

    await waitFor(() => expect(mpegtsState.instances).toHaveLength(2))
    expect(firstPlayer.destroy).toHaveBeenCalledOnce()

    const secondPlayer = mpegtsState.instances[1]!
    view.unmount()
    expect(secondPlayer.destroy).toHaveBeenCalledOnce()
  })

  it('reports unsupported legacy MPEG-TS playback instead of using raw video', async () => {
    mpegtsState.supported = false

    render(
      <VideoPlayer
        sources={[{
          url: 'http://127.0.0.1:19876/absolute?path=episode.otaku&token=test-token',
          quality: 'Downloaded',
          type: 'video/mp4',
          server: 'Local',
        }]}
        disableSeeking
        isLegacyTsDownload
      />
    )

    expect(
      await screen.findByText('Downloaded MPEG-TS playback is not supported on this device')
    ).toBeInTheDocument()
    expect(mpegtsState.instances).toHaveLength(0)
    expect(hlsState.instances).toHaveLength(0)
  })

  it('leaves non-fatal media errors to hls.js recovery', async () => {
    render(
      <VideoPlayer
        sources={[{
          url: 'https://media.example.test/master.m3u8',
          quality: 'Auto',
          type: 'hls',
          server: 'Primary',
          audio_type: 'sub',
        }]}
        autoPlay={false}
      />
    )

    await waitFor(() => expect(hlsState.instances).toHaveLength(1))
    const hls = hlsState.instances[0]!
    const onError = hls.handlers.get('error')!

    act(() => {
      onError('error', {
        type: 'mediaError',
        details: 'bufferAddCodecError',
        fatal: false,
      })
      onError('error', {
        type: 'mediaError',
        details: 'bufferAddCodecError',
        fatal: false,
      })
    })

    expect(hls.recoverMediaError).not.toHaveBeenCalled()
    expect(screen.queryByText('Playback Error')).not.toBeInTheDocument()
  })

  it('falls back to native HLS when MSE rejects the stream codec', async () => {
    render(
      <VideoPlayer
        sources={[{
          url: 'https://media.example.test/master.m3u8',
          quality: 'Auto',
          type: 'hls',
          server: 'Primary',
          referrer: 'https://player.example.test/',
          audio_type: 'sub',
        }]}
        initialTime={264}
      />
    )

    await waitFor(() => expect(hlsState.instances).toHaveLength(1))
    const hls = hlsState.instances[0]!
    const onError = hls.handlers.get('error')!
    const video = document.querySelector('video')!

    act(() => {
      onError('error', {
        type: 'mediaError',
        details: 'bufferAddCodecError',
        fatal: true,
      })
    })

    expect(hls.destroy).toHaveBeenCalledOnce()
    expect(hls.recoverMediaError).not.toHaveBeenCalled()
    expect(video.src).toContain('http://127.0.0.1:19876/hls?')
    expect(video.src).toContain(encodeURIComponent('https://media.example.test/master.m3u8'))
    expect(video.src).toContain(`referrer=${encodeURIComponent('https://player.example.test/')}`)
    expect(screen.queryByText('Playback Error')).not.toBeInTheDocument()

    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(video.currentTime).toBe(264)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
  })

  it('removes a pending native HLS fallback listener when the source changes', async () => {
    const view = render(
      <VideoPlayer
        sources={[{
          url: 'https://media.example.test/episode-1.m3u8',
          quality: 'Auto',
          type: 'hls',
          server: 'Primary',
          audio_type: 'sub',
        }]}
        initialTime={264}
      />
    )

    await waitFor(() => expect(hlsState.instances).toHaveLength(1))
    const onError = hlsState.instances[0]!.handlers.get('error')!
    const video = document.querySelector('video')!
    act(() => {
      onError('error', {
        type: 'mediaError',
        details: 'bufferAddCodecError',
        fatal: true,
      })
    })

    view.rerender(
      <VideoPlayer
        sources={[{
          url: 'https://media.example.test/episode-2.m3u8',
          quality: 'Auto',
          type: 'hls',
          server: 'Primary',
          audio_type: 'sub',
        }]}
        initialTime={0}
        autoPlay={false}
      />
    )
    await waitFor(() => expect(hlsState.instances).toHaveLength(2))

    video.currentTime = 0
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(video.currentTime).toBe(0)
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })
})
