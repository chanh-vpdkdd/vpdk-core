import { mkdir, readdir, copyFile, access, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, basename, extname } from 'node:path'
import type { QuickFileSearchMatchItem, QuickFileSearchProgress, QuickFileSearchRequest, QuickFileSearchResult } from './types.js'
import { quickFileSearchReportFileName, writeQuickFileSearchReport } from './quickFileSearchReport.js'

const execFileAsync = promisify(execFile)
const PROGRESS_INTERVAL_MS = 400

interface FoundFile {
  keyword: string
  sourcePath: string
  fileName: string
}

type EntryKind = 'directory' | 'file' | 'other'

export async function quickFileSearchAndCopy(
  input: QuickFileSearchRequest,
  onProgress?: (progress: QuickFileSearchProgress) => void,
): Promise<QuickFileSearchResult> {
  const sourcePath = normalizeUncSourcePath(input.sourcePath)
  const destinationPath = input.destinationPath.trim()
  const keywords = sanitizeKeywords(input.keywords)

  if (!sourcePath) {
    return emptyResult(false, 'Thiếu đường dẫn SMB nguồn.')
  }
  if (!destinationPath) {
    return emptyResult(false, 'Thiếu thư mục đích để copy file.')
  }
  if (keywords.length === 0) {
    return emptyResult(false, 'Danh sách từ khóa đang trống.')
  }

  let scanRoots: string[]
  try {
    scanRoots = await resolveQuickFileScanRoots(sourcePath)
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'lỗi không xác định'
    const host = extractUncHost(sourcePath) ?? 'SMB'
    return emptyResult(
      false,
      `Không mở được: ${sourcePath}\n` +
        `• Kiểm tra máy ${host} có bật và cùng mạng LAN\n` +
        `• Thử mở \\\\${host} trong File Explorer trước\n` +
        `Chi tiết: ${detail}`,
    )
  }

  return quickFileSearchOnRoots(
    {
      scanRoots,
      destinationPath,
      keywords: input.keywords,
      mode: 'scanAndCopy',
      jobId: input.jobId,
    },
    onProgress,
  )
}

export async function resolveQuickFileScanRoots(sourcePathRaw: string): Promise<string[]> {
  const sourcePath = normalizeUncSourcePath(sourcePathRaw)
  if (!sourcePath) throw new Error('Thiếu đường dẫn SMB nguồn.')
  return resolveScanRoots(sourcePath)
}

export interface QuickFileSearchOnRootsInput {
  scanRoots: string[]
  destinationPath: string
  keywords: string[]
  mode: 'scanOnly' | 'scanAndCopy'
  signal?: AbortSignal
  jobId?: string
}

