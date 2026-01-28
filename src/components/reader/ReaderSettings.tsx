/**
 * ReaderSettings - Settings panel for the manga reader
 * Styled with Netflix-inspired red and black accents
 */

import { X, Book, BookOpen, AlignJustify, Rows3, ArrowLeft, ArrowRight, Maximize, Square, RectangleVertical, Settings, RotateCcw } from 'lucide-react'
import { useReaderStore, ReadingMode, FitMode } from '@/store/readerStore'
import { cn } from '@/lib/utils'

interface ReaderSettingsProps {
  isOpen: boolean
  onClose: () => void
}

const readingModes: { value: ReadingMode; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'single', label: 'Single Page', icon: <Book className="w-5 h-5" />, description: 'One page at a time' },
  { value: 'double', label: 'Double Page', icon: <BookOpen className="w-5 h-5" />, description: 'Two pages side by side' },
  { value: 'vertical', label: 'Vertical Scroll', icon: <AlignJustify className="w-5 h-5" />, description: 'Scroll through pages' },
  { value: 'webtoon', label: 'Webtoon', icon: <Rows3 className="w-5 h-5" />, description: 'Seamless long strip' },
]

const fitModes: { value: FitMode; label: string; icon: React.ReactNode }[] = [
  { value: 'contain', label: 'Fit Screen', icon: <Maximize className="w-4 h-4" /> },
  { value: 'width', label: 'Fit Width', icon: <RectangleVertical className="w-4 h-4" /> },
  { value: 'height', label: 'Fit Height', icon: <Square className="w-4 h-4" /> },
  { value: 'original', label: 'Original', icon: <Square className="w-4 h-4" /> },
]

const backgroundColors = [
  { value: '#000000', label: 'Black' },
  { value: '#141414', label: 'Dark' },
  { value: '#1a1a1a', label: 'Charcoal' },
  { value: '#2d2d2d', label: 'Gray' },
  { value: '#ffffff', label: 'White' },
]

