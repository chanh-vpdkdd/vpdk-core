# Quét tìm và sao chép tệp

Entry point `/file-search` duyệt thư mục và so khớp từ khóa với tên hoặc đường dẫn tệp. Chức năng này không đọc nội dung tệp và không tự kết nối mạng mesh.

## Quét trên thư mục local hoặc đã mount

```ts
import { quickFileSearchOnRoots } from '@cn-vpdk-my/tra-cuu-core/file-search'

const controller = new AbortController()
const result = await quickFileSearchOnRoots({
  scanRoots: ['./ho-so'],
  destinationPath: '',
  keywords: ['AA123', 'BB 456'],
  mode: 'scanOnly',
  signal: controller.signal,
}, (progress) => {
  console.log(progress.phase, progress.scannedCount, progress.matchedCount)
})

if (!result.success) throw new Error(result.message)
console.log(result.items)
```

`scanOnly` chỉ trả danh sách `items`; `files` là danh sách đường dẫn đã copy nên rỗng trong chế độ này. Để sao chép, đặt `mode: 'scanAndCopy'` và `destinationPath` là thư mục đích:

```ts
import { quickFileSearchOnRoots } from '@cn-vpdk-my/tra-cuu-core/file-search'

const result = await quickFileSearchOnRoots({
  scanRoots: ['./ho-so'],
  destinationPath: './ket-qua',
  keywords: ['AA123'],
  mode: 'scanAndCopy',
})
```

Khi trùng tên, tệp đích được thêm `(1)`, `(2)`… Hàm cố gắng tạo báo cáo Excel trong thư mục đích; kiểm tra `reportPath` để biết báo cáo có được tạo hay không.

## Đường dẫn SMB

`quickFileSearchAndCopy` nhận `sourcePath`, `destinationPath` và `keywords`; hàm chuẩn hóa nguồn theo UNC Windows và thực hiện quét cùng copy. Với nguồn dạng `\\\\host`, hàm dùng lệnh `net view` của Windows để liệt kê share dạng Disk. Với Linux, mount share trước và truyền đường dẫn mount vào `quickFileSearchOnRoots`.

## Từ khóa và kết quả

- Có thể truyền nhiều chuỗi; các phần phân cách bằng `hoặc`, `hoac`, `or`, dấu phẩy hoặc chấm phẩy cũng được tách thành lựa chọn.
- So khớp không phân biệt chữ hoa/thường và có xử lý các dấu phân cách trong tên/đường dẫn.
- `scannedCount`, `matchedCount`, `copiedCount` và `items` mô tả kết quả; kiểm tra `items[].copied` cho từng tệp.
- Thư mục không đọc được có thể bị bỏ qua; một số lỗi copy hoặc ghi báo cáo không làm toàn bộ kết quả thất bại. Kiểm tra quyền và kết quả từng tệp trước khi kết luận.
- `signal` hỗ trợ hủy tại các điểm kiểm tra trong vòng quét/copy. Tệp đã sao chép trước khi hủy vẫn ở thư mục đích.

Để xuất báo cáo riêng, dùng `buildQuickFileSearchReportBuffer(items)` hoặc `writeQuickFileSearchReport(items, filePath)`. Ứng dụng chịu trách nhiệm chọn nơi lưu, quản lý quyền truy cập và điều phối quét phân tán.