export async function quickFileSearchOnRoots(
  input: QuickFileSearchOnRootsInput,
  onProgress?: (progress: QuickFileSearchProgress) => void,
): Promise<QuickFileSearchResult> {
  const destinationPath = input.destinationPath.trim()
  const keywords = sanitizeKeywords(input.keywords)
  const scanRoots = input.scanRoots.filter(Boolean)

  if (scanRoots.length === 0) {
    return emptyResult(false, 'Không có thư mục gốc để quét.')
  }
  if (input.mode === 'scanAndCopy' && !destinationPath) {
    return emptyResult(false, 'Thiếu thư mục đích để copy file.')
  }
  if (keywords.length === 0) {
    return emptyResult(false, 'Danh sách từ khóa đang trống.')
  }

  if (input.mode === 'scanAndCopy') {
    await mkdir(destinationPath, { recursive: true })
  }

  let scannedCount = 0
  let copiedCount = 0
  const found: FoundFile[] = []
  const stack = [...scanRoots]
  let foldersVisited = 0
  let foldersSkipped = 0
  let lastProgressAt = 0

  const emit = (partial: Partial<QuickFileSearchProgress> & { message: string }) => {
    onProgress?.({
      phase: partial.phase ?? 'scanning',
      scannedCount,
      matchedCount: found.length,
      copiedCount,
      currentPath: partial.currentPath,
      message: partial.message,
      jobId: input.jobId,
    })
  }

  const maybeEmitScan = (currentPath: string) => {
    const now = Date.now()
    if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return
    lastProgressAt = now
    emit({
      phase: 'scanning',
      currentPath,
      message: `Đang quét… đã đọc ${scannedCount} file, khớp ${found.length}`,
    })
  }

  const throwIfAborted = () => {
    if (input.signal?.aborted) {
      throw new Error('Đã hủy quét.')
    }
  }

  emit({
    phase: 'scanning',
    currentPath: scanRoots[0],
    message:
      scanRoots.length > 1
        ? `Quét ${scanRoots.length} thư mục gốc…`
        : `Bắt đầu quét ${scanRoots[0]}…`,
  })

  while (stack.length > 0) {
    throwIfAborted()
    const currentPath = stack.pop()
    if (!currentPath) continue

    let entries: Dirent[]
    try {
      entries = await readdir(currentPath, { withFileTypes: true })
    } catch {
      foldersSkipped += 1
      continue
    }

    foldersVisited += 1
    maybeEmitScan(currentPath)

    for (const entry of entries) {
      throwIfAborted()
      const fullPath = joinPath(currentPath, entry.name)
      const kind = await resolveEntryKind(fullPath, entry)

      if (kind === 'directory') {
        stack.push(fullPath)
        continue
      }
      if (kind !== 'file') continue

      scannedCount += 1
      const matchedKeyword = findMatchingKeyword(fullPath, entry.name, keywords)
      if (matchedKeyword) {
        found.push({ keyword: matchedKeyword, sourcePath: fullPath, fileName: entry.name })
      }

      if (scannedCount % 25 === 0) maybeEmitScan(fullPath)
    }
  }

  if (scannedCount === 0 && foldersVisited === 0) {
    return emptyResult(
      false,
      `Không đọc được share nào.\n` +
        `Đã thử ${scanRoots.length} gốc, ${foldersSkipped} thư mục bị từ chối quyền (EPERM).`,
    )
  }

  if (input.mode === 'scanOnly') {
    const items: QuickFileSearchMatchItem[] = found.map((file) => ({
      keyword: file.keyword,
      fileName: file.fileName,
      sourcePath: file.sourcePath,
      copied: false,
    }))
    const summary = `Quét ${scannedCount} file, khớp ${found.length} (chỉ quét).`
    emit({ phase: 'done', message: summary })
    return {
      success: true,
      message: summary,
      scannedCount,
      matchedCount: found.length,
      copiedCount: 0,
      files: [],
      items,
    }
  }

  emit({
    phase: 'copying',
    message: `Quét xong ${scannedCount} file, khớp ${found.length}. Đang copy…`,
  })

  const items: QuickFileSearchMatchItem[] = []
  const copiedPaths: string[] = []
  for (const file of found) {
    throwIfAborted()
    const target = await buildUniqueTargetPath(destinationPath, file.fileName)
    let copied = false
    try {
      await copyFile(file.sourcePath, target)
      copied = true
      copiedCount += 1
      copiedPaths.push(target)
    } catch {
      // Bỏ qua file không copy được.
    }
    items.push({
      keyword: file.keyword,
      fileName: file.fileName,
      sourcePath: file.sourcePath,
      destinationPath: copied ? target : undefined,
      copied,
    })
  }

  let reportPath: string | undefined
  try {
    reportPath = writeQuickFileSearchReport(items, join(destinationPath, quickFileSearchReportFileName()))
  } catch {
    // Báo cáo lỗi không chặn kết quả copy.
  }

  const matchedCount = found.length
  const summary = `Quét ${scannedCount} file, khớp ${matchedCount}, copy ${copiedCount} file.`
  const message = reportPath ? `${summary}\nBáo cáo: ${reportPath}` : summary

  emit({ phase: 'done', message: summary })

  return {
    success: true,
    message,
    scannedCount,
    matchedCount,
    copiedCount,
    files: copiedPaths,
    items,
    reportPath,
  }
}

/** Node.js không đọc được \\host (không có share) — dùng net view như Explorer. */
async function listSmbDiskShares(host: string): Promise<string[]> {
  const uncHost = `\\\\${host}`
  const { stdout } = await execFileAsync('net', ['view', uncHost], {
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  })

  const shares: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!/\bDisk\b/i.test(line)) continue
    const name = line.trim().split(/\s+/)[0]
    if (name && !/^-+$/.test(name) && name.toLowerCase() !== 'share') {
      shares.push(name)
    }
  }
  return shares
}

async function resolveScanRoots(sourcePath: string): Promise<string[]> {
  if (!isUncHostOnly(sourcePath)) {
    await readdir(sourcePath)
    return [sourcePath]
  }

  const host = extractUncHost(sourcePath)
  if (!host) throw new Error('Không xác định được máy chủ SMB.')

  const shares = await listSmbDiskShares(host)
  if (shares.length === 0) {
    throw new Error(`Không tìm thấy ổ đĩa chia sẻ (Disk) trên \\\\${host}`)
  }

  return shares.map((share) => `\\\\${host}\\${share}`)
}

