export type CcttCanonicalKey = 'fullName' | 'birthYear' | 'address' | 'gcnIssueNo'

export interface CcttCanonicalFields {
  fullName: string | null
  birthYear: string | null
  address: string | null
  gcnIssueNo: string | null
}

export interface CcttCanonicalMatch {
  key: CcttCanonicalKey
  header: string
  value: string
  score: number
}

const ALIASES: Record<CcttCanonicalKey, string[]> = {
  fullName: [
    'ho ten',
    'ho va ten',
    'ten chu su dung',
    'chu su dung',
    'chu so huu',
    'ten chu so huu',
    'ten to chuc ca nhan',
    'ten ca nhan to chuc',
    'ten to chuc',
    'ten ca nhan',
    'ho ten chu',
    'ten nguoi',
    'full name',
    'name',
  ],
  birthYear: [
    'nam sinh',
    'ngay sinh',
    'nam/ngay sinh',
    'namsinh2',
    'ns',
    'dob',
    'birth year',
    'birth date',
    'ngay thang nam sinh',
  ],
  address: [
    'dia chi chu',
    'dia chi tai san',
    'dia chi',
    'dia chi thuong tru',
    'thuong tru',
    'noi o',
    'dia chi noi o',
    'dia chi thua dat',
    'dia chi dat',
    'vi tri thua dat',
    'address',
  ],
  gcnIssueNo: [
    'so phat hanh gcn',
    'so phat hanh',
    'so gcn',
    'so vao so gcn',
    'so vao so',
    'so serial',
    'serial gcn',
    'ma gcn',
    'so giay chung nhan',
    'so gcn qsd',
    'gcn',
  ],
}

export function normalizeCcttLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function scoreCcttHeaderMatch(key: CcttCanonicalKey, header: string): number {
  const norm = normalizeCcttLabel(header)
  if (!norm) return 0

  let score = 0
  for (const alias of ALIASES[key]) {
    if (norm === alias) {
      score = Math.max(score, 100)
      continue
    }
    if (norm.includes(alias)) {
      score = Math.max(score, 85)
      continue
    }
    if (alias.includes(norm) && norm.length >= 4) {
      score = Math.max(score, 70)
    }
  }

  // Ưu tiên / loại trừ nhiễu
  if (key === 'fullName') {
    if (norm === 'ho ten' || norm === 'ten to chuc' || norm === 'ten ca nhan to chuc') {
      score += 20
    } else if (norm.includes('ho ten') || norm.includes('chu so huu') || norm.includes('chu su dung')) {
      score += 10
    }
    // Họ tên 2 / địa chỉ phụ — không làm canonical chính
    if (/\b2\b/.test(norm) || norm.endsWith(' 2') || norm.includes('namsinh2')) {
      score -= 35
    }
    if (norm.includes('file') || norm.includes('phong') || norm.includes('hop')) score -= 40
    if (norm.includes('nguoi ky')) score -= 50
  }
  if (key === 'birthYear') {
    if (norm === 'nam' || norm === 'nam hs') score = Math.min(score, 40)
    if (norm === 'nam sinh') score += 20
    else if (norm.includes('nam sinh') || norm.includes('ngay sinh')) score += 15
    if (/\b2\b/.test(norm) || norm.includes('namsinh2')) score -= 35
  }
  if (key === 'address') {
    if (norm === 'dia chi chu') score += 25
    else if (norm === 'dia chi tai san') score += 22
    else if (norm === 'dia chi') score += 18
    else if (norm.includes('thuong tru')) score += 10
    else if (norm.includes('thua dat')) score += 5
    if (/\b2\b/.test(norm) || norm.endsWith(' chu 2') || norm.includes('chu 2')) score -= 35
    if (norm.includes('email') || norm.includes('website')) score -= 50
  }
  if (key === 'gcnIssueNo') {
    if (norm.includes('phat hanh')) score += 25
    else if (norm.includes('vao so')) score += 8
    else if (norm.includes('gcn')) score += 15
    if (norm.includes('ho so') && !norm.includes('gcn')) score -= 30
    if (norm.includes('cmnd') || norm.includes('cccd') || norm.includes('giay to')) score -= 40
  }

  return score
}

/** Từ ngày đầy đủ / serial text → năm (4 chữ số). */
export function extractBirthYearValue(raw: string): string | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (/^(19|20)\d{2}$/.test(text)) return text

  const ymd = text.match(/(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/)
  if (ymd?.[1]) return ymd[1]

  const dmy = text.match(/(\d{1,2})[/.-](\d{1,2})[/.-]((?:19|20)\d{2})/)
  if (dmy?.[3]) return dmy[3]

  const iso = text.match(/((?:19|20)\d{2})[/.-](\d{1,2})[/.-](\d{1,2})/)
  if (iso?.[1]) return iso[1]

  return null
}

function cellAsString(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

const CANONICAL_KEYS: CcttCanonicalKey[] = ['fullName', 'birthYear', 'address', 'gcnIssueNo']

/**
 * Gom fields Excel thô → 4 trường CCTT chuẩn.
 * Trả thêm danh sách header đã map để UI có thể ẩn trùng.
 */
export function extractCcttCanonicalFields(
  fields: Record<string, string | number | null>,
): { values: CcttCanonicalFields; matches: CcttCanonicalMatch[] } {
  const best = new Map<CcttCanonicalKey, CcttCanonicalMatch>()

  for (const [header, raw] of Object.entries(fields)) {
    const value = cellAsString(raw)
    if (!value) continue
    for (const key of CANONICAL_KEYS) {
      const score = scoreCcttHeaderMatch(key, header)
      if (score < 70) continue
      const prev = best.get(key)
      if (!prev || score > prev.score) {
        best.set(key, { key, header, value, score })
      }
    }
  }

  const fullNameMatch = best.get('fullName')
  const birthMatch = best.get('birthYear')
  const addressMatch = best.get('address')
  const gcnMatch = best.get('gcnIssueNo')

  const birthYear = birthMatch ? extractBirthYearValue(birthMatch.value) ?? birthMatch.value : null

  return {
    values: {
      fullName: fullNameMatch?.value ?? null,
      birthYear,
      address: addressMatch?.value ?? null,
      gcnIssueNo: gcnMatch?.value ?? null,
    },
    matches: [...best.values()],
  }
}

/** Chuỗi phụ trợ gắn vào searchText khi index. */
export function ccttCanonicalSearchParts(fields: Record<string, string | number | null>): string[] {
  const { values } = extractCcttCanonicalFields(fields)
  return [
    values.fullName,
    values.birthYear,
    values.address,
    values.gcnIssueNo,
  ].filter((v): v is string => Boolean(v?.trim()))
}

export function ccttMatchedHeaderSet(
  matches: CcttCanonicalMatch[],
): Set<string> {
  return new Set(matches.map((m) => m.header))
}
