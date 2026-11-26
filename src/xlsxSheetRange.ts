import * as XLSX from 'xlsx'

/**
 * Một số file xuất VBDLIS khai báo `!ref` sai (vd. A1:DR7) trong khi cell thật tới hàng nghìn.
 * Mở rộng range bằng cách quét mọi key ô thực tế.
 */
export function decodeWorksheetUsedRange(worksheet: XLSX.WorkSheet): XLSX.Range {
  let range = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1')
  for (const key of Object.keys(worksheet)) {
    if (key.charAt(0) === '!') continue
    const cell = XLSX.utils.decode_cell(key)
    if (cell.r < range.s.r) range.s.r = cell.r
    if (cell.c < range.s.c) range.s.c = cell.c
    if (cell.r > range.e.r) range.e.r = cell.r
    if (cell.c > range.e.c) range.e.c = cell.c
  }
  return range
}
