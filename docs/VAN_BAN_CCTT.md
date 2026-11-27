# Xử lý văn bản cung cấp thông tin

Entry point `/cctt` cung cấp các hàm trích chữ, rà soát cá nhân, quản lý mẫu và tạo DOCX. Các kiểu, hàm chuẩn hóa và quy tắc đánh giá dùng chung được xuất qua `/shared`.

## Trích xuất chữ

```ts
import { readFile } from 'node:fs/promises'
import { extractCcttReplyText } from '@cn-vpdk-my/tra-cuu-core/cctt'

const bytes = await readFile('./van-ban.pdf')
const extracted = await extractCcttReplyText({
  fileName: 'van-ban.pdf',
  base64: bytes.toString('base64'),
})

if (!extracted.success) {
  throw new Error('Không đọc được văn bản: ' + extracted.code)
}
console.log(extracted.text)
```

| Định dạng | Hỗ trợ |
| --- | --- |
| `.pdf` | Trích lớp chữ; có bộ đọc dự phòng |
| `.docx` | Trích chữ từ nội dung tài liệu Word |
| `.txt`, `.md` | Đọc UTF-8 |
| `.doc` cũ | Trả mã `legacy-doc` |

Đầu vào giới hạn 12 MiB sau giải mã. Mã lỗi gồm `empty`, `too-large`, `unsupported`, `unreadable` và `legacy-doc`. PDF ảnh không có lớp chữ cần OCR từ một hệ thống khác; thư viện không cung cấp OCR.

## Rà soát cá nhân

`reviewCcttReplyPersons(input, search)` nhận danh sách cá nhân và một hàm tìm kiếm do ứng dụng cung cấp. Hàm tìm kiếm trả `Promise<SearchResult[]>`; mỗi kết quả cần bản ghi có `id`, `fields`, `searchText` và thông tin nguồn.

Đoạn mã sau minh họa hợp đồng; thay `searchRecords` bằng hàm tìm kiếm của ứng dụng.

```ts
import { reviewCcttReplyPersons } from '@cn-vpdk-my/tra-cuu-core/cctt'
import type { SearchResult } from '@cn-vpdk-my/tra-cuu-core/contracts'

// Cung cấp kết quả từ chỉ mục đã sẵn sàng và đủ dữ liệu.
declare function searchRecords(query: string, limit: number): Promise<SearchResult[]>

const result = await reviewCcttReplyPersons({
  persons: [{
    id: 'person-1',
    hoTen: 'Nguyễn Văn An',
    namSinh: '1985',
    diaChi: '',
    soGcn: '',
    soCccd: '',
    soCmnd: '',
  }],
}, searchRecords)

for (const person of result.persons) {
  console.log(person.id, person.level, person.hits)
}
```

Mức kết quả cho cá nhân là `cao`, `kiem-tra` hoặc `khong-co`. Các `hits` chứa thông tin nguồn, trường khớp và nhóm `manh`/`yeu`. Hàm xét tối đa 800 phần tử đầu vào và tìm tối đa 40 kết quả cho mỗi query được tạo.

**Không trả mảng rỗng khi hệ thống tìm kiếm gặp lỗi.** Hãy để hàm tìm kiếm báo lỗi, để tác vụ rà soát thất bại và ứng dụng xử lý. Nếu truyền kết quả rỗng cho một nguồn chưa sẵn sàng hoặc thiếu dữ liệu, thư viện có thể trả `khong-co`. Mức độ khớp là gợi ý nghiệp vụ, cần được người có trách nhiệm xác nhận.

## Mẫu và tạo DOCX

Mẫu được lưu trong thư mục do ứng dụng chỉ định. Mẫu phải là DOCX hợp lệ, tối đa 12 MiB và có placeholder nội dung được hỗ trợ, ví dụ `{{ketQuaTraCuu}}`.

```ts
import { readFile, writeFile } from 'node:fs/promises'
import {
  renderCcttReplyDocx,
  saveCcttReplyTemplate,
} from '@cn-vpdk-my/tra-cuu-core/cctt'
import { emptyCcttReplyExtracted } from '@cn-vpdk-my/tra-cuu-core/shared'

const root = './mau-cctt'
const template = await readFile('./mau-tra-loi.docx')
const saved = saveCcttReplyTemplate(root, {
  name: 'Mẫu trả lời',
  fileName: 'mau-tra-loi.docx',
  base64: template.toString('base64'),
})
if (!saved.success || !saved.template) throw new Error(saved.code)

const rendered = renderCcttReplyDocx(root, {
  templateId: saved.template.id,
  resultId: 'co-thong-tin',
  extracted: {
    ...emptyCcttReplyExtracted(),
    soKyHieu: '123/YC',
    ketQuaTraCuu: 'Nội dung kết quả đã được xác nhận.',
  },
})
if (!rendered.success) throw new Error(rendered.code + ': ' + rendered.message)
await writeFile('./tra-loi.docx', Buffer.from(rendered.docxBase64, 'base64'))
```

`listCcttReplyTemplates`, `reloadCcttReplyTemplate` và `deleteCcttReplyTemplate` quản lý kho mẫu. Các hàm thao tác tệp trực tiếp; ứng dụng chịu trách nhiệm cấp quyền thư mục và chọn đường dẫn lưu. Danh sách placeholder và quy tắc nhánh `[lựa chọn] || [lựa chọn]` được khai báo trong [mã nguồn CCTT](https://github.com/chanh-vpdkdd/vpdk-core/blob/main/src/ccttReply.ts).

## Kết nối mô hình tùy chọn

`listCcttReplyLocalModels` và `completeCcttReply` nhận cấu hình endpoint do ứng dụng cung cấp. `completeCcttReply` trả `success`, `code`, `content` và `message`; kết quả có thể lỗi mạng, HTTP hoặc rỗng. Ứng dụng chịu trách nhiệm quản lý endpoint, token và kiểm tra dữ liệu gửi đi.

Các kiểu liên quan phiên ChatGPT trong `/shared` không đồng nghĩa package cung cấp đăng nhập ChatGPT. Việc đăng nhập và lưu bí mật thuộc ứng dụng tích hợp.
