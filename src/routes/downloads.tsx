/**
 * Downloads Route - Download Manager Page
 *
 * Renders DownloadPageContent directly as a page (no modal chrome).
 * On mobile, TopNav navigates here instead of opening a modal overlay.
 * On desktop, this route also works as a standalone page.
 */

import { createFileRoute } from '@tanstack/react-router'
import { DownloadPageContent } from '@/components/player/DownloadManager'

export const Route = createFileRoute('/downloads')({
  component: DownloadsPage,
})

function DownloadsPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <DownloadPageContent />
    </div>
  )
}
