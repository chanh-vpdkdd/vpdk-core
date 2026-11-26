import { extractBirthYearValue } from './ccttCanonicalFields.js'
import type { CcttReplyPerson } from './ccttReply.js'
import { orderedNameWindowExtra } from './nameWindow.js'
import { normalizeSearchText, tokenizeSearchText } from './textNormalize.js'

export const CCTT_REPLY_REVIEW_LIMIT = 40

export type CcttReplyPersonLevel = 'cao' | 'khong-co' | 'kiem-tra'
export type CcttReplyReviewLevel = CcttReplyPersonLevel | 'khong-doc-duoc'
export type CcttReplyPersonDecision = 'cao' | 'khong-co' | null

export const CCTT_REPLY_MATCH_KEYS = ['hoTen', 'cccd', 'cmnd', 'gcn', 'namSinh', 'diaChi'] as const
export type CcttReplyMatchKey = (typeof CCTT_REPLY_MATCH_KEYS)[number]
export type CcttReplyHitGroup = 'manh' | 'yeu'

export interface CcttReplyReviewHit {
  id: string
  fullName: string
  birthYear: string
  address: string
  gcnIssueNo: string
  sourceFile: string
  sheetName: string
  matchedKeys: CcttReplyMatchKey[]
  group: CcttReplyHitGroup
}

export interface CcttReplyReviewCandidate {
  id: string
  fullName: string
  birthYear: string
  address: string
  gcnIssueNo: string
  sourceFile: string
  sheetName: string
  searchText: string
}

export interface CcttReplyReviewSearch {
  key: CcttReplyMatchKey
  query: string
}

export interface CcttReplyReviewQuery extends CcttReplyPerson {
  id: string
}

export interface CcttReplyReviewParams {
  persons: CcttReplyReviewQuery[]
}

export interface CcttReplyReviewPersonResult {
  id: string
  level: CcttReplyPersonLevel
  hits: CcttReplyReviewHit[]
}

export interface CcttReplyReviewResult {
  success: boolean
  message: string
  persons: CcttReplyReviewPersonResult[]
}

const LEADING_HONORIFIC = new Set(['ong', 'ba'])

export function ccttReplyNameTokens(hoTen: string): string[] {
  const tokens = normalizeSearchText(hoTen)
    .split(/[^a-z0-9]+/)
    .filter((token) => /^[a-z]+$/.test(token))
  while (tokens.length > 2 && tokens[0] && LEADING_HONORIFIC.has(tokens[0])) tokens.shift()
  return tokens
}

export function ccttReplyNameQuery(hoTen: string): string | null {
  const tokens = ccttReplyNameTokens(hoTen).filter((token) => token.length >= 2)
  if (tokens.length < 1) return null
  return tokens.join(' ')
}

