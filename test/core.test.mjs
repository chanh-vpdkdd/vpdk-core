import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import XLSX from 'xlsx'
import PizZip from 'pizzip'
import { buildSearchIndex } from '../dist/index.js'
import { openSearchDatabase, loadIndex, loadProfileFromDb, getIndexBuildErrors } from '../dist/sqlite.js'
import { SearchIndexCore } from '../dist/search.js'
import { reviewCcttReplyPersons, extractCcttReplyText, saveCcttReplyTemplate, renderCcttReplyDocx } from '../dist/cctt.js'
import { emptyCcttReplyExtracted } from '../dist/shared.js'
import { quickFileSearchOnRoots } from '../dist/file-search.js'

async function withTemp(fn) {
  const root = await mkdtemp(join(tmpdir(), 'vpdk-core-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}

const extraRecord = {
  id: 'survey-1', sourceFile: 'survey', sheetName: 'records', type: 'tabular',
  rowStart: 1, rowEnd: 1, fields: { 'Họ tên': 'Trần Thị Bình', 'Năm sinh': '1991' },
  searchText: 'tran thi binh 1991', tags: ['ho-so-do-dac'],
}

function samplePdf() {
  const text = 'BT /F1 12 Tf 72 720 Td (Nguyen Van An 1985) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + Buffer.byteLength(text) + ' >>\nstream\n' + text + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body))
    body += (i + 1) + ' 0 obj\n' + object + '\nendobj\n'
  }
  const start = Buffer.byteLength(body)
  body += 'xref\n0 6\n0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) body += String(offset).padStart(10, '0') + ' 00000 n \n'
  body += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n'
  return Buffer.from(body)
}

test('lập chỉ mục, dùng cache, thay đổi nguồn, nạp lại và tìm theo nguồn', async () => withTemp(async (root) => {
  const input = join(root, 'input')
  await mkdir(input)
  const excel = join(input, 'du-lieu.xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Họ tên', 'Năm sinh', 'Địa chỉ'],
    ['Nguyễn Văn An', '1985', 'Mang Yang'],
    ['Lê Thị Mai', '1990', 'Gia Lai'],
  ]), 'Danh sách')
  XLSX.writeFile(wb, excel)
  const db = openSearchDatabase(join(root, 'timluukho.db'))
  try {
    let loaded = 0
    const extra = async () => { loaded++; return { records: [extraRecord] } }
    const initial = await buildSearchIndex({ rawDataDir: input, db, profile: loadProfileFromDb(db), loadAdditionalRecords: extra })
    assert.equal(initial.success, true)
    assert.equal(initial.stats.fileCount, 1)
    assert.equal(initial.stats.recordCount, 3)
    const records = loadIndex(db).records
    const search = new SearchIndexCore()
    search.appendBatch(records, 0)
    assert.equal(search.search('nguyen van an')[0].record.fields['Họ tên'], 'Nguyễn Văn An')
    assert.equal(search.search('tran thi binh', 50, 'ho-so-do-dac')[0].record.id, 'survey-1')
    let parseCalls = 0
    const cached = await buildSearchIndex({
      rawDataDir: input, db, profile: loadProfileFromDb(db), loadAdditionalRecords: extra,
      parseFile: async () => { parseCalls++; throw new Error('Không được parse lại cache') },
    })
    assert.equal(parseCalls, 0)
    assert.equal(cached.stats.recordCount, 3)
    assert.equal(loaded, 2)
    await rm(excel)
    const removed = await buildSearchIndex({ rawDataDir: input, db, profile: loadProfileFromDb(db), loadAdditionalRecords: extra })
    assert.equal(removed.stats.recordCount, 1)
    assert.deepEqual(loadIndex(db).records.map((record) => record.id), ['survey-1'])
    await writeFile(join(input, 'loi.xlsx'), 'không phải Excel')
    const partial = await buildSearchIndex({
      rawDataDir: input, db, profile: loadProfileFromDb(db), loadAdditionalRecords: extra,
      parseFile: async () => ({ records: [], error: 'lỗi dữ liệu thử' }),
    })
    assert.equal(partial.errors.length, 1)
    assert.match(getIndexBuildErrors(db)[0], /lỗi dữ liệu thử/)
  } finally {
    db.close()
  }
  const reopened = openSearchDatabase(join(root, 'timluukho.db'))
  try {
    assert.deepEqual(loadIndex(reopened).records.map((record) => record.id), ['survey-1'])
    assert.equal(loadIndex(reopened).meta.version, 6)
    assert.equal(getIndexBuildErrors(reopened).length, 1)
  } finally {
    reopened.close()
  }
}))

