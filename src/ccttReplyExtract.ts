import { inflateSync } from 'zlib'
import PizZip from 'pizzip'
import type { CcttReplyExtractParams, CcttReplyExtractResult } from './ccttReply.js'

const MAX_BYTES = 12 * 1024 * 1024

function fail(code: CcttReplyExtractResult['code'], message = ''): CcttReplyExtractResult {
  return { success: false, code, text: '', message }
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function extractDocx(buffer: Buffer): string {
  const zip = new PizZip(buffer)
  const file = zip.file('word/document.xml')
  if (!file) return ''
  const xml = file.asText()
  const withBreaks = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
  return decodeXml(withBreaks)
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodePdfLiteral(raw: string): string {
  return raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (all, token: string) => {
    if (token === 'n') return '\n'
    if (token === 'r') return '\r'
    if (token === 't') return '\t'
    if (token === 'b') return ''
    if (token === 'f') return ''
    if (token === '(' || token === ')' || token === '\\') return token
    const code = Number.parseInt(token, 8)
    return Number.isFinite(code) ? String.fromCharCode(code) : all
  })
}

function parenStrings(window: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < window.length) {
    if (window[i] !== '(') {
      i += 1
      continue
    }
    let j = i + 1
    let escaped = false
    let value = ''
    while (j < window.length) {
      const ch = window[j] ?? ''
      if (escaped) {
        value += `\\${ch}`
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === ')') {
        out.push(decodePdfLiteral(value))
        i = j
        break
      } else {
        value += ch
      }
      j += 1
    }
    i += 1
    if (out.length > 40) break
  }
  return out
}

function extractPdfOperators(content: string): string[] {
  const out: string[] = []
  const n = Math.min(content.length, 1_500_000)
  let i = 0
  while (i < n && out.length < 8000) {
    const tj = content.indexOf('Tj', i)
    const tJ = content.indexOf('TJ', i)
    let next = -1
    if (tj >= 0 && (tJ < 0 || tj <= tJ)) next = tj
    else if (tJ >= 0) next = tJ
    else break
    const window = content.slice(Math.max(0, next - 2500), next)
    for (const part of parenStrings(window)) {
      const text = part.replace(/\s+/g, ' ').trim()
      if (text) out.push(text)
    }
    i = next + 2
  }
  return out
}

function looksLikeText(text: string): boolean {
  const letters = text.match(/[A-Za-z\u00C0-\u1EF9]/g)
  return (letters?.length ?? 0) >= 20
}

function extractPdfParen(buffer: Buffer): string {
  const chunks: string[] = []
  const raw = buffer.toString('latin1')
  chunks.push(...extractPdfOperators(raw))
  let i = 0
  let streams = 0
  while (streams < 80 && (i = buffer.indexOf('stream', i)) !== -1) {
    let start = i + 6
    if (buffer[start] === 0x0d) start += 1
    if (buffer[start] === 0x0a) start += 1
    const end = buffer.indexOf('endstream', start)
    if (end < 0) break
    const dictStart = buffer.lastIndexOf('<<', i)
    const dict = dictStart >= 0 ? buffer.subarray(dictStart, i).toString('latin1') : ''
    let data = buffer.subarray(start, end)
    if (dict.includes('FlateDecode')) {
      try {
        data = inflateSync(data)
      } catch {
        try {
          data = inflateSync(data.subarray(2))
        } catch {
          data = Buffer.alloc(0)
        }
      }
    }
    if (data.length > 0) chunks.push(...extractPdfOperators(data.toString('latin1')))
    i = end + 9
    streams += 1
  }
  const text = chunks.join(' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return looksLikeText(text) ? text.slice(0, 200_000) : ''
}

interface PdfTextItem {
  str?: string
  transform?: number[]
  width?: number
  hasEOL?: boolean
}

interface PdfTextPage {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>
}

interface PdfTextDocument {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfTextPage>
  destroy: () => Promise<void>
}

interface PdfJsModule {
  getDocument: (src: { data: Uint8Array; isEvalSupported?: boolean; verbosity?: number }) => {
    promise: Promise<PdfTextDocument>
  }
}

function linesFromPdfItems(items: PdfTextItem[]): string {
  const lines: string[] = []
  let line = ''
  let lastY: number | null = null
  let lastEnd: number | null = null
  for (const item of items) {
    const str = item.str ?? ''
    const x = item.transform?.[4] ?? 0
    const y = item.transform?.[5] ?? 0
    if (lastY != null && Math.abs(y - lastY) > 2) {
      if (line.trim()) lines.push(line.trim())
      line = ''
      lastEnd = null
    }
    if (str) {
      const gap = lastEnd == null ? 0 : x - lastEnd
      if (line && gap > 1.5 && !line.endsWith(' ') && !str.startsWith(' ')) line += ' '
      line += str
      lastEnd = x + (item.width ?? 0)
    }
    if (item.hasEOL) {
      if (line.trim()) lines.push(line.trim())
      line = ''
      lastY = null
      lastEnd = null
      continue
    }
    lastY = y
  }
  if (line.trim()) lines.push(line.trim())
  return lines.join('\n')
}

async function extractPdfJs(buffer: Buffer): Promise<string> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as PdfJsModule
  const doc = await pdfjs
    .getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 })
    .promise
  try {
    const pages: string[] = []
    const total = Math.min(doc.numPages, 40)
    for (let index = 1; index <= total; index += 1) {
      const page = await doc.getPage(index)
      const content = await page.getTextContent()
      const text = linesFromPdfItems(content.items)
      if (text) pages.push(text)
    }
    return pages.join('\n\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 200_000)
  } finally {
    await doc.destroy()
  }
}

async function extractPdfDocument(buffer: Buffer): Promise<string> {
  try {
    return (await extractPdfJs(buffer)).trim()
  } catch {
    // Font hoặc worker lỗi thì dùng bộ đọc ngoặc bên dưới.
    return extractPdfParen(buffer)
  }
}

function extension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)
  return match?.[1] ?? ''
}

export async function extractCcttReplyText(input: unknown): Promise<CcttReplyExtractResult> {
  if (!input || typeof input !== 'object') return fail('unreadable')
  const params = input as Partial<CcttReplyExtractParams>
  const fileName = typeof params.fileName === 'string' ? params.fileName : ''
  const base64 = typeof params.base64 === 'string' ? params.base64 : ''
  if (!base64) return fail('unreadable')
  if (base64.length > Math.ceil((MAX_BYTES * 4) / 3) + 64) return fail('too-large')
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0 || buffer.length > MAX_BYTES) return fail(buffer.length ? 'too-large' : 'unreadable')

  const ext = extension(fileName)
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b
  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-'
  const isOle = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0

  try {
    if (ext === 'doc' || isOle) return fail('legacy-doc')
    if (ext === 'docx' || (isZip && ext !== 'pdf')) {
      const text = extractDocx(buffer)
      return text ? { success: true, code: 'ok', text, message: '' } : fail('empty')
    }
    if (ext === 'pdf' || isPdf) {
      const text = await extractPdfDocument(buffer)
      return text ? { success: true, code: 'ok', text, message: '' } : fail('empty')
    }
    if (ext === 'txt' || ext === 'md') {
      const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim()
      return text ? { success: true, code: 'ok', text, message: '' } : fail('empty')
    }
    return fail('unsupported')
  } catch {
    return fail('unreadable')
  }
}
