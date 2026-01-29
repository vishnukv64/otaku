/**
 * PageSlider - Page navigation slider component
 */

import { cn } from '@/lib/utils'

interface PageSliderProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
  direction?: 'ltr' | 'rtl'
}

export function PageSlider({
  currentPage,
  totalPages,
  onPageChange,
  className,
  direction = 'ltr',
}: PageSliderProps) {
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10)
    onPageChange(value)
  }

  const progress = totalPages > 0 ? ((currentPage - 1) / (totalPages - 1)) * 100 : 0

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="text-sm text-muted-foreground min-w-[3ch] text-right">
        {direction === 'rtl' ? totalPages : 1}
      </span>

      <div className="relative flex-1">
        <input
          type="range"
          min={1}
          max={totalPages || 1}
          value={currentPage}
          onChange={handleSliderChange}
          className={cn(
            'w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer',
            'slider-thumb:appearance-none slider-thumb:w-4 slider-thumb:h-4',
            'slider-thumb:bg-primary slider-thumb:rounded-full slider-thumb:cursor-pointer',
            '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4',
            '[&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer',
            '[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4',
            '[&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0',
            direction === 'rtl' && 'direction-rtl'
          )}
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${progress}%, hsl(var(--muted)) ${progress}%, hsl(var(--muted)) 100%)`,
          }}
        />
      </div>

      <span className="text-sm text-muted-foreground min-w-[3ch]">
        {direction === 'rtl' ? 1 : totalPages}
      </span>
    </div>
  )
}
