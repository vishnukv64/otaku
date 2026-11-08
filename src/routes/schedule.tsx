import { createFileRoute } from '@tanstack/react-router'
import { SchedulePage } from '@/components/schedule/SchedulePage'
import { MobileSchedule } from '@/components/schedule/MobileSchedule'
import { isMobile } from '@/utils/platform'

function ScheduleRoute() {
  return isMobile() ? <MobileSchedule /> : <SchedulePage />
}

export const Route = createFileRoute('/schedule')({
  component: ScheduleRoute,
})
