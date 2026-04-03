/**
 * StatsPage — main orchestrator that loads all data and renders sections.
 * Fires all API calls in parallel with Promise.allSettled(). Each section
 * renders independently as its data arrives.
 */

import { useEffect, useState } from 'react'
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
    // Fire each query independently so sections render as data arrives.
    // ActivityChart and GenreDistribution manage their own data fetching.
    const err = (name: string) => (e: unknown) => console.error(`Stats [${name}] failed:`, e)

    getWatchStatsSummary().then(setWatchStats).catch(err('watchStats'))
    getReadingStatsSummary().then(setReadingStats).catch(err('readingStats'))
    getCompletionStats().then(setCompletionStats).catch(err('completion'))
    getTopWatchedAnime(5).then(setTopAnime).catch(err('topAnime'))
    getTopReadManga(5).then(setTopManga).catch(err('topManga'))
    getStreakStats().then(setStreaks).catch(err('streaks'))
    getActivityPatterns().then(setPatterns).catch(err('patterns'))
    getBingeStats().then(setBinge).catch(err('binge'))
  }, [])

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 sm:px-6 lg:px-8 3xl:px-12 py-8 max-w-4k mx-auto">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="mb-2">
          <h1 className="text-[2.5rem] font-extrabold font-display mb-1.5 bg-gradient-to-br from-[var(--color-text-primary)] to-[var(--color-text-secondary)] bg-clip-text text-transparent">
            Activity Statistics
          </h1>
          <p className="text-[var(--color-text-muted)] text-[0.9375rem]">
            Your anime and manga activity at a glance
          </p>
        </div>

        {/* Summary Cards */}
        <div
          style={{
            animation: 'stats-fade-up 0.5s ease-out forwards',
            animationDelay: '0ms',
            opacity: 0,
          }}
        >
          <SummaryCards watchStats={watchStats} readingStats={readingStats} />
        </div>

        {/* Activity Chart (manages its own data fetching) */}
        <div
          style={{
            animation: 'stats-fade-up 0.5s ease-out forwards',
            animationDelay: '80ms',
            opacity: 0,
          }}
        >
          <ActivityChart />
        </div>

        {/* Genre Distribution (manages its own data fetching) */}
        <div
          style={{
            animation: 'stats-fade-up 0.5s ease-out forwards',
            animationDelay: '160ms',
            opacity: 0,
          }}
        >
          <GenreDistribution />
        </div>

        {/* Completion Rings */}
        <div
          style={{
            animation: 'stats-fade-up 0.5s ease-out forwards',
            animationDelay: '240ms',
            opacity: 0,
          }}
        >
          <CompletionRings data={completionStats} />
        </div>

        {/* Top Content */}
        <div
          style={{
            animation: 'stats-fade-up 0.5s ease-out forwards',
            animationDelay: '320ms',
            opacity: 0,
          }}
        >
          <TopContent topAnime={topAnime} topManga={topManga} />
        </div>

        {/* Streaks & Fun */}
        <div
          style={{
            animation: 'stats-fade-up 0.5s ease-out forwards',
            animationDelay: '400ms',
            opacity: 0,
          }}
        >
          <StreaksAndFun streaks={streaks} patterns={patterns} binge={binge} />
        </div>
      </div>
    </div>
  )
}
