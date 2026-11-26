import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'
import { basename, relative } from 'path'
import { ccttCanonicalSearchParts } from './ccttCanonicalFields.js'
import { detectCcttDataset } from './ccttDataSources.js'
import { parseCcttFixedSheet, type CcttGrid } from './ccttFixedParsers.js'
import type { HoSoRecord, ParserProfile } from './types.js'
import { listExcelFiles } from './excelParser.js'
import { normalizeSearchText as normalizeToken } from './textNormalize.js'
import { decodeWorksheetUsedRange } from './xlsxSheetRange.js'

type CellValue = string | number | boolean | Date | null | undefined
type Grid = CellValue[][]

const BASE_KEYWORDS = [
  'hồ sơ', 'ho so', 'dossier', 'tài liệu', 'tai lieu',
  'số hồ sơ', 'so ho so', 'mã hồ sơ', 'ma ho so',
  'tên hồ sơ', 'ten ho so', 'tiêu đề', 'tieu de', 'trích yếu', 'trich yeu',
  'phông', 'phong', 'mục lục', 'muc luc', 'hộp', 'hop', 'kệ', 'ke',
  'vị trí', 'vi tri', 'lưu trữ', 'luu tru', 'lưu kho', 'luu kho',
  'ngày lưu', 'ngay luu', 'ngày nộp', 'ngay nop', 'năm', 'nam',
  'thời hạn', 'thoi han', 'bảo quản', 'bao quan', 'cơ quan', 'co quan',
  'đơn vị', 'don vi', 'số tờ', 'so to', 'ghi chú', 'ghi chu', 'stt', 'tt',
  // CCTT — họ tên / năm sinh / địa chỉ / GCN
  'họ tên', 'ho ten', 'họ và tên', 'ho va ten', 'chủ sử dụng', 'chu su dung',
  'chủ sở hữu', 'chu so huu', 'năm sinh', 'nam sinh', 'ngày sinh', 'ngay sinh',
  'địa chỉ', 'dia chi', 'thường trú', 'thuong tru', 'nơi ở', 'noi o',
  'số phát hành', 'so phat hanh', 'số gcn', 'so gcn', 'gcn', 'số vào sổ', 'so vao so',
  'số serial', 'so serial', 'mã gcn', 'ma gcn',
]

function getKeywords(profile: ParserProfile): string[] {
  const learned = profile.learnedKeywords
  const fromHeaders = Object.keys(profile.knownHeaders)
  return [...new Set([...BASE_KEYWORDS, ...learned, ...fromHeaders])]
}

function cellToString(value: CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().split('T')[0]
  return String(value).trim()
}

function isEmptyRow(row: CellValue[]): boolean {
  return row.every((c) => cellToString(c) === '')
}

function buildSearchText(parts: (string | number | null | undefined)[]): string {
  return normalizeToken(parts.map((p) => (p == null ? '' : String(p))).filter(Boolean).join(' '))
}

function buildRecordSearchText(
  sourceFile: string,
  sheetName: string,
  values: string[],
  fields: Record<string, string | number | null>,
): string {
  const canonical = ccttCanonicalSearchParts(fields)
  // Chỉ giá trị (không "header: value") để token không dính dấu ':'
  return buildSearchText([sourceFile, sheetName, ...values, ...canonical])
}

function ccttTags(fields: Record<string, string | number | null>): string[] {
  return ccttCanonicalSearchParts(fields).length > 0 ? ['cctt'] : []
}

function displayName(filePath: string, rawDataDir: string): string {
  return relative(rawDataDir, filePath).split(/[/\\]/).join('/') || basename(filePath)
}

function makeId(file: string, sheet: string, row: number, suffix: string): string {
  return Buffer.from(`${file}::${sheet}::${row}::${suffix}`).toString('base64url')
}

function looksLikeHeader(text: string, keywords: string[]): boolean {
  const n = normalizeToken(text)
  return keywords.some((kw) => n.includes(kw))
}

function countNonEmpty(row: CellValue[]): number {
  return row.map(cellToString).filter(Boolean).length
}

function scoreHeaderRow(row: CellValue[], keywords: string[]): number {
  const cells = row.map(cellToString).filter(Boolean)
  if (cells.length < 2) return 0
  let score = cells.length
  for (const cell of cells) {
    if (looksLikeHeader(cell, keywords)) score += 3
    if (/^\d+([.,]\d+)?$/.test(cell)) score -= 1
  }
  return score
}

function makeUniqueHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>()
  return headers.map((h, i) => {
    const base = h || `cột_${i + 1}`
    const n = counts.get(base) ?? 0
    counts.set(base, n + 1)
    return n === 0 ? base : `${base}_${n + 1}`
  })
}

function extractTabular(
  grid: Grid,
  headerRow: number,
  sourceFile: string,
  sheetName: string,
  tag: string,
): HoSoRecord[] {
  const records: HoSoRecord[] = []
  const rawHeaders = (grid[headerRow] ?? []).map((c, i) => cellToString(c) || `cột_${i + 1}`)
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
        values.push(val)
      }
    })
    if (values.length === 0) continue

    records.push({
      id: makeId(sourceFile, sheetName, r, tag),
      sourceFile,
      sheetName,
      type: 'tabular',
      rowStart: r + 1,
      rowEnd: r + 1,
      fields,
      searchText: buildRecordSearchText(sourceFile, sheetName, values, fields),
      tags: [tag, ...ccttTags(fields)],
    })
  }
  return records
}

function extractKeyValue(grid: Grid, sourceFile: string, sheetName: string): HoSoRecord[] {
  const records: HoSoRecord[] = []
  let blockStart = -1
  let blockFields: Record<string, string> = {}

  const flush = (endRow: number) => {
    if (Object.keys(blockFields).length === 0) return
    const fields: Record<string, string | number | null> = { ...blockFields }
    const values = Object.values(blockFields)
    records.push({
      id: makeId(sourceFile, sheetName, blockStart, 'kv'),
      sourceFile,
      sheetName,
      type: 'keyvalue',
      rowStart: blockStart + 1,
      rowEnd: endRow + 1,
      fields,
      searchText: buildRecordSearchText(sourceFile, sheetName, values, fields),
      tags: ['keyvalue', ...ccttTags(fields)],
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
    } else if (blockStart >= 0) {
      flush(r - 1)
    }
  }
  if (blockStart >= 0) flush(grid.length - 1)
  return records
}

function rowContainsTokens(row: CellValue[], tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const line = normalizeToken(row.map(cellToString).join(' '))
  return tokens.some((t) => line.includes(t))
}

function extractEveryRow(
  grid: Grid,
  sourceFile: string,
  sheetName: string,
  tokens: string[] = [],
): HoSoRecord[] {
  const records: HoSoRecord[] = []
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? []
    if (countNonEmpty(row) < 2) continue
    if (!rowContainsTokens(row, tokens)) continue

    const fields: Record<string, string | number | null> = {}
    const values: string[] = []
    row.forEach((cell, c) => {
      const val = cellToString(cell)
      if (val) {
        const key = `cột_${c + 1}`
        fields[key] = val
        values.push(val)
      }
    })

    records.push({
      id: makeId(sourceFile, sheetName, r, 'row'),
      sourceFile,
      sheetName,
      type: 'merged',
      rowStart: r + 1,
      rowEnd: r + 1,
      fields,
      searchText: buildRecordSearchText(sourceFile, sheetName, values, fields),
      tags: ['row-scan', ...ccttTags(fields)],
    })
  }
  return records
}

function sheetToGrid(worksheet: XLSX.WorkSheet): Grid {
  const range = decodeWorksheetUsedRange(worksheet)
  const grid: Grid = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: CellValue[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      row.push(worksheet[XLSX.utils.encode_cell({ r, c })]?.v ?? null)
    }
    grid.push(row)
  }
  return grid
}

function asCcttGrid(grid: Grid): CcttGrid {
  return grid
}

