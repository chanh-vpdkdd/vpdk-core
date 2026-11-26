export const CCTT_SEARCH_MODES = ['single', 'multi'] as const
export type CcttSearchMode = (typeof CCTT_SEARCH_MODES)[number]

export const CCTT_KEYWORD_JOINS = ['and', 'or'] as const
export type CcttKeywordJoin = (typeof CCTT_KEYWORD_JOINS)[number]

export function isCcttKeywordJoin(value: string): value is CcttKeywordJoin {
  return (CCTT_KEYWORD_JOINS as readonly string[]).includes(value)
}

interface ScoredBatchItem {
  record: { id: string }
  score: number
}

function bestById<T extends ScoredBatchItem>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) {
    const prev = map.get(item.record.id)
    if (!prev || item.score < prev.score) map.set(item.record.id, item)
  }
  return map
}

/** Hợp hoặc giao các lần tìm đa từ khóa. Điểm thấp hơn được giữ. */
export function combineCcttSearchBatches<T extends ScoredBatchItem>(
  batches: readonly (readonly T[])[],
  join: CcttKeywordJoin,
): T[] {
  if (batches.length === 0) return []
  const maps = batches.map((batch) => bestById(batch))
  if (join === 'and') {
    const [first, ...rest] = maps
    if (!first || rest.some((map) => map.size === 0)) return []
    const kept: T[] = []
    for (const [id, item] of first) {
      let best = item
      let present = true
      for (const map of rest) {
        const found = map.get(id)
        if (!found) {
          present = false
          break
        }
        if (found.score < best.score) best = found
      }
      if (present) kept.push(best)
    }
    return kept.sort((a, b) => a.score - b.score)
  }
  const merged = new Map<string, T>()
  for (const map of maps) {
    for (const [id, item] of map) {
      const prev = merged.get(id)
      if (!prev || item.score < prev.score) merged.set(id, item)
    }
  }
  return [...merged.values()].sort((a, b) => a.score - b.score)
}

export function isCcttSearchMode(value: string): value is CcttSearchMode {
  return (CCTT_SEARCH_MODES as readonly string[]).includes(value)
}

export function ccttSearchKeywords(text: string, mode: CcttSearchMode): string[] {
  if (mode === 'single') {
    const keyword = text.replace(/\s+/g, ' ').trim()
    return keyword ? [keyword] : []
  }
  return splitCcttSearchKeywords(text)
}

export const CCTT_SEARCH_KEYWORD_LIMIT = 40

const SEPARATOR = /\s*(?:;|\bhoặc\b|\bhoac\b|\bor\b)\s*/i

/** Tách ô tìm thành từng từ khóa. Dấu phẩy nằm trong cùng một từ khóa. */
export function splitCcttSearchKeywords(text: string): string[] {
  const keywords: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    for (const part of line.split(SEPARATOR)) {
      const keyword = part.replace(/\s+/g, ' ').trim()
      if (!keyword) continue
      const key = keyword.toLocaleLowerCase('vi')
      if (seen.has(key)) continue
      seen.add(key)
      keywords.push(keyword)
      if (keywords.length >= CCTT_SEARCH_KEYWORD_LIMIT) return keywords
    }
  }
  return keywords
}
