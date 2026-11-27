import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import {
  buildCcttReplyMergeData,
  emptyCcttReplyExtracted,
  isCcttReplyOrMode,
  isCcttReplyResultId,
  resolveCcttReplyOrText,
  type CcttReplyOrContext,
  type CcttReplyRenderParams,
  type CcttReplyRenderResult,
} from './ccttReply.js'
import { readCcttReplyTemplateFile } from './ccttReplyTemplates.js'

const FILE_NAME = 'Công văn trả lời CCTT.docx'

function replyFileName(soKyHieu: string): string {
  const cleaned = soKyHieu.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return cleaned ? `Trả lời ${cleaned}.docx` : FILE_NAME
}

function fail(code: CcttReplyRenderResult['code'], message = ''): CcttReplyRenderResult {
  return { success: false, code, message, docxBase64: '', fileName: '' }
}

function renderError(err: unknown): string {
  if (err && typeof err === 'object' && 'properties' in err) {
    const props = (err as { properties?: { errors?: Array<{ message?: string }> } }).properties
    const messages = props?.errors?.map((item) => item.message).filter(Boolean)
    if (messages?.length) return messages.join('; ').slice(0, 240)
  }
  if (err instanceof Error) return err.message.slice(0, 240)
  return ''
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function encodeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function applyOrChoices(xml: string, context: CcttReplyOrContext): string {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const parts: string[] = []
    const pattern = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g
    let found: RegExpExecArray | null
    while ((found = pattern.exec(paragraph))) parts.push(decodeXml(found[2] ?? ''))
    if (parts.length === 0 || !parts.join('').includes('||')) return paragraph
    const next = resolveCcttReplyOrText(parts.join(''), context)
    if (next === parts.join('')) return paragraph
    let used = false
    return paragraph.replace(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g, (_full, attrs: string | undefined) => {
      if (used) return `<w:t${attrs ?? ''}></w:t>`
      used = true
      const space = /^\s|\s$/.test(next) && !(attrs ?? '').includes('xml:space') ? ' xml:space="preserve"' : ''
      return `<w:t${attrs ?? ''}${space}>${encodeXml(next)}</w:t>`
    })
  })
}

export function renderCcttReplyDocx(root: string, input: unknown): CcttReplyRenderResult {
  if (!input || typeof input !== 'object') return fail('missing-template')
  const params = input as Partial<CcttReplyRenderParams>
  const resultId = String(params.resultId ?? '')
  const templateId = String(params.templateId ?? '')
  if (!isCcttReplyResultId(resultId)) return fail('unsupported-result')
  const extracted = params.extracted ?? emptyCcttReplyExtracted()
  const buffer = readCcttReplyTemplateFile(root, templateId)
  if (!buffer) return fail('missing-template')
  try {
    const zip = new PizZip(buffer)
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
      nullGetter: () => '',
    })
    doc.render(buildCcttReplyMergeData(extracted, params.valueOverrides))
    const rendered = doc.getZip()
    const documentXml = rendered.file('word/document.xml')
    if (documentXml) {
      const people = extracted.caNhan?.filter((person) => person.hoTen?.trim()) ?? []
      const modeRaw = typeof params.orMode === 'string' ? params.orMode : ''
      rendered.file(
        'word/document.xml',
        applyOrChoices(documentXml.asText(), {
          mode: isCcttReplyOrMode(modeRaw) ? modeRaw : 'auto',
          personCount: people.length,
          hasFindings: resultId === 'co-thong-tin' || Boolean(extracted.ketQuaTraCuu?.trim()),
        }),
      )
    }
    const out = rendered.generate({ type: 'nodebuffer' }) as Buffer
    return {
      success: true,
      code: 'ok',
      message: '',
      docxBase64: out.toString('base64'),
      fileName: replyFileName(extracted.soKyHieu ?? ''),
    }
  } catch (err) {
    return fail('render-failed', renderError(err))
  }
}
