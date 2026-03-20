import { useRef, useEffect } from 'react'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export type DayKey = (typeof DAYS)[number]

/** Get today's day key (e.g., "monday") */
export function getTodayKey(): DayKey {
  const jsDay = new Date().getDay() // 0=Sun, 1=Mon...
  // Map: Sun(0)->sunday, Mon(1)->monday, ...
  const mapped = jsDay === 0 ? 6 : jsDay - 1
  return DAYS[mapped]
}

interface DayTabsProps {
  activeDay: DayKey
  onDayChange: (day: DayKey) => void
  counts?: Partial<Record<DayKey, number>>
}

export function DayTabs({ activeDay, onDayChange, counts }: DayTabsProps): JSX.Element {
  const todayKey = getTodayKey()
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  // Scroll active tab into view on mount
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeDay])

  return (
    <div ref={scrollRef} className="flex gap-1 overflow-x-auto scrollbar-hide px-1 py-2">
      {DAYS.map((day, i) => {
        const isActive = day === activeDay
        const isToday = day === todayKey
        const count = counts?.[day]

        return (
          <button
            key={day}
            ref={isActive ? activeRef : undefined}
            onClick={() => onDayChange(day)}
            className={`
              relative flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${isActive
                ? 'bg-[#e50914] text-white'
                : 'bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.6)] hover:bg-[rgba(255,255,255,0.1)] hover:text-white'
              }
            `}
          >
            <span className="flex items-center gap-1.5">
              {DAY_LABELS[i]}
              {isToday && !isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#e50914]" />
              )}
              {count !== undefined && (
                <span className={`text-xs ${isActive ? 'text-white/70' : 'text-[rgba(255,255,255,0.4)]'}`}>
                  {count}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
