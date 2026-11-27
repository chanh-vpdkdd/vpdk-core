import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PizZip from 'pizzip'
import { extractCcttReplyText, renderCcttReplyDocx, saveCcttReplyTemplate } from '../dist/cctt.js'
import {
  CCTT_REPLY_EXTRACT_FIELD_PROMPT_DEFAULTS,
  CCTT_REPLY_FIELD_PROMPT_DEFAULTS,
  buildCcttReplyMergeData,
  buildCcttReplyPrompt,
  buildCcttReplyValuePrompt,
  emptyCcttReplyExtracted,
  parseCcttReplyValueResponse,
  resolveCcttReplyFieldPrompt,
} from '../dist/shared.js'

test('prompt bóc tách giữ chỉ dẫn riêng và không dùng prompt chỗ điền', () => {
  const prompt = buildCcttReplyPrompt('Văn bản đến', true, false, undefined, 'CHỈ DẪN BÓC TÁCH')
  assert.match(prompt, /CHỈ DẪN BÓC TÁCH/)
  assert.match(prompt, /Mỗi người một phần tử/)
  assert.doesNotMatch(prompt, /Điền danh sách người/)
  assert.equal(
    resolveCcttReplyFieldPrompt('CacCaNhanDuocDeNghiXacMinh', CCTT_REPLY_EXTRACT_FIELD_PROMPT_DEFAULTS.CacCaNhanDuocDeNghiXacMinh),
    CCTT_REPLY_FIELD_PROMPT_DEFAULTS.CacCaNhanDuocDeNghiXacMinh,
  )
})

test('giá trị chỗ điền chỉ ghi đè những khóa được chọn', () => {
  const extracted = { ...emptyCcttReplyExtracted(), soKyHieu: '4152/VPĐK', tenCoQuanGui: 'Văn phòng Đăng ký đất đai' }
  const ids = ['soKyHieuVanBanCanTraLoi']
  const prompt = buildCcttReplyValuePrompt(extracted, ids, { soKyHieuVanBanCanTraLoi: 'Giữ số và thêm chữ A' })
  assert.match(prompt, /Giữ số và thêm chữ A/)
  assert.match(prompt, /4152\/VPĐK/)
  const values = parseCcttReplyValueResponse('```json\n{"soKyHieuVanBanCanTraLoi":"4152/VPĐK-A","CoQuanBanHanhVanBan":"sai"}\n```', ids)
  assert.deepEqual(values, { soKyHieuVanBanCanTraLoi: '4152/VPĐK-A' })
  const merged = buildCcttReplyMergeData(extracted, values)
  assert.equal(merged.soKyHieuVanBanCanTraLoi, '4152/VPĐK-A')
  assert.equal(merged.CoQuanBanHanhVanBan, 'Văn phòng Đăng ký đất đai')
  assert.deepEqual(parseCcttReplyValueResponse('{"soKyHieuVanBanCanTraLoi":', ids), {})
})

test('DOCX nhận giá trị chỗ điền từ prompt trả lời', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cctt-reply-values-'))
  try {
    const zip = new PizZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{soKyHieuVanBanCanTraLoi}}</w:t></w:r></w:p></w:body></w:document>')
    const saved = saveCcttReplyTemplate(root, { name: 'Mẫu thử', fileName: 'mau.docx', base64: zip.generate({ type: 'base64' }) })
    assert.equal(saved.success, true)
    const extracted = { ...emptyCcttReplyExtracted(), soKyHieu: '4152/VPĐK' }
    const rendered = renderCcttReplyDocx(root, {
      templateId: saved.template.id,
      resultId: 'khong-tim-thay',
      extracted,
      valueOverrides: { soKyHieuVanBanCanTraLoi: '4152/VPĐK-A' },
    })
    assert.equal(rendered.success, true)
    const text = await extractCcttReplyText({ fileName: rendered.fileName, base64: rendered.docxBase64 })
    assert.equal(text.text, '4152/VPĐK-A')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
