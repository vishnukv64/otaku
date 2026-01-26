/**
 * ContinueWatchingSection Component
 *
 * Displays recently watched anime with progress indicators
 */

import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Play, Loader2 } from 'lucide-react'
import { getContinueWatchingWithDetails, type ContinueWatchingEntry } from '@/utils/tauri-commands'
import { MediaCard } from './MediaCard'
import type { SearchResult } from '@/types/extension'

interface ContinueWatchingSectionProps {
  extensionId: string
}

export function ContinueWatchingSection({ extensionId }: ContinueWatchingSectionProps) {
  const [continueWatching, setContinueWatching] = useState<ContinueWatchingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const loadContinueWatching = async () => {
      try {
        const results = await getContinueWatchingWithDetails(20)
        setContinueWatching(results)
      } catch (error) {
        console.error('Failed to load continue watching:', error)
      } finally {
        setLoading(false)
      }
    }

    loadContinueWatching()
  }, [])

  const handleContinueWatching = (entry: ContinueWatchingEntry) => {
    navigate({
      to: '/watch',
      search: {
        extensionId,
        animeId: entry.media.id,
        episodeId: entry.episode_id,
      },
    })
  }

  if (loading) {
    return (
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Play className="w-6 h-6 text-[var(--color-accent-primary)]" fill="currentColor" />
          Continue Watching
        </h2>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
        </div>
      </div>
    )
  }

  if (continueWatching.length === 0) {
    return null // Don't show section if no continue watching items
  }

  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Play className="w-6 h-6 text-[var(--color-accent-primary)]" fill="currentColor" />
        Continue Watching
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {continueWatching.map((entry) => {
          // Convert MediaEntry to SearchResult format for MediaCard
          const media: SearchResult = {
            id: entry.media.id,
            title: entry.media.title,
            cover_url: entry.media.cover_url,
            description: entry.media.description,
            rating: entry.media.rating,
            year: entry.media.year,
            status: entry.media.status,
          }

          const progressPercentage = entry.duration
            ? (entry.progress_seconds / entry.duration) * 100
            : 0

          return (
            <MediaCard
              key={entry.media.id}
              media={media}
              onClick={() => handleContinueWatching(entry)}
              progress={{
                current: entry.progress_seconds,
                total: entry.duration || 0,
                episodeNumber: entry.episode_number,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
