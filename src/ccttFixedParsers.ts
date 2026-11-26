import type { HoSoRecord } from './types.js'
import { ccttCanonicalSearchParts, normalizeCcttLabel } from './ccttCanonicalFields.js'
import { ccttDatasetTag, type CcttDatasetKind } from './ccttDataSources.js'
import { normalizeSearchText } from './textNormalize.js'

type CellValue = string | number | boolean | Date | null | undefined
export type CcttGrid = CellValue[][]

const VBDLIS_HEADER_ROW = 2
const VBDLIS_DATA_START = 4
const HO_SO_TIEP_NHAN_HEADER_ROW = 1
const HO_SO_TIEP_NHAN_DATA_START = 2
const SO_THEO_DOI_HEADER_ROW = 7
const SO_THEO_DOI_DATA_START = 9

/** Header đưa vào searchText (sau normalizeCcttLabel). */
const VBDLIS_SEARCH_HEADERS = new Set(
  [
    'stt',
    'ten xa',
    'ten huyen',
    'so thu tu hsttdk',
    'so phat hanh',
    'so vao so',
    'so vao so cu',
    'ma vach',
    'so hieu to ban do',
    'so thu tu thua',
    'so hieu to ban do cu',
    'so thu tu thua cu',
    'dia chi thua dat',
    'ten duong',
    'to dan pho',
    'loai chu',
    'ho ten',
    'nam sinh',
    'dia chi chu',
    'so giay to',
    'ho ten 2',
    'namsinh2',
    'dia chi chu 2',
    'so giay to 2',
    'ten to chuc',
    'so giay to to chuc',
    'ten cong dong',
    'so giay to cong dong',
  ].map((h) => h),
)

const HO_SO_TIEP_NHAN_SEARCH_HEADERS = new Set(
  [
    'stt',
    'tinh thanh pho',
    'quan huyen',
    'phuong xa',
    'so bien nhan',
    'ma ho so mot cua',
    'ma ho so truc tuyen',
    'dia chi tai san',
    'ghi chu chuyen viec',
    'ghi chu cap nhat du lieu phap ly',
    'ghi chu ket iso',
    'ghi chu nhan van ban bo sung',
    'ghi chu tra ho so',
  ].map((h) => h),
)

const SO_THEO_DOI_SEARCH_HEADERS = new Set(
  [
    'so thu tu',
    'ma so ho so',
    'ten tthc',
    'ten ca nhan to chuc',
    'dia chi',
    'so dien thoai',
    'ghi chu',
  ].map((h) => h),
)

function cellToString(value: CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().split('T')[0]
  return String(value).trim()
}

function isEmptyRow(row: CellValue[] | undefined): boolean {
  return !row || row.every((c) => cellToString(c) === '')
}

function countNonEmpty(row: CellValue[] | undefined): number {
  return (row ?? []).map(cellToString).filter(Boolean).length
}