function parseSheetAdaptive(
  worksheet: XLSX.WorkSheet,
  sourceFile: string,
  sheetName: string,
  profile: ParserProfile,
  aggressive: boolean,
  queryTokens: string[] = [],
  /** Vét cạn mọi dòng (≥2 ô) — dùng cho ho-so-luu không cấu trúc cố định. */
  exhaustiveRows = false,
): HoSoRecord[] {
  const grid = sheetToGrid(worksheet)
  if (grid.filter((r) => !isEmptyRow(r)).length === 0) return []

  const keywords = getKeywords(profile)
  const records: HoSoRecord[] = []
  const minHeaderScore = aggressive ? 3 : 5
  const scanLimit = aggressive ? 50 : 20

  let bestRow = -1
  let bestScore = 0
  for (let i = 0; i < Math.min(grid.length, scanLimit); i++) {
    if (countNonEmpty(grid[i] ?? []) < 2) continue
    const score = scoreHeaderRow(grid[i] ?? [], keywords)
    if (score > bestScore) {
      bestScore = score
      bestRow = i
    }
  }

  if (bestScore >= minHeaderScore && bestRow >= 0) {
    records.push(...extractTabular(grid, bestRow, sourceFile, sheetName, 'adaptive-tabular'))
  }

  if (aggressive) {
    const altHeaders: number[] = []
    for (let i = 0; i < Math.min(grid.length, scanLimit); i++) {
      if (i === bestRow) continue
      if (scoreHeaderRow(grid[i] ?? [], keywords) >= 3 && countNonEmpty(grid[i] ?? []) >= 2) {
        altHeaders.push(i)
      }
    }
    for (const i of altHeaders.slice(0, 4)) {
      records.push(...extractTabular(grid, i, sourceFile, sheetName, `multi-h${i}`))
    }
    records.push(...extractKeyValue(grid, sourceFile, sheetName))
    if (exhaustiveRows || queryTokens.length > 0) {
      records.push(...extractEveryRow(grid, sourceFile, sheetName, queryTokens))
    }
  } else {
    records.push(...extractKeyValue(grid, sourceFile, sheetName))
  }

  return dedupeRecords(records)
}

function withDatasetTag(records: HoSoRecord[], tag: string | null): HoSoRecord[] {
  if (!tag) return records
  return records.map((rec) =>
    rec.tags.includes(tag) ? rec : { ...rec, tags: [tag, ...rec.tags] },
  )
}

function dedupeRecords(records: HoSoRecord[]): HoSoRecord[] {
  const seen = new Set<string>()
  const out: HoSoRecord[] = []
  for (const rec of records) {
    const key = `${rec.sourceFile}::${rec.sheetName}::${rec.rowStart}::${rec.searchText.slice(0, 100)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(rec)
  }
  return out
}

export function parseExcelFileAdaptive(
  filePath: string,
  rawDataDir: string,
  profile: ParserProfile,
): HoSoRecord[] {
  const wb = XLSX.read(readFileSync(filePath), { type: 'buffer', cellDates: true })
  const sourceFile = displayName(filePath, rawDataDir)
  const dataset = detectCcttDataset(sourceFile)
  const records: HoSoRecord[] = []

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue

    // Hồ sơ lưu: không schema cố định — vét cạn (multi-header + KV + mọi dòng)
    if (dataset === 'hoSoLuu') {
      const sheetRecords = parseSheetAdaptive(sheet, sourceFile, sheetName, profile, true, [], true)
      records.push(...withDatasetTag(sheetRecords, 'ho-so-luu'))
      continue
    }

    if (dataset !== 'generic') {
      const grid = asCcttGrid(sheetToGrid(sheet))
      const fixed = parseCcttFixedSheet(dataset, grid, sourceFile, sheetName)
      if (fixed) {
        records.push(...fixed)
        continue
      }
    }

    records.push(...parseSheetAdaptive(sheet, sourceFile, sheetName, profile, false, []))
  }

  return dedupeRecords(records)
}

export function parseAllAdaptive(
  rawDataDir: string,
  profile: ParserProfile,
  aggressive: boolean,
  query = '',
): { records: HoSoRecord[]; errors: string[] } {
  const queryTokens = normalizeToken(query).split(/\s+/).filter((t) => t.length >= 2)
  const records: HoSoRecord[] = []
  const errors: string[] = []

  for (const filePath of listExcelFiles(rawDataDir)) {
    try {
      const wb = XLSX.read(readFileSync(filePath), { type: 'buffer', cellDates: true })
      const sourceFile = displayName(filePath, rawDataDir)
      const dataset = detectCcttDataset(sourceFile)
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName]
        if (!sheet) continue

        if (dataset === 'hoSoLuu') {
          const sheetRecords = parseSheetAdaptive(
            sheet,
            sourceFile,
            sheetName,
            profile,
            true,
            queryTokens,
            true,
          )
          records.push(...withDatasetTag(sheetRecords, 'ho-so-luu'))
          continue
        }

        if (dataset !== 'generic') {
          const grid = asCcttGrid(sheetToGrid(sheet))
          const fixed = parseCcttFixedSheet(dataset, grid, sourceFile, sheetName)
          if (fixed) {
            records.push(...fixed)
            continue
          }
        }

        records.push(
          ...parseSheetAdaptive(sheet, sourceFile, sheetName, profile, aggressive, queryTokens),
        )
      }
    } catch (err) {
      errors.push(`${basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { records: dedupeRecords(records), errors }
}
