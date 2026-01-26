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
 * @param mediaId - Media ID
 * @param episodeId - Episode ID
 * @param episodeNumber - Episode number
 * @param url - Video URL to download
 * @param filename - Filename for the downloaded video
 * @returns Download ID for tracking progress
 */
export async function startDownload(
  mediaId: string,
  episodeId: string,
  episodeNumber: number,
  url: string,
  filename: string
): Promise<string> {
  return await invoke('start_download', { mediaId, episodeId, episodeNumber, url, filename })
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

/**
 * Check if an episode is downloaded
 * @param mediaId - Media ID
 * @param episodeNumber - Episode number
 */
export async function isEpisodeDownloaded(mediaId: string, episodeNumber: number): Promise<boolean> {
  return await invoke('is_episode_downloaded', { mediaId, episodeNumber })
}

/**
 * Get the file path for a downloaded episode
 * @param mediaId - Media ID
 * @param episodeNumber - Episode number
 */
export async function getEpisodeFilePath(mediaId: string, episodeNumber: number): Promise<string | null> {
  return await invoke('get_episode_file_path', { mediaId, episodeNumber })
}

/**
 * Get total storage used by downloads in bytes
 */
export async function getTotalStorageUsed(): Promise<number> {
  return await invoke('get_total_storage_used')
}

/**
 * Get the downloads directory path
 */
export async function getDownloadsDirectory(): Promise<string> {
  return await invoke('get_downloads_directory')
}

/**
 * Open the downloads folder in file explorer
 */
export async function openDownloadsFolder(): Promise<void> {
  return await invoke('open_downloads_folder')
}

/**
 * Remove a download from the list (doesn't delete file)
 * @param downloadId - Download ID to remove
 */
export async function removeDownload(downloadId: string): Promise<void> {
  return await invoke('remove_download', { downloadId })
}

/**
 * Delete a downloaded file
 * @param downloadId - Download ID to delete
 */
export async function deleteDownload(downloadId: string): Promise<void> {
  return await invoke('delete_download', { downloadId })
}

/**
 * Delete a downloaded episode by media ID and episode number
 * @param mediaId - Media ID
 * @param episodeNumber - Episode number
 */
export async function deleteEpisodeDownload(mediaId: string, episodeNumber: number): Promise<void> {
  return await invoke('delete_episode_download', { mediaId, episodeNumber })
}

/**
 * Clear completed downloads from list
 */
export async function clearCompletedDownloads(): Promise<void> {
  return await invoke('clear_completed_downloads')
}

/**
 * Clear failed downloads from list
 */
export async function clearFailedDownloads(): Promise<void> {
  return await invoke('clear_failed_downloads')
}

// Download types
export interface DownloadProgress {
  id: string
  media_id: string
  episode_id: string
  episode_number: number
  filename: string
  url: string
  file_path: string
  total_bytes: number
  downloaded_bytes: number
  percentage: number
  speed: number
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled'
  error_message?: string
}

// ==================== Watch History Commands ====================

export interface WatchHistory {
  id: number
  media_id: string
  episode_id: string
  episode_number: number
  progress_seconds: number // in seconds
  duration?: number // total duration in seconds
  completed: boolean
  last_watched: string
  created_at: string
}

/**
 * Save or update watch progress for an episode
 */
export async function saveWatchProgress(
  mediaId: string,
  episodeId: string,
  episodeNumber: number,
  progressSeconds: number,
  duration?: number,
  completed: boolean = false
): Promise<void> {
  return await invoke('save_watch_progress', {
    mediaId,
    episodeId,
    episodeNumber,
    progressSeconds,
    duration,
    completed,
  })
}

/**
 * Get watch progress for a specific episode
 */
export async function getWatchProgress(episodeId: string): Promise<WatchHistory | null> {
  return await invoke('get_watch_progress', { episodeId })
}

/**
 * Get continue watching list (recently watched episodes that aren't completed)
 */
export async function getContinueWatching(limit: number = 20): Promise<WatchHistory[]> {
  return await invoke('get_continue_watching', { limit })
}

// ==================== Library Commands ====================

export type LibraryStatus = 'watching' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_watch'

export interface LibraryEntry {
  id: number
  media_id: string
  status: LibraryStatus
  favorite: boolean
  score?: number
  notes?: string
  added_at: string
  updated_at: string
}

/**
 * Library entry with full media details (joined data)
 */
export interface LibraryEntryWithMedia {
  library_entry: LibraryEntry
  media: MediaEntry
}

/**
 * Add media to library
 */
export async function addToLibrary(
  mediaId: string,
  status: LibraryStatus = 'plan_to_watch'
): Promise<LibraryEntry> {
  return await invoke('add_to_library', { mediaId, status })
}

/**
 * Remove media from library
 */
export async function removeFromLibrary(mediaId: string): Promise<void> {
  return await invoke('remove_from_library', { mediaId })
}

/**
 * Get library entry for a specific media
 */
export async function getLibraryEntry(mediaId: string): Promise<LibraryEntry | null> {
  return await invoke('get_library_entry', { mediaId })
}

/**
 * Get all library entries by status
 */
export async function getLibraryByStatus(status?: LibraryStatus): Promise<LibraryEntry[]> {
  return await invoke('get_library_by_status', { status: status || null })
}

/**
 * Get library entries with full media details by status
 */
export async function getLibraryWithMedia(status?: LibraryStatus): Promise<LibraryEntryWithMedia[]> {
  return await invoke('get_library_with_media', { status: status || null })
}

/**
 * Toggle favorite status
 */
export async function toggleFavorite(mediaId: string): Promise<boolean> {
  return await invoke('toggle_favorite', { mediaId })
}

/**
 * Check if media is in library
 */
export async function isInLibrary(mediaId: string): Promise<boolean> {
  return await invoke('is_in_library', { mediaId })
}

// ==================== Media Commands ====================

export interface MediaEntry {
  id: string
  extension_id: string
  title: string
  english_name?: string
  native_name?: string
  description?: string
  cover_url?: string
  banner_url?: string
  trailer_url?: string
  media_type: 'anime' | 'manga'
  content_type?: string
  status?: string
  year?: number
  rating?: number
  episode_count?: number
  episode_duration?: number
  season_quarter?: string
  season_year?: number
  aired_start_year?: number
  aired_start_month?: number
  aired_start_date?: number
  genres?: string
  created_at: string
  updated_at: string
}

export interface ContinueWatchingEntry {
  media: MediaEntry
  episode_id: string
  episode_number: number
  progress_seconds: number
  duration?: number
  last_watched: string
}

/**
 * Save media details to database
 */
export async function saveMediaDetails(media: MediaEntry): Promise<void> {
  return await invoke('save_media_details', { media })
}

/**
 * Get continue watching with full media details
 */
export async function getContinueWatchingWithDetails(limit: number = 20): Promise<ContinueWatchingEntry[]> {
  return await invoke('get_continue_watching_with_details', { limit })
}

/**
 * Downloaded anime with media details
 */
export interface DownloadWithMedia {
  media_id: string
  title: string
  cover_url?: string
  episode_count: number
  total_size: number
}

/**
 * Get downloads with full media details
 */
export async function getDownloadsWithMedia(): Promise<DownloadWithMedia[]> {
  return await invoke('get_downloads_with_media')
}

