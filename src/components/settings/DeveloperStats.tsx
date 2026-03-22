/**
 * Developer Stats Route - System Metrics Dashboard
 *
 * Real-time system statistics for debugging:
 * - CPU usage (system & app)
 * - Memory usage (system & app)
 * - Storage usage
 * - Thread count
 *
 * Uses SSE (Tauri events) instead of polling for real-time updates.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { startStatsStream, stopStatsStream, SYSTEM_STATS_EVENT, type SystemStats } from '@/utils/tauri-commands'
import { invoke } from '@tauri-apps/api/core'
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
  ArrowLeft,
  RefreshCw,
  Database,
} from 'lucide-react'

export const Route = createFileRoute('/stats')({
  component: StatsPage,
})

// Store last 60 data points (1 minute at 1 second intervals)
const HISTORY_SIZE = 60

interface StatsHistory {
  cpuUsage: number[]
  memoryPercent: number[]
  processMemory: number[]
  processCpu: number[]
  diskPercent: number[]
}

interface StorageUsage {
  database_size: number
  downloads_size: number
  total_size: number
}

function StatsPage() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [history, setHistory] = useState<StatsHistory>({
    cpuUsage: [],
    memoryPercent: [],
    processMemory: [],
    processCpu: [],
    diskPercent: [],
  })
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)
  const [isStreaming, setIsStreaming] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Format bytes to human readable
  const formatBytes = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }, [])

  // Fetch storage usage (less frequent, can stay as simple call)
  const fetchStorageUsage = useCallback(async () => {
    try {
      const usage = await invoke<StorageUsage>('get_storage_usage')
      setStorageUsage(usage)
    } catch (err) {
      console.error('Failed to fetch storage usage:', err)
    }
  }, [])

  // Handle incoming stats from SSE
  const handleStatsUpdate = useCallback((newStats: SystemStats) => {
    setStats(newStats)
    setError(null)

    // Update history (keep last HISTORY_SIZE entries)
    setHistory((prev) => ({
      cpuUsage: [...prev.cpuUsage, newStats.cpu_usage].slice(-HISTORY_SIZE),
      memoryPercent: [...prev.memoryPercent, newStats.memory_percent].slice(-HISTORY_SIZE),
      processMemory: [...prev.processMemory, newStats.process_memory].slice(-HISTORY_SIZE),
      processCpu: [...prev.processCpu, newStats.process_cpu].slice(-HISTORY_SIZE),
      diskPercent: [...prev.diskPercent, newStats.disk_percent].slice(-HISTORY_SIZE),
    }))
  }, [])

  // Set up SSE listener for stats
  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    let isMounted = true
    let storageInterval: ReturnType<typeof setInterval> | null = null

    const setup = async () => {
      // Fetch initial storage usage
      fetchStorageUsage()

      // Set up event listener
      unlisten = await listen<SystemStats>(SYSTEM_STATS_EVENT, (event) => {
        if (isMounted) {
          handleStatsUpdate(event.payload)
        }
      })

      // Start the stream if enabled
      if (isStreaming) {
        try {
          await startStatsStream()
        } catch (err) {
          if (isMounted) {
            setError(`Failed to start stats stream: ${err}`)
          }
        }
      }

      // Poll storage usage every 5 seconds (small data, doesn't need SSE)
      storageInterval = setInterval(fetchStorageUsage, 5000)
    }

    setup()

    return () => {
      isMounted = false
      if (unlisten) {
        unlisten()
      }
      if (storageInterval) {
        clearInterval(storageInterval)
      }
      // Stop the stream when component unmounts
      stopStatsStream().catch(console.error)
    }
  }, [fetchStorageUsage, handleStatsUpdate, isStreaming])

  // Toggle streaming on/off
  const toggleStreaming = async () => {
    if (isStreaming) {
      await stopStatsStream()
      setIsStreaming(false)
    } else {
      await startStatsStream()
      setIsStreaming(true)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)] px-4 py-8">
      <div className="max-w-4k mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              to="/settings"
              className="p-2 rounded-lg bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <ArrowLeft size={20} className="text-[var(--color-text-secondary)]" />
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">
                Developer Stats
              </h1>
              <p className="text-[var(--color-text-secondary)] mt-1">
                Real-time system metrics via SSE
              </p>
            </div>
          </div>

          <button
            onClick={toggleStreaming}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors
              ${
                isStreaming
                  ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  : 'bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
              }
            `}
          >
            <RefreshCw
              size={16}
              className={isStreaming ? 'animate-spin' : ''}
            />
            {isStreaming ? 'Live' : 'Paused'}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30">
            {error}
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5 5xl:grid-cols-6 gap-6">
          {/* CPU Usage */}
          <StatCard
            icon={<Cpu size={24} />}
            title="CPU Usage"
            value={stats ? `${stats.cpu_usage.toFixed(1)}%` : '--'}
            subtitle={stats ? `${stats.cpu_count} cores` : ''}
            data={history.cpuUsage}
            max={100}
            color="#3b82f6"
          />

          {/* Memory Usage */}
          <StatCard
            icon={<MemoryStick size={24} />}
            title="System Memory"
            value={stats ? `${stats.memory_percent.toFixed(1)}%` : '--'}
            subtitle={
              stats
                ? `${formatBytes(stats.memory_used)} / ${formatBytes(stats.memory_total)}`
                : ''
            }
            data={history.memoryPercent}
            max={100}
            color="#8b5cf6"
          />

          {/* Disk Usage */}
          <StatCard
            icon={<HardDrive size={24} />}
            title="Disk Usage"
            value={stats ? `${stats.disk_percent.toFixed(1)}%` : '--'}
            subtitle={
              stats
                ? `${formatBytes(stats.disk_used)} / ${formatBytes(stats.disk_total)}`
                : ''
            }
            data={history.diskPercent}
            max={100}
            color="#10b981"
          />

          {/* App Memory */}
          <StatCard
            icon={<Activity size={24} />}
            title="App Memory"
            value={stats ? formatBytes(stats.process_memory) : '--'}
            subtitle="Process RSS"
            data={history.processMemory}
            max={Math.max(...history.processMemory, 1)}
            color="#f59e0b"
            formatValue={formatBytes}
          />

          {/* App CPU */}
          <StatCard
            icon={<Cpu size={24} />}
            title="App CPU"
            value={stats ? `${stats.process_cpu.toFixed(1)}%` : '--'}
            subtitle={stats ? `${stats.thread_count} threads available` : ''}
            data={history.processCpu}
            max={100}
            color="#ec4899"
          />

          {/* Database Storage */}
          <StatCard
            icon={<Database size={24} />}
            title="App Storage"
            value={storageUsage ? formatBytes(storageUsage.total_size) : '--'}
            subtitle={
              storageUsage
                ? `DB: ${formatBytes(storageUsage.database_size)} | Downloads: ${formatBytes(storageUsage.downloads_size)}`
                : ''
            }
            data={[]}
            max={100}
            color="#06b6d4"
            showChart={false}
          />
        </div>

        {/* Debug Info */}
        {stats && (
          <div className="mt-8 p-4 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
            <h3 className="text-sm font-mono text-[var(--color-text-secondary)] mb-2">
              Raw Stats
            </h3>
            <pre className="text-xs font-mono text-[var(--color-text-tertiary)] overflow-x-auto">
              {JSON.stringify(stats, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// SVG Sparkline Chart Component
interface MiniChartProps {
  data: number[]
  max?: number
  color: string
  height?: number
  width?: number
}

function MiniChart({
  data,
  max = 100,
  color,
  height = 50,
  width = 200,
}: MiniChartProps) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} className="opacity-30">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
      </svg>
    )
  }

  const effectiveMax = max || Math.max(...data, 1)
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width
    const y = height - (value / effectiveMax) * height
    return `${x},${y}`
  })

  const pathD = `M ${points.join(' L ')}`

  // Create gradient fill path
  const fillPath = `${pathD} L ${width},${height} L 0,${height} Z`

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient
          id={`gradient-${color.replace('#', '')}`}
          x1="0%"
          y1="0%"
          x2="0%"
          y2="100%"
        >
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Fill area */}
      <path
        d={fillPath}
        fill={`url(#gradient-${color.replace('#', '')})`}
      />

      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Current value dot */}
      {data.length > 0 && (
        <circle
          cx={width}
          cy={height - (data[data.length - 1] / effectiveMax) * height}
          r={3}
          fill={color}
        />
      )}
    </svg>
  )
}

// Stat Card Component
interface StatCardProps {
  icon: React.ReactNode
  title: string
  value: string
  subtitle: string
  data: number[]
  max: number
  color: string
  showChart?: boolean
  formatValue?: (v: number) => string
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  data,
  max,
  color,
  showChart = true,
}: StatCardProps) {
  return (
    <div className="p-6 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] transition-all hover:border-[var(--color-border-hover)]">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-lg"
            style={{ backgroundColor: `${color}20` }}
          >
            <div style={{ color }}>{icon}</div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">
              {title}
            </h3>
            <p className="text-2xl font-bold text-[var(--color-text-primary)]">
              {value}
            </p>
          </div>
        </div>
      </div>

      {showChart && (
        <div className="mb-2">
          <MiniChart data={data} max={max} color={color} width={280} height={50} />
        </div>
      )}

      {subtitle && (
        <p className="text-xs text-[var(--color-text-tertiary)]">{subtitle}</p>
      )}
    </div>
  )
}
