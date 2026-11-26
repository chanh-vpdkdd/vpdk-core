import { extractCcttCanonicalFields } from './ccttCanonicalFields.js'
import { readCcttReplyPerson, type CcttReplyPerson } from './ccttReply.js'
import {
  CCTT_REPLY_REVIEW_LIMIT,
  ccttReplyReviewSearches,
  judgeCcttReplyPerson,
  type CcttReplyReviewCandidate,
  type CcttReplyReviewParams,
  type CcttReplyReviewQuery,
  type CcttReplyReviewResult,
} from './ccttReplyReview.js'
import type { SearchResult } from './types.js'

const MAX_PERSONS = 800

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function queryFrom(raw: unknown, index: number): CcttReplyReviewQuery | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = clip(row.id, 80) || `p-${index}`
  return { id, ...readCcttReplyPerson(row) }
}

function candidateFromResult(item: SearchResult): CcttReplyReviewCandidate {
  const { values } = extractCcttCanonicalFields(item.record.fields ?? {})
  return {
    id: item.record.id,
    fullName: values.fullName ?? '',
    birthYear: values.birthYear ?? '',
    address: values.address ?? '',
    gcnIssueNo: values.gcnIssueNo ?? '',
    sourceFile: item.record.sourceFile,
    sheetName: item.record.sheetName,
    searchText: item.record.searchText ?? '',
  }
}

export async function reviewCcttReplyPersons(
  input: unknown,
  search: (query: string, limit: number) => Promise<SearchResult[]>,
): Promise<CcttReplyReviewResult> {
  const params = (input && typeof input === 'object' ? input : {}) as Partial<CcttReplyReviewParams>
  const list = Array.isArray(params.persons) ? params.persons.slice(0, MAX_PERSONS) : []
  const persons: CcttReplyReviewResult['persons'] = []

  for (let index = 0; index < list.length; index++) {
    const query = queryFrom(list[index], index)
    if (!query) continue
    const person: CcttReplyPerson = {
      hoTen: query.hoTen,
      namSinh: query.namSinh,
      diaChi: query.diaChi,
      soGcn: query.soGcn,
      soCccd: query.soCccd,
      soCmnd: query.soCmnd,
    }
    const seen = new Map<string, CcttReplyReviewCandidate>()
    for (const lookup of ccttReplyReviewSearches(person)) {
      const found = await search(lookup.query, CCTT_REPLY_REVIEW_LIMIT)
      for (const item of found) {
        if (!item.record?.id || seen.has(item.record.id)) continue
        seen.set(item.record.id, candidateFromResult(item))
      }
    }
    const judged = judgeCcttReplyPerson(person, [...seen.values()])
    persons.push({ id: query.id, level: judged.level, hits: judged.hits })
  }

  return { success: true, message: '', persons }
}
