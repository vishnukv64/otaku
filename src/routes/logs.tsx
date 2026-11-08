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
import { ArrowLeft, RefreshCw, Trash2, FolderOpen, Download, Filter, Copy, Pause, Play, Search, ScrollText } from 'lucide-react'
import { isMobile } from '@/utils/platform'
import { ChipRow, ConfirmSheet, EmptyState, Spinner } from '@/components/mobile/you/ui'
import { notifySuccess, notifyError } from '@/utils/notify'
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
  const [query, setQuery] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  const loadLogs = useCallback(async () => {
    try {
      const entries = await getAppLogs(500)
      setLogs(entries)
    } catch (error) {
      console.error('Failed to load logs:', error)
      notifyError('Load Failed', `Failed to load logs: ${error}`)
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
      notifySuccess('Logs Cleared', 'Application logs have been cleared')
    } catch (error) {
      notifyError('Clear Failed', `Failed to clear logs: ${error}`)
    }
  }

  const handleOpenLogFolder = async () => {
    if (!logFilePath) return

    try {
      // Get the directory containing the log file
      const dirPath = logFilePath.substring(0, logFilePath.lastIndexOf('/'))
      await invoke('plugin:shell|open', { path: dirPath })
    } catch (error) {
      notifyError('Open Failed', `Failed to open folder: ${error}`)
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
    notifySuccess('Logs Exported', 'Logs have been exported')
  }

  const q = query.trim().toLowerCase()
  const filteredLogs = logs.filter((log) => {
    if (q && !log.message.toLowerCase().includes(q)) return false
    if (filter === 'all') return true
    return log.level.toLowerCase() === filter
  })

  const handleCopyLogs = async () => {
    try {
      await navigator.clipboard.writeText(
        filteredLogs.map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`).join('\n')
      )
      notifySuccess('Copied', `${filteredLogs.length} log lines copied`)
    } catch (error) {
      notifyError('Copy Failed', `${error}`)
    }
  }

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

  if (isMobile()) {
    const icon = 'flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-text-primary)] disabled:opacity-40'
    return (
      <div className="flex min-h-screen flex-col bg-[var(--color-background)] px-4 pb-24 pt-2">
        <div className="mb-3 flex items-center gap-1">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search logs"
              aria-label="Search logs"
              className="min-h-[44px] w-full rounded-[var(--radius-lg)] border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)] pl-9 pr-3 text-[15px] text-white"
            />
          </div>
          <button aria-label={autoRefresh ? 'Pause live logs' : 'Resume live logs'} aria-pressed={autoRefresh} onClick={() => setAutoRefresh(!autoRefresh)} className={icon}>
            {autoRefresh ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button aria-label="Copy logs" onClick={handleCopyLogs} disabled={filteredLogs.length === 0} className={icon}><Copy size={18} /></button>
          <button aria-label="Export logs" onClick={handleExportLogs} disabled={logs.length === 0} className={icon}><Download size={18} /></button>
          <button aria-label="Clear logs" onClick={() => setConfirmClear(true)} disabled={logs.length === 0} className={`${icon} !text-[var(--color-accent-light)]`}><Trash2 size={18} /></button>
        </div>
        <ChipRow
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'All', count: logs.length },
            { id: 'error', label: 'Errors', count: logs.filter((l) => l.level.toLowerCase() === 'error').length },
            { id: 'warn', label: 'Warnings', count: logs.filter((l) => l.level.toLowerCase() === 'warn').length },
            { id: 'info', label: 'Info' },
            { id: 'debug', label: 'Debug' },
          ]}
        />
        {autoRefresh && <p className="mt-2 text-xs text-[var(--color-accent-light)]">Live · auto-scrolling</p>}
        <div className="mt-3 flex-1">
          {loading && logs.length === 0 ? (
            <Spinner label="Loading logs…" />
          ) : filteredLogs.length === 0 ? (
            <EmptyState
              icon={<ScrollText size={44} aria-hidden="true" />}
              title={q || filter !== 'all' ? 'No matching logs' : 'No logs yet'}
              text={q || filter !== 'all' ? 'Try another level or search term.' : 'App activity will show up here.'}
            />
          ) : (
            <div className="space-y-1 font-mono text-xs">
              {filteredLogs.map((log, index) => (
                <div key={index} className={`rounded-md px-2.5 py-1.5 ${getLevelBg(log.level)}`}>
                  <div className="flex gap-2">
                    <span className={`font-semibold uppercase ${getLevelColor(log.level)}`}>{log.level}</span>
                    <span className="text-[var(--color-text-tertiary)]">{log.timestamp}</span>
                  </div>
                  <div className="mt-0.5 break-all text-[var(--color-text-primary)]">{log.message}</div>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
        <ConfirmSheet isOpen={confirmClear} onClose={() => setConfirmClear(false)} title="Clear all logs?" text="This deletes the application log. It can't be undone." confirmLabel="Clear logs" onConfirm={handleClearLogs} />
      </div>
    )
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
