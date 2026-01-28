/**
 * Application Logs Route
 *
 * Real-time log viewer for debugging.
 * Uses SSE (Tauri events) instead of polling for auto-refresh.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState, useRef, useCallback } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getAppLogs, clearAppLogs, getLogFilePath, startLogsStream, stopLogsStream, APP_LOGS_EVENT, type LogEntry } from '../utils/tauri-commands'
import { ArrowLeft, RefreshCw, Trash2, FolderOpen, Download, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import { invoke } from '@tauri-apps/api/core'

export const Route = createFileRoute('/logs')({
  component: LogsScreen,
})

type LogLevel = 'all' | 'error' | 'warn' | 'info' | 'debug'

function LogsScreen() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [filter, setFilter] = useState<LogLevel>('all')
  const [logFilePath, setLogFilePath] = useState<string>('')
  const logsEndRef = useRef<HTMLDivElement>(null)

  const loadLogs = useCallback(async () => {
    try {
      const entries = await getAppLogs(500)
      setLogs(entries)
    } catch (error) {
      console.error('Failed to load logs:', error)
      toast.error(`Failed to load logs: ${error}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadLogFilePath = async () => {
    try {
      const path = await getLogFilePath()
      setLogFilePath(path)
    } catch (error) {
      console.error('Failed to get log file path:', error)
    }
  }

  // Initial load
  useEffect(() => {
    loadLogs()
    loadLogFilePath()
  }, [loadLogs])

  // SSE-based auto-refresh
  useEffect(() => {
    if (!autoRefresh) return

    let unlisten: UnlistenFn | null = null
    let isMounted = true

    const setup = async () => {
      // Set up event listener for log updates
      unlisten = await listen<LogEntry[]>(APP_LOGS_EVENT, (event) => {
        if (isMounted) {
          setLogs(event.payload)
        }
      })

      // Start the logs stream
      try {
        await startLogsStream()
      } catch (err) {
        console.error('Failed to start logs stream:', err)
      }
    }

    setup()

    return () => {
      isMounted = false
      if (unlisten) {
        unlisten()
      }
      // Stop the stream when auto-refresh is disabled
      stopLogsStream().catch(console.error)
    }
  }, [autoRefresh])

  // Scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoRefresh && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoRefresh])

  const handleClearLogs = async () => {
    try {
      await clearAppLogs()
      setLogs([])
      toast.success('Logs cleared')
    } catch (error) {
      toast.error(`Failed to clear logs: ${error}`)
    }
  }

  const handleOpenLogFolder = async () => {
    if (!logFilePath) return

    try {
      // Get the directory containing the log file
      const dirPath = logFilePath.substring(0, logFilePath.lastIndexOf('/'))
      await invoke('plugin:shell|open', { path: dirPath })
    } catch (error) {
      toast.error(`Failed to open folder: ${error}`)
    }
  }

  const handleExportLogs = () => {
    const content = logs
      .map((log) => `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n')

    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `otaku-logs-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Logs exported')
  }

  const filteredLogs = logs.filter((log) => {
    if (filter === 'all') return true
    return log.level.toLowerCase() === filter
  })

  const getLevelColor = (level: string): string => {
    switch (level.toLowerCase()) {
      case 'error':
        return 'text-red-400'
      case 'warn':
        return 'text-yellow-400'
      case 'info':
        return 'text-blue-400'
      case 'debug':
        return 'text-gray-400'
      default:
        return 'text-[var(--color-text-secondary)]'
    }
  }

  const getLevelBg = (level: string): string => {
    switch (level.toLowerCase()) {
      case 'error':
        return 'bg-red-500/10'
      case 'warn':
        return 'bg-yellow-500/10'
      default:
        return ''
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)] flex flex-col">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="max-w-4k mx-auto px-4 3xl:px-12 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to="/settings"
                className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <ArrowLeft size={20} className="text-[var(--color-text-secondary)]" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
                  Application Logs
                </h1>
                <p className="text-sm text-[var(--color-text-tertiary)]">
                  {logFilePath || 'Loading...'} {autoRefresh && '(SSE enabled)'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Filter Dropdown */}
              <div className="relative">
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as LogLevel)}
                  className="
                    appearance-none
                    bg-[var(--color-surface-subtle)]
                    border border-[var(--color-border)]
                    text-[var(--color-text-primary)]
                    rounded-lg
                    pl-8 pr-4 py-2
                    text-sm
                    cursor-pointer
                    hover:bg-[var(--color-surface-hover)]
                    transition-colors
                  "
                >
                  <option value="all">All Levels</option>
                  <option value="error">Errors</option>
                  <option value="warn">Warnings</option>
                  <option value="info">Info</option>
                  <option value="debug">Debug</option>
                </select>
                <Filter
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none"
                />
              </div>

              {/* Auto Refresh Toggle */}
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`
                  flex items-center gap-2
                  px-3 py-2
                  rounded-lg
                  text-sm font-medium
                  transition-colors
                  ${
                    autoRefresh
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-surface-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
                  }
                `}
              >
                <RefreshCw size={14} className={autoRefresh ? 'animate-spin' : ''} />
                Auto
              </button>

              {/* Refresh Button */}
              <button
                onClick={loadLogs}
                disabled={loading}
                className="
                  p-2
                  rounded-lg
                  bg-[var(--color-surface-subtle)]
                  hover:bg-[var(--color-surface-hover)]
                  text-[var(--color-text-primary)]
                  transition-colors
                  disabled:opacity-50
                "
                title="Refresh logs"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>

              {/* Export Button */}
              <button
                onClick={handleExportLogs}
                disabled={logs.length === 0}
                className="
                  p-2
                  rounded-lg
                  bg-[var(--color-surface-subtle)]
                  hover:bg-[var(--color-surface-hover)]
                  text-[var(--color-text-primary)]
                  transition-colors
                  disabled:opacity-50
                "
                title="Export logs"
              >
                <Download size={16} />
              </button>

              {/* Open Folder Button */}
              <button
                onClick={handleOpenLogFolder}
                disabled={!logFilePath}
                className="
                  p-2
                  rounded-lg
                  bg-[var(--color-surface-subtle)]
                  hover:bg-[var(--color-surface-hover)]
                  text-[var(--color-text-primary)]
                  transition-colors
                  disabled:opacity-50
                "
                title="Open log folder"
              >
                <FolderOpen size={16} />
              </button>

              {/* Clear Button */}
              <button
                onClick={handleClearLogs}
                disabled={logs.length === 0}
                className="
                  p-2
                  rounded-lg
                  bg-red-500/10
                  hover:bg-red-500/20
                  text-red-400
                  transition-colors
                  disabled:opacity-50
                "
                title="Clear logs"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Log Stats */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
        <div className="max-w-4k mx-auto px-4 3xl:px-12 py-2">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-[var(--color-text-tertiary)]">
              {filteredLogs.length} {filter === 'all' ? 'entries' : `${filter} entries`}
            </span>
            <span className="text-[var(--color-text-tertiary)]">|</span>
            <span className="text-red-400">
              {logs.filter((l) => l.level.toLowerCase() === 'error').length} errors
            </span>
            <span className="text-yellow-400">
              {logs.filter((l) => l.level.toLowerCase() === 'warn').length} warnings
            </span>
          </div>
        </div>
      </div>

      {/* Logs Container */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4k mx-auto p-4 3xl:px-12">
          {loading && logs.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw size={24} className="animate-spin text-[var(--color-text-tertiary)]" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-[var(--color-text-tertiary)]">
                {filter === 'all' ? 'No logs yet' : `No ${filter} logs`}
              </p>
            </div>
          ) : (
            <div className="space-y-1 font-mono text-sm">
              {filteredLogs.map((log, index) => (
                <div
                  key={index}
                  className={`
                    flex gap-3
                    px-3 py-1.5
                    rounded
                    hover:bg-[var(--color-surface-subtle)]
                    ${getLevelBg(log.level)}
                  `}
                >
                  <span className="text-[var(--color-text-tertiary)] whitespace-nowrap shrink-0">
                    {log.timestamp}
                  </span>
                  <span
                    className={`uppercase font-semibold w-12 shrink-0 ${getLevelColor(log.level)}`}
                  >
                    {log.level}
                  </span>
                  <span className="text-[var(--color-text-primary)] break-all">{log.message}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
