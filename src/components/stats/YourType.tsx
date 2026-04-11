/**
 * YourType — a fun "personality type" card derived from genre preferences
 * and rating patterns. Purely frontend logic, no backend call needed.
 */

import { Sparkles } from 'lucide-react'
import type { GenreStat, ScoreDistribution } from '@/utils/tauri-commands'

interface YourTypeProps {
  topGenres: GenreStat[] | null
  scores: ScoreDistribution | null
}

interface OtakuType {
  name: string
  description: string
  gradient: string
}

function deriveType(topGenre: string): OtakuType {
  const g = topGenre.toLowerCase()

  if (g === 'action' || g === 'adventure') {
    return {
      name: 'The Thrill Seeker',
      description:
        'You live for the adrenaline rush. If there are no explosions in the first five minutes, you are already reaching for the next episode.',
      gradient: 'linear-gradient(135deg, #1a0a0a 0%, #2d1111 40%, #1a0505 100%)',
    }
  }
  if (g === 'romance' || g === 'drama') {
    return {
      name: 'The Romantic',
      description:
        'You feel every confession, every heartbreak, every lingering glance. Your tissue box is always within reach.',
      gradient: 'linear-gradient(135deg, #1a0a14 0%, #2d1128 40%, #140510 100%)',
    }
  }
  if (g === 'comedy' || g === 'slice of life') {
    return {
      name: 'The Chill Vibes Enjoyer',
      description:
        'Why stress when you can laugh? You appreciate the beauty in everyday life and a good running gag.',
      gradient: 'linear-gradient(135deg, #0a1a0f 0%, #112d18 40%, #051408 100%)',
    }
  }
  if (g === 'horror' || g === 'thriller' || g === 'mystery') {
    return {
      name: 'The Detective',
      description:
        'You are always three steps ahead, piecing together clues before the reveal. Nothing gets past you.',
      gradient: 'linear-gradient(135deg, #0a0a1a 0%, #11112d 40%, #050514 100%)',
    }
  }
  if (g === 'fantasy' || g === 'sci-fi') {
    return {
      name: 'The World Builder',
      description:
        'Ordinary reality is overrated. You crave expansive lore, magic systems, and civilizations beyond imagination.',
      gradient: 'linear-gradient(135deg, #0f0a1a 0%, #1a112d 40%, #0a0514 100%)',
    }
  }
  if (g === 'sports') {
    return {
      name: 'The Competitor',
      description:
        'Win or lose, it is all about the grind. You find inspiration in every training arc and last-second comeback.',
      gradient: 'linear-gradient(135deg, #1a140a 0%, #2d2211 40%, #141005 100%)',
    }
  }
  if (g === 'music') {
    return {
      name: 'The Audiophile',
      description:
        'The soundtrack hits different. You can tell a great anime by its opening theme alone.',
      gradient: 'linear-gradient(135deg, #0a1a1a 0%, #112d2d 40%, #051414 100%)',
    }
  }

  return {
    name: 'The Eclectic',
    description:
      'You refuse to be boxed in. From shonen to seinen, mecha to iyashikei — your taste knows no bounds.',
    gradient: 'linear-gradient(135deg, #120a1a 0%, #1e112d 40%, #0d0514 100%)',
  }
}

function getCriticLabel(avg: number): string {
  if (avg > 7.5) return 'generous'
  if (avg >= 5) return 'fair'
  return 'tough'
}

export function YourType({ topGenres, scores }: YourTypeProps) {
  if (!topGenres || topGenres.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Your Otaku Type</h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-2">
          Watch or read more to discover your type!
        </p>
      </div>
    )
  }

  const topGenre = topGenres[0].genre
  const otakuType = deriveType(topGenre)
  const top3 = topGenres.slice(0, 3).map((g) => g.genre)

  return (
    <div
      className="rounded-xl p-6 relative overflow-hidden"
      style={{ background: otakuType.gradient }}
    >
      {/* Decorative sparkle pattern */}
      <div className="absolute top-4 right-4 text-white/[0.06]">
        <Sparkles size={80} strokeWidth={1} />
      </div>
      <div className="absolute bottom-3 left-3 text-white/[0.04] rotate-45">
        <Sparkles size={48} strokeWidth={1} />
      </div>

      {/* Section title */}
      <div className="relative mb-4">
        <p className="text-xs font-medium uppercase tracking-widest text-white/40 mb-3">
          Your Otaku Type
        </p>

        {/* Type name */}
        <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">
          {otakuType.name}
        </h2>

        {/* Description */}
        <p className="text-sm text-white/60 leading-relaxed max-w-md">
          {otakuType.description}
        </p>
      </div>

      {/* Top genres */}
      <div className="relative mt-5 pt-4 border-t border-white/[0.08]">
        <p className="text-xs text-white/40 mb-2">Based on your top genres</p>
        <div className="flex flex-wrap gap-2">
          {top3.map((genre) => (
            <span
              key={genre}
              className="px-3 py-1 text-xs font-medium rounded-full bg-white/[0.08] text-white/70"
            >
              {genre}
            </span>
          ))}
        </div>
      </div>

      {/* Rating critic line */}
      {scores && scores.total_rated > 0 && (
        <div className="relative mt-4">
          <p className="text-xs text-white/40">
            You rate{' '}
            <span className="text-white/70 font-semibold">{scores.average_score.toFixed(1)}</span>{' '}
            on average —{' '}
            <span className="text-white/70 font-semibold">{getCriticLabel(scores.average_score)}</span>{' '}
            critic
          </p>
        </div>
      )}
    </div>
  )
}
