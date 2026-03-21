interface DetailTab {
  id: string
  label: string
  count?: number
}

interface DetailTabBarProps {
  tabs: DetailTab[]
  activeTab: string
  onTabChange: (tabId: string) => void
}

export function DetailTabBar({ tabs, activeTab, onTabChange }: DetailTabBarProps) {
  return (
    <div className="border-b border-[var(--color-glass-border)] overflow-x-auto scrollbar-hide">
      <div className="flex whitespace-nowrap">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative min-h-[44px] sm:min-h-0 flex items-center gap-1.5 -mb-px ${
              activeTab === tab.id
                ? 'text-[var(--color-accent-light)] border-b-2 border-[var(--color-accent-mid)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border-b-2 border-transparent'
            }`}
          >
            {tab.label}
            {tab.count != null && (
              <span className="text-xs opacity-60">({tab.count})</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
