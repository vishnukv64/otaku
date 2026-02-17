/**
 * Auto Update Check Hook
 *
 * Automatically checks for updates on app launch and periodically.
 * Shows a notification via the NotificationCenter when an update is available.
 * Uses database to track check timestamps and notified versions.
 */

import { useEffect, useRef } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { getVersion } from '@tauri-apps/api/app'
import { useUpdateStore } from '@/store/updateStore'
import { useNotificationStore } from '@/store/notificationStore'
import { getUpdateCheckInfo, setUpdateCheckInfo } from '@/utils/tauri-commands'
import { isMobile } from '@/utils/platform'

// Check interval: 24 hours in milliseconds
const CHECK_INTERVAL = 24 * 60 * 60 * 1000

export function useAutoUpdateCheck() {
  const { setStatus, setUpdateInfo, setLastChecked } = useUpdateStore()
  const checkInProgressRef = useRef(false)

  useEffect(() => {
    // Updater plugin is not registered on Android — skip entirely
    if (isMobile()) return
    let intervalId: ReturnType<typeof setInterval> | null = null

    const checkForUpdates = async (isInitialCheck = false) => {
      // Prevent concurrent checks
      if (checkInProgressRef.current) return
      checkInProgressRef.current = true

      try {
        // Get update check info from database
        const checkInfo = await getUpdateCheckInfo()
        const now = Date.now()

        // Skip if we checked within the last 24 hours (except for initial check which has a 1 hour grace)
        const minInterval = isInitialCheck ? 60 * 60 * 1000 : CHECK_INTERVAL // 1 hour for initial, 24 hours for periodic
        if (checkInfo.last_check && now - checkInfo.last_check < minInterval) {
          checkInProgressRef.current = false
          return
        }

        const currentVersion = await getVersion()
        const update = await check()

        // Update last check time in database
        await setUpdateCheckInfo(now)
        setLastChecked(now)

        if (update) {
          setUpdateInfo({
            version: update.version,
            currentVersion,
            date: update.date,
            body: update.body,
          })
          setStatus('available')

          // Only show notification if we haven't notified about this version yet
          if (checkInfo.notified_version !== update.version) {
            // Mark this version as notified in database
            await setUpdateCheckInfo(undefined, update.version)

            // Add notification to the NotificationCenter
            useNotificationStore.getState().addNotification({
              id: `update-${update.version}`,
              type: 'info',
              title: 'Update Available',
              message: `Version ${update.version} is available. You're currently on v${currentVersion}.`,
              timestamp: now,
              read: false,
              dismissed: false,
              source: 'updater',
              action: {
                label: 'View Update',
                route: '/settings',
              },
              metadata: {
                version: update.version,
                currentVersion,
                date: update.date,
              },
            })
          }
        } else {
          setUpdateInfo({
            version: currentVersion,
            currentVersion,
          })
          setStatus('up-to-date')
        }
      } catch (err) {
        // Silently fail for auto-checks - don't disrupt user experience
        console.error('Auto update check failed:', err)
      } finally {
        checkInProgressRef.current = false
      }
    }

    // Initial check on mount (delayed to not block app startup)
    const initialCheckTimeout = setTimeout(() => {
      checkForUpdates(true)
    }, 5000) // Wait 5 seconds after app launch

    // Periodic check every 24 hours
    intervalId = setInterval(() => {
      checkForUpdates(false)
    }, CHECK_INTERVAL)

    return () => {
      clearTimeout(initialCheckTimeout)
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [setStatus, setUpdateInfo, setLastChecked])
}
