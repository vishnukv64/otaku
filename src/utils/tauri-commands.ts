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

// ==================== API Status Reporting ====================
// Global event emitter for real-time API status updates
// Used by ApiStatusIndicator to show connectivity status

type ApiStatusListener = (type: 'anime' | 'manga', success: boolean, resultCount?: number) => void
const apiStatusListeners = new Set<ApiStatusListener>()

/**
 * Subscribe to API status updates
 * @param listener - Called when an API call completes
 * @returns Unsubscribe function
 */
export function subscribeToApiStatus(listener: ApiStatusListener): () => void {
  apiStatusListeners.add(listener)
  return () => apiStatusListeners.delete(listener)
}

/**
 * Report an API call result (internal use)
 */
function reportApiStatus(type: 'anime' | 'manga', success: boolean, resultCount?: number) {
  apiStatusListeners.forEach(listener => listener(type, success, resultCount))
}

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
  try {
    const result = await invoke<SearchResults>('search_anime', { extensionId, query, page, allowAdult })
    reportApiStatus('anime', true, result.results?.length ?? 0)
    return result
  } catch (err) {
    reportApiStatus('anime', false)
    throw err
  }
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
  try {
    const result = await invoke<SearchResults>('discover_anime', { extensionId, page, sortType, genres, allowAdult })
    reportApiStatus('anime', true, result.results?.length ?? 0)
    return result
  } catch (err) {
    reportApiStatus('anime', false)
    throw err
  }
}

// Season Results type
export interface SeasonResults {
  results: SearchResults['results']
  has_next_page: boolean
  season: string // 'Winter' | 'Spring' | 'Summer' | 'Fall'
  year: number
}

/**
 * Get anime from current season (based on current date)
 * Automatically determines season (Winter/Spring/Summer/Fall) from current month
 * @param extensionId - Extension ID
 * @param page - Page number (1-indexed)
 * @param allowAdult - Whether to include adult content (from NSFW setting)
 * @returns Season results with anime list, season name and year
 */
