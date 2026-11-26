import PizZip from 'pizzip'

const PART_PATTERN = /^word\/(document|header\d+|footer\d+)\.xml$/

function pieceAt(offsets: number[], texts: string[], index: number): number {
  for (let i = 0; i < texts.length; i += 1) {
    const off = offsets[i] ?? 0
    const end = off + (texts[i]?.length ?? 0)
    if (index >= off && index < end) return i
  }
  return -1
}

function openTag(open: string, text: string): string {
  const needsSpace = text.startsWith(' ') || text.endsWith(' ')
  if (!needsSpace || open.includes('xml:space')) return open
  return open.replace('<w:t', '<w:t xml:space="preserve"')
}

function repairParagraphXml(paragraphXml: string): string {
  const re = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g
  const parts: { start: number; end: number; open: string }[] = []
  const texts: string[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(paragraphXml))) {
    parts.push({
      start: match.index,
      end: match.index + match[0].length,
      open: `<w:t${match[1] ?? ''}>`,
    })
    texts.push(match[2] ?? '')
  }
  if (parts.length < 2) return paragraphXml
  const concat = texts.join('')
  if (!concat.includes('{{') || !concat.includes('}}')) return paragraphXml

  const offsets = texts.map(() => 0)
  const syncOffsets = () => {
    let cursor = 0
    for (let i = 0; i < texts.length; i += 1) {
      offsets[i] = cursor
      cursor += texts[i]?.length ?? 0
    }
  }
  syncOffsets()

  const tagRe = /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/g
  let changed = false
  let tag: RegExpExecArray | null
  while ((tag = tagRe.exec(concat))) {
    const from = tag.index
    const to = tag.index + tag[0].length
    const first = pieceAt(offsets, texts, from)
    const last = pieceAt(offsets, texts, to - 1)
    if (first < 0 || last <= first) continue
    const token = concat.slice(from, to)
    const firstOff = offsets[first] ?? 0
    const lastOff = offsets[last] ?? 0
    const prefix = (texts[first] ?? '').slice(0, from - firstOff)
    const suffix = (texts[last] ?? '').slice(to - lastOff)
    texts[first] = prefix + token
    for (let i = first + 1; i < last; i += 1) texts[i] = ''
    texts[last] = suffix
    changed = true
    syncOffsets()
  }
  if (!changed) return paragraphXml

  let xml = paragraphXml
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]
    if (!part) continue
    const text = texts[i] ?? ''
    xml = `${xml.slice(0, part.start)}${openTag(part.open, text)}${text}</w:t>${xml.slice(part.end)}`
  }
  return xml
}

export function repairDocxPlaceholderXml(xml: string): string {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => repairParagraphXml(paragraph))
}

export function repairCcttReplyTemplateZip(zip: PizZip): boolean {
  let changed = false
  for (const name of Object.keys(zip.files)) {
    if (!PART_PATTERN.test(name)) continue
    const file = zip.file(name)
    if (!file) continue
    const xml = file.asText()
    const next = repairDocxPlaceholderXml(xml)
    if (next === xml) continue
    zip.file(name, next)
    changed = true
  }
  return changed
}

export function readCcttReplyTemplateText(zip: PizZip): string {
  const chunks: string[] = []
  for (const name of Object.keys(zip.files)) {
    if (!PART_PATTERN.test(name)) continue
    const file = zip.file(name)
    if (!file) continue
    chunks.push(
      file
        .asText()
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>'),
    )
  }
  return chunks.join('\n')
}