function makeId(file: string, sheet: string, row: number, suffix: string): string {
  return Buffer.from(`${file}::${sheet}::${row}::${suffix}`).toString('base64url')
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

/** Hàng số thứ tự cột (1, 2, 3, …) ngay dưới header VBDLIS. */
export function isColumnIndexRow(row: CellValue[] | undefined): boolean {
  const cells = (row ?? []).map(cellToString).filter(Boolean)
  if (cells.length < 5) return false
  let numeric = 0
  for (const c of cells) {
    if (/^\d+$/.test(c)) numeric++
  }
  return numeric / cells.length >= 0.8
}

function buildLeanSearchText(
  sourceFile: string,
  sheetName: string,
  fields: Record<string, string | number | null>,
  searchHeaderNorms: Set<string>,
): string {
  const values: string[] = []
  for (const [header, raw] of Object.entries(fields)) {
    const val = cellToString(raw)
    if (!val) continue
    const norm = normalizeCcttLabel(header.replace(/_\d+$/, ''))
    if (searchHeaderNorms.has(norm)) {
      values.push(val)
    }
  }
  const canonical = ccttCanonicalSearchParts(fields)
  return normalizeSearchText([sourceFile, sheetName, ...values, ...canonical].filter(Boolean).join(' '))
}

function extractFixedTabular(
  grid: CcttGrid,
  headerRow: number,
  dataStartRow: number,
  sourceFile: string,
  sheetName: string,
  datasetKind: Exclude<CcttDatasetKind, 'generic'>,
  searchHeaderNorms: Set<string>,
  skipColumnIndexRow: boolean,
): HoSoRecord[] {
  if (headerRow < 0 || headerRow >= grid.length) return []

  const rawHeaders = (grid[headerRow] ?? []).map((c, i) => cellToString(c) || `cột_${i + 1}`)
  const headers = makeUniqueHeaders(rawHeaders)
  const datasetTag = ccttDatasetTag(datasetKind)
  const tags = datasetTag ? [datasetTag, 'cctt', 'fixed-tabular'] : ['cctt', 'fixed-tabular']

  let start = Math.max(dataStartRow, headerRow + 1)
  if (skipColumnIndexRow && start < grid.length && isColumnIndexRow(grid[start])) {
    start += 1
  }

  const records: HoSoRecord[] = []
  for (let r = start; r < grid.length; r++) {
    const row = grid[r] ?? []
    if (isEmptyRow(row)) continue
    if (countNonEmpty(row) < 2) continue

    const fields: Record<string, string | number | null> = {}
    headers.forEach((h, c) => {
      const val = cellToString(row[c])
      if (val) fields[h] = val
    })
    if (Object.keys(fields).length === 0) continue

    records.push({
      id: makeId(sourceFile, sheetName, r, datasetKind),
      sourceFile,
      sheetName,
      type: 'tabular',
      rowStart: r + 1,
      rowEnd: r + 1,
      fields,
      searchText: buildLeanSearchText(sourceFile, sheetName, fields, searchHeaderNorms),
      tags: [...tags],
    })
  }
  return records
}

export function parseVbdlisSheet(
  grid: CcttGrid,
  sourceFile: string,
  sheetName: string,
): HoSoRecord[] {
  return extractFixedTabular(
    grid,
    VBDLIS_HEADER_ROW,
    VBDLIS_DATA_START,
    sourceFile,
    sheetName,
    'vbdlis',
    VBDLIS_SEARCH_HEADERS,
    true,
  )
}

export function parseHoSoTiepNhanVbdlisSheet(
  grid: CcttGrid,
  sourceFile: string,
  sheetName: string,
): HoSoRecord[] {
  return extractFixedTabular(
    grid,
    HO_SO_TIEP_NHAN_HEADER_ROW,
    HO_SO_TIEP_NHAN_DATA_START,
    sourceFile,
    sheetName,
    'hoSoTiepNhanVbdlis',
    HO_SO_TIEP_NHAN_SEARCH_HEADERS,
    false,
  )
}

export function parseSoTheoDoiMcSheet(
  grid: CcttGrid,
  sourceFile: string,
  sheetName: string,
): HoSoRecord[] {
  return extractFixedTabular(
    grid,
    SO_THEO_DOI_HEADER_ROW,
    SO_THEO_DOI_DATA_START,
    sourceFile,
    sheetName,
    'soTheoDoiMc',
    SO_THEO_DOI_SEARCH_HEADERS,
    false,
  )
}

export function parseCcttFixedSheet(
  kind: CcttDatasetKind,
  grid: CcttGrid,
  sourceFile: string,
  sheetName: string,
): HoSoRecord[] | null {
  if (kind === 'vbdlis') return parseVbdlisSheet(grid, sourceFile, sheetName)
  if (kind === 'hoSoTiepNhanVbdlis') return parseHoSoTiepNhanVbdlisSheet(grid, sourceFile, sheetName)
  if (kind === 'soTheoDoiMc') return parseSoTheoDoiMcSheet(grid, sourceFile, sheetName)
  return null
}