export async function getCurrentSeasonAnime(
  extensionId: string,
  page: number = 1,
  allowAdult: boolean = false
): Promise<SeasonResults> {
  return await invoke('get_current_season_anime', { extensionId, page, allowAdult })
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

// ==================== Anime/Manga Discover Streaming (SSE) ====================

/** Event name for anime discover streaming */
export const ANIME_DISCOVER_EVENT = 'anime-discover-results'

/** Event name for manga discover streaming */
export const MANGA_DISCOVER_EVENT = 'manga-discover-results'

/** Event payload for streaming discover results */
export interface DiscoverResultsEvent {
  results: SearchResults['results']
  page: number
  has_next_page: boolean
  is_last: boolean
  total_results: number
}

/**
 * Start streaming anime discover results via SSE
 * Results are emitted progressively as pages load
 * @param extensionId - Extension ID
 * @param sortType - Sort type: "score", "update", "view"
 * @param genres - Array of genres to filter by
 * @param allowAdult - Whether to include adult content
 * @param pagesToFetch - Number of pages to fetch (default 3)
 */
export async function streamDiscoverAnime(
  extensionId: string,
  sortType?: string,
  genres: string[] = [],
  allowAdult: boolean = false,
  pagesToFetch: number = 3
): Promise<void> {
  return await invoke('stream_discover_anime', {
    extensionId,
    sortType,
    genres,
    allowAdult,
    pagesToFetch,
  })
}

/**
 * Listen for anime discover results events
 * @param callback - Called when results are received
 * @returns Unsubscribe function
 */
export async function onAnimeDiscoverResults(
  callback: (event: DiscoverResultsEvent) => void
): Promise<UnlistenFn> {
  return await listen<DiscoverResultsEvent>(ANIME_DISCOVER_EVENT, (event) => {
    callback(event.payload)
  })
}

/**
 * Start streaming manga discover results via SSE
 * Results are emitted progressively as pages load
 * @param extensionId - Extension ID
 * @param sortType - Sort type: "score", "update", "view"
 * @param genres - Array of genres to filter by
 * @param allowAdult - Whether to include adult content
 * @param pagesToFetch - Number of pages to fetch (default 3)
 */
export async function streamDiscoverManga(
  extensionId: string,
  sortType?: string,
  genres: string[] = [],
  allowAdult: boolean = false,
  pagesToFetch: number = 3
): Promise<void> {
  return await invoke('stream_discover_manga', {
    extensionId,
    sortType,
    genres,
    allowAdult,
    pagesToFetch,
  })
}

/**
 * Listen for manga discover results events
 * @param callback - Called when results are received
 * @returns Unsubscribe function
 */
export async function onMangaDiscoverResults(
  callback: (event: DiscoverResultsEvent) => void
): Promise<UnlistenFn> {
  return await listen<DiscoverResultsEvent>(MANGA_DISCOVER_EVENT, (event) => {
    callback(event.payload)
  })
}

// ==================== Season Anime Streaming (SSE) ====================

/** Event name for season anime streaming */
export const SEASON_ANIME_DISCOVER_EVENT = 'season-anime-discover-results'

/** Event payload for streaming season anime results */
export interface SeasonDiscoverResultsEvent {
  results: SearchResults['results']
  page: number
  has_next_page: boolean
  is_last: boolean
  total_results: number
  season: string // 'Winter' | 'Spring' | 'Summer' | 'Fall'
  year: number
}

/**
 * Start streaming current season anime results via SSE
 * Results are emitted progressively as pages load
 * @param extensionId - Extension ID
 * @param allowAdult - Whether to include adult content
 * @param pagesToFetch - Number of pages to fetch (default 3)
 */
export async function streamCurrentSeasonAnime(
  extensionId: string,
  allowAdult: boolean = false,
  pagesToFetch: number = 3
): Promise<void> {
  return await invoke('stream_current_season_anime', {
    extensionId,
    allowAdult,
    pagesToFetch,
  })
}

/**
 * Listen for season anime discover results events
 * @param callback - Called when results are received
 * @returns Unsubscribe function
 */
export async function onSeasonAnimeDiscoverResults(
  callback: (event: SeasonDiscoverResultsEvent) => void
): Promise<UnlistenFn> {
  return await listen<SeasonDiscoverResultsEvent>(SEASON_ANIME_DISCOVER_EVENT, (event) => {
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
  try {
    const result = await invoke<SearchResults>('search_manga', { extensionId, query, page, allowAdult })
    reportApiStatus('manga', true, result.results?.length ?? 0)
    return result
  } catch (err) {
    reportApiStatus('manga', false)
    throw err
  }
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
  try {
    const result = await invoke<SearchResults>('discover_manga', { extensionId, page, sortType, genres, allowAdult })
    reportApiStatus('manga', true, result.results?.length ?? 0)
    return result
  } catch (err) {
    reportApiStatus('manga', false)
    throw err
  }
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
 * @param customPath - Optional custom download location
 * @returns Download ID for tracking progress
 */
export async function startDownload(
  mediaId: string,
  episodeId: string,
  episodeNumber: number,
  url: string,
  filename: string,
  customPath?: string
): Promise<string> {
  return await invoke('start_download', { mediaId, episodeId, episodeNumber, url, filename, customPath })
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
 * Pause an ongoing download
 * @param downloadId - Download ID to pause
 */
export async function pauseDownload(downloadId: string): Promise<void> {
  return await invoke('pause_download', { downloadId })
}

/**
 * Resume a paused download
 * @param downloadId - Download ID to resume
 */
export async function resumeDownload(downloadId: string): Promise<void> {
  return await invoke('resume_download', { downloadId })
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
 * @param customPath - Optional custom path to open (uses default if not provided)
 */
export async function openDownloadsFolder(customPath?: string): Promise<void> {
  return await invoke('open_downloads_folder', { customPath })
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

/**
 * Clear cancelled downloads from list
 */
export async function clearCancelledDownloads(): Promise<void> {
  return await invoke('clear_cancelled_downloads')
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

// ==================== Library Tag Commands ====================

export interface LibraryTag {
  id: number
  name: string
  color: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface LibraryTagWithCount {
  tag: LibraryTag
  item_count: number
}

/**
 * Create a new library tag
 * @param name - Tag name
 * @param color - Tag color (hex format, e.g., "#6366f1")
 * @returns The created tag
 */
export async function createLibraryTag(name: string, color: string): Promise<LibraryTag> {
  return await invoke('create_library_tag', { name, color })
}

/**
 * Get all library tags
 * @returns Array of all tags
 */
export async function getLibraryTags(): Promise<LibraryTag[]> {
  return await invoke('get_library_tags')
}

/**
 * Get all library tags with item counts
 * @returns Array of tags with their associated item counts
 */
export async function getLibraryTagsWithCounts(): Promise<LibraryTagWithCount[]> {
  return await invoke('get_library_tags_with_counts')
}

/**
 * Update a library tag
 * @param tagId - Tag ID to update
 * @param name - New name (optional)
 * @param color - New color (optional)
 */
export async function updateLibraryTag(
  tagId: number,
  name?: string,
  color?: string
): Promise<void> {
  return await invoke('update_library_tag', { tagId, name, color })
}

/**
 * Delete a library tag
 * @param tagId - Tag ID to delete
 */
export async function deleteLibraryTag(tagId: number): Promise<void> {
  return await invoke('delete_library_tag', { tagId })
}

/**
 * Assign a tag to a media item
 * @param mediaId - Media ID
 * @param tagId - Tag ID to assign
 */
export async function assignLibraryTag(mediaId: string, tagId: number): Promise<void> {
  return await invoke('assign_library_tag', { mediaId, tagId })
}

/**
 * Unassign a tag from a media item
 * @param mediaId - Media ID
 * @param tagId - Tag ID to unassign
 */
export async function unassignLibraryTag(mediaId: string, tagId: number): Promise<void> {
  return await invoke('unassign_library_tag', { mediaId, tagId })
}

/**
 * Get all tags for a specific media item
 * @param mediaId - Media ID
 * @returns Array of tags assigned to the media
 */
export async function getMediaTags(mediaId: string): Promise<LibraryTag[]> {
  return await invoke('get_media_tags', { mediaId })
}

/**
 * Get all library entries with a specific tag
 * @param tagId - Tag ID
 * @returns Array of library entries with full media details
 */
export async function getLibraryByTag(tagId: number): Promise<LibraryEntryWithMedia[]> {
  return await invoke('get_library_by_tag', { tagId })
}

// ==================== Bulk Operations ====================

/**
 * Bulk assign a tag to multiple media items
 * @param mediaIds - Array of media IDs
 * @param tagId - Tag ID to assign
 */
export async function bulkAssignLibraryTag(mediaIds: string[], tagId: number): Promise<void> {
  return await invoke('bulk_assign_library_tag', { mediaIds, tagId })
}

/**
 * Bulk unassign a tag from multiple media items
 * @param mediaIds - Array of media IDs
 * @param tagId - Tag ID to unassign
 */
export async function bulkUnassignLibraryTag(mediaIds: string[], tagId: number): Promise<void> {
  return await invoke('bulk_unassign_library_tag', { mediaIds, tagId })
}

/**
 * Bulk update library status for multiple items
 * @param mediaIds - Array of media IDs
 * @param status - New status
 */
export async function bulkUpdateLibraryStatus(mediaIds: string[], status: LibraryStatus): Promise<void> {
  return await invoke('bulk_update_library_status', { mediaIds, status })
}

/**
 * Bulk remove items from library
 * @param mediaIds - Array of media IDs
 */
export async function bulkRemoveFromLibrary(mediaIds: string[]): Promise<void> {
  return await invoke('bulk_remove_from_library', { mediaIds })
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
  completed: boolean
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

/** Episode entry for caching */
export interface EpisodeEntry {
  id: string
  media_id: string
  extension_id: string
  number: number
  title?: string
  description?: string
  thumbnail_url?: string
  aired_date?: string
  duration?: number // in seconds
}

/** Cached media details with episodes (for offline fallback) */
export interface CachedMediaDetails {
  media: MediaEntry
  episodes: EpisodeEntry[]
}

/**
 * Save episodes to database for caching
 * @param mediaId - Media ID
 * @param extensionId - Extension ID
 * @param episodes - Episodes to cache
 */
export async function saveEpisodes(
  mediaId: string,
  extensionId: string,
  episodes: EpisodeEntry[]
): Promise<void> {
  return await invoke('save_episodes', { mediaId, extensionId, episodes })
}

/**
 * Get cached media details with episodes (for offline fallback)
 * @param mediaId - Media ID
 * @returns Cached media details or null if not cached
 */
export async function getCachedMediaDetails(mediaId: string): Promise<CachedMediaDetails | null> {
  return await invoke('get_cached_media_details', { mediaId })
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
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled'
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
  imageUrls: string[],
  customPath?: string
): Promise<string> {
  return await invoke('start_chapter_download', {
    mediaId,
    mediaTitle,
    chapterId,
    chapterNumber,
    imageUrls,
    customPath,
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
 * Cancel an ongoing chapter download
 * @param mediaId - Media ID
 * @param chapterId - Chapter ID
 */
export async function cancelChapterDownload(
  mediaId: string,
  chapterId: string
): Promise<void> {
  return await invoke('cancel_chapter_download', { mediaId, chapterId })
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
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled'
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
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  error_message?: string
}

/**
 * List ALL chapter downloads across all manga (for Download Manager)
 */
export async function listAllChapterDownloads(): Promise<ChapterDownloadWithTitle[]> {
  return await invoke('list_all_chapter_downloads')
}

// ==================== Notification Commands ====================

export type NotificationType = 'success' | 'error' | 'warning' | 'info'

export interface NotificationAction {
  label: string
  route?: string
  callback?: string
}

export interface NotificationPayload {
  id: string
  type: NotificationType
  title: string
  message: string
  source?: string
  action?: NotificationAction
  metadata?: Record<string, unknown>
  read: boolean
  dismissed: boolean
  timestamp: number
}

/** Event name for notification events */
export const NOTIFICATION_EVENT = 'notification'

/**
 * Create and save a notification to the database
 * @param notificationType - Type of notification (success, error, warning, info)
 * @param title - Notification title
 * @param message - Notification message
 * @param source - Optional source/category
 * @param actionLabel - Optional action button label
 * @param actionRoute - Optional route to navigate to when action is clicked
 * @param metadata - Optional additional metadata
 * @returns The notification ID
 */
export async function createNotification(
  notificationType: 'success' | 'error' | 'warning' | 'info',
  title: string,
  message: string,
  source?: string,
  actionLabel?: string,
  actionRoute?: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  return await invoke('create_notification', {
    notificationType,
    title,
    message,
    source,
    actionLabel,
    actionRoute,
    metadata,
  })
}

/**
 * List notifications from database
 * @param limit - Maximum number of notifications to return (default 50)
 * @param includeDismissed - Whether to include dismissed notifications
 */
export async function listNotifications(
  limit: number = 50,
  includeDismissed: boolean = false
): Promise<NotificationPayload[]> {
  return await invoke('list_notifications', { limit, includeDismissed })
}

/**
 * Mark a notification as read
 * @param notificationId - The notification ID to mark as read
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  return await invoke('mark_notification_read', { notificationId })
}

/**
 * Mark all notifications as read
 */
export async function markAllNotificationsRead(): Promise<void> {
  return await invoke('mark_all_notifications_read')
}

/**
 * Dismiss a notification (soft delete)
 * @param notificationId - The notification ID to dismiss
 */
export async function dismissNotification(notificationId: string): Promise<void> {
  return await invoke('dismiss_notification', { notificationId })
}

/**
 * Clear all notifications
 */
export async function clearAllNotifications(): Promise<void> {
  return await invoke('clear_all_notifications')
}

/**
 * Get count of unread notifications
 */
export async function getUnreadNotificationCount(): Promise<number> {
  return await invoke('get_unread_notification_count')
}

/**
 * Listen for notification events
 * @param callback - Called when a notification is received
 * @returns Unsubscribe function
 */
export async function onNotification(
  callback: (notification: NotificationPayload) => void
): Promise<UnlistenFn> {
  return await listen<NotificationPayload>(NOTIFICATION_EVENT, (event) => {
    callback(event.payload)
  })
}

// ============================================================================
// App Settings / Update Check
// ============================================================================

/** Update check info from database */
export interface UpdateCheckInfo {
  last_check: number | null
  next_check: number | null
  notified_version: string | null
}

/**
 * Get update check info from database
 * @returns Update check timestamps and notified version
 */
export async function getUpdateCheckInfo(): Promise<UpdateCheckInfo> {
  return await invoke('get_update_check_info')
}

/**
 * Set update check info in database
 * @param lastCheck - Timestamp of last check (optional)
 * @param notifiedVersion - Version user was notified about (optional)
 */
export async function setUpdateCheckInfo(
  lastCheck?: number,
  notifiedVersion?: string
): Promise<void> {
  return await invoke('set_update_check_info', {
    lastCheck: lastCheck ?? null,
    notifiedVersion: notifiedVersion ?? null,
  })
}

// ============================================================================
// Release Checker Commands
// ============================================================================

/** Release check settings (V2 with granular intervals) */
export interface ReleaseCheckSettings {
  enabled: boolean
  interval_minutes: number
  fast_interval_minutes: number
  retry_delay_minutes: number
  max_retries: number
  last_full_check: number | null
  /** @deprecated Use interval_minutes instead */
  interval_hours?: number
}

/** Release check status */
export interface ReleaseCheckStatus {
  is_running: boolean
  last_check: number | null
  next_check: number | null
  items_checked: number
  new_releases_found: number
}

/** Result from checking a single media item (V2 with detection signal) */
export interface ReleaseCheckResult {
  media_id: string
  media_title: string
  media_type: 'anime' | 'manga'
  previous_count: number
  current_count: number
  previous_number: number | null
  current_number: number | null
  new_releases: number
  extension_id: string
  detection_signal: 'number' | 'id' | 'count'
}

/** Media release state for NEW badges */
export interface MediaReleaseState {
  media_id: string
  has_new_release: boolean
  latest_number: number | null
  notified_up_to: number | null
  last_checked: number | null
  normalized_status: 'ongoing' | 'completed' | 'hiatus' | 'unknown'
}

/** Check log entry for debugging */
export interface CheckLogEntry {
  id: number
  media_id: string
  check_timestamp: number
  result_type: 'new_release' | 'no_change' | 'api_error' | 'count_decreased' | 'first_check'
  previous_count: number | null
  new_count: number | null
  previous_latest_number: number | null
  new_latest_number: number | null
  detection_signal: string | null
  error_message: string | null
  notification_sent: boolean
}

/** Full tracking debug info */
export interface TrackingDebugInfo {
  media_id: string
  extension_id: string
  media_type: 'anime' | 'manga'
  last_known_count: number | null
  last_known_latest_number: number | null
  last_known_latest_id: string | null
  raw_status: string | null
  normalized_status: string
  user_notified_up_to: number | null
  notification_enabled: boolean
  last_checked_at: number | null
  next_scheduled_check: number | null
  consecutive_failures: number
  last_error: string | null
  recent_logs: CheckLogEntry[]
}

/**
 * Get release check settings
 * @returns Current release check settings
 */
export async function getReleaseCheckSettings(): Promise<ReleaseCheckSettings> {
  return await invoke('get_release_check_settings')
}

/**
 * Update release check settings
 * @param enabled - Whether release checking is enabled
 * @param intervalMinutes - Minutes between checks (or use intervalHours for backwards compatibility)
 * @param intervalHours - Hours between checks (legacy, converted to minutes)
 */
export async function updateReleaseCheckSettings(
  enabled: boolean,
  intervalMinutes?: number,
  intervalHours?: number
): Promise<void> {
  return await invoke('update_release_check_settings', {
    enabled,
    intervalMinutes,
    intervalHours,
  })
}

/**
 * Manually trigger a release check for all eligible media
 * @returns Array of media items with new releases
 */
export async function checkForNewReleases(): Promise<ReleaseCheckResult[]> {
  return await invoke('check_for_new_releases')
}

/**
 * Stop the current release check
 * Halts any ongoing release check operation
 */
export async function stopReleaseCheck(): Promise<void> {
  return await invoke('stop_release_check')
}

/**
 * Get release check status
 * @returns Current status of the release checker
 */
export async function getReleaseCheckStatus(): Promise<ReleaseCheckStatus> {
  return await invoke('get_release_check_status')
}

/**
 * Initialize release tracking for a media item
 * Called when adding media to library
 * @param mediaId - Media ID
 * @param extensionId - Extension ID
 * @param mediaType - Type of media ('anime' or 'manga')
 * @param currentCount - Current episode/chapter count
 */
export async function initializeReleaseTracking(
  mediaId: string,
  extensionId: string,
  mediaType: 'anime' | 'manga',
  currentCount: number
): Promise<void> {
  return await invoke('initialize_release_tracking', {
    mediaId,
    extensionId,
    mediaType,
    currentCount,
  })
}

/**
 * Get release tracking status for multiple media items
 * @param mediaIds - Array of media IDs to check
 * @returns Array of media IDs that are being tracked
 */
export async function getReleaseTrackingStatus(mediaIds: string[]): Promise<string[]> {
  return await invoke('get_release_tracking_status', { mediaIds })
}

// ============================================================================
// Release Checker V2 Commands
// ============================================================================

/**
 * Get release states for multiple media items (V2)
 * Used for determining NEW badges on media cards
 * @param mediaIds - Array of media IDs to check
 * @returns Array of release states
 */
export async function getMediaReleaseStates(
  mediaIds: string[]
): Promise<MediaReleaseState[]> {
  return await invoke('get_media_release_states', { mediaIds })
}

/**
 * Acknowledge new releases (dismiss NEW badge)
 * @param mediaId - Media ID to acknowledge
 * @param upToNumber - Optional episode/chapter number to acknowledge up to
 */
export async function acknowledgeNewReleases(
  mediaId: string,
  upToNumber?: number
): Promise<void> {
  return await invoke('acknowledge_new_releases', { mediaId, upToNumber })
}

/**
 * Get release check history for debugging
 * @param mediaId - Media ID to get history for
 * @param limit - Maximum number of entries to return
 * @returns Array of check log entries
 */
export async function getReleaseCheckHistory(
  mediaId: string,
  limit?: number
): Promise<CheckLogEntry[]> {
  return await invoke('get_release_check_history', { mediaId, limit })
}

/**
 * Get full tracking debug info for a media item
 * @param mediaId - Media ID to get debug info for
 * @returns Tracking debug info or null if not tracked
 */
export async function getReleaseTrackingDebug(
  mediaId: string
): Promise<TrackingDebugInfo | null> {
  return await invoke('get_release_tracking_debug', { mediaId })
}

/**
 * Initialize release tracking with V2 fields
 * Includes episode number, ID, and raw status for better tracking
 * @param mediaId - Media ID
 * @param extensionId - Extension ID
 * @param mediaType - Type of media
 * @param currentCount - Current episode/chapter count
 * @param latestNumber - Latest episode/chapter number
 * @param latestId - Latest episode/chapter ID
 * @param rawStatus - Raw status string from API
 */
export async function initializeReleaseTrackingV2(
  mediaId: string,
  extensionId: string,
  mediaType: 'anime' | 'manga',
  currentCount: number,
  latestNumber?: number,
  latestId?: string,
  rawStatus?: string
): Promise<void> {
  return await invoke('initialize_release_tracking_v2', {
    mediaId,
    extensionId,
    mediaType,
    currentCount,
    latestNumber,
    latestId,
    rawStatus,
  })
}

// ============================================================================
// App Settings
// ============================================================================

/**
 * Get an app setting from the database
 * @param key - Setting key
 * @returns Setting value or null if not found
 */
export async function getAppSetting(key: string): Promise<string | null> {
  return await invoke('get_app_setting', { key })
}

/**
 * Set an app setting in the database
 * @param key - Setting key
 * @param value - Setting value
 */
export async function setAppSetting(key: string, value: string): Promise<void> {
  return await invoke('set_app_setting', { key, value })
}

/**
 * Delete an app setting from the database
 * @param key - Setting key
 */
export async function deleteAppSetting(key: string): Promise<void> {
  return await invoke('delete_app_setting', { key })
}


