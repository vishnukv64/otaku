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
  description?: string
  year?: number
  status?: string
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
  cover_url?: string
  description?: string
  genres: string[]
  status?: string
  year?: number
  rating?: number
  episodes: Episode[]
}

export interface VideoSource {
  url: string
  quality: string
  type: string // 'hls' | 'mp4' | 'dash'
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
