export type { CcttSourceFilterOption } from './ccttDataSources.js'

export type RecordType = 'tabular' | 'keyvalue' | 'block' | 'merged'

export interface HoSoRecord {
  id: string
  sourceFile: string
  sheetName: string
  type: RecordType
  rowStart: number
  rowEnd: number
  fields: Record<string, string | number | null>
  searchText: string
  tags: string[]
}

export interface IndexMeta {
  version: number
  builtAt: string
  fileCount: number
  sheetCount: number
  recordCount: number
  sourceFiles: string[]
}

export interface SearchIndex {
  meta: IndexMeta
  records: HoSoRecord[]
}

export interface SearchResult {
  record: HoSoRecord
  score: number
  matches?: readonly FuseMatch[]
}

export interface FuseMatch {
  key?: string
  value?: string
  indices?: readonly [number, number][]
}

export interface ParserProfile {
  version: number
  learnedKeywords: string[]
  knownHeaders: Record<string, { text: string; hits: number }>
  fuseThreshold: number
  searchCount: number
  lastTunedAt: string
}

export interface QuickFileSearchRequest {
  sourcePath: string
  destinationPath: string
  keywords: string[]
  jobId?: string
  distributed?: boolean
}

export interface QuickFileSearchProgress {
  phase: 'scanning' | 'copying' | 'done'
  scannedCount: number
  matchedCount: number
  copiedCount: number
  currentPath?: string
  message: string
  jobId?: string
  peerId?: string
}

export interface QuickFileSearchMatchItem {
  keyword: string
  fileName: string
  sourcePath: string
  destinationPath?: string
  copied: boolean
}

export interface QuickFileSearchResult {
  success: boolean
  message: string
  scannedCount: number
  matchedCount: number
  copiedCount: number
  /** Đường dẫn đích của mọi file copy thành công */
  files: string[]
  items: QuickFileSearchMatchItem[]
  reportPath?: string
}

export interface FileCacheEntry {
  mtimeMs: number
  size: number
  records: HoSoRecord[]
}
