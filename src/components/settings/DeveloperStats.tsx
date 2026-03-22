/**
 * DeveloperStats - Collapsible System Metrics Panel
 *
 * Self-contained collapsible component for the Settings developer section.
 * Only starts SSE stream when expanded, stops when collapsed or unmounted.
 */

import { useEffect, useState, useCallback } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { startStatsStream, stopStatsStream, SYSTEM_STATS_EVENT, type SystemStats } from '@/utils/tauri-commands'
import { invoke } from '@tauri-apps/api/core'
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
  Database,
  ChevronDown,
  RefreshCw,
} from 'lucide-react'

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

export function DeveloperStats() {
  const [expanded, setExpanded] = useState(false)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [history, setHistory] = useState<StatsHistory>({
    cpuUsage: [],
    memoryPercent: [],
    processMemory: [],
    processCpu: [],
    diskPercent: [],
  })
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const formatBytes = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }, [])

  const fetchStorageUsage = useCallback(async () => {
    try {
      const usage = await invoke<StorageUsage>('get_storage_usage')
      setStorageUsage(usage)
    } catch (err) {
      console.error('Failed to fetch storage usage:', err)
    }
  }, [])

  const handleStatsUpdate = useCallback((newStats: SystemStats) => {
    setStats(newStats)
    setError(null)
    setHistory((prev) => ({
      cpuUsage: [...prev.cpuUsage, newStats.cpu_usage].slice(-HISTORY_SIZE),
      memoryPercent: [...prev.memoryPercent, newStats.memory_percent].slice(-HISTORY_SIZE),
      processMemory: [...prev.processMemory, newStats.process_memory].slice(-HISTORY_SIZE),
      processCpu: [...prev.processCpu, newStats.process_cpu].slice(-HISTORY_SIZE),
      diskPercent: [...prev.diskPercent, newStats.disk_percent].slice(-HISTORY_SIZE),
    }))
  }, [])

  // Start/stop SSE stream based on expanded state
  useEffect(() => {
    if (!expanded) return

    let unlisten: UnlistenFn | null = null
    let isMounted = true
    let storageInterval: ReturnType<typeof setInterval> | null = null

    const setup = async () => {
      fetchStorageUsage()

      unlisten = await listen<SystemStats>(SYSTEM_STATS_EVENT, (event) => {
        if (isMounted) {
          handleStatsUpdate(event.payload)
        }
      })

      try {
        await startStatsStream()
      } catch (err) {
        if (isMounted) {
          setError(`Failed to start stats stream: ${err}`)
        }
      }

      storageInterval = setInterval(fetchStorageUsage, 5000)
    }

    setup()

    return () => {
      isMounted = false
      if (unlisten) unlisten()
      if (storageInterval) clearInterval(storageInterval)
      stopStatsStream().catch(console.error)
    }
  }, [expanded, fetchStorageUsage, handleStatsUpdate])

  return (
    <div className="mt-2">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <Activity size={16} className="text-[var(--color-text-secondary)]" />
          <div className="text-left">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">System Stats</span>
            <p className="text-xs text-[var(--color-text-tertiary)]">Real-time CPU, memory, and storage metrics</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {expanded && stats && (
            <RefreshCw size={14} className="animate-spin text-green-400" />
          )}
          <ChevronDown
            size={16}
            className={`text-[var(--color-text-tertiary)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Collapsible content */}
      {expanded && (
        <div className="mt-3 space-y-3">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <StatCard
              icon={<Cpu size={18} />}
              title="CPU Usage"
              value={stats ? `${stats.cpu_usage.toFixed(1)}%` : '--'}
              subtitle={stats ? `${stats.cpu_count} cores` : ''}
              data={history.cpuUsage}
              max={100}
              color="#3b82f6"
            />
            <StatCard
              icon={<MemoryStick size={18} />}
              title="System Memory"
              value={stats ? `${stats.memory_percent.toFixed(1)}%` : '--'}
              subtitle={stats ? `${formatBytes(stats.memory_used)} / ${formatBytes(stats.memory_total)}` : ''}
              data={history.memoryPercent}
              max={100}
              color="#8b5cf6"
            />
            <StatCard
              icon={<HardDrive size={18} />}
              title="Disk Usage"
              value={stats ? `${stats.disk_percent.toFixed(1)}%` : '--'}
              subtitle={stats ? `${formatBytes(stats.disk_used)} / ${formatBytes(stats.disk_total)}` : ''}
              data={history.diskPercent}
              max={100}
              color="#10b981"
            />
            <StatCard
              icon={<Activity size={18} />}
              title="App Memory"
              value={stats ? formatBytes(stats.process_memory) : '--'}
              subtitle="Process RSS"
              data={history.processMemory}
              max={Math.max(...history.processMemory, 1)}
              color="#f59e0b"
            />
            <StatCard
              icon={<Cpu size={18} />}
              title="App CPU"
              value={stats ? `${stats.process_cpu.toFixed(1)}%` : '--'}
              subtitle={stats ? `${stats.thread_count} threads available` : ''}
              data={history.processCpu}
              max={100}
              color="#ec4899"
            />
            <StatCard
              icon={<Database size={18} />}
              title="App Storage"
              value={storageUsage ? formatBytes(storageUsage.total_size) : '--'}
              subtitle={storageUsage ? `DB: ${formatBytes(storageUsage.database_size)} | Downloads: ${formatBytes(storageUsage.downloads_size)}` : ''}
              data={[]}
              max={100}
              color="#06b6d4"
              showChart={false}
            />
          </div>
        </div>
      )}
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
  height = 40,
  width = 180,
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
      <path
        d={fillPath}
        fill={`url(#gradient-${color.replace('#', '')})`}
      />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
    <div className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] transition-all hover:border-[var(--color-border-hover)]">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="p-1.5 rounded-lg"
            style={{ backgroundColor: `${color}20` }}
          >
            <div style={{ color }}>{icon}</div>
          </div>
          <div>
            <h3 className="text-xs font-medium text-[var(--color-text-secondary)]">
              {title}
            </h3>
            <p className="text-lg font-bold text-[var(--color-text-primary)]">
              {value}
            </p>
          </div>
        </div>
      </div>

      {showChart && (
        <div className="mb-1.5">
          <MiniChart data={data} max={max} color={color} width={220} height={40} />
        </div>
      )}

      {subtitle && (
        <p className="text-[0.65rem] text-[var(--color-text-tertiary)]">{subtitle}</p>
      )}
    </div>
  )
}
