import { useState, useEffect, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'

interface NetworkStatus {
  isOnline: boolean
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const wasOfflineRef = useRef(false)

  const handleOnline = useCallback(() => {
    setIsOnline(true)
    if (wasOfflineRef.current) {
      toast.success("You're back online!", { duration: 3000 })
      wasOfflineRef.current = false
    }
  }, [])

  const handleOffline = useCallback(() => {
    setIsOnline(false)
    wasOfflineRef.current = true
  }, [])

  useEffect(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [handleOnline, handleOffline])

  return { isOnline }
}
