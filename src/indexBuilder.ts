import { statSync } from 'node:fs'
import { parseExcelFileAdaptive } from './adaptiveParser.js'
import { listExcelFiles } from './excelParser.js'
import {
  clearFileCache, deleteOrphanFileCache, getFileCacheEntry, getIndexMeta,
  saveAllRecords, saveFileCacheEntry, saveIndexMeta, saveIndexBuildErrors, type SqliteDatabase,
} from './sqlite.js'
import type { HoSoRecord, IndexMeta, ParserProfile } from './types.js'

export const INDEX_VERSION = 6

export interface IndexBuildProgress {
  progress: number
  message: string
  currentFile?: string
  done: number
  total: number
}

export interface IndexBuildResult {
  success: boolean
  stats: IndexMeta
  errors: string[]
}

export interface IndexBuildOptions {
  rawDataDir: string
  db: SqliteDatabase
  profile: ParserProfile
  parseFile?: (filePath: string, rawDataDir: string, profile: ParserProfile) =>
    Promise<{ records: HoSoRecord[]; error?: string }>
  prepareParser?: (poolSize: number) => Promise<void>
  loadAdditionalRecords?: () => Promise<{ records: HoSoRecord[]; errors?: string[] }>
  poolSize?: number
  pauseMs?: number
  onProgress?: (progress: IndexBuildProgress) => void
  signal?: AbortSignal
}

interface PendingParse {
  filePath: string
  key: string
  fp: { mtimeMs: number; size: number } | null
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw Object.assign(new Error('Đã hủy lập chỉ mục.'), { name: 'AbortError' })
}

function fingerprint(filePath: string): PendingParse['fp'] {
  try {
    const stat = statSync(filePath)
    return { mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return null
  }
}

function relativeKey(root: string, filePath: string): string {
  return filePath.replace(root, '').replace(/^[/\\]/, '').split(/[/\\]/).join('/')
}

async function mapConcurrent<T, R>(
  items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, () => worker()))
  return results
}

export async function buildSearchIndex(options: IndexBuildOptions): Promise<IndexBuildResult> {
  const { db, rawDataDir, profile, signal } = options
  const poolSize = Math.max(1, options.poolSize ?? 1)
  const pauseMs = Math.max(0, options.pauseMs ?? 0)
  const parseFile = options.parseFile ?? (async (file, root, currentProfile) => {
    try { return { records: parseExcelFileAdaptive(file, root, currentProfile) } }
    catch (error) { return { records: [], error: error instanceof Error ? error.message : String(error) } }
  })
  const report = (done: number, total: number, message: string, currentFile?: string) => {
    options.onProgress?.({ done, total, message, currentFile, progress: total === 0 ? 100 : Math.round(done / total * 100) })
  }

  throwIfAborted(signal)
  const existingMeta = getIndexMeta(db)
  if (!existingMeta || existingMeta.version !== INDEX_VERSION) clearFileCache(db)
  const files = listExcelFiles(rawDataDir)
  const errors: string[] = []
  const allRecords: HoSoRecord[] = []
  const activePaths = new Set<string>()
  const pending: PendingParse[] = []
  report(0, files.length, 'Bắt đầu phân tích...')

  for (const filePath of files) {
    throwIfAborted(signal)
    const key = relativeKey(rawDataDir, filePath)
    activePaths.add(key)
    const fp = fingerprint(filePath)
    const cached = getFileCacheEntry(db, key)
    if (fp && cached && cached.mtimeMs === fp.mtimeMs && cached.size === fp.size) {
      allRecords.push(...cached.records)
    } else pending.push({ filePath, key, fp })
  }

  const cachedCount = files.length - pending.length
  if (cachedCount > 0) report(cachedCount, files.length, 'Đã dùng cache ' + cachedCount + ' file...')
  if (pending.length) {
    await options.prepareParser?.(poolSize)
    const results = await mapConcurrent(pending, poolSize, async (item, index) => {
      throwIfAborted(signal)
      const result = await parseFile(item.filePath, rawDataDir, profile)
      report(cachedCount + index + 1, files.length, 'Đang phân tích ' + item.key, item.key)
      if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs))
      return { item, result }
    })
    throwIfAborted(signal)
    for (const { item, result } of results) {
      if (result.error) { errors.push(item.key + ': ' + result.error); continue }
      allRecords.push(...result.records)
      if (item.fp) saveFileCacheEntry(db, item.key, { ...item.fp, records: result.records })
    }
  }

  throwIfAborted(signal)
  deleteOrphanFileCache(db, activePaths)
  report(files.length, files.length, 'Đang nạp hồ sơ đo đạc...')
  const additional = await options.loadAdditionalRecords?.() ?? { records: [] }
  errors.push(...(additional.errors ?? []))
  throwIfAborted(signal)
  const byRow = new Map<string, HoSoRecord>()
  for (const rec of allRecords) byRow.set(rec.sourceFile + '::' + rec.sheetName + '::' + rec.rowStart, rec)
  const excelRecords = [...byRow.values()]
  const records = [...excelRecords, ...additional.records]
  const sourceFiles = files.map((file) => relativeKey(rawDataDir, file))
  const stats: IndexMeta = {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    fileCount: sourceFiles.length,
    sheetCount: new Set(excelRecords.map((rec) => rec.sourceFile + '::' + rec.sheetName)).size,
    recordCount: records.length,
    sourceFiles,
  }
  db.transaction(() => {
    saveAllRecords(db, records)
    saveIndexMeta(db, stats)
    saveIndexBuildErrors(db, errors)
  })()
  report(files.length, files.length, 'Hoàn tất — ' + records.length.toLocaleString() + ' hồ sơ')
  return { success: true, stats, errors }
}
