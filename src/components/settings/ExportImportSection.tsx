import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { save, open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { Download, Upload, AlertTriangle, Check, Loader2 } from 'lucide-react'
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notify'
import { SettingSection } from './SettingSection'
import { SettingRow } from './SettingRow'

interface ExportMetadata {
  library_count: number
  watch_history_count: number
  reading_history_count: number
  tag_count: number
  media_cache_count: number
}

interface ExportData {
  format_version: string
  app_version: string
  exported_at: string
  data: Record<string, unknown>
  metadata: ExportMetadata
}

interface ImportOptions {
  strategy: 'replace_all' | 'merge_keep_existing' | 'merge_prefer_import'
  import_library: boolean
  import_watch_history: boolean
  import_reading_history: boolean
  import_tags: boolean
  import_settings: boolean
  import_media_cache: boolean
  import_tracker_mappings: boolean
}

interface ImportResult {
  success: boolean
  library_imported: number
  library_skipped: number
  watch_history_imported: number
  watch_history_skipped: number
  reading_history_imported: number
  reading_history_skipped: number
  tags_imported: number
  tags_skipped: number
  tag_assignments_imported: number
  settings_imported: number
  media_cache_imported: number
  tracker_mappings_imported: number
  warnings: string[]
}

type ExportState = 'idle' | 'exporting' | 'success' | 'error'
type ImportState = 'idle' | 'selecting' | 'preview' | 'importing' | 'success' | 'error'

export function ExportImportSection() {
  // Export state
  const [exportState, setExportState] = useState<ExportState>('idle')

  // Import state
  const [importState, setImportState] = useState<ImportState>('idle')
  const [importData, setImportData] = useState<ExportData | null>(null)
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    strategy: 'merge_keep_existing',
    import_library: true,
    import_watch_history: true,
    import_reading_history: true,
    import_tags: true,
    import_settings: true,
    import_media_cache: true,
    import_tracker_mappings: true,
  })
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  const handleExport = async () => {
    setExportState('exporting')

    try {
      // Get export data from backend
      const data = await invoke<ExportData>('export_user_data')

      // Open save dialog
      const filePath = await save({
        defaultPath: `otaku-backup-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })

      if (!filePath) {
        setExportState('idle')
        return
      }

      // Write to file
      await writeTextFile(filePath, JSON.stringify(data, null, 2))

      setExportState('success')
      notifySuccess(
        'Export Complete',
        `Exported ${data.metadata.library_count} library items, ${data.metadata.watch_history_count} watch history entries`
      )

      // Reset state after a delay
      setTimeout(() => setExportState('idle'), 3000)
    } catch (error) {
      setExportState('error')
      notifyError('Export Failed', `${error}`)
      setTimeout(() => setExportState('idle'), 3000)
    }
  }

  const handleSelectFile = async () => {
    setImportState('selecting')

    try {
      const filePath = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false,
      })

      if (!filePath) {
        setImportState('idle')
        return
      }

      // Read and parse the file
      const content = await readTextFile(filePath as string)
      const data = JSON.parse(content) as ExportData

      // Validate structure
      if (!data.format_version || !data.data || !data.metadata) {
        throw new Error('Invalid export file format')
      }

      setImportData(data)
      setImportState('preview')
    } catch (error) {
      setImportState('error')
      notifyError('Import Failed', `Failed to read file: ${error}`)
      setTimeout(() => setImportState('idle'), 3000)
    }
  }

  const handleImport = async () => {
    if (!importData) return

    setImportState('importing')

    try {
      const result = await invoke<ImportResult>('import_user_data', {
        data: importData,
        options: importOptions,
      })

      setImportResult(result)
      setImportState('success')

      if (result.warnings.length > 0) {
        notifyWarning(
          'Import Complete with Warnings',
          `${result.warnings.length} warnings occurred during import`
        )
      } else {
        notifySuccess(
          'Import Complete',
          `Imported ${result.library_imported} library items, ${result.watch_history_imported} watch history entries`
        )
      }
    } catch (error) {
      setImportState('error')
      notifyError('Import Failed', `${error}`)
      setTimeout(() => {
        setImportState('idle')
        setImportData(null)
      }, 3000)
    }
  }

  const resetImport = () => {
    setImportState('idle')
    setImportData(null)
    setImportResult(null)
  }

  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return isoString
    }
  }

  return (
    <SettingSection
      title="Export & Import"
      description="Transfer your data between devices or create backups"
    >
      {/* Export Section */}
      <SettingRow
        label="Export Data"
        description="Save all your library, watch history, and settings to a JSON file"
      >
        <button
            onClick={handleExport}
            disabled={exportState === 'exporting'}
            className={`
              flex items-center gap-2
              px-4 py-2 rounded-lg
              font-medium
              transition-colors
              ${
                exportState === 'success'
                  ? 'bg-green-600 text-white'
                  : exportState === 'error'
                    ? 'bg-red-600 text-white'
                    : 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {exportState === 'exporting' ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Exporting...
            </>
          ) : exportState === 'success' ? (
            <>
              <Check size={16} />
              Exported!
            </>
          ) : (
            <>
              <Download size={16} />
              Export to File
            </>
          )}
        </button>
      </SettingRow>

      {/* Import Section */}
      <SettingRow
        label="Import Data"
        description="Restore your data from a previously exported JSON file"
      >
        <div className="flex flex-col gap-3 w-full">
          {importState === 'idle' && (
            <button
              onClick={handleSelectFile}
              className="
                flex items-center gap-2
                px-4 py-2 rounded-lg
                font-medium
                bg-[var(--color-surface-subtle)]
                hover:bg-[var(--color-surface-hover)]
                text-[var(--color-text-primary)]
                transition-colors
              "
            >
              <Upload size={16} />
              Select File to Import
            </button>
          )}

          {importState === 'selecting' && (
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <Loader2 size={16} className="animate-spin" />
              Selecting file...
            </div>
          )}

          {importState === 'preview' && importData && (
            <div className="bg-[var(--color-surface-subtle)] rounded-lg p-4 space-y-4">
              {/* File info */}
              <div className="space-y-1">
                <h4 className="font-medium text-[var(--color-text-primary)]">
                  Export File Details
                </h4>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Exported on: {formatDate(importData.exported_at)}
                </p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  App version: v{importData.app_version}
                </p>
              </div>

              {/* Data summary */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">Library items:</span>
                  <span className="text-[var(--color-text-primary)] font-medium">
                    {importData.metadata.library_count}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">Watch history:</span>
                  <span className="text-[var(--color-text-primary)] font-medium">
                    {importData.metadata.watch_history_count}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">Reading history:</span>
                  <span className="text-[var(--color-text-primary)] font-medium">
                    {importData.metadata.reading_history_count}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">Tags:</span>
                  <span className="text-[var(--color-text-primary)] font-medium">
                    {importData.metadata.tag_count}
                  </span>
                </div>
              </div>

              {/* Import strategy */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--color-text-primary)]">
                  Import Strategy
                </label>
                <select
                  value={importOptions.strategy}
                  onChange={(e) =>
                    setImportOptions({
                      ...importOptions,
                      strategy: e.target.value as ImportOptions['strategy'],
                    })
                  }
                  className="
                    w-full px-3 py-2 rounded-lg
                    bg-[var(--color-surface)]
                    border border-[var(--color-border)]
                    text-[var(--color-text-primary)]
                    text-sm
                  "
                >
                  <option value="merge_keep_existing">
                    Merge - Keep existing data (Recommended)
                  </option>
                  <option value="merge_prefer_import">
                    Merge - Prefer imported data
                  </option>
                  <option value="replace_all">
                    Replace all - Clear and import fresh
                  </option>
                </select>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  {importOptions.strategy === 'merge_keep_existing'
                    ? 'Only imports items that do not already exist locally.'
                    : importOptions.strategy === 'merge_prefer_import'
                      ? 'Overwrites existing items with imported data.'
                      : 'Deletes all existing data before importing. Cannot be undone.'}
                </p>
              </div>

              {/* Replace all warning */}
              {importOptions.strategy === 'replace_all' && (
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertTriangle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-400">
                    This will permanently delete all existing data before importing. This action
                    cannot be undone.
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleImport}
                  className="
                    flex-1 flex items-center justify-center gap-2
                    px-4 py-2 rounded-lg
                    font-medium
                    bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)]
                    text-white
                    transition-colors
                  "
                >
                  <Upload size={16} />
                  Import Data
                </button>
                <button
                  onClick={resetImport}
                  className="
                    px-4 py-2 rounded-lg
                    font-medium
                    bg-[var(--color-surface)]
                    hover:bg-[var(--color-surface-hover)]
                    text-[var(--color-text-primary)]
                    transition-colors
                  "
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {importState === 'importing' && (
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <Loader2 size={16} className="animate-spin" />
              Importing data...
            </div>
          )}

          {importState === 'success' && importResult && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-green-500 font-medium">
                <Check size={16} />
                Import Complete
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                {importResult.library_imported > 0 && (
                  <div className="text-[var(--color-text-secondary)]">
                    Library: {importResult.library_imported} imported
                    {importResult.library_skipped > 0 && `, ${importResult.library_skipped} skipped`}
                  </div>
                )}
                {importResult.watch_history_imported > 0 && (
                  <div className="text-[var(--color-text-secondary)]">
                    Watch history: {importResult.watch_history_imported} imported
                  </div>
                )}
                {importResult.reading_history_imported > 0 && (
                  <div className="text-[var(--color-text-secondary)]">
                    Reading history: {importResult.reading_history_imported} imported
                  </div>
                )}
                {importResult.tags_imported > 0 && (
                  <div className="text-[var(--color-text-secondary)]">
                    Tags: {importResult.tags_imported} imported
                  </div>
                )}
              </div>

              {importResult.warnings.length > 0 && (
                <div className="text-sm text-yellow-500">
                  {importResult.warnings.length} warnings occurred
                </div>
              )}

              <button
                onClick={resetImport}
                className="
                  w-full px-4 py-2 rounded-lg
                  font-medium
                  bg-[var(--color-surface)]
                  hover:bg-[var(--color-surface-hover)]
                  text-[var(--color-text-primary)]
                  transition-colors
                "
              >
                Done
              </button>
            </div>
          )}

          {importState === 'error' && (
            <div className="flex items-center gap-2 text-red-500">
              <AlertTriangle size={16} />
              Import failed. Please try again.
            </div>
          )}
        </div>
      </SettingRow>
    </SettingSection>
  )
}
