# Tra cứu core

Thư viện TypeScript/Node.js dùng cho lập chỉ mục Excel, tra cứu hồ sơ, xử lý văn bản cung cấp thông tin và quét tìm tệp. Thư viện không phụ thuộc Electron, React, NocoDB hoặc cấu hình của ứng dụng.

## Yêu cầu

Node.js 20 trở lên. `better-sqlite3` là phụ thuộc native, cần cài cho đúng phiên bản Node hoặc Electron sử dụng. Trên Electron, build lại native module cho Electron theo quy trình đóng gói của ứng dụng.

## Các entry point

| Đường dẫn | Nội dung |
| --- | --- |
| `@cn-vpdk-my/tra-cuu-core/contracts` | Kiểu bản ghi, kết quả và tham số |
| `@cn-vpdk-my/tra-cuu-core/shared` | Chuẩn hóa, quy tắc CCTT và kiểu dùng chung; không cần Node |
| `@cn-vpdk-my/tra-cuu-core/index` | Parser Excel và lập chỉ mục |
| `@cn-vpdk-my/tra-cuu-core/sqlite` | Lưu và đọc chỉ mục SQLite |
| `@cn-vpdk-my/tra-cuu-core/search` | Tìm kiếm và xếp hạng |
| `@cn-vpdk-my/tra-cuu-core/cctt` | Trích xuất, rà soát và tạo văn bản |
| `@cn-vpdk-my/tra-cuu-core/file-search` | Quét tệp, sao chép và báo cáo |

Các entry point ngoài `shared` và `contracts` cần Node.js. Hợp đồng đang ở phiên bản `0.x`; chưa công bố ổn định.

## Lập chỉ mục và tra cứu

```ts
import { buildSearchIndex } from '@cn-vpdk-my/tra-cuu-core/index'
import { openSearchDatabase, loadProfileFromDb, loadIndex } from '@cn-vpdk-my/tra-cuu-core/sqlite'
import { SearchIndexCore } from '@cn-vpdk-my/tra-cuu-core/search'

const db = openSearchDatabase('/duong-dan/timluukho.db')
try {
  const result = await buildSearchIndex({
    db,
    rawDataDir: '/duong-dan/excel',
    profile: loadProfileFromDb(db),
    // Ứng dụng có thể cung cấp hồ sơ đo đạc và callback tiến độ.
    loadAdditionalRecords: async () => ({ records: [] }),
  })
  if (!result.success || result.errors.length) throw new Error(result.errors.join('; '))
  const index = loadIndex(db)
  const search = new SearchIndexCore()
  search.appendBatch(index?.records ?? [], 0)
  console.log(search.search('Nguyễn Văn A'))
} finally {
  db.close()
}
```

Việc nạp hồ sơ từ NocoDB, quyết định dùng cache nguồn ngoài và thông báo lỗi thuộc ứng dụng gọi. Lỗi từ nguồn không nên được coi là kết quả “không có hồ sơ”. `AbortSignal` dừng ở điểm kiểm tra giữa các bước; những tệp đã đưa vào parser hoặc cache đã cập nhật có thể vẫn hoàn tất.

Các hàm tìm tệp hỗ trợ chế độ chỉ quét hoặc sao chép, callback tiến độ và `AbortSignal`. Giải quyết `\\host` dựa vào lệnh `net view` trên Windows; với Linux truyền đường dẫn thư mục đã mount vào `quickFileSearchOnRoots`.

## Phát triển

```bash
npm install
npm run build
npm test
npm pack
```

`npm test` cần `better-sqlite3` tương thích với Node đang chạy. Trong workspace ứng dụng, native module có thể đã build cho Electron; khi đó chạy test bằng Electron ở chế độ Node sau khi build thư viện.

Dữ liệu kiểm thử dùng tệp và thư mục tạm. Không đưa dữ liệu hồ sơ, token, cấu hình hoặc bản sao database thực vào repository.
