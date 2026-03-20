import { createFileRoute } from '@tanstack/react-router'
import { SchedulePage } from '@/components/schedule/SchedulePage'

export const Route = createFileRoute('/schedule')({
  component: SchedulePage,
})
