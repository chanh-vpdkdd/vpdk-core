import type { HoSoRecord } from './types.js'
import { orderedNameWindowExtra } from './nameWindow.js'
import { tokenizeSearchText } from './textNormalize.js'

export function queryTokens(query: string): string[] {
  return tokenizeSearchText(query)
}

function wordsOf(text: string): string[] {
  return text.split(/[^a-z0-9]+/).filter(Boolean)
}

function isAlphaToken(token: string): boolean {
  return /^[a-z]+$/.test(token)
}

function hasWholeWord(words: string[], token: string): boolean {
  for (const word of words) {
    if (word === token) return true
  }
  return false
}

/**
 * Điểm 0–1. Mọi từ khóa phải là một từ nguyên trong hồ sơ.
 * Cụm chữ (họ tên, địa danh) phải đi cùng nhau, không lấy «Nguyễn» ở ô này và «Minh» ở ô khác.
 */
export function computeRelevance(record: HoSoRecord, query: string, tokens: string[]): number {
  void query
  if (tokens.length === 0 || !record.searchText) return 0

  const words = wordsOf(record.searchText)
  for (const token of tokens) {
    if (!hasWholeWord(words, token)) return 0
  }

  const alphaTokens = tokens.filter(isAlphaToken)
  if (alphaTokens.length >= 2) {
    const extra = orderedNameWindowExtra(record.searchText, alphaTokens)
    if (extra == null) return 0
    return extra === 0 ? 1 : 0.94
  }

  return 1
}
