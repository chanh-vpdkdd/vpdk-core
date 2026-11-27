# Lập chỉ mục và tra cứu

## Luồng dữ liệu

1. Liệt kê tệp Excel trong thư mục nguồn và các thư mục con.
2. Đọc từng workbook, nhận diện cấu trúc và chuyển dữ liệu thành `HoSoRecord`.
3. Dùng cache theo tệp; nhận thêm bản ghi từ ứng dụng nếu có.
4. Ghi bản ghi, metadata, cache và profile vào SQLite.
5. Nạp bản ghi vào `SearchIndexCore` để tìm trong bộ nhớ.

Mỗi bản ghi có `id`, thông tin tệp/sheet/dòng, `fields`, `searchText` và `tags`. Bản ghi từ nguồn ngoài cần cùng hợp đồng; ứng dụng tạo và cung cấp chúng qua `loadAdditionalRecords`. Chuẩn hóa `searchText` bằng `normalizeSearchText` từ `/shared` để thuật toán chấm điểm xử lý nhất quán. Thư viện không tự truy cập NocoDB.

## Lập chỉ mục và tìm kiếm

Ví dụ Node.js/TypeScript dưới đây giả định thư mục `./du-lieu-excel` đã tồn tại:

```ts
import { buildSearchIndex } from '@cn-vpdk-my/tra-cuu-core/index'
import {
  getIndexBuildErrors,
  loadIndex,
  loadProfileFromDb,
  openSearchDatabase,
} from '@cn-vpdk-my/tra-cuu-core/sqlite'
import { SearchIndexCore } from '@cn-vpdk-my/tra-cuu-core/search'

const db = openSearchDatabase('./du-lieu/timluukho.db')
try {
  const build = await buildSearchIndex({
    db,
    rawDataDir: './du-lieu-excel',
    profile: loadProfileFromDb(db),
    onProgress: ({ done, total, message }) => {
      console.log(done, total, message)
    },
  })

  if (!build.success || build.errors.length > 0) {
    throw new Error('Phân tích chưa đầy đủ: ' + build.errors.join('; '))
  }

  const storedErrors = getIndexBuildErrors(db)
  if (storedErrors.length > 0) {
    throw new Error('Chỉ mục có lỗi: ' + storedErrors.join('; '))
  }

  const index = loadIndex(db)
  const search = new SearchIndexCore()
  search.appendBatch(index?.records ?? [], 0)

  for (const hit of search.search('Nguyễn Văn An', 20, 'all')) {
    console.log(hit.record.sourceFile, hit.record.sheetName, hit.score)
  }
} finally {
  db.close()
}
```

`buildSearchIndex` có thể trả `success: true` cùng danh sách `errors` khi một số tệp hoặc nguồn bổ sung có lỗi. Luôn kiểm tra cả hai trường trước khi coi dữ liệu là đầy đủ. `getIndexBuildErrors` đọc lỗi build gần nhất; database cũ chưa có metadata lỗi trả mảng rỗng, nên điều đó không xác nhận lịch sử build cũ hoàn chỉnh.

## Tùy chọn lập chỉ mục

| Trường | Ý nghĩa |
| --- | --- |
| `rawDataDir`, `db`, `profile` | Thư mục Excel, kết nối SQLite và profile parser |
| `loadAdditionalRecords` | Hàm async trả `{ records, errors? }` từ nguồn do ứng dụng quản lý |
| `parseFile` | Thay parser mặc định; trả `{ records, error? }` |
| `prepareParser`, `poolSize` | Chuẩn bị parser riêng và số tác vụ đồng thời |
| `pauseMs` | Thời gian chờ sau mỗi tác vụ parse |
| `onProgress` | Nhận `done`, `total`, `progress`, `message` và `currentFile?` |
| `signal` | Yêu cầu hủy giữa các bước |

Parser mặc định chạy trong process gọi; thư viện không tự tạo worker pool. Muốn xử lý bằng worker, ứng dụng cung cấp `parseFile` và quản lý vòng đời worker.

Cache dùng đường dẫn tương đối, `mtimeMs` và kích thước tệp. Metadata phiên bản index hiện là `6`; khi phiên bản index không khớp, cache tệp được làm lại. Nếu nội dung thay đổi nhưng cả thời gian sửa và kích thước giữ nguyên, fingerprint này có thể không phát hiện thay đổi.

`AbortSignal` được kiểm tra tại các điểm trong quá trình xử lý. Hủy không tự dừng parser đang chạy; một số cập nhật cache có thể đã xảy ra. Bản ghi, metadata và lỗi build được lưu trong transaction ở bước cuối.

## Hành vi tìm kiếm hiện tại

- Query và `searchText` được chuẩn hóa chữ thường, bỏ dấu tiếng Việt và tách token chữ/số có ít nhất hai ký tự.
- Các token của một query được lấy **giao**: bản ghi phải chứa tất cả token. Query rỗng hoặc không tạo token trả mảng rỗng.
- Khi query có từ hai token chữ trở lên, các token chữ còn phải xuất hiện theo thứ tự, với tối đa một từ xen giữa mỗi cặp.
- Kết quả lọc theo tag nguồn và xếp theo độ liên quan. `score` bằng `1 - relevance`, nên điểm nhỏ hơn biểu thị độ liên quan cao hơn.
- Với query chỉ có một token, vòng xét có thể dừng khi đạt `limit` trước khi sắp xếp. Không coi kết quả đó là toàn bộ corpus.
- Mã có khả năng tạo Fuse index, nhưng `search()` hiện tìm bằng giao token; không cam kết tìm mờ hoặc sửa lỗi chính tả.

Giá trị lọc nguồn: `all`, `vbdlis`, `ho-so-tiep-nhan`, `so-theo-doi`, `ho-so-luu`, `ho-so-do-dac`. Bộ lọc dựa trên `record.tags`; dữ liệu bổ sung cần gắn tag phù hợp.

## SQLite và vòng đời

`openSearchDatabase(path)` tạo thư mục cha khi cần và mở database. Gọi `db.close()` khi hoàn tất. Có thể mở các database độc lập bằng các instance riêng. SQLite dùng WAL; khi sao lưu database đang hoạt động, dùng cơ chế sao lưu phù hợp với SQLite hoặc đóng các kết nối và bảo đảm dữ liệu WAL đã được xử lý.

`loadIndex` nạp toàn bộ bản ghi. Với tập dữ liệu lớn, xem `countHoSoRecords`, `loadRecordsBatchSlim` và `hydrateRecordFields` trong entry point `/sqlite` để thiết kế luồng nạp theo lô và bổ sung `fields` khi cần.

## Giới hạn cần xử lý ở ứng dụng

- Phân biệt lỗi nạp index, nguồn dữ liệu không sẵn sàng và kết quả tìm rỗng.
- `listExcelFiles` bỏ qua thư mục không đọc được; ứng dụng cần kiểm tra quyền và sự sẵn sàng của nguồn trước khi kết luận dữ liệu đầy đủ.
- Quản lý lịch rebuild, worker, NocoDB và chính sách cache nguồn ngoài ở ứng dụng.
