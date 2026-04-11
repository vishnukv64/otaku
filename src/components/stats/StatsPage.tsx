/**
 * StatsPage — main orchestrator that loads all data and renders sections.
 * Organized into 5 logical groups with sticky anchor navigation.
 * Fires all API calls in parallel; each section renders as data arrives.
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import {
  getWatchStatsSummary,
  getReadingStatsSummary,
  getCompletionStats,
  getTopWatchedAnime,
  getTopReadManga,
  getStreakStats,
  getActivityPatterns,
  getBingeStats,
  getCompletionRate,
  getScoreDistribution,
  getContentTypeBreakdown,
  getSeasonalTrends,
  getWatchCompletionRate,
  getFavoritesStats,
  getTimeToCompletion,
  getYearDistribution,
  getMilestones,
  getMonthlyRecap,
  getRatingComparison,
  getGenreStats,
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
  CompletionRateStats,
  ScoreDistribution as ScoreDistributionData,
  ContentTypeEntry,
  SeasonEntry,
  WatchCompletionRateStats,
  FavoritesStats,
  TimeToCompletion as TimeToCompletionData,
  YearDistEntry,
  MilestoneStats,
  MonthlyRecap as MonthlyRecapData,
  RatingComparisonEntry,
  GenreStat,
} from '@/utils/tauri-commands'

import { SummaryCards } from './SummaryCards'
import { ActivityChart } from './ActivityChart'
import { GenreDistribution } from './GenreDistribution'
import { CompletionRings } from './CompletionRings'
import { TopContent } from './TopContent'
import { StreaksAndFun } from './StreaksAndFun'
import { PeakHoursHeatmap } from './PeakHoursHeatmap'
import { CompletionFunnel } from './CompletionFunnel'
import { ScoreDistribution } from './ScoreDistribution'
import { ContentTypeBreakdown } from './ContentTypeBreakdown'
import { SeasonalTrends } from './SeasonalTrends'
import { WatchCompletionRate } from './WatchCompletionRate'
import { FavoritesOverview } from './FavoritesOverview'
import { TimeToCompletion } from './TimeToCompletion'
import { YearDistribution } from './YearDistribution'
import { Milestones } from './Milestones'
import { MonthlyRecap } from './MonthlyRecap'
import { RatingComparison } from './RatingComparison'
import { YourType } from './YourType'

// ── Nav sections ──────────────────────────────────────────

const NAV_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'library', label: 'Library' },
  { id: 'taste', label: 'Taste' },
  { id: 'achievements', label: 'Achievements' },
] as const

type SectionId = (typeof NAV_SECTIONS)[number]['id']

// ── Animated wrapper ──────────────────────────────────────

function FadeIn({ delay, children, className }: { delay: number; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{ animation: 'stats-fade-up 0.5s ease-out forwards', animationDelay: `${delay}ms`, opacity: 0 }}
    >
      {children}
    </div>
  )
}

// ── Section group ─────────────────────────────────────────

function SectionGroup({
  id,
  title,
  subtitle,
  sectionRef,
  children,
}: {
  id: string
  title: string
  subtitle: string
  sectionRef: (el: HTMLElement | null) => void
  children: React.ReactNode
}) {
  return (
    <section id={id} ref={sectionRef} className="scroll-mt-24">
      <div className="pt-8 pb-2 border-t border-[var(--color-border,rgba(255,255,255,0.06))]">
        <h2 className="text-xl font-bold text-[var(--color-text-primary)]">{title}</h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>
      </div>
      <div className="space-y-6 mt-4">{children}</div>
    </section>
  )
}

// ── Main component ────────────────────────────────────────

export function StatsPage() {
  // ── State ───────────────────────────────────────────────
  const [watchStats, setWatchStats] = useState<WatchStatsSummary | null>(null)
  const [readingStats, setReadingStats] = useState<ReadingStatsSummary | null>(null)
  const [completionStats, setCompletionStats] = useState<CompletionStats | null>(null)
  const [topAnime, setTopAnime] = useState<TopWatchedEntry[] | null>(null)
  const [topManga, setTopManga] = useState<TopReadEntry[] | null>(null)
  const [streaks, setStreaks] = useState<StreakStats | null>(null)
  const [patterns, setPatterns] = useState<ActivityPatterns | null>(null)
  const [binge, setBinge] = useState<BingeStats | null>(null)
  const [completionRate, setCompletionRate] = useState<CompletionRateStats | null>(null)
  const [scores, setScores] = useState<ScoreDistributionData | null>(null)
  const [contentTypes, setContentTypes] = useState<ContentTypeEntry[] | null>(null)
  const [seasons, setSeasons] = useState<SeasonEntry[] | null>(null)
  const [watchCompletion, setWatchCompletion] = useState<WatchCompletionRateStats | null>(null)
  const [favorites, setFavorites] = useState<FavoritesStats | null>(null)
  const [timeToComplete, setTimeToComplete] = useState<TimeToCompletionData | null>(null)
  const [yearDist, setYearDist] = useState<YearDistEntry[] | null>(null)
  const [milestones, setMilestones] = useState<MilestoneStats | null>(null)
  const [monthlyRecap, setMonthlyRecap] = useState<MonthlyRecapData | null>(null)
  const [ratingComparison, setRatingComparison] = useState<RatingComparisonEntry[] | null>(null)
  const [topGenres, setTopGenres] = useState<GenreStat[] | null>(null)

  // ── Scroll-spy ──────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<SectionId>('overview')
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())

  const setSectionRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el)
    else sectionRefs.current.delete(id)
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible section
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) {
          setActiveSection(visible[0].target.id as SectionId)
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )

    // Small delay to let refs populate
    const timer = setTimeout(() => {
      sectionRefs.current.forEach((el) => observer.observe(el))
    }, 100)

    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  const scrollTo = (id: string) => {
    const el = sectionRefs.current.get(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Data fetching ───────────────────────────────────────
  useEffect(() => {
    const err = (name: string) => (e: unknown) => console.error(`Stats [${name}] failed:`, e)

    getWatchStatsSummary().then(setWatchStats).catch(err('watchStats'))
    getReadingStatsSummary().then(setReadingStats).catch(err('readingStats'))
    getCompletionStats().then(setCompletionStats).catch(err('completion'))
    getTopWatchedAnime(5).then(setTopAnime).catch(err('topAnime'))
    getTopReadManga(5).then(setTopManga).catch(err('topManga'))
    getStreakStats().then(setStreaks).catch(err('streaks'))
    getActivityPatterns().then(setPatterns).catch(err('patterns'))
    getBingeStats().then(setBinge).catch(err('binge'))
    getCompletionRate().then(setCompletionRate).catch(err('completionRate'))
    getScoreDistribution().then(setScores).catch(err('scores'))
    getContentTypeBreakdown().then(setContentTypes).catch(err('contentTypes'))
    getSeasonalTrends().then(setSeasons).catch(err('seasons'))
    getWatchCompletionRate().then(setWatchCompletion).catch(err('watchCompletion'))
    getFavoritesStats().then(setFavorites).catch(err('favorites'))
    getTimeToCompletion().then(setTimeToComplete).catch(err('timeToComplete'))
    getYearDistribution().then(setYearDist).catch(err('yearDist'))
    getMilestones().then(setMilestones).catch(err('milestones'))
    getMonthlyRecap().then(setMonthlyRecap).catch(err('monthlyRecap'))
    getRatingComparison().then(setRatingComparison).catch(err('ratingComparison'))
    getGenreStats().then(setTopGenres).catch(err('topGenres'))
  }, [])

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 sm:px-6 lg:px-8 3xl:px-12 py-8 max-w-4k mx-auto">
      <div className="max-w-6xl mx-auto">
        {/* ── Page Header ── */}
        <div className="mb-6">
          <h1 className="text-[2.5rem] font-extrabold font-display mb-1.5 bg-gradient-to-br from-[var(--color-text-primary)] to-[var(--color-text-secondary)] bg-clip-text text-transparent">
            Activity Statistics
          </h1>
          <p className="text-[var(--color-text-muted)] text-[0.9375rem]">
            Your anime and manga activity at a glance
          </p>
        </div>

        {/* ── Sticky Nav ── */}
        <nav className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 3xl:-mx-12 px-4 sm:px-6 lg:px-8 3xl:px-12 py-3 mb-4 backdrop-blur-xl bg-[var(--color-bg-primary,rgb(10,10,10))]/80 border-b border-[var(--color-border,rgba(255,255,255,0.06))]">
          <div className="max-w-6xl mx-auto flex gap-1 overflow-x-auto scrollbar-none">
            {NAV_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                onClick={() => scrollTo(sec.id)}
                className={`
                  px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200
                  ${
                    activeSection === sec.id
                      ? 'bg-[var(--color-accent-primary)] text-white shadow-sm shadow-[var(--color-accent-primary)]/25'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
                  }
                `}
              >
                {sec.label}
              </button>
            ))}
          </div>
        </nav>

        {/* ═══════════════════ OVERVIEW ═══════════════════ */}
        <SectionGroup
          id="overview"
          title="Overview"
          subtitle="The big picture"
          sectionRef={setSectionRef('overview')}
        >
          <FadeIn delay={0}>
            <SummaryCards watchStats={watchStats} readingStats={readingStats} />
          </FadeIn>
          <FadeIn delay={80}>
            <PeakHoursHeatmap />
          </FadeIn>
          <FadeIn delay={160}>
            <MonthlyRecap data={monthlyRecap} />
          </FadeIn>
        </SectionGroup>

        {/* ═══════════════════ ACTIVITY ═══════════════════ */}
        <SectionGroup
          id="activity"
          title="Activity"
          subtitle="When and how much you watch"
          sectionRef={setSectionRef('activity')}
        >
          <FadeIn delay={0}>
            <ActivityChart />
          </FadeIn>
          <FadeIn delay={80}>
            <StreaksAndFun streaks={streaks} patterns={patterns} binge={binge} />
          </FadeIn>
        </SectionGroup>

        {/* ═══════════════════ LIBRARY ════════════════════ */}
        <SectionGroup
          id="library"
          title="Library"
          subtitle="Your collection and finish rate"
          sectionRef={setSectionRef('library')}
        >
          <FadeIn delay={0} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CompletionRings data={completionStats} />
            <CompletionFunnel data={completionRate} />
          </FadeIn>
          <FadeIn delay={80} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <WatchCompletionRate data={watchCompletion} />
            <TimeToCompletion data={timeToComplete} />
          </FadeIn>
          <FadeIn delay={160}>
            <TopContent topAnime={topAnime} topManga={topManga} />
          </FadeIn>
        </SectionGroup>

        {/* ═══════════════════ TASTE ══════════════════════ */}
        <SectionGroup
          id="taste"
          title="Taste"
          subtitle="Your preferences and patterns"
          sectionRef={setSectionRef('taste')}
        >
          <FadeIn delay={0}>
            <GenreDistribution />
          </FadeIn>
          <FadeIn delay={80} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ContentTypeBreakdown data={contentTypes} />
            <FavoritesOverview data={favorites} />
          </FadeIn>
          <FadeIn delay={160} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ScoreDistribution data={scores} />
            <RatingComparison data={ratingComparison} />
          </FadeIn>
          <FadeIn delay={240} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SeasonalTrends data={seasons} />
            <YearDistribution data={yearDist} />
          </FadeIn>
        </SectionGroup>

        {/* ═══════════════════ ACHIEVEMENTS ═══════════════ */}
        <SectionGroup
          id="achievements"
          title="Achievements"
          subtitle="Your milestones and personality"
          sectionRef={setSectionRef('achievements')}
        >
          <FadeIn delay={0}>
            <Milestones data={milestones} />
          </FadeIn>
          <FadeIn delay={80}>
            <YourType topGenres={topGenres} scores={scores} />
          </FadeIn>
        </SectionGroup>

        {/* Bottom spacer */}
        <div className="h-16" />
      </div>
    </div>
  )
}
