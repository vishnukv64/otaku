/**
 * Downloads Route - Download Manager Page
 *
 * Displays all video downloads with progress tracking
 */

import { createFileRoute } from '@tanstack/react-router'
import { DownloadManager } from '@/components/player/DownloadManager'

export const Route = createFileRoute('/downloads')({
  component: DownloadsPage,
})

function DownloadsPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <DownloadManager isOpen={true} onClose={() => {}} />
    </div>
  )
}
