import * as XLSX from 'xlsx'
import { readFileSync, readdirSync, statSync, type Dirent } from 'fs'
import { join, basename } from 'path'
import type { HoSoRecord, RecordType } from './types.js'
import { decodeWorksheetUsedRange } from './xlsxSheetRange.js'

type CellValue = string | number | boolean | Date | null | undefined
type Grid = CellValue[][]

const HOSO_KEYWORDS = [
  'hồ sơ', 'ho so', 'hoso', 'dossier', 'tài liệu', 'tai lieu',
  'số hồ sơ', 'so ho so', 'shs', 'mã hồ sơ', 'ma ho so',
  'tên hồ sơ', 'ten ho so', 'tiêu đề', 'tieu de', 'trích yếu', 'trich yeu',
  'phông', 'phong', 'fonds', 'mục lục', 'muc luc', 'mlhs',
  'hộp', 'hop', 'cặp', 'cap', 'thùng', 'thung',
  'kệ', 'ke', 'giá', 'gia', 'tủ', 'tu', 'dãy', 'day',
  'vị trí', 'vi tri', 'lưu trữ', 'luu tru', 'lưu kho', 'luu kho',
  'ngày lưu', 'ngay luu', 'ngày nộp', 'ngay nop', 'năm', 'nam', 'year',
  'thời hạn', 'thoi han', 'bảo quản', 'bao quan', 'thời gian', 'thoi gian',
  'người nộp', 'nguoi nop', 'cơ quan', 'co quan', 'đơn vị', 'don vi',
  'loại hồ sơ', 'loai ho so', 'số tờ', 'so to', 'số trang', 'so trang',
  'ghi chú', 'ghi chu', 'note', 'remark', 'tt', 'stt',
]

function cellToString(value: CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().split('T')[0]
  return String(value).trim()
}

function isEmptyRow(row: CellValue[]): boolean {
  return row.every((c) => cellToString(c) === '')
}

function normalizeHeader(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeHeader(text: string): boolean {
  const n = normalizeHeader(text)
  return HOSO_KEYWORDS.some((kw) => n.includes(kw))
}

function countNonEmptyCells(row: CellValue[]): number {
  return row.map(cellToString).filter(Boolean).length
}

function scoreHeaderRow(row: CellValue[]): number {
  const cells = row.map(cellToString).filter(Boolean)
  if (cells.length < 3) return 0

  let score = cells.length
  for (const cell of cells) {
    if (looksLikeHeader(cell)) score += 3
    if (/^\d+([.,]\d+)?$/.test(cell)) score -= 1
  }
  return score
}

function detectHeaderRow(grid: Grid): number {
  const limit = Math.min(grid.length, 20)
  let bestRow = -1
  let bestScore = 0

  for (let i = 0; i < limit; i++) {
    const row = grid[i] ?? []
    if (countNonEmptyCells(row) < 3) continue

    const score = scoreHeaderRow(row)
    if (score > bestScore) {
      bestScore = score
      bestRow = i
    }
  }

  return bestScore >= 5 ? bestRow : -1
}

function isKeyValueDominant(grid: Grid): boolean {
  let kvPairs = 0
  let tabularRows = 0

  for (const row of grid) {
    const nonEmpty = countNonEmptyCells(row)
    if (nonEmpty === 0) continue

    const label = cellToString(row[0])
    const value = cellToString(row[1])
    const restEmpty = row.slice(2).every((c) => cellToString(c) === '')

    if (label && value && restEmpty && nonEmpty === 2) {
      kvPairs++
    } else if (nonEmpty >= 3) {
      tabularRows++
    }
  }

  return kvPairs >= 2 && kvPairs > tabularRows
}

function makeUniqueHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>()
  return headers.map((h, i) => {
    const base = h || `cột_${i + 1}`
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    return count === 0 ? base : `${base}_${count + 1}`
  })
}

function buildSearchText(parts: (string | number | null | undefined)[]): string {
  return parts
    .map((p) => (p == null ? '' : String(p)))
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function makeId(file: string, sheet: string, row: number, suffix = ''): string {
  const safe = `${basename(file)}::${sheet}::${row}${suffix ? `::${suffix}` : ''}`
  return Buffer.from(safe).toString('base64url')
}

function extractTabular(
  grid: Grid,
  headerRow: number,
  sourceFile: string,
  sheetName: string,
): HoSoRecord[] {
  const records: HoSoRecord[] = []
  const headerCells = grid[headerRow] ?? []
  const rawHeaders = headerCells.map((c, i) => cellToString(c) || `cột_${i + 1}`)
  const headers = makeUniqueHeaders(rawHeaders)

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? []
    if (isEmptyRow(row)) continue

    const fields: Record<string, string | number | null> = {}
    const values: string[] = []

    headers.forEach((h, c) => {
      const val = cellToString(row[c])
      if (val) {
        fields[h] = val
        values.push(`${h}: ${val}`)
      }
    })

    if (values.length === 0) continue

    records.push({
      id: makeId(sourceFile, sheetName, r),
      sourceFile,
      sheetName,
      type: 'tabular',
      rowStart: r + 1,
      rowEnd: r + 1,
      fields,
      searchText: buildSearchText([sourceFile, sheetName, ...values]),
      tags: ['tabular'],
    })
  }

  return records
}

