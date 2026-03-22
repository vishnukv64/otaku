/**
 * StatsPage — main orchestrator that loads all data and renders sections.
 * Fires all API calls in parallel with Promise.allSettled(). Each section
 * renders independently as its data arrives.
 */

import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import {
  getWatchStatsSummary,
  getReadingStatsSummary,
  getCompletionStats,
  getTopWatchedAnime,
  getTopReadManga,
  getStreakStats,
  getActivityPatterns,
  getBingeStats,
} from '@/utils/tauri-commands'
import type {
  WatchStatsSummary,
  ReadingStatsSummary,
  CompletionStats,
  TopWatchedEntry,
  TopReadEntry,
  StreakStats,
  ActivityPatterns,
  BingeStats,
} from '@/utils/tauri-commands'

import { SummaryCards } from './SummaryCards'
import { ActivityChart } from './ActivityChart'
import { GenreDistribution } from './GenreDistribution'
import { CompletionRings } from './CompletionRings'
import { TopContent } from './TopContent'
import { StreaksAndFun } from './StreaksAndFun'

export function StatsPage() {
  const [watchStats, setWatchStats] = useState<WatchStatsSummary | null>(null)
  const [readingStats, setReadingStats] = useState<ReadingStatsSummary | null>(null)
  const [completionStats, setCompletionStats] = useState<CompletionStats | null>(null)
  const [topAnime, setTopAnime] = useState<TopWatchedEntry[] | null>(null)
  const [topManga, setTopManga] = useState<TopReadEntry[] | null>(null)
  const [streaks, setStreaks] = useState<StreakStats | null>(null)
  const [patterns, setPatterns] = useState<ActivityPatterns | null>(null)
  const [binge, setBinge] = useState<BingeStats | null>(null)

  useEffect(() => {
    // Fire all API calls in parallel
    const load = async () => {
      const results = await Promise.allSettled([
        getWatchStatsSummary(),       // 0
        getReadingStatsSummary(),     // 1
        getCompletionStats(),         // 2
        getTopWatchedAnime(5),        // 3
        getTopReadManga(5),           // 4
        getStreakStats(),             // 5
        getActivityPatterns(),        // 6
        getBingeStats(),              // 7
      ])

      if (results[0].status === 'fulfilled') setWatchStats(results[0].value)
      if (results[1].status === 'fulfilled') setReadingStats(results[1].value)
      if (results[2].status === 'fulfilled') setCompletionStats(results[2].value)
      if (results[3].status === 'fulfilled') setTopAnime(results[3].value)
      if (results[4].status === 'fulfilled') setTopManga(results[4].value)
      if (results[5].status === 'fulfilled') setStreaks(results[5].value)
      if (results[6].status === 'fulfilled') setPatterns(results[6].value)
      if (results[7].status === 'fulfilled') setBinge(results[7].value)

      // Log any failures
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`Stats query ${i} failed:`, r.reason)
        }
      })
    }

    load()
  }, [])

  return (
    <div className="min-h-screen bg-[var(--color-background)] px-4 py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-blue-500/20">
            <BarChart3 size={24} className="text-blue-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
              Activity Statistics
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Your anime and manga activity at a glance
            </p>
          </div>
        </div>

        {/* Summary Cards */}
        <SummaryCards watchStats={watchStats} readingStats={readingStats} />

        {/* Activity Chart (manages its own data fetching) */}
        <ActivityChart />

        {/* Genre Distribution (manages its own data fetching) */}
        <GenreDistribution />

        {/* Completion Rings */}
        <CompletionRings data={completionStats} />

        {/* Top Content */}
        <TopContent topAnime={topAnime} topManga={topManga} />

        {/* Streaks & Fun */}
        <StreaksAndFun streaks={streaks} patterns={patterns} binge={binge} />
      </div>
    </div>
  )
}
