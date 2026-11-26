import {
  readCcttReplyAttachedFile,
  type CcttReplyAttachedFile,
  type CcttReplyCompleteParams,
  type CcttReplyCompleteResult,
  type CcttReplyModelChoice,
  type CcttReplyModelsResult,
} from './ccttReply.js'

function result(
  code: CcttReplyCompleteResult['code'],
  message: string,
  content = '',
): CcttReplyCompleteResult {
  return { success: code === 'ok', code, message, content }
}

function readContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return ''
  const message = (choices[0] as { message?: { content?: unknown } }).message
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        return (part as { text: string }).text
      }
      return ''
    })
    .join('')
}

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_TOKENS = 2500

function fileDataUrl(file: CcttReplyAttachedFile): string {
  if (file.base64.startsWith('data:')) return file.base64
  const media = file.mediaType || 'application/pdf'
  return `data:${media};base64,${file.base64}`
}

function userContent(prompt: string, file: CcttReplyAttachedFile | null): string | unknown[] {
  if (!file) return prompt
  return [
    { type: 'text', text: prompt },
    {
      type: 'file',
      file: {
        filename: file.fileName || 'van-ban.pdf',
        file_data: fileDataUrl(file),
      },
    },
  ]
}

function endpointOf(baseUrl: string): string | null {
  const trimmed = baseUrl.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith('/chat/completions')) return url.toString()
  url.pathname = `${path}/chat/completions`
  return url.toString()
}

function modelsResult(
  code: CcttReplyModelsResult['code'],
  models: CcttReplyModelChoice[] = [],
  message = '',
): CcttReplyModelsResult {
  return { success: code === 'ok' || code === 'empty', code, models, message }
}

function modelsEndpoint(baseUrl: string): string | null {
  const trimmed = baseUrl.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/models') ? path : `${path}/models`
  url.search = ''
  return url.toString()
}

function uniqueModels(ids: string[]): string[] {
  const seen = new Set<string>()
  const models: string[] = []
  for (const id of ids) {
    const name = id.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    models.push(name)
  }
  models.sort((a, b) => a.localeCompare(b))
  return models
}

async function readOpenAiModelIds(url: string, apiKey: string): Promise<string[]> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    data?: Array<{ id?: string }>
    error?: { message?: string } | string
  }
  if (!response.ok) {
    const detail =
      typeof payload.error === 'string'
        ? payload.error
        : payload.error?.message || `HTTP ${response.status}`
    throw Object.assign(new Error(detail.slice(0, 240)), { status: response.status })
  }
  return (payload.data ?? []).map((item) => item.id ?? '')
}

async function readOllamaTags(baseUrl: string): Promise<string[]> {
  const url = new URL(baseUrl)
  url.pathname = '/api/tags'
  url.search = ''
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  const payload = (await response.json().catch(() => ({}))) as { models?: Array<{ name?: string }> }
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
  return (payload.models ?? []).map((item) => item.name ?? '')
}

export async function listCcttReplyLocalModels(input: unknown): Promise<CcttReplyModelsResult> {
  const params = (input && typeof input === 'object' ? input : {}) as { baseUrl?: unknown; apiKey?: unknown; preset?: unknown }
  const baseUrl = typeof params.baseUrl === 'string' ? params.baseUrl : ''
  const apiKey = typeof params.apiKey === 'string' ? params.apiKey.trim() : ''
  const ollama = params.preset === 'ollama' || /11434|ollama/i.test(baseUrl)
  const endpoint = modelsEndpoint(baseUrl)
  if (!endpoint) return modelsResult('bad-url')
  try {
    let ids = await readOpenAiModelIds(endpoint, apiKey)
    if (ids.length === 0 && ollama) ids = await readOllamaTags(baseUrl)
    const models = uniqueModels(ids).map((id) => ({ id, label: id }))
    return modelsResult(models.length ? 'ok' : 'empty', models)
  } catch (error) {
    const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined
    if (ollama && (status === 404 || status === 405)) {
      try {
        const models = uniqueModels(await readOllamaTags(baseUrl)).map((id) => ({ id, label: id }))
        return modelsResult(models.length ? 'ok' : 'empty', models)
      } catch {
        return modelsResult('network')
      }
    }
    if (typeof status === 'number') {
      return modelsResult('http', [], error instanceof Error ? error.message : `HTTP ${status}`)
    }
    return modelsResult('network')
  }
}

export async function completeCcttReply(input: unknown): Promise<CcttReplyCompleteResult> {
  if (!input || typeof input !== 'object') return result('bad-url', '')
  const params = input as Partial<CcttReplyCompleteParams>
  const baseUrl = typeof params.baseUrl === 'string' ? params.baseUrl : ''
  let model = typeof params.model === 'string' ? params.model.trim() : ''
  const apiKey = typeof params.apiKey === 'string' ? params.apiKey.trim() : ''
  const prompt = typeof params.prompt === 'string' ? params.prompt.slice(0, 100_000) : ''
  const file = readCcttReplyAttachedFile(params)
  if (!prompt.trim()) return result('empty', '')
  if (file && file.base64.length > MAX_FILE_BYTES * 2) return result('http', 'Tệp vượt quá 12 MB.')
  if (!model) {
    if (/11434|ollama/i.test(baseUrl)) return result('missing-model', '')
    model = 'local-model'
  }
  const endpoint = endpointOf(baseUrl)
  if (!endpoint) return result('bad-url', '')

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: 'system',
            content:
              'Bóc tách văn bản hành chính Việt Nam. Chỉ trả về một đối tượng JSON. Không markdown, không giải thích.',
          },
          { role: 'user', content: userContent(prompt, file) },
        ],
      }),
      signal: AbortSignal.timeout(file ? 180_000 : 120_000),
    })
    if (!response.ok) {
      let detail = `HTTP ${response.status}`
      try {
        const body = (await response.json()) as { error?: { message?: string } | string }
        if (typeof body.error === 'string' && body.error.trim()) detail = body.error.trim().slice(0, 240)
        else if (body.error && typeof body.error === 'object' && body.error.message) {
          detail = body.error.message.trim().slice(0, 240)
        }
      } catch {
        // Giữ mã HTTP khi máy không trả JSON.
      }
      return result('http', detail)
    }
    const content = readContent(await response.json()).trim()
    if (!content) return result('empty', '')
    return result('ok', '', content)
  } catch {
    return result('network', '')
  }
}
