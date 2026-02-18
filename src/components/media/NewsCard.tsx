import { ExternalLink } from 'lucide-react'
import type { JikanNews } from '@/utils/tauri-commands'

interface NewsListProps {
  news: JikanNews[]
  loading?: boolean
}

function getNewsImage(item: JikanNews): string | undefined {
  const imgs = item.images
  if (!imgs) return undefined
  return imgs.webp?.image_url || imgs.jpg?.image_url || undefined
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function openUrl(url: string) {
  // Use Tauri's shell open for external links
  try {
    window.open(url, '_blank')
  } catch {
    // Fallback
  }
}

export function NewsList({ news, loading }: NewsListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3 p-3 bg-[var(--color-bg-secondary)] rounded-lg animate-pulse">
            <div className="w-20 sm:w-[120px] lg:w-40 aspect-video bg-[var(--color-bg-hover)] rounded shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-[var(--color-bg-hover)] rounded w-3/4" />
              <div className="h-3 bg-[var(--color-bg-hover)] rounded w-full" />
              <div className="h-3 bg-[var(--color-bg-hover)] rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (news.length === 0) {
    return (
      <p className="text-center py-8 text-[var(--color-text-secondary)]">
        No news available
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {news.map((item) => {
        const imgUrl = getNewsImage(item)

        return (
          <button
            key={item.mal_id}
            onClick={() => item.url && openUrl(item.url)}
            className="w-full flex gap-3 p-3 bg-[var(--color-bg-secondary)] rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors text-left min-h-[48px]"
          >
            {imgUrl && (
              <div className="w-20 sm:w-[120px] lg:w-40 aspect-video rounded overflow-hidden bg-[var(--color-bg-hover)] shrink-0">
                <img
                  src={imgUrl}
                  alt={item.title || 'News'}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm sm:text-base font-medium text-[var(--color-text-primary)] line-clamp-2">
                {item.title || 'Untitled'}
              </h3>
              {item.excerpt && (
                <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] mt-1 line-clamp-2 sm:line-clamp-3 lg:line-clamp-4">
                  {item.excerpt}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1.5 text-xs text-[var(--color-text-muted)]">
                {item.date && <span>{formatDate(item.date)}</span>}
                {item.author_username && (
                  <>
                    <span>-</span>
                    <span>{item.author_username}</span>
                  </>
                )}
                {item.comments != null && (
                  <>
                    <span>-</span>
                    <span>{item.comments} comments</span>
                  </>
                )}
                <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