function extractKeyValue(
  grid: Grid,
  sourceFile: string,
  sheetName: string,
): HoSoRecord[] {
  const records: HoSoRecord[] = []
  let blockStart = -1
  let blockFields: Record<string, string> = {}

  const flushBlock = (endRow: number) => {
    if (Object.keys(blockFields).length === 0) return
    const values = Object.entries(blockFields).map(([k, v]) => `${k}: ${v}`)
    records.push({
      id: makeId(sourceFile, sheetName, blockStart, 'kv'),
      sourceFile,
      sheetName,
      type: 'keyvalue',
      rowStart: blockStart + 1,
      rowEnd: endRow + 1,
      fields: { ...blockFields },
      searchText: buildSearchText([sourceFile, sheetName, ...values]),
      tags: ['keyvalue'],
    })
    blockFields = {}
    blockStart = -1
  }

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? []
    const label = cellToString(row[0])
    const value = cellToString(row[1])

    if (label && value && row.slice(2).every((c) => cellToString(c) === '')) {
      if (blockStart < 0) blockStart = r
      blockFields[label] = value
    } else {
      if (blockStart >= 0) flushBlock(r - 1)
    }
  }

  if (blockStart >= 0) flushBlock(grid.length - 1)
  return records
}

function extractBlocks(
  grid: Grid,
  sourceFile: string,
  sheetName: string,
): HoSoRecord[] {
  const records: HoSoRecord[] = []
  let currentBlock: string[] = []
  let blockStart = -1

  const flush = (endRow: number) => {
    const text = currentBlock.join(' ').trim()
    if (!text || text.length < 4) {
      currentBlock = []
      blockStart = -1
      return
    }

    records.push({
      id: makeId(sourceFile, sheetName, blockStart, 'block'),
      sourceFile,
      sheetName,
      type: 'block',
      rowStart: blockStart + 1,
      rowEnd: endRow + 1,
      fields: { nội_dung: text },
      searchText: buildSearchText([sourceFile, sheetName, text]),
      tags: ['block'],
    })
    currentBlock = []
    blockStart = -1
  }

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? []
    if (isEmptyRow(row)) {
      if (blockStart >= 0) flush(r - 1)
      continue
    }

    const line = row.map(cellToString).filter(Boolean).join(' | ')
    if (!line) continue

    if (blockStart < 0) blockStart = r
    currentBlock.push(line)
  }

  if (blockStart >= 0) flush(grid.length - 1)
  return records
}

function sheetToGrid(worksheet: XLSX.WorkSheet): Grid {
  const range = decodeWorksheetUsedRange(worksheet)
  const grid: Grid = []

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: CellValue[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = worksheet[addr]
      row.push(cell?.v ?? null)
    }
    grid.push(row)
  }

  return grid
}

function parseSheet(
  worksheet: XLSX.WorkSheet,
  sourceFile: string,
  sheetName: string,
): HoSoRecord[] {
  const grid = sheetToGrid(worksheet)
  const nonEmptyRows = grid.filter((r) => !isEmptyRow(r))
  if (nonEmptyRows.length === 0) return []

  const records: HoSoRecord[] = []
  const keyValueDominant = isKeyValueDominant(grid)

  if (keyValueDominant) {
    records.push(...extractKeyValue(grid, sourceFile, sheetName))
  } else {
    const headerRow = detectHeaderRow(grid)
    if (headerRow >= 0) {
      const tabular = extractTabular(grid, headerRow, sourceFile, sheetName)
      if (tabular.length > 0) records.push(...tabular)
    }

    const keyValue = extractKeyValue(grid, sourceFile, sheetName)
    if (keyValue.length > 0) records.push(...keyValue)
  }

  if (records.length === 0) {
    records.push(...extractBlocks(grid, sourceFile, sheetName))
  }

  return dedupeRecords(records)
}

function dedupeRecords(records: HoSoRecord[]): HoSoRecord[] {
  const seen = new Set<string>()
  const result: HoSoRecord[] = []

  for (const rec of records) {
    const key = `${rec.type}::${rec.rowStart}::${rec.searchText.slice(0, 80)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(rec)
  }

  return result
}

export function parseExcelFile(filePath: string): HoSoRecord[] {
  const buffer = readFileSync(filePath)
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sourceFile = basename(filePath)
  const allRecords: HoSoRecord[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    allRecords.push(...parseSheet(sheet, sourceFile, sheetName))
  }

  return allRecords
}

function walkExcelFiles(dir: string, results: string[]): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkExcelFiles(fullPath, results)
    } else if (/\.(xlsx|xls|xlsm|xlsb)$/i.test(entry.name)) {
      results.push(fullPath)
    }
  }
}

export function listExcelFiles(rawDataDir: string): string[] {
  const results: string[] = []
  walkExcelFiles(rawDataDir, results)
  return results
}

export function parseAllExcel(rawDataDir: string): { records: HoSoRecord[]; errors: string[] } {
  const files = listExcelFiles(rawDataDir)
  const records: HoSoRecord[] = []
  const errors: string[] = []

  for (const file of files) {
    try {
      records.push(...parseExcelFile(file))
    } catch (err) {
      errors.push(`${basename(file)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { records, errors }
}
