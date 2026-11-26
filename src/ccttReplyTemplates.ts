import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import PizZip from 'pizzip'
import {
  findCcttReplyPlaceholders,
  hasCcttReplyContentPlaceholder,
  isCcttReplyResultId,
  isCcttReplyTemplateId,
  matchKeyFromName,
  type CcttReplyTemplateDeleteParams,
  type CcttReplyTemplateDeleteResult,
  type CcttReplyTemplateListResult,
  type CcttReplyTemplateSaveParams,
  type CcttReplyTemplateSaveResult,
  type CcttReplyTemplateSummary,
} from './ccttReply.js'
import { readCcttReplyTemplateText, repairCcttReplyTemplateZip } from './ccttReplyTemplateXml.js'

const MAX_BYTES = 12 * 1024 * 1024
const INDEX_FILE = 'index.json'

interface StoredTemplate extends CcttReplyTemplateSummary {
  storedName: string
}

function failSave(
  code: CcttReplyTemplateSaveResult['code'],
  message = '',
): CcttReplyTemplateSaveResult {
  return { success: false, code, template: null, message }
}

function indexPath(root: string): string {
  return join(root, INDEX_FILE)
}

function filePath(root: string, id: string): string {
  return join(root, `${id}.docx`)
}

function readIndex(root: string): StoredTemplate[] {
  const path = indexPath(root)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { templates?: unknown }
    if (!Array.isArray(raw.templates)) return []
    const items: StoredTemplate[] = []
    for (const entry of raw.templates) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      const id = typeof row.id === 'string' ? row.id : ''
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      if (!isCcttReplyTemplateId(id) || id === 'tu-dong' || !name) continue
      if (!existsSync(filePath(root, id))) continue
      const placeholders = Array.isArray(row.placeholders)
        ? row.placeholders.filter((item): item is string => typeof item === 'string')
        : []
      const resultRaw = typeof row.resultId === 'string' ? row.resultId : ''
      items.push({
        id,
        name: name.slice(0, 80),
        matchKey: matchKeyFromName(name),
        resultId: isCcttReplyResultId(resultRaw) ? resultRaw : 'khong-tim-thay',
        placeholders,
        storedName: typeof row.storedName === 'string' ? row.storedName : `${id}.docx`,
      })
    }
    items.sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    return items
  } catch {
    return []
  }
}

function writeIndex(root: string, templates: StoredTemplate[]): void {
  mkdirSync(root, { recursive: true })
  const payload = {
    templates: templates.map((item) => ({
      id: item.id,
      name: item.name,
      matchKey: item.matchKey,
      resultId: item.resultId,
      placeholders: item.placeholders,
      storedName: item.storedName,
    })),
  }
  writeFileSync(indexPath(root), JSON.stringify(payload, null, 2), 'utf8')
}

function toSummary(item: StoredTemplate): CcttReplyTemplateSummary {
  return {
    id: item.id,
    name: item.name,
    matchKey: item.matchKey,
    resultId: item.resultId,
    placeholders: item.placeholders,
  }
}

export function listCcttReplyTemplates(root: string): CcttReplyTemplateListResult {
  return { success: true, templates: readIndex(root).map(toSummary), message: '' }
}