function gcnKey(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 3 ? digits : ''
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

function searchableNameTokens(hoTen: string): string[] {
  return ccttReplyNameTokens(hoTen).filter((token) => token.length >= 2)
}

function hasDigitToken(searchText: string, digits: string): boolean {
  if (!digits) return false
  return tokenizeSearchText(searchText).includes(digits)
}

function addressMatches(request: string, recordAddress: string): boolean {
  const need = tokenizeSearchText(request)
  if (need.length < 2 || !recordAddress.trim()) return false
  const have = new Set(tokenizeSearchText(recordAddress))
  return need.every((token) => have.has(token))
}

type ReviewPerson = Pick<CcttReplyPerson, 'hoTen' | 'namSinh' | 'diaChi' | 'soGcn' | 'soCccd' | 'soCmnd'>

export function ccttReplyReviewSearches(person: ReviewPerson): CcttReplyReviewSearch[] {
  const searches: CcttReplyReviewSearch[] = []
  const name = ccttReplyNameQuery(person.hoTen)
  if (name) searches.push({ key: 'hoTen', query: name })
  const cccd = digitsOnly(person.soCccd)
  if (cccd.length === 12) searches.push({ key: 'cccd', query: cccd })
  const cmnd = digitsOnly(person.soCmnd)
  if (cmnd.length === 9) searches.push({ key: 'cmnd', query: cmnd })
  const gcn = person.soGcn.replace(/\s+/g, ' ').trim()
  if (gcn.length >= 3) searches.push({ key: 'gcn', query: gcn })
  const year = extractBirthYearValue(person.namSinh) ?? ''
  if (/^(19|20)\d{2}$/.test(year)) searches.push({ key: 'namSinh', query: year })
  const address = person.diaChi.replace(/\s+/g, ' ').trim()
  if (tokenizeSearchText(address).length >= 2) searches.push({ key: 'diaChi', query: address })
  return searches
}

function keysOnCandidate(person: ReviewPerson, candidate: CcttReplyReviewCandidate): CcttReplyMatchKey[] {
  const keys: CcttReplyMatchKey[] = []
  const nameTokens = searchableNameTokens(person.hoTen)
  if (nameTokens.length > 0 && candidate.fullName.trim() && orderedNameWindowExtra(candidate.fullName, nameTokens) !== null) {
    keys.push('hoTen')
  }
  const cccd = digitsOnly(person.soCccd)
  if (cccd.length === 12 && hasDigitToken(candidate.searchText, cccd)) keys.push('cccd')
  const cmnd = digitsOnly(person.soCmnd)
  if (cmnd.length === 9 && hasDigitToken(candidate.searchText, cmnd)) keys.push('cmnd')
  const requestGcn = gcnKey(person.soGcn)
  const recordGcn = gcnKey(candidate.gcnIssueNo)
  if (requestGcn && recordGcn && requestGcn === recordGcn) keys.push('gcn')
  const requestYear = extractBirthYearValue(person.namSinh) ?? ''
  const recordYear = extractBirthYearValue(candidate.birthYear) ?? ''
  if (/^(19|20)\d{2}$/.test(requestYear) && recordYear === requestYear) keys.push('namSinh')
  if (addressMatches(person.diaChi, candidate.address)) keys.push('diaChi')
  return keys
}

interface ScoredHit {
  hit: CcttReplyReviewHit
  year: string
}

function hasIdPaper(person: ReviewPerson): boolean {
  return digitsOnly(person.soCccd).length === 12 || digitsOnly(person.soCmnd).length === 9
}

function requestYear(person: ReviewPerson): string {
  const year = extractBirthYearValue(person.namSinh) ?? ''
  return /^(19|20)\d{2}$/.test(year) ? year : ''
}

function requestHasAddress(person: ReviewPerson): boolean {
  return tokenizeSearchText(person.diaChi).length >= 2
}

function hasIdentityPair(keys: readonly CcttReplyMatchKey[]): boolean {
  const name = keys.includes('hoTen')
  const cccd = keys.includes('cccd')
  const cmnd = keys.includes('cmnd')
  return (name && cccd) || (name && cmnd) || (cmnd && cccd)
}

function nameProfileAgrees(person: ReviewPerson, row: ScoredHit): boolean {
  const year = requestYear(person)
  if (year && row.year !== year) return false
  if (requestHasAddress(person) && !row.hit.matchedKeys.includes('diaChi')) return false
  return true
}

export function judgeCcttReplyPerson(
  person: ReviewPerson,
  candidates: readonly CcttReplyReviewCandidate[],
): { level: CcttReplyPersonLevel; hits: CcttReplyReviewHit[] } {
  const rows: ScoredHit[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!candidate.id || seen.has(candidate.id)) continue
    const matchedKeys = keysOnCandidate(person, candidate)
    if (matchedKeys.length === 0) continue
    seen.add(candidate.id)
    const year = extractBirthYearValue(candidate.birthYear) ?? ''
    rows.push({
      hit: {
        id: candidate.id,
        fullName: candidate.fullName,
        birthYear: year || candidate.birthYear,
        address: candidate.address,
        gcnIssueNo: candidate.gcnIssueNo,
        sourceFile: candidate.sourceFile,
        sheetName: candidate.sheetName,
        matchedKeys,
        group: 'yeu',
      },
      year,
    })
  }

  const withPaper = hasIdPaper(person)
  const kept = rows.filter((row) => {
    const keys = row.hit.matchedKeys
    if (withPaper) return keys.includes('hoTen') || keys.includes('cccd') || keys.includes('cmnd')
    return keys.includes('hoTen')
  })
  for (const row of kept) {
    const agreed = withPaper
      ? hasIdentityPair(row.hit.matchedKeys)
      : nameProfileAgrees(person, row) && (requestYear(person) !== '' || requestHasAddress(person))
    row.hit.group = agreed ? 'manh' : 'yeu'
  }
  kept.sort((a, b) => {
    if (a.hit.group !== b.hit.group) return a.hit.group === 'manh' ? -1 : 1
    return b.hit.matchedKeys.length - a.hit.matchedKeys.length
  })
  const hits = kept.map((row) => row.hit)
  if (kept.length === 0) return { level: 'khong-co', hits }
  if (withPaper) {
    return { level: kept.some((row) => row.hit.group === 'manh') ? 'cao' : 'kiem-tra', hits }
  }
  if (!requestYear(person) && !requestHasAddress(person)) return { level: 'kiem-tra', hits }
  if (kept.some((row) => !nameProfileAgrees(person, row))) return { level: 'kiem-tra', hits }
  return { level: 'cao', hits }
}

export function rollupCcttReplyLevels(levels: readonly CcttReplyPersonLevel[]): CcttReplyPersonLevel {
  if (levels.length === 0) return 'kiem-tra'
  if (levels.every((level) => level === 'khong-co')) return 'khong-co'
  if (levels.every((level) => level === 'cao')) return 'cao'
  return 'kiem-tra'
}

export function effectiveCcttReplyPersonLevel(input: {
  autoLevel: CcttReplyPersonLevel
  decision: CcttReplyPersonDecision
  selectedHitIds: readonly string[]
}): CcttReplyPersonLevel {
  if (input.decision === 'khong-co') return 'khong-co'
  if (input.decision === 'cao' || input.selectedHitIds.length > 0) return 'cao'
  return input.autoLevel
}

export function formatCcttReplyKetQua(hits: readonly CcttReplyReviewHit[]): string {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const bits = [
      hit.fullName.trim(),
      hit.birthYear.trim() ? `sinh năm ${hit.birthYear.trim()}` : '',
      hit.address.trim() ? `địa chỉ ${hit.address.trim()}` : '',
      hit.gcnIssueNo.trim() ? `số phát hành GCN ${hit.gcnIssueNo.trim()}` : '',
    ].filter(Boolean)
    const line = bits.join(', ')
    if (!line || seen.has(line)) continue
    seen.add(line)
    lines.push(line)
  }
  return lines.join('\n')
}