export function ReaderSettings({ isOpen, onClose }: ReaderSettingsProps) {
  const { settings, updateSettings, setReadingMode, setReadingDirection, setFitMode, resetSettings } = useReaderStore()

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="absolute right-0 top-0 h-full w-80 bg-[var(--color-bg-primary)] border-l border-[var(--color-bg-hover)] shadow-2xl overflow-y-auto scrollbar-hide"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'slideInRight 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-bg-hover)] bg-[var(--color-bg-secondary)] sticky top-0 z-10">
          <h2 className="text-lg font-bold flex items-center gap-2 text-white">
            <Settings className="w-5 h-5 text-[var(--color-accent-primary)]" />
            Reader Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--color-bg-hover)] rounded-lg transition-colors text-[var(--color-text-secondary)] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Reading Mode */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--color-accent-primary)] uppercase tracking-wide mb-3">
              Reading Mode
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {readingModes.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => setReadingMode(mode.value)}
                  className={cn(
                    'flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all',
                    settings.readingMode === mode.value
                      ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/20 text-white'
                      : 'border-[var(--color-bg-hover)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent-primary)]/50 hover:bg-[var(--color-bg-hover)]'
                  )}
                >
                  <div className={cn(
                    'transition-colors',
                    settings.readingMode === mode.value && 'text-[var(--color-accent-primary)]'
                  )}>
                    {mode.icon}
                  </div>
                  <span className="text-xs font-medium">{mode.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Reading Direction (only for single/double modes) */}
          {(settings.readingMode === 'single' || settings.readingMode === 'double') && (
            <section>
              <h3 className="text-sm font-semibold text-[var(--color-accent-primary)] uppercase tracking-wide mb-3">
                Reading Direction
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setReadingDirection('ltr')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all',
                    settings.readingDirection === 'ltr'
                      ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/20 text-white'
                      : 'border-[var(--color-bg-hover)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent-primary)]/50'
                  )}
                >
                  <ArrowRight className={cn(
                    'w-4 h-4',
                    settings.readingDirection === 'ltr' && 'text-[var(--color-accent-primary)]'
                  )} />
                  <span className="text-sm font-medium">LTR</span>
                </button>
                <button
                  onClick={() => setReadingDirection('rtl')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all',
                    settings.readingDirection === 'rtl'
                      ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/20 text-white'
                      : 'border-[var(--color-bg-hover)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent-primary)]/50'
                  )}
                >
                  <ArrowLeft className={cn(
                    'w-4 h-4',
                    settings.readingDirection === 'rtl' && 'text-[var(--color-accent-primary)]'
                  )} />
                  <span className="text-sm font-medium">RTL</span>
                </button>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                {settings.readingDirection === 'rtl' ? 'Manga style (right to left)' : 'Western style (left to right)'}
              </p>
            </section>
          )}

          {/* Fit Mode */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--color-accent-primary)] uppercase tracking-wide mb-3">
              Page Fit
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {fitModes.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => setFitMode(mode.value)}
                  className={cn(
                    'flex items-center justify-center gap-2 p-2.5 rounded-lg border-2 transition-all',
                    settings.fitMode === mode.value
                      ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/20 text-white'
                      : 'border-[var(--color-bg-hover)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent-primary)]/50'
                  )}
                >
                  <span className={cn(
                    settings.fitMode === mode.value && 'text-[var(--color-accent-primary)]'
                  )}>
                    {mode.icon}
                  </span>
                  <span className="text-xs font-medium">{mode.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Background Color */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--color-accent-primary)] uppercase tracking-wide mb-3">
              Background
            </h3>
            <div className="flex gap-2">
              {backgroundColors.map((color) => (
                <button
                  key={color.value}
                  onClick={() => updateSettings({ backgroundColor: color.value })}
                  title={color.label}
                  className={cn(
                    'w-10 h-10 rounded-lg border-2 transition-all relative',
                    settings.backgroundColor === color.value
                      ? 'border-[var(--color-accent-primary)] ring-2 ring-[var(--color-accent-primary)]/30 scale-110'
                      : 'border-[var(--color-bg-hover)] hover:border-[var(--color-text-muted)]'
                  )}
                  style={{ backgroundColor: color.value }}
                >
                  {color.value === '#ffffff' && (
                    <div className="absolute inset-0.5 rounded border border-gray-200" />
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* Toggles */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--color-accent-primary)] uppercase tracking-wide mb-3">
              Display Options
            </h3>

            <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer group">
              <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-white transition-colors">
                Show Page Numbers
              </span>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={settings.showPageNumbers}
                  onChange={(e) => updateSettings({ showPageNumbers: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-10 h-6 bg-[var(--color-bg-hover)] rounded-full peer peer-checked:bg-[var(--color-accent-primary)] transition-colors" />
                <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
              </div>
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer group">
              <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-white transition-colors">
                Show Progress Bar
              </span>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={settings.showProgressBar}
                  onChange={(e) => updateSettings({ showProgressBar: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-10 h-6 bg-[var(--color-bg-hover)] rounded-full peer peer-checked:bg-[var(--color-accent-primary)] transition-colors" />
                <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
              </div>
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer group">
              <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-white transition-colors">
                Auto-advance Chapter
              </span>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={settings.autoAdvanceChapter}
                  onChange={(e) => updateSettings({ autoAdvanceChapter: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-10 h-6 bg-[var(--color-bg-hover)] rounded-full peer peer-checked:bg-[var(--color-accent-primary)] transition-colors" />
                <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
              </div>
            </label>
          </section>

          {/* Preload Pages */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--color-accent-primary)] uppercase tracking-wide">
                Preload Pages
              </h3>
              <span className="text-sm font-bold text-white bg-[var(--color-accent-primary)] px-2 py-0.5 rounded">
                {settings.preloadPages}
              </span>
            </div>
            <div className="relative">
              <input
                type="range"
                min={1}
                max={10}
                value={settings.preloadPages}
                onChange={(e) => updateSettings({ preloadPages: parseInt(e.target.value, 10) })}
                className="w-full h-2 bg-[var(--color-bg-hover)] rounded-lg appearance-none cursor-pointer slider-accent"
                style={{
                  background: `linear-gradient(to right, var(--color-accent-primary) 0%, var(--color-accent-primary) ${(settings.preloadPages - 1) / 9 * 100}%, var(--color-bg-hover) ${(settings.preloadPages - 1) / 9 * 100}%, var(--color-bg-hover) 100%)`
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-[var(--color-text-muted)] mt-1">
              <span>1</span>
              <span>5</span>
              <span>10</span>
            </div>
          </section>

          {/* Reset */}
          <section className="pt-4 border-t border-[var(--color-bg-hover)]">
            <button
              onClick={resetSettings}
              className="w-full flex items-center justify-center gap-2 p-3 text-sm text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] rounded-lg transition-all border border-[var(--color-bg-hover)] hover:border-[var(--color-accent-primary)]/50"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to Defaults
            </button>
          </section>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        .slider-accent::-webkit-slider-thumb {
          appearance: none;
          width: 18px;
          height: 18px;
          background: white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
          transition: transform 0.15s ease;
        }

        .slider-accent::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }

        .slider-accent::-moz-range-thumb {
          width: 18px;
          height: 18px;
          background: white;
          border-radius: 50%;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        }
      `}</style>
    </div>
  )
}
