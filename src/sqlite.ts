import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeSearchText } from './textNormalize.js'
import type { FileCacheEntry, HoSoRecord, IndexMeta, ParserProfile, SearchIndex, SearchResult } from './types.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

const DB_VERSION = 1
const MAX_KEYWORDS = 300

export type SqliteDatabase = InstanceType<typeof Database>

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ho_so_records (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  type TEXT NOT NULL,
  row_start INTEGER NOT NULL,
  row_end INTEGER NOT NULL,
  fields_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  tags_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_search ON ho_so_records(search_text);
CREATE INDEX IF NOT EXISTS idx_records_source ON ho_so_records(source_file, sheet_name, row_start);

CREATE TABLE IF NOT EXISTS file_cache (
  rel_path TEXT PRIMARY KEY,
  mtime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  records_json TEXT NOT NULL,
  parsed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learned_keywords (
  keyword TEXT PRIMARY KEY,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS known_headers (
  normalized TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS parser_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export function openSearchDatabase(dbPath: string): SqliteDatabase {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const db = new Database(dbPath)
  db.exec(SCHEMA)
  db.prepare('INSERT OR IGNORE INTO parser_settings (key, value) VALUES (?, ?)').run('db_version', String(DB_VERSION))
  return db
}

function rowToRecord(row: {
  id: string
  source_file: string
  sheet_name: string
  type: string
  row_start: number
  row_end: number
  fields_json: string
  search_text: string
  tags_json: string
}): HoSoRecord {
  return {
    id: row.id,
    sourceFile: row.source_file,
    sheetName: row.sheet_name,
    type: row.type as HoSoRecord['type'],
    rowStart: row.row_start,
    rowEnd: row.row_end,
    fields: JSON.parse(row.fields_json),
    searchText: row.search_text,
    tags: JSON.parse(row.tags_json),
  }
}

export function countHoSoRecords(db: SqliteDatabase): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM ho_so_records').get() as { c: number }
  return row.c
}

export function loadRecordsBatch(db: SqliteDatabase, offset: number, limit: number): HoSoRecord[] {
  const rows = db
    .prepare('SELECT * FROM ho_so_records ORDER BY rowid LIMIT ? OFFSET ?')
    .all(limit, offset) as Parameters<typeof rowToRecord>[0][]
  return rows.map(rowToRecord)
}

/**
 * Bản ghi nhẹ cho index RAM: bỏ fields (lấy lại khi trả kết quả tìm).
 * Giảm đáng kể heap khi nạp hàng chục/trăm nghìn hồ sơ.
 */
export function loadRecordsBatchSlim(db: SqliteDatabase, offset: number, limit: number): HoSoRecord[] {
  const rows = db
    .prepare(
      `SELECT id, source_file, sheet_name, type, row_start, row_end, search_text, tags_json
       FROM ho_so_records ORDER BY rowid LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Array<{
    id: string
    source_file: string
    sheet_name: string
    type: string
    row_start: number
    row_end: number
    search_text: string
    tags_json: string
  }>

  return rows.map((row) => ({
    id: row.id,
    sourceFile: row.source_file,
    sheetName: row.sheet_name,
    type: row.type as HoSoRecord['type'],
    rowStart: row.row_start,
    rowEnd: row.row_end,
    fields: {},
    searchText: row.search_text,
    tags: JSON.parse(row.tags_json) as string[],
  }))
}

/** Gắn lại fields từ SQLite cho các record kết quả (theo id). */
export function hydrateRecordFields(db: SqliteDatabase, records: HoSoRecord[]): void {
  if (records.length === 0) return
  const stmt = db.prepare('SELECT fields_json FROM ho_so_records WHERE id = ?')
  for (const rec of records) {
    const row = stmt.get(rec.id) as { fields_json: string } | undefined
    if (!row) continue
    try {
      rec.fields = JSON.parse(row.fields_json) as Record<string, string | number | null>
    } catch {
      rec.fields = {}
    }
  }
}

export function loadAllRecords(db: SqliteDatabase): HoSoRecord[] {
  const total = countHoSoRecords(db)
  if (total === 0) return []
  return loadRecordsBatch(db, 0, total)
}

export function loadRecordsByTag(db: SqliteDatabase, tag: string): HoSoRecord[] {
  const rows = db
    .prepare('SELECT * FROM ho_so_records WHERE tags_json LIKE ?')
    .all(`%"${tag}"%`) as Parameters<typeof rowToRecord>[0][]
  return rows.map(rowToRecord)
}

/** Thay toàn bộ bản ghi của một tag. false = không đổi. */
export function replaceRecordsByTag(db: SqliteDatabase, tag: string, records: HoSoRecord[]): boolean {
  const like = `%"${tag}"%`
  const existing = db
    .prepare('SELECT id, search_text FROM ho_so_records WHERE tags_json LIKE ?')
    .all(like) as { id: string; search_text: string }[]
  const previous = new Map(existing.map((row) => [row.id, row.search_text]))
  const same =
    previous.size === records.length &&
    records.every((rec) => previous.get(rec.id) === rec.searchText)
  if (same) return false

  const insert = db.prepare(`
    INSERT OR REPLACE INTO ho_so_records
    (id, source_file, sheet_name, type, row_start, row_end, fields_json, search_text, tags_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction((items: HoSoRecord[]) => {
    db.prepare('DELETE FROM ho_so_records WHERE tags_json LIKE ?').run(like)
    for (const rec of items) {
      insert.run(
        rec.id,
        rec.sourceFile,
        rec.sheetName,
        rec.type,
        rec.rowStart,
        rec.rowEnd,
        JSON.stringify(rec.fields),
        rec.searchText,
        JSON.stringify(rec.tags),
      )
    }
    const count = (db.prepare('SELECT COUNT(*) as c FROM ho_so_records').get() as { c: number }).c
    const meta = getIndexMeta(db)
    if (meta) {
      meta.recordCount = count
      saveIndexMeta(db, meta)
    } else {
      saveIndexMeta(db, {
        version: DB_VERSION,
        builtAt: new Date(0).toISOString(),
        fileCount: 0,
        sheetCount: 0,
        recordCount: count,
        sourceFiles: [],
      })
    }
  })
  tx(records)
  return true
}

export function saveAllRecords(db: SqliteDatabase, records: HoSoRecord[]): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO ho_so_records
    (id, source_file, sheet_name, type, row_start, row_end, fields_json, search_text, tags_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction((items: HoSoRecord[]) => {
    db.prepare('DELETE FROM ho_so_records').run()
    for (const rec of items) {
      insert.run(
        rec.id,
        rec.sourceFile,
        rec.sheetName,
        rec.type,
        rec.rowStart,
        rec.rowEnd,
        JSON.stringify(rec.fields),
        rec.searchText,
        JSON.stringify(rec.tags),
      )
    }
  })
  tx(records)
}

export function getIndexMeta(db: SqliteDatabase): IndexMeta | null {
  const row = db.prepare("SELECT value FROM index_meta WHERE key = 'meta'").get() as { value: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value) as IndexMeta
  } catch {
    return null
  }
}

export function saveIndexMeta(db: SqliteDatabase, meta: IndexMeta): void {
  db.prepare('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)').run('meta', JSON.stringify(meta))
}

/** Lỗi của lần build gần nhất; index cũ chưa có metadata này trả về mảng rỗng. */
export function getIndexBuildErrors(db: SqliteDatabase): string[] {
  const row = db.prepare("SELECT value FROM index_meta WHERE key = 'build_errors'").get() as { value: string } | undefined
  if (!row) return []
  try {
    const parsed: unknown = JSON.parse(row.value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed as string[]
      : ['invalid-build-errors']
  } catch {
    return ['invalid-build-errors']
  }
}

export function saveIndexBuildErrors(db: SqliteDatabase, errors: string[]): void {
  db.prepare('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)').run('build_errors', JSON.stringify(errors))
}

export function loadIndex(db: SqliteDatabase): SearchIndex | null {
  const records = loadAllRecords(db)
  const meta = getIndexMeta(db)
  if (records.length === 0 && !meta) return null
  return { meta: meta ?? emptyMeta(), records }
}

function emptyMeta(): IndexMeta {
  return {
    version: DB_VERSION,
    builtAt: new Date().toISOString(),
    fileCount: 0,
    sheetCount: 0,
    recordCount: 0,
    sourceFiles: [],
  }
}

export function getFileCacheEntry(db: SqliteDatabase, relPath: string): FileCacheEntry | null {
  const row = db.prepare('SELECT mtime_ms, size, records_json FROM file_cache WHERE rel_path = ?').get(relPath) as
    | { mtime_ms: number; size: number; records_json: string }
    | undefined
  if (!row) return null
  return {
    mtimeMs: row.mtime_ms,
    size: row.size,
    records: JSON.parse(row.records_json) as HoSoRecord[],
  }
}

export function saveFileCacheEntry(
  db: SqliteDatabase,
  relPath: string,
  entry: FileCacheEntry,
): void {
  db.prepare(`
    INSERT OR REPLACE INTO file_cache (rel_path, mtime_ms, size, records_json, parsed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(relPath, entry.mtimeMs, entry.size, JSON.stringify(entry.records))
}

export function deleteOrphanFileCache(db: SqliteDatabase, activePaths: Set<string>): void {
  const rows = db.prepare('SELECT rel_path FROM file_cache').all() as { rel_path: string }[]
  const del = db.prepare('DELETE FROM file_cache WHERE rel_path = ?')
  for (const { rel_path } of rows) {
    if (!activePaths.has(rel_path)) del.run(rel_path)
  }
}

export function clearFileCache(db: SqliteDatabase): void {
  db.prepare('DELETE FROM file_cache').run()
}

export function defaultProfile(): ParserProfile {
  return {
    version: 1,
    learnedKeywords: [],
    knownHeaders: {},
    fuseThreshold: 0.42,
    searchCount: 0,
    lastTunedAt: new Date().toISOString(),
  }
}

export function loadProfileFromDb(db: SqliteDatabase): ParserProfile {
  const profile = defaultProfile()

  const keywords = db.prepare('SELECT keyword FROM learned_keywords ORDER BY added_at').all() as { keyword: string }[]
  profile.learnedKeywords = keywords.map((k) => k.keyword)

  const headers = db.prepare('SELECT normalized, text, hits FROM known_headers').all() as {
    normalized: string
    text: string
    hits: number
  }[]
  for (const h of headers) {
    profile.knownHeaders[h.normalized] = { text: h.text, hits: h.hits }
  }

  const settings = db.prepare('SELECT key, value FROM parser_settings').all() as { key: string; value: string }[]
  for (const s of settings) {
    if (s.key === 'fuse_threshold') profile.fuseThreshold = parseFloat(s.value)
    if (s.key === 'search_count') profile.searchCount = parseInt(s.value, 10)
    if (s.key === 'last_tuned_at') profile.lastTunedAt = s.value
  }

  return profile
}

export function saveProfileToDb(db: SqliteDatabase, profile: ParserProfile): void {
  profile.lastTunedAt = new Date().toISOString()

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM learned_keywords').run()
    const insKw = db.prepare("INSERT INTO learned_keywords (keyword, added_at) VALUES (?, datetime('now'))")
    for (const kw of profile.learnedKeywords.slice(-MAX_KEYWORDS)) {
      insKw.run(kw)
    }

    db.prepare('DELETE FROM known_headers').run()
    const insHdr = db.prepare('INSERT INTO known_headers (normalized, text, hits) VALUES (?, ?, ?)')
    for (const [n, h] of Object.entries(profile.knownHeaders)) {
      insHdr.run(n, h.text, h.hits)
    }

    const upsert = db.prepare('INSERT OR REPLACE INTO parser_settings (key, value) VALUES (?, ?)')
    upsert.run('fuse_threshold', String(profile.fuseThreshold))
    upsert.run('search_count', String(profile.searchCount))
    upsert.run('last_tuned_at', profile.lastTunedAt)
  })
  tx()
}

export function learnFromSearchResultsDb(db: SqliteDatabase, results: SearchResult[]): number {
  const profile = loadProfileFromDb(db)
  let added = 0
  const good = results.filter((r) => r.score < 0.45)

  for (const { record } of good) {
    for (const key of Object.keys(record.fields)) {
      const n = normalizeToken(key)
      if (n && n.length >= 2 && !profile.learnedKeywords.includes(n)) {
        profile.learnedKeywords.push(n)
        added++
      }
      if (n && n.length >= 2) {
        const existing = profile.knownHeaders[n]
        profile.knownHeaders[n] = existing
          ? { text: existing.text, hits: existing.hits + 1 }
          : { text: key, hits: 1 }
      }
    }
  }

  if (profile.learnedKeywords.length > MAX_KEYWORDS) {
    profile.learnedKeywords = profile.learnedKeywords.slice(-MAX_KEYWORDS)
  }
  profile.searchCount++
  saveProfileToDb(db, profile)
  return added
}

export function normalizeToken(text: string): string {
  return normalizeSearchText(text)
}

export function getIndexBuiltAt(db: SqliteDatabase): number {
  const meta = getIndexMeta(db)
  if (!meta?.builtAt) return 0
  return new Date(meta.builtAt).getTime()
}
