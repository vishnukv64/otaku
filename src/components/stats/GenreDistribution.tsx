/**
 * GenreDistribution — CSS horizontal bar chart, top 10 genres with toggle
 */

import { useState, useEffect, useCallback } from 'react'
import { getGenreStats } from '@/utils/tauri-commands'
import type { GenreStat } from '@/utils/tauri-commands'

const tabs = ['Combined', 'Anime', 'Manga'] as const
type TabValue = (typeof tabs)[number]

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function GenreDistribution() {
  const [selectedTab, setSelectedTab] = useState<TabValue>('Combined')
  const [data, setData] = useState<GenreStat[] | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async (tab: TabValue) => {
    setLoading(true)
    try {
      const mediaType = tab === 'Combined' ? undefined : tab === 'Anime' ? 'anime' : 'manga'
      const result = await getGenreStats(mediaType)
      setData(result)
    } catch (err) {
      console.error('Failed to fetch genre stats:', err)
      setData([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(selectedTab)
  }, [selectedTab, fetchData])

  if (!loading && (!data || data.length === 0)) {
    return null // hide section if empty per spec
  }

  const maxTime = data ? Math.max(...data.map((g) => g.time_seconds), 1) : 1

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Genre Distribution
        </h2>
        <div className="flex gap-1 rounded-lg bg-[var(--color-surface-hover)] p-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                selectedTab === tab
                  ? 'bg-[var(--color-accent-primary)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[var(--color-accent-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {data!.slice(0, 10).map((genre, i) => {
            const pct = (genre.time_seconds / maxTime) * 100
            // Use accent color with decreasing opacity for lower-ranked genres
            const opacity = 1 - i * 0.07
            return (
              <div key={genre.genre} className="flex items-center gap-3">
                <span className="w-24 text-sm text-[var(--color-text-secondary)] text-right shrink-0 truncate">
                  {genre.genre}
                </span>
                <div className="flex-1 h-6 rounded-full bg-[var(--color-surface-hover)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                      backgroundColor:
                        selectedTab === 'Manga'
                          ? `rgba(99, 102, 241, ${opacity})`
                          : `rgba(229, 9, 20, ${opacity})`,
                    }}
                  />
                </div>
                <span className="w-16 text-sm text-[var(--color-text-tertiary)] shrink-0">
                  {formatTime(genre.time_seconds)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
