/**
 * Extension System Types
 *
 * TypeScript definitions matching the Rust extension types.
 * Keep in sync with src-tauri/src/extensions/types.rs
 */

export type ExtensionType = 'anime' | 'manga'

export interface ExtensionMetadata {
  id: string
  name: string
  version: string
  type: ExtensionType
  language: string
  base_url: string
}

export interface SearchResult {
  id: string
  title: string
  cover_url?: string
  trailer_url?: string
  description?: string
  year?: number
  status?: string
  rating?: number
  /** Latest episode number (for currently airing) */
  latest_episode?: number
  /** Date of the latest episode release */
  latest_episode_date?: {
    year: number
    month: number // 0-indexed (0 = January)
    date: number
  }
  /** Total available episodes (sub) */
  available_episodes?: number
  /** Media type: TV, Movie, OVA, ONA, Special */
  media_type?: string
}

export interface SearchResults {
  results: SearchResult[]
  has_next_page: boolean
}

export interface Episode {
  id: string
  number: number
  title?: string
  thumbnail?: string
}

export interface MediaDetails {
  id: string
  title: string
  english_name?: string
  native_name?: string
  cover_url?: string
  trailer_url?: string
  description?: string
  genres: string[]
  status?: string
  year?: number
  rating?: number
  episodes: Episode[]
  type?: string // TV, ONA, OVA, Movie, Special
  season?: {
    quarter: string // Spring, Summer, Fall, Winter
    year: number
  }
  episode_duration?: number // in milliseconds
  episode_count?: number
  aired_start?: {
    year: number
    month?: number
    date?: number
  }
}

export interface VideoSource {
  url: string
  quality: string
  type: string // 'hls' | 'mp4' | 'dash'
  server: string // Server name (e.g., 'Wixmp', 'Default', etc.)
}

export interface Subtitle {
  url: string
  language: string
  label: string
}

export interface VideoSources {
  sources: VideoSource[]
  subtitles: Subtitle[]
}

// ==================== Manga Types ====================

export interface Chapter {
  id: string
  number: number
  title?: string
  thumbnail?: string
  releaseDate?: string
}

export interface ChapterImage {
  url: string
  page: number
  width?: number
  height?: number
}

export interface ChapterImages {
  images: ChapterImage[]
  total_pages: number
  title?: string
}

export interface MangaDetails extends Omit<MediaDetails, 'episodes'> {
  chapters: Chapter[]
  totalChapters?: number
}
