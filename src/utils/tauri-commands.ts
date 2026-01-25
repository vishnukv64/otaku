/**
 * Type-safe wrappers for Tauri IPC commands
 *
 * This file contains all frontend-to-backend communication functions.
 * Each function corresponds to a Tauri command defined in the Rust backend.
 */

import { invoke } from '@tauri-apps/api/core'
import type {
  ExtensionMetadata,
  SearchResults,
  MediaDetails,
  VideoSources,
} from '@/types/extension'

/**
 * Load an extension from JavaScript code
 * @param code - Extension JavaScript code
 * @returns Extension metadata
 */
export async function loadExtension(code: string): Promise<ExtensionMetadata> {
  return await invoke('load_extension', { code })
}

/**
 * Search for anime using a specific extension
 * @param extensionId - Extension ID
 * @param query - Search query
 * @param page - Page number (1-indexed)
 * @returns Search results with pagination info
 */
export async function searchAnime(
  extensionId: string,
  query: string,
  page: number
): Promise<SearchResults> {
  return await invoke('search_anime', { extensionId, query, page })
}

/**
 * Get recommended anime (trending/latest)
 * @param extensionId - Extension ID
 * @returns Recommended anime list
 */
export async function getRecommendations(
  extensionId: string
): Promise<SearchResults> {
  return await invoke('get_recommendations', { extensionId })
}

/**
 * Get detailed information about an anime
 * @param extensionId - Extension ID
 * @param animeId - Anime ID from search results
 * @returns Detailed anime information with episodes
 */
export async function getAnimeDetails(
  extensionId: string,
  animeId: string
): Promise<MediaDetails> {
  return await invoke('get_anime_details', { extensionId, animeId })
}

/**
 * Get video sources for an episode
 * @param extensionId - Extension ID
 * @param episodeId - Episode ID
 * @returns Video sources with quality options and subtitles
 */
export async function getVideoSources(
  extensionId: string,
  episodeId: string
): Promise<VideoSources> {
  return await invoke('get_video_sources', { extensionId, episodeId })
}

/**
 * Discover anime with filters (trending, top-rated, by genre)
 * @param extensionId - Extension ID
 * @param page - Page number (1-indexed)
 * @param sortType - Sort type: "score" (top rated), "update" (recently updated), "view" (trending)
 * @param genres - Array of genres to filter by
 * @returns Search results with pagination info
 */
export async function discoverAnime(
  extensionId: string,
  page: number = 1,
  sortType?: string,
  genres: string[] = []
): Promise<SearchResults> {
  return await invoke('discover_anime', { extensionId, page, sortType, genres })
}

/**
 * Get detailed media information (alias for getAnimeDetails)
 * @param extensionId - Extension ID
 * @param mediaId - Media ID from search results
 * @returns Detailed media information with episodes
 */
export async function getMediaDetails(
  extensionId: string,
  mediaId: string
): Promise<MediaDetails> {
  return await getAnimeDetails(extensionId, mediaId)
}

/**
 * List all loaded extensions
 * @returns Array of extension metadata
 */
export async function listExtensions(): Promise<ExtensionMetadata[]> {
  return await invoke('list_extensions')
}

/**
 * Proxy a video request to avoid CORS issues
 * @param url - URL to proxy
 * @param range - Optional HTTP Range header value (for seeking)
 * @returns Response body as Uint8Array
 */
export async function proxyVideoRequest(
  url: string,
  range?: string
): Promise<Uint8Array> {
  return await invoke('proxy_video_request', { url, range })
}

/**
 * Proxy HLS playlist and rewrite URLs
 * @param url - URL of the m3u8 playlist
 * @returns Rewritten playlist content
 */
export async function proxyHlsPlaylist(url: string): Promise<string> {
  return await invoke('proxy_hls_playlist', { url })
}

/**
 * Start downloading a video
 * @param url - Video URL to download
 * @param filename - Filename for the downloaded video
 * @param animeTitle - Title of the anime
 * @param episodeNumber - Episode number
 * @returns Download ID for tracking progress
 */
export async function startDownload(
  url: string,
  filename: string,
  animeTitle: string,
  episodeNumber: number
): Promise<string> {
  return await invoke('start_download', { url, filename, animeTitle, episodeNumber })
}

/**
 * Get download progress for a specific download
 * @param downloadId - Download ID returned from startDownload
 * @returns Download progress information
 */
export async function getDownloadProgress(downloadId: string): Promise<DownloadProgress> {
  return await invoke('get_download_progress', { downloadId })
}

/**
 * List all downloads
 * @returns Array of all download progress information
 */
export async function listDownloads(): Promise<DownloadProgress[]> {
  return await invoke('list_downloads')
}

/**
 * Cancel an ongoing download
 * @param downloadId - Download ID to cancel
 */
export async function cancelDownload(downloadId: string): Promise<void> {
  return await invoke('cancel_download', { downloadId })
}

// Download types
export interface DownloadProgress {
  id: string
  filename: string
  total_bytes: number
  downloaded_bytes: number
  percentage: number
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled'
}