test('rá soát CCTT dùng kết quả tra cứu và bảo toàn lỗi từ nguồn', async () => {
  const person = { id: 'p1', hoTen: 'Trần Thị Bình', namSinh: '1991', diaChi: '', soGcn: '', soCccd: '', soCmnd: '' }
  const result = await reviewCcttReplyPersons({ persons: [person] }, async () => [{ record: extraRecord, score: 0 }])
  assert.equal(result.persons[0].level, 'cao')
  assert.equal(result.persons[0].hits[0].id, 'survey-1')
  await assert.rejects(() => reviewCcttReplyPersons({ persons: [person] }, async () => { throw new Error('index unavailable') }), /index unavailable/)
  const text = await extractCcttReplyText({ fileName: 'test.txt', base64: Buffer.from('Nội dung thử').toString('base64') })
  assert.equal(text.text, 'Nội dung thử')
  const pdf = await extractCcttReplyText({ fileName: 'test.pdf', base64: samplePdf().toString('base64') })
  assert.match(pdf.text, /Nguyen Van An/)
  assert.equal((await extractCcttReplyText({ fileName: 'old.doc', base64: Buffer.from('abc').toString('base64') })).code, 'legacy-doc')
})

test('các database độc lập và metadata từ bản cũ vẫn đọc được', async () => withTemp(async (root) => {
  const first = openSearchDatabase(join(root, 'cu.db'))
  const second = openSearchDatabase(join(root, 'moi.db'))
  try {
    const meta = { version: 6, builtAt: '2026-01-01T00:00:00.000Z', fileCount: 0, sheetCount: 0, recordCount: 0, sourceFiles: [] }
    first.prepare('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)').run('meta', JSON.stringify(meta))
    assert.deepEqual(loadIndex(first).meta, meta)
    assert.equal(loadIndex(second), null)
    assert.deepEqual(getIndexBuildErrors(first), [])
    first.close()
    assert.equal(second.prepare('SELECT count(*) AS n FROM ho_so_records').get().n, 0)
  } finally {
    if (first.open) first.close()
    second.close()
  }
}))

test('quét tệp, sao chép trùng tên, báo cáo và hủy', async () => withTemp(async (root) => {
  const source = join(root, 'source')
  const target = join(root, 'target')
  await mkdir(join(source, 'nested'), { recursive: true })
  await writeFile(join(source, 'AA 123.pdf'), 'first')
  await writeFile(join(source, 'nested', 'AA 123.pdf'), 'second')
  await writeFile(join(source, 'nested', 'khac.txt'), 'other')
  const progress = []
  const scan = await quickFileSearchOnRoots({ scanRoots: [source], destinationPath: '', keywords: ['AA123'], mode: 'scanOnly' }, (p) => progress.push(p.phase))
  assert.equal(scan.matchedCount, 2)
  assert.equal(scan.copiedCount, 0)
  assert.equal(progress.at(-1), 'done')
  const copy = await quickFileSearchOnRoots({ scanRoots: [source], destinationPath: target, keywords: ['AA123'], mode: 'scanAndCopy' })
  assert.equal(copy.copiedCount, 2)
  const names = await readdir(target)
  assert.ok(names.includes('AA 123.pdf'))
  assert.ok(names.includes('AA 123 (1).pdf'))
  assert.ok(copy.reportPath)
  assert.equal((await readFile(join(target, 'AA 123.pdf'))).length > 0, true)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => quickFileSearchOnRoots({ scanRoots: [source], destinationPath: '', keywords: ['AA'], mode: 'scanOnly', signal: controller.signal }), /hủy/)
}))


test('lưu mẫu, xuất DOCX và trích chữ từ tệp kết quả', async () => withTemp(async (root) => {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{ketQuaTraCuu}}</w:t></w:r></w:p></w:body></w:document>')
  const base64 = zip.generate({ type: 'base64' })
  const saved = saveCcttReplyTemplate(root, { name: 'Mẫu thử', fileName: 'mau.docx', base64 })
  assert.equal(saved.success, true, saved.code)
  const extracted = { ...emptyCcttReplyExtracted(), ketQuaTraCuu: 'Có hồ sơ thử' }
  const rendered = renderCcttReplyDocx(root, { templateId: saved.template.id, resultId: 'co-thong-tin', extracted })
  assert.equal(rendered.success, true, rendered.message)
  const text = await extractCcttReplyText({ fileName: rendered.fileName, base64: rendered.docxBase64 })
  assert.equal(text.text, 'Có hồ sơ thử')
}))
