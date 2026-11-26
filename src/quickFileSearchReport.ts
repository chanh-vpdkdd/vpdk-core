import { writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import type { QuickFileSearchMatchItem } from './types.js'

const REPORT_HEADERS = ['STT', 'Từ khóa', 'Tên file', 'Đường dẫn nguồn', 'Đường dẫn đích', 'Đã copy'] as const

export function buildQuickFileSearchReportBuffer(items: QuickFileSearchMatchItem[]): Buffer {
  const rows = items.map((item, index) => ({
    STT: index + 1,
    'Từ khóa': item.keyword,
    'Tên file': item.fileName,
    'Đường dẫn nguồn': item.sourcePath,
    'Đường dẫn đích': item.destinationPath ?? '',
    'Đã copy': item.copied ? 'Có' : 'Không',
  }))

  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...REPORT_HEADERS] })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Báo cáo tìm nhanh')

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export function writeQuickFileSearchReport(items: QuickFileSearchMatchItem[], filePath: string): string {
  const buffer = buildQuickFileSearchReportBuffer(items)
  writeFileSync(filePath, buffer)
  return filePath
}

export function quickFileSearchReportFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `bao-cao-tim-nhanh-${stamp}.xlsx`
}
