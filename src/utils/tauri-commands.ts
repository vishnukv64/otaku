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
  MangaDetails,
  ChapterImages,
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
 * @param allowAdult - Whether to include adult content (from NSFW setting)
 * @returns Search results with pagination info
 */
export async function searchAnime(
  extensionId: string,
  query: string,
  page: number,
  allowAdult: boolean = false
): Promise<SearchResults> {
  return await invoke('search_anime', { extensionId, query, page, allowAdult })
}

/**
 * Get recommended anime (trending/latest)
 * @param extensionId - Extension ID
 * @param allowAdult - Whether to include adult content (from NSFW setting)
 * @returns Recommended anime list
 */
export async function getRecommendations(
  extensionId: string,
  allowAdult: boolean = false
): Promise<SearchResults> {
  return await invoke('get_recommendations', { extensionId, allowAdult })
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
 * @param allowAdult - Whether to include adult content (from NSFW setting)
 * @returns Search results with pagination info
 */
export async function discoverAnime(
  extensionId: string,
  page: number = 1,
  sortType?: string,
  genres: string[] = [],
  allowAdult: boolean = false
): Promise<SearchResults> {
  return await invoke('discover_anime', { extensionId, page, sortType, genres, allowAdult })
}

// Home Content types
export interface HomeCategory {
  id: string
  title: string
  items: SearchResults['results']
}

export interface HomeContent {
  featured: SearchResults['results'][0] | null
  categories: HomeCategory[]
}

/**
 * Get home page content with all categories in a single call
 * More efficient than making multiple discover calls
 * @param extensionId - Extension ID
 * @param allowAdult - Whether to include adult content (from NSFW setting)
 * @returns Home content with featured anime and categorized lists
 */
export async function getHomeContent(
  extensionId: string,
  allowAdult: boolean = false
): Promise<HomeContent> {
  return await invoke('get_home_content', { extensionId, allowAdult })
}

// ==================== Home Content Streaming (SSE) ====================

import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/** Event name for home content streaming */
export const HOME_CONTENT_EVENT = 'home-content-category'

/** Event payload for streaming home content */
export interface HomeCategoryEvent {
  category: HomeCategory
  is_last: boolean
  featured: SearchResults['results'][0] | null
}

/**
 * Start streaming home content via SSE
 * Categories are emitted progressively as they load
 * @param extensionId - Extension ID
 * @param allowAdult - Whether to include adult content
 */
export async function streamHomeContent(
  extensionId: string,
  allowAdult: boolean = false
): Promise<void> {
  return await invoke('stream_home_content', { extensionId, allowAdult })
}

/**
 * Listen for home content category events
 * @param callback - Called when a category is received
 * @returns Unsubscribe function
 */
export async function onHomeContentCategory(
  callback: (event: HomeCategoryEvent) => void
): Promise<UnlistenFn> {
  return await listen<HomeCategoryEvent>(HOME_CONTENT_EVENT, (event) => {
    callback(event.payload)
  })
}

// Tag/Genre types
export interface Tag {
  name: string
  slug: string
  count: number
  thumbnail?: string
}

export interface TagsResult {
  genres: Tag[]
  studios: Tag[]
  has_next_page: boolean
}

/**
 * Get available tags (genres and studios) for filtering
 * @param extensionId - Extension ID
 * @param page - Page number (1-indexed)
 * @returns Tags result with genres and studios
 */
export async function getTags(
  extensionId: string,
  page: number = 1
): Promise<TagsResult> {
  return await invoke('get_tags', { extensionId, page })
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

// ==================== Manga Commands ====================

/**
 * Search for manga using a specific extension
 * @param extensionId - Extension ID
 * @param query - Search query
 * @param page - Page number (1-indexed)
 * @param allowAdult - Whether to include adult content (from NSFW setting)
 * @returns Search results with pagination info
 */
export async function searchManga(
  extensionId: string,
  query: string,
  page: number,
  allowAdult: boolean = false
): Promise<SearchResults> {
  return await invoke('search_manga', { extensionId, query, page, allowAdult })
}

/**
 * Get detailed information about a manga
 * @param extensionId - Extension ID
 * @param mangaId - Manga ID from search results
 * @param allowAdult - Whether to include adult content (from NSFW setting)
 * @returns Detailed manga information with chapters
 */
export async function getMangaDetails(
  extensionId: string,
  mangaId: string,
  allowAdult: boolean = false
): Promise<MangaDetails> {
  return await invoke('get_manga_details', { extensionId, mangaId, allowAdult })
}

/**
 * Get chapter images for reading
 * @param extensionId - Extension ID
 * @param chapterId - Chapter ID
 * @returns Chapter images with total pages
 */
export async function getChapterImages(
  extensionId: string,
  chapterId: string
): Promise<ChapterImages> {
  return await invoke('get_chapter_images', { extensionId, chapterId })
}

/**
 * Discover manga with filters (trending, top-rated, by genre)
 * @param extensionId - Extension ID
 * @param page - Page number (1-indexed)
 * @param sortType - Sort type: "score" (top rated), "update" (recently updated)
 * @param genres - Array of genres to filter by
 * @param allowAdult - Whether to include adult content (from NSFW setting)
 * @returns Search results with pagination info
 */
export async function discoverManga(
  extensionId: string,
  page: number = 1,
  sortType?: string,
  genres: string[] = [],
  allowAdult: boolean = false
): Promise<SearchResults> {
  return await invoke('discover_manga', { extensionId, page, sortType, genres, allowAdult })
}

/**
 * Get available manga tags (genres)
 * @param extensionId - Extension ID
 * @param page - Page number (1-indexed)
 * @returns Tags result with genres
 */
export async function getMangaTags(
  extensionId: string,
  page: number = 1
): Promise<TagsResult> {
  return await invoke('get_manga_tags', { extensionId, page })
}

/**
 * Proxy an image request to avoid CORS issues (for manga pages)
 * @param url - Image URL to proxy
 * @returns Image bytes as Uint8Array
 */
export async function proxyImageRequest(url: string): Promise<Uint8Array> {
  return await invoke('proxy_image_request', { url })
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
 * Get the most recent watch progress for a media (for Resume Watching feature)
 */
export async function getLatestWatchProgressForMedia(mediaId: string): Promise<WatchHistory | null> {
  return await invoke('get_latest_watch_progress_for_media', { mediaId })
}

/**
 * Get continue watching list (recently watched episodes that aren't completed)
 */
export async function getContinueWatching(limit: number = 20): Promise<WatchHistory[]> {
  return await invoke('get_continue_watching', { limit })
}

/**
 * Remove media from continue watching (deletes all watch history for that media)
 * @param mediaId - The media ID to remove
 */
export async function removeFromContinueWatching(mediaId: string): Promise<void> {
  return await invoke('remove_from_continue_watching', { mediaId })
}

// ==================== Reading History Commands ====================

export interface ReadingHistory {
  id: number
  media_id: string
  chapter_id: string
  chapter_number: number
  current_page: number
  total_pages?: number
  completed: boolean
  last_read: string
  created_at: string
}

/**
 * Save or update reading progress for a chapter
 */
export async function saveReadingProgress(
  mediaId: string,
  chapterId: string,
  chapterNumber: number,
  currentPage: number,
  totalPages?: number,
  completed: boolean = false
): Promise<void> {
  return await invoke('save_reading_progress', {
    mediaId,
    chapterId,
    chapterNumber,
    currentPage,
    totalPages,
    completed,
  })
}

/**
 * Get reading progress for a specific chapter
 */
export async function getReadingProgress(chapterId: string): Promise<ReadingHistory | null> {
  return await invoke('get_reading_progress', { chapterId })
}

/**
 * Get the most recent reading progress for a manga (for Resume Reading feature)
 */
export async function getLatestReadingProgressForMedia(mediaId: string): Promise<ReadingHistory | null> {
  return await invoke('get_latest_reading_progress_for_media', { mediaId })
}

/**
 * Get continue reading list (recently read chapters that aren't completed)
 */
export async function getContinueReading(limit: number = 20): Promise<ReadingHistory[]> {
  return await invoke('get_continue_reading', { limit })
}

/**
 * Remove manga from continue reading (deletes all reading history for that manga)
 * @param mediaId - The media ID to remove
 */
export async function removeFromContinueReadingManga(mediaId: string): Promise<void> {
  return await invoke('remove_from_continue_reading_manga', { mediaId })
}

// ==================== Library Commands ====================

export type LibraryStatus = 'watching' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_watch' | 'reading' | 'plan_to_read'

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

export interface ContinueReadingEntry {
  media: MediaEntry
  chapter_id: string
  chapter_number: number
  current_page: number
  total_pages?: number
  last_read: string
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
 * Get continue reading with full media details
 */
export async function getContinueReadingWithDetails(limit: number = 20): Promise<ContinueReadingEntry[]> {
  return await invoke('get_continue_reading_with_details', { limit })
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

// ==================== Video Server Commands ====================

export interface VideoServerUrls {
  local_base_url: string
  proxy_base_url: string
  token: string
  port: number
}

/**
 * Get video server info for streaming
 * The video server handles large videos properly with true HTTP Range support
 */
export async function getVideoServerInfo(): Promise<VideoServerUrls> {
  return await invoke('get_video_server_info')
}

/**
 * Get streaming URL for a local downloaded file
 * Uses the embedded HTTP server for proper Range request support
 * @param filename - Filename in the downloads directory
 */
export async function getLocalVideoUrl(filename: string): Promise<string> {
  return await invoke('get_local_video_url', { filename })
}

/**
 * Get proxy URL for a remote video
 * Uses the embedded HTTP server for proper streaming
 * @param url - Remote video URL to proxy
 */
export async function getProxyVideoUrl(url: string): Promise<string> {
  return await invoke('get_proxy_video_url', { url })
}

// ==================== System Stats Commands ====================

export interface SystemStats {
  // Memory (in bytes)
  memory_used: number
  memory_total: number
  memory_percent: number

  // CPU (percentage)
  cpu_usage: number
  cpu_count: number

  // Process-specific
  process_memory: number
  process_cpu: number
  thread_count: number

  // Storage
  disk_used: number
  disk_total: number
  disk_percent: number
}

/**
 * Get real-time system statistics for developer debugging
 * @returns System stats including CPU, memory, storage, and process info
 */
export async function getSystemStats(): Promise<SystemStats> {
  return await invoke('get_system_stats')
}

// ==================== Log Commands ====================

export interface LogEntry {
  timestamp: string
  level: string
  message: string
}

/**
 * Get application logs for debugging
 * @param lines - Number of recent log lines to retrieve (default 100)
 * @returns Array of log entries
 */
export async function getAppLogs(lines?: number): Promise<LogEntry[]> {
  return await invoke('get_app_logs', { lines })
}

/**
 * Clear application logs
 */
export async function clearAppLogs(): Promise<void> {
  return await invoke('clear_app_logs')
}

/**
 * Get log file path
 * @returns Path to the log file
 */
export async function getLogFilePath(): Promise<string> {
  return await invoke('get_log_file_path')
}

// ==================== Streaming Commands ====================

/** Event name for system stats stream */
export const SYSTEM_STATS_EVENT = 'system-stats'

/** Event name for app logs stream */
export const APP_LOGS_EVENT = 'app-logs'

/**
 * Start streaming system stats via events (emits every second)
 */
export async function startStatsStream(): Promise<void> {
  return await invoke('start_stats_stream')
}

/**
 * Stop streaming system stats
 */
export async function stopStatsStream(): Promise<void> {
  return await invoke('stop_stats_stream')
}

/**
 * Start streaming logs via events (emits every 2 seconds)
 */
export async function startLogsStream(): Promise<void> {
  return await invoke('start_logs_stream')
}

/**
 * Stop streaming logs
 */
export async function stopLogsStream(): Promise<void> {
  return await invoke('stop_logs_stream')
}

// ==================== Chapter Download Commands ====================

export interface ChapterDownloadProgress {
  id: string
  media_id: string
  chapter_id: string
  chapter_number: number
  total_images: number
  downloaded_images: number
  percentage: number
  status: 'queued' | 'downloading' | 'completed' | 'failed'
  error_message?: string
}

/**
 * Start downloading a manga chapter
 * @param mediaId - Media ID
 * @param mediaTitle - Manga title (for folder naming)
 * @param chapterId - Chapter ID
 * @param chapterNumber - Chapter number
 * @param imageUrls - Array of image URLs to download
 * @returns Download ID for tracking progress
 */
export async function startChapterDownload(
  mediaId: string,
  mediaTitle: string,
  chapterId: string,
  chapterNumber: number,
  imageUrls: string[]
): Promise<string> {
  return await invoke('start_chapter_download', {
    mediaId,
    mediaTitle,
    chapterId,
    chapterNumber,
    imageUrls,
  })
}

/**
 * Get chapter download progress
 * @param downloadId - Download ID returned from startChapterDownload
 */
export async function getChapterDownloadProgress(
  downloadId: string
): Promise<ChapterDownloadProgress | null> {
  return await invoke('get_chapter_download_progress', { downloadId })
}

/**
 * Check if a chapter is downloaded
 * @param mediaId - Media ID
 * @param chapterId - Chapter ID
 */
export async function isChapterDownloaded(
  mediaId: string,
  chapterId: string
): Promise<boolean> {
  return await invoke('is_chapter_downloaded', { mediaId, chapterId })
}

/**
 * Get downloaded chapter images (local paths)
 * @param mediaId - Media ID
 * @param chapterId - Chapter ID
 * @returns Array of local file paths for the chapter images
 */
export async function getDownloadedChapterImages(
  mediaId: string,
  chapterId: string
): Promise<string[]> {
  return await invoke('get_downloaded_chapter_images', { mediaId, chapterId })
}

/**
 * Delete a chapter download
 * @param mediaId - Media ID
 * @param chapterId - Chapter ID
 */
export async function deleteChapterDownload(
  mediaId: string,
  chapterId: string
): Promise<void> {
  return await invoke('delete_chapter_download', { mediaId, chapterId })
}

/**
 * List all chapter downloads for a manga
 * @param mediaId - Media ID
 */
export async function listChapterDownloads(
  mediaId: string
): Promise<ChapterDownloadProgress[]> {
  return await invoke('list_chapter_downloads', { mediaId })
}

/**
 * Downloaded manga with media details (for library display)
 */
export interface DownloadedMangaWithMedia {
  media_id: string
  title: string
  cover_url?: string
  chapter_count: number
  total_images: number
  total_size: number
}

/**
 * Get all downloaded manga with chapter counts and media details
 */
export async function getDownloadedMangaWithMedia(): Promise<DownloadedMangaWithMedia[]> {
  return await invoke('get_downloaded_manga')
}

/**
 * Chapter download with media title (for Download Manager display)
 */
export interface ChapterDownloadWithTitle {
  id: string
  media_id: string
  media_title: string
  chapter_id: string
  chapter_number: number
  total_images: number
  downloaded_images: number
  percentage: number
  status: 'queued' | 'downloading' | 'completed' | 'failed'
  error_message?: string
}

/**
 * Chapter download progress event payload (no media_title)
 */
export interface ChapterDownloadProgressEvent {
  id: string
  media_id: string
  chapter_id: string
  chapter_number: number
  total_images: number
  downloaded_images: number
  percentage: number
  status: 'queued' | 'downloading' | 'completed' | 'failed'
  error_message?: string
}

/**
 * List ALL chapter downloads across all manga (for Download Manager)
 */
export async function listAllChapterDownloads(): Promise<ChapterDownloadWithTitle[]> {
  return await invoke('list_all_chapter_downloads')
}

// ==================== Cache Management Commands ====================

/**
 * Cache statistics
 */
export interface CacheStats {
  search_entries: number
  discover_entries: number
  anime_details_entries: number
  manga_details_entries: number
  video_sources_entries: number
  chapter_images_entries: number
  tags_entries: number
  home_content_entries: number
  recommendations_entries: number
}

/**
 * Get cache statistics for debugging
 */
export async function getCacheStats(): Promise<CacheStats> {
  return await invoke('get_cache_stats')
}

/**
 * Clear all API caches
 */
export async function clearApiCache(): Promise<void> {
  return await invoke('clear_api_cache')
}