async function resolveEntryKind(fullPath: string, entry: Dirent): Promise<EntryKind> {
  if (entry.isDirectory()) return 'directory'
  if (entry.isFile()) return 'file'

  try {
    const info = await stat(fullPath)
    if (info.isDirectory()) return 'directory'
    if (info.isFile()) return 'file'
  } catch {
    // Bỏ qua mục không đọc được.
  }
  return 'other'
}

async function buildUniqueTargetPath(destinationPath: string, originalName: string): Promise<string> {
  const extension = extname(originalName)
  const plainName = basename(originalName, extension)

  let candidate = join(destinationPath, originalName)
  let counter = 1
  while (await pathExists(candidate)) {
    candidate = join(destinationPath, `${plainName} (${counter})${extension}`)
    counter += 1
  }
  return candidate
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Tách nhiều cụm trên cùng dòng: "AA 123 hoặc BB 456" → 2 pattern. */
const KEYWORD_OR_SPLIT_RE = /\s*(?:hoặc|hoac|or|,|;)\s*/i

interface MatchPattern {
  raw: string
  /** Chuỗi liên tục (bỏ khoảng trắng, -, _, ., \) — khớp aa0394924 với AA 0394924 */
  compact: string
  /** Chuỗi có dấu cách chuẩn — khớp "aa 0394924" dù file có nhiều space */
  spaced: string
  /** Các phần tách theo space — khớp nếu tất cả đều có (kể cả đảo thứ tự trong tên file) */
  tokens: string[]
}

function normalizeCompact(text: string): string {
  return text.toLowerCase().replace(/[\s\-_.\\/]+/g, '')
}

function normalizeSpaced(text: string): string {
  return text.toLowerCase().replace(/[\s\-_\\/]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function sanitizeKeywords(keywords: string[]): MatchPattern[] {
  const patterns: MatchPattern[] = []
  const seen = new Set<string>()

  for (const raw of keywords) {
    const parts = raw.split(KEYWORD_OR_SPLIT_RE).map((item) => item.trim()).filter(Boolean)
    for (const part of parts) {
      const compact = normalizeCompact(part)
      if (!compact || seen.has(compact)) continue
      seen.add(compact)
      patterns.push({
        raw: part,
        compact,
        spaced: normalizeSpaced(part),
        tokens: part
          .toLowerCase()
          .split(/\s+/)
          .map((token) => normalizeCompact(token))
          .filter(Boolean),
      })
    }
  }
  return patterns
}

/** Luôn tạo UNC chuẩn \\host\share… bất kể user gõ thiếu dấu \. */
function normalizeUncSourcePath(raw: string): string {
  const path = raw.trim().replace(/\//g, '\\')
  if (!path) return ''

  const segments = path.replace(/^\\+/, '').replace(/\\+$/, '').split('\\').filter(Boolean)
  if (segments.length === 0) return ''

  return `\\\\${segments.join('\\')}`
}

function joinPath(base: string, name: string): string {
  if (base.startsWith('\\\\')) {
    const root = base.replace(/\\+$/, '')
    const segment = name.replace(/^\\+/, '')
    return segment ? `${root}\\${segment}` : root
  }
  return join(base, name)
}

function isUncHostOnly(path: string): boolean {
  if (!path.startsWith('\\\\')) return false
  return path.slice(2).split('\\').filter(Boolean).length === 1
}

function extractUncHost(path: string): string | null {
  if (!path.startsWith('\\\\')) return null
  return path.slice(2).split('\\').filter(Boolean)[0] ?? null
}

function emptyResult(success: boolean, message: string): QuickFileSearchResult {
  return { success, message, scannedCount: 0, matchedCount: 0, copiedCount: 0, files: [], items: [] }
}

function matchesPattern(haystack: string, pattern: MatchPattern): boolean {
  const hayCompact = normalizeCompact(haystack)
  const haySpaced = normalizeSpaced(haystack)

  if (hayCompact.includes(pattern.compact)) return true
  if (pattern.spaced && haySpaced.includes(pattern.spaced)) return true
  if (pattern.tokens.length > 1 && pattern.tokens.every((token) => hayCompact.includes(token))) return true

  return false
}

/** Khớp cả tên file và đường dẫn đầy đủ (thư mục cha có thể chứa mã). */
function findMatchingKeyword(fullPath: string, fileName: string, patterns: MatchPattern[]): string | null {
  for (const pattern of patterns) {
    if (matchesPattern(fileName, pattern) || matchesPattern(fullPath, pattern)) {
      return pattern.raw
    }
  }
  return null
}
