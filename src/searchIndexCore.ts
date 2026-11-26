import Fuse, { type IFuseOptions } from 'fuse.js'
import type { CcttSourceFilterOption, FuseMatch, HoSoRecord, SearchResult } from './types.js'
import { normalizeSearchText, tokenizeSearchText } from './textNormalize.js'
import { computeRelevance, queryTokens } from './relevanceScore.js'

const BATCH_YIELD_EVERY = 1500
/** Không build Fuse khi corpus lớn — tránh spike RAM. */
const FUSE_MAX_RECORDS = 20_000
function buildFuseOptions(threshold: number): IFuseOptions<HoSoRecord> {
  return {
    keys: [
      { name: 'searchText', weight: 0.85 },
      { name: 'sourceFile', weight: 0.1 },
      { name: 'sheetName', weight: 0.05 },
    ],
    threshold: Math.max(threshold, 0.45),
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true,
    includeMatches: false,
    useExtendedSearch: false,
  }
}

function addToPosting(map: Map<string, Set<number>>, key: string, idx: number): void {
  let set = map.get(key)
  if (!set) {
    set = new Set()
    map.set(key, set)
  }
  set.add(idx)
}

/** Logic tra cứu — ưu tiên ít RAM (không prefix index, Fuse tùy chọn). */
export class SearchIndexCore {
  private fuse: Fuse<HoSoRecord> | null = null
  private records: HoSoRecord[] = []
  private idToIndex = new Map<string, number>()
  private tokenIndex = new Map<string, Set<number>>()
  private threshold = 0.35

  clear(): void {
    this.records = []
    this.idToIndex.clear()
    this.tokenIndex.clear()
    this.fuse = null
  }

  setThreshold(value: number): void {
    this.threshold = Math.min(value, 0.5)
    if (this.records.length > 0) {
      this.fuse = null
    }
  }

  appendBatch(batch: HoSoRecord[], startOffset: number): void {
    if (batch.length === 0) return
    if (startOffset === 0) {
      this.clear()
      this.records = new Array(batch.length)
    } else if (startOffset + batch.length > this.records.length) {
      this.records.length = startOffset + batch.length
    }

    for (let i = 0; i < batch.length; i++) {
      const idx = startOffset + i
      const rec = batch[i]!
      this.records[idx] = rec
      this.idToIndex.set(rec.id, idx)
      this.indexRecordTokens(rec, idx)
    }
  }

  trimToLength(length: number): void {
    if (length < this.records.length) {
      this.records.length = length
    }
  }

  buildFuseIndex(): void {
    if (this.records.length === 0 || this.records.length > FUSE_MAX_RECORDS) {
      this.fuse = null
      return
    }
    this.fuse = new Fuse(this.records, buildFuseOptions(this.threshold))
  }

  getRecordCount(): number {
    return this.records.length
  }

  search(
    query: string,
    limit = 50,
    source: CcttSourceFilterOption = 'all',
  ): SearchResult[] {
    const q = normalizeSearchText(query)
    if (!q || this.records.length === 0) return []

    const tokens = queryTokens(query)
    if (tokens.length === 0) return []

    const scored = new Map<number, number>()

    const matchesSource = (idx: number): boolean => {
      if (source === 'all') return true
      return this.records[idx]?.tags.includes(source) ?? false
    }

    const addScore = (idx: number, relevance: number) => {
      if (!matchesSource(idx)) return
      if (relevance < 0.25) return
      const prev = scored.get(idx) ?? 0
      if (relevance > prev) scored.set(idx, relevance)
    }

    // Giao các từ khóa — thiếu một từ thì không đưa vào kết quả.
    const hits = this.intersectTokens(tokens)
    for (const idx of hits) {
      addScore(idx, computeRelevance(this.records[idx]!, query, tokens))
      if (tokens.length === 1 && scored.size >= limit) break
    }

    return [...scored.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([idx, relevance]) => ({
        record: this.records[idx]!,
        score: 1 - relevance,
        matches: undefined as FuseMatch[] | undefined,
      }))
  }

  private indexRecordTokens(rec: HoSoRecord, idx: number): void {
    const words = new Set(tokenizeSearchText(rec.searchText))
    for (const w of words) {
      if (!w) continue
      addToPosting(this.tokenIndex, w, idx)
    }
  }

  /** Hồ sơ chứa đủ mọi từ khóa (không cộng hồ sơ chỉ khớp một từ). */
  private intersectTokens(tokens: string[]): Set<number> {
    const sets: Set<number>[] = []
    for (const token of tokens) {
      const set = this.tokenIndex.get(token)
      if (!set || set.size === 0) return new Set()
      sets.push(set)
    }
    sets.sort((a, b) => a.size - b.size)
    const result = new Set<number>()
    const first = sets[0]!
    for (const idx of first) {
      let ok = true
      for (let i = 1; i < sets.length; i++) {
        if (!sets[i]!.has(idx)) {
          ok = false
          break
        }
      }
      if (ok) result.add(idx)
    }
    return result
  }
}

export const SEARCH_BATCH_YIELD_EVERY = BATCH_YIELD_EVERY
