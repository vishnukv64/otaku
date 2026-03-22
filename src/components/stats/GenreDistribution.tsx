/**
 * GenreDistribution — CSS horizontal bar chart, top 10 genres with toggle
 */

import { useState, useEffect, useCallback } from 'react'
import { getGenreStats } from '@/utils/tauri-commands'
import type { GenreStat } from '@/utils/tauri-commands'
import { BarChart3 } from 'lucide-react'

const tabs = ['Combined', 'Anime', 'Manga'] as const
type TabValue = (typeof tabs)[number]

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const barColors = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
]

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
    <div className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: '#8b5cf620' }}>
            <BarChart3 size={20} className="text-purple-500" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Genre Distribution
          </h2>
        </div>
        <div className="flex gap-1 rounded-lg bg-[var(--color-surface-subtle)] p-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                selectedTab === tab
                  ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
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
          <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {data!.slice(0, 10).map((genre, i) => {
            const pct = (genre.time_seconds / maxTime) * 100
            return (
              <div key={genre.genre} className="flex items-center gap-3">
                <span className="w-24 text-sm text-[var(--color-text-secondary)] text-right shrink-0 truncate">
                  {genre.genre}
                </span>
                <div className="flex-1 h-6 rounded-full bg-[var(--color-surface-subtle)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                      backgroundColor: barColors[i % barColors.length],
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
