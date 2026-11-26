/** Thư mục con cố định dưới excelDataDir (xuất hệ thống đất đai). */
export const CCTT_DATA_FOLDERS = {
  vbdlis: 'chi-tiet-dang-ky-vbdlis',
  hoSoTiepNhanVbdlis: 'ho-so-tiep-nhan-vbdlis',
  soTheoDoiMc: 'so-theo-doi-mc',
  hoSoLuu: 'ho-so-luu',
} as const

export type CcttDatasetKind = 'vbdlis' | 'hoSoTiepNhanVbdlis' | 'soTheoDoiMc' | 'hoSoLuu' | 'generic'

/** Tag nguồn hồ sơ đo đạc (NocoDB / SQLite local) trong index tra cứu. */
export const HO_SO_DO_DAC_SEARCH_TAG = 'ho-so-do-dac' as const

/** Tag gắn vào HoSoRecord.tags khi parse theo nguồn. */
export type CcttDatasetTag =
  | 'vbdlis'
  | 'ho-so-tiep-nhan'
  | 'so-theo-doi'
  | 'ho-so-luu'
  | typeof HO_SO_DO_DAC_SEARCH_TAG

export const CCTT_SOURCE_FILTER_OPTIONS = [
  'all',
  'vbdlis',
  'ho-so-tiep-nhan',
  'so-theo-doi',
  'ho-so-luu',
  HO_SO_DO_DAC_SEARCH_TAG,
] as const

export type CcttSourceFilterOption = (typeof CCTT_SOURCE_FILTER_OPTIONS)[number]

export function normalizeSourceRelPath(sourceFileRel: string): string {
  return sourceFileRel.replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

function folderPrefix(folder: string): string {
  return `${folder.toLowerCase()}/`
}

function matchesFolder(normPath: string, folder: string): boolean {
  const lower = folder.toLowerCase()
  return normPath === lower || normPath.startsWith(folderPrefix(folder))
}

/** Nhận diện nguồn theo đường dẫn tương đối POSIX (vd. chi-tiet-dang-ky-vbdlis/Trang_1.xlsx). */
export function detectCcttDataset(sourceFileRel: string): CcttDatasetKind {
  const norm = normalizeSourceRelPath(sourceFileRel).toLowerCase()
  if (!norm) return 'generic'
  if (matchesFolder(norm, CCTT_DATA_FOLDERS.vbdlis)) return 'vbdlis'
  if (matchesFolder(norm, CCTT_DATA_FOLDERS.hoSoTiepNhanVbdlis)) return 'hoSoTiepNhanVbdlis'
  if (matchesFolder(norm, CCTT_DATA_FOLDERS.soTheoDoiMc)) return 'soTheoDoiMc'
  if (matchesFolder(norm, CCTT_DATA_FOLDERS.hoSoLuu)) return 'hoSoLuu'
  return 'generic'
}

export function ccttDatasetTag(kind: CcttDatasetKind): CcttDatasetTag | null {
  if (kind === 'vbdlis') return 'vbdlis'
  if (kind === 'hoSoTiepNhanVbdlis') return 'ho-so-tiep-nhan'
  if (kind === 'soTheoDoiMc') return 'so-theo-doi'
  if (kind === 'hoSoLuu') return 'ho-so-luu'
  return null
}

export function isHoSoDoDacSearchRecord(tags: string[] | undefined): boolean {
  return Boolean(tags?.includes(HO_SO_DO_DAC_SEARCH_TAG))
}

/** Tag nguồn trên kết quả tìm. */
export function ccttSourceTagFromRecordTags(tags: string[] | undefined): CcttDatasetTag | null {
  if (!tags?.length) return null
  if (tags.includes(HO_SO_DO_DAC_SEARCH_TAG)) return HO_SO_DO_DAC_SEARCH_TAG
  if (tags.includes('vbdlis')) return 'vbdlis'
  if (tags.includes('ho-so-tiep-nhan')) return 'ho-so-tiep-nhan'
  if (tags.includes('so-theo-doi')) return 'so-theo-doi'
  if (tags.includes('ho-so-luu')) return 'ho-so-luu'
  return null
}
