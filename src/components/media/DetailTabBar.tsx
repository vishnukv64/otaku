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
    <div className="border-b border-[var(--color-bg-hover)] overflow-x-auto scrollbar-hide">
      <div className="flex whitespace-nowrap">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2 sm:py-2 text-sm font-medium transition-colors relative min-h-[44px] sm:min-h-0 flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'text-[var(--color-accent-primary)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {tab.label}
            {tab.count != null && (
              <span className="text-xs opacity-60">({tab.count})</span>
            )}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-accent-primary)]" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
