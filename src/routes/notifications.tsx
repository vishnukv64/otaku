/**
 * Notifications Route - Notification Center Page
 *
 * Renders NotificationPageContent directly as a page (no modal chrome).
 * On mobile, TopNav navigates here instead of opening a modal overlay.
 * On desktop, this route also works as a standalone page.
 */

import { createFileRoute } from '@tanstack/react-router'
import { NotificationPageContent } from '@/components/notifications/MobileNotificationCenter'

export const Route = createFileRoute('/notifications')({
  component: NotificationsPage,
})

function NotificationsPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <NotificationPageContent />
    </div>
  )
}