function newId(): string {
  return `tpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function saveCcttReplyTemplate(root: string, input: unknown): CcttReplyTemplateSaveResult {
  const params = (input && typeof input === 'object' ? input : {}) as Partial<CcttReplyTemplateSaveParams>
  const name = typeof params.name === 'string' ? params.name.trim().slice(0, 80) : ''
  if (!name) return failSave('empty-name')
  const resultRaw = typeof params.resultId === 'string' ? params.resultId : ''
  const resultId = isCcttReplyResultId(resultRaw) ? resultRaw : 'khong-tim-thay'
  const fileName = typeof params.fileName === 'string' ? params.fileName.trim() : ''
  const base64 = typeof params.base64 === 'string' ? params.base64.trim() : ''
  if (!base64) return failSave('need-file')
  if (fileName && !fileName.toLowerCase().endsWith('.docx')) {
    if (fileName.toLowerCase().endsWith('.doc')) return failSave('legacy-doc')
    return failSave('unsupported')
  }
  let buffer: Buffer
  try {
    buffer = Buffer.from(base64, 'base64')
  } catch {
    return failSave('unreadable')
  }
  if (buffer.length === 0) return failSave('need-file')
  if (buffer.length > MAX_BYTES) return failSave('too-large')
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) return failSave('legacy-doc')
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return failSave('unsupported')

  let zip: PizZip
  try {
    zip = new PizZip(buffer)
  } catch {
    return failSave('unreadable')
  }
  if (!zip.file('word/document.xml')) return failSave('unreadable')
  repairCcttReplyTemplateZip(zip)
  const placeholders = findCcttReplyPlaceholders(readCcttReplyTemplateText(zip))
  if (!hasCcttReplyContentPlaceholder(placeholders)) return failSave('no-placeholder')

  const id = newId()
  const stored: StoredTemplate = {
    id,
    name,
    matchKey: matchKeyFromName(name),
    resultId,
    placeholders,
    storedName: fileName || `${id}.docx`,
  }
  mkdirSync(root, { recursive: true })
  const target = filePath(root, id)
  writeFileSync(target, zip.generate({ type: 'nodebuffer' }) as Buffer)
  try {
    const next = readIndex(root)
    next.push(stored)
    next.sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    writeIndex(root, next)
  } catch (err) {
    if (existsSync(target)) unlinkSync(target)
    throw err
  }
  return { success: true, code: 'ok', template: toSummary(stored), message: '' }
}

export function deleteCcttReplyTemplate(root: string, input: unknown): CcttReplyTemplateDeleteResult {
  const params = (input && typeof input === 'object' ? input : {}) as Partial<CcttReplyTemplateDeleteParams>
  const id = typeof params.id === 'string' ? params.id : ''
  if (!isCcttReplyTemplateId(id) || id === 'tu-dong') {
    return { success: false, message: '' }
  }
  const current = readIndex(root)
  const next = current.filter((item) => item.id !== id)
  if (next.length === current.length) return { success: false, message: '' }
  const target = filePath(root, id)
  if (existsSync(target)) unlinkSync(target)
  writeIndex(root, next)
  return { success: true, message: '' }
}

export function readCcttReplyTemplateFile(root: string, id: string): Buffer | null {
  const target = ccttReplyTemplateFilePath(root, id)
  if (!target) return null
  return readFileSync(target)
}

export function ccttReplyTemplateFilePath(root: string, id: string): string | null {
  if (!isCcttReplyTemplateId(id) || id === 'tu-dong') return null
  const target = filePath(root, id)
  return existsSync(target) ? target : null
}

function templateIdOf(input: unknown): string {
  const params = (input && typeof input === 'object' ? input : {}) as { id?: unknown }
  return typeof params.id === 'string' ? params.id : ''
}

export function reloadCcttReplyTemplate(root: string, input: unknown): CcttReplyTemplateSaveResult {
  const id = templateIdOf(input)
  const current = readIndex(root)
  const item = current.find((entry) => entry.id === id)
  const buffer = readCcttReplyTemplateFile(root, id)
  if (!item || !buffer) return failSave('unreadable')
  let zip: PizZip
  try {
    zip = new PizZip(buffer)
  } catch {
    return failSave('unreadable')
  }
  const placeholders = findCcttReplyPlaceholders(readCcttReplyTemplateText(zip))
  if (!hasCcttReplyContentPlaceholder(placeholders)) return failSave('no-placeholder')
  item.placeholders = placeholders
  item.matchKey = matchKeyFromName(item.name)
  writeIndex(root, current)
  return { success: true, code: 'ok', template: toSummary(item), message: '' }
}

export function readCcttReplyTemplateDownload(root: string, input: unknown): {
  success: boolean
  message: string
  docxBase64: string
  fileName: string
} {
  const id = templateIdOf(input)
  const item = readIndex(root).find((entry) => entry.id === id)
  const buffer = readCcttReplyTemplateFile(root, id)
  if (!item || !buffer) return { success: false, message: '', docxBase64: '', fileName: '' }
  const fileName = item.storedName.toLowerCase().endsWith('.docx') ? item.storedName : `${item.name}.docx`
  return { success: true, message: '', docxBase64: buffer.toString('base64'), fileName }
}
