# VPĐK Core

Thư viện TypeScript cho các nghiệp vụ tra cứu dữ liệu và trả lời văn bản cung cấp thông tin (CCTT). Thư viện đọc dữ liệu Excel, lập chỉ mục SQLite, tìm hồ sơ, hỗ trợ xử lý văn bản và quét tệp theo tên hoặc đường dẫn.

VPĐK Core chạy trên Node.js và có thể tích hợp vào Electron. Thư viện không tự kết nối NocoDB, quản lý tài khoản, cung cấp giao diện hay khởi động web server; ứng dụng tích hợp chịu trách nhiệm cho các phần đó.

## Tài liệu

| Nhu cầu | Hướng dẫn |
| --- | --- |
| Cài đặt, build, sử dụng package và tích hợp Electron | [Bắt đầu](docs/BAT_DAU.md) |
| Đọc Excel, lập chỉ mục SQLite và tìm kiếm | [Index và tra cứu](docs/INDEX_VA_TRA_CUU.md) |
| Trích xuất, rà soát và tạo văn bản CCTT | [Văn bản CCTT](docs/VAN_BAN_CCTT.md) |
| Quét, sao chép tệp và xuất báo cáo | [Tìm tệp](docs/TIM_TEP.md) |
| Kiến trúc, kiểm thử và quy trình phát triển | [Phát triển thư viện](docs/PHAT_TRIEN.md) |

## Chạy từ mã nguồn

Yêu cầu Node.js 20 trở lên và npm. Từ thư mục repository:

```bash
npm ci
npm run build
npm test
```

`better-sqlite3` là module native: cài phụ thuộc cho đúng runtime và hệ điều hành sẽ chạy thư viện. Khi dùng Electron, cần bản native tương thích Electron. Chi tiết: [Bắt đầu](docs/BAT_DAU.md).

## Các entry point

Package có tên `@cn-vpdk-my/tra-cuu-core`, dùng ESM và chưa khai báo entry point gốc. Import qua đường dẫn tương ứng:

| Entry point | Công dụng | Môi trường |
| --- | --- | --- |
| `/contracts` | Kiểu bản ghi, kết quả và tham số | TypeScript |
| `/shared` | Chuẩn hóa và quy tắc CCTT dùng chung | Không yêu cầu API Node |
| `/index` | Parser Excel và lập chỉ mục | Node.js |
| `/sqlite` | Đọc và ghi SQLite | Node.js |
| `/search` | Tìm kiếm và xếp hạng | Node.js |
| `/cctt` | Trích xuất, rà soát và tạo văn bản | Node.js |
| `/file-search` | Quét, sao chép và báo cáo tệp | Node.js |

Ví dụ import:

```ts
import { buildSearchIndex } from '@cn-vpdk-my/tra-cuu-core/index'
import { SearchIndexCore } from '@cn-vpdk-my/tra-cuu-core/search'
import type { HoSoRecord } from '@cn-vpdk-my/tra-cuu-core/contracts'
```

## Phạm vi và trạng thái

- Phiên bản hiện tại là `0.x`; kiểm tra thay đổi hợp đồng khi cập nhật.
- Package được đánh dấu `private` và chưa có quy trình phát hành lên npm registry. Hướng dẫn dùng tarball nội bộ có trong [Bắt đầu](docs/BAT_DAU.md).
- Kết quả tìm kiếm và rà soát là dữ liệu hỗ trợ xử lý. Ứng dụng tích hợp cần kiểm tra trạng thái chỉ mục, lỗi nguồn dữ liệu và xác nhận nghiệp vụ trước khi đưa ra kết luận.
- Các ví dụ và kiểm thử dùng dữ liệu giả. Không đưa hồ sơ, token hoặc database thật vào repository.
