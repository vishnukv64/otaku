import { type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { OfflineHub } from '@/components/offline/OfflineHub'

// Routes that work without internet (local data only)
const OFFLINE_SAFE_ROUTES = [
  '/library',
  '/settings',
  '/downloads',
  '/watch',
  '/read',
  '/logs',
  '/notifications',
  '/stats',
]

function isOfflineSafe(pathname: string): boolean {
  return OFFLINE_SAFE_ROUTES.some((route) => pathname.startsWith(route))
}

interface OfflineGuardProps {
  children: ReactNode
}

export function OfflineGuard({ children }: OfflineGuardProps) {
  const { isOnline } = useNetworkStatus()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  // If online, always render children
  if (isOnline) {
    return <>{children}</>
  }

  // If offline but on a safe route, render children
  if (isOfflineSafe(currentPath)) {
    return <>{children}</>
  }

  // Offline on an internet-required route — show the hub
  return (
    <div className="animate-in fade-in duration-300">
      <OfflineHub />
    </div>
  )
}
