import test from 'node:test'
import assert from 'node:assert/strict'
import { completeCcttReply } from '../dist/cctt.js'
import { parseCcttReplyAiJson } from '../dist/shared.js'

const first = '{"coQuanBanHanhVanBan":"Văn phòng Đăng ký đất đai tỉnh Gia Lai","soKyHieuVanBanCanTraLoi":"4152/VPĐK-TTLT","ngayVanBanCanTraLoi":"2026-10-12","CacCaNhanDuocDeNghiXacMinh":[{"hoTen":"Nguyễn Thị Thúy Hà","ngaySinh":"1974-10-19","CCCD":"037174012'
const last = '345","CMND":"","DiaChiThuongTru":"","DiaChi":"Quy Nhơn"}]}'

test('tiếp tục phản hồi bị cắt giữa chuỗi JSON và giữ đủ người', async () => {
  const previousFetch = globalThis.fetch
  const requests = []
  const parts = [first, last]
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: parts.shift() } }] }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const result = await completeCcttReply({
      baseUrl: 'http://localhost:1234/v1', model: 'local-model', prompt: 'Văn bản dài',
    })
    assert.equal(result.code, 'ok')
    assert.equal(requests.length, 2)
    assert.equal(requests[0].max_tokens, 8192)
    assert.equal(requests[1].messages[2].content, first)
    const parsed = parseCcttReplyAiJson(result.content)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.caNhan[0].soCccd, '037174012345')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('phản hồi vẫn thiếu đoạn cuối được báo là chưa hoàn tất', async () => {
  const previousFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response(JSON.stringify({ choices: [{ message: { content: calls === 1 ? first : '' } }] }))
  }
  try {
    const result = await completeCcttReply({
      baseUrl: 'http://localhost:1234/v1', model: 'local-model', prompt: 'Văn bản dài',
    })
    assert.equal(result.code, 'incomplete')
    assert.equal(result.content, first)
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = previousFetch
  }
})
