import { normalizeSearchText } from './textNormalize.js'

/** Một từ chèn giữa hai từ khóa liền kề — đủ cho «Văn/Thị». */
const NAME_TOKEN_GAP = 1

/**
 * Các từ khóa chữ phải đứng đúng thứ tự, mỗi cặp cách nhau tối đa một từ.
 * Trả về số từ chèn, hoặc null nếu không có cửa sổ nào.
 */
export function orderedNameWindowExtra(haystack: string, nameTokens: readonly string[]): number | null {
  if (nameTokens.length === 0) return null
  const words = normalizeSearchText(haystack)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  let best: number | null = null

  for (let start = 0; start < words.length; start++) {
    if (words[start] !== nameTokens[0]) continue
    let from = start + 1
    let extra = 0
    let ok = true
    for (let t = 1; t < nameTokens.length; t++) {
      const limit = Math.min(words.length, from + NAME_TOKEN_GAP + 1)
      let found = -1
      for (let i = from; i < limit; i++) {
        if (words[i] === nameTokens[t]) {
          found = i
          break
        }
      }
      if (found < 0) {
        ok = false
        break
      }
      extra += found - from
      from = found + 1
    }
    if (ok && (best === null || extra < best)) best = extra
  }

  return best
}
