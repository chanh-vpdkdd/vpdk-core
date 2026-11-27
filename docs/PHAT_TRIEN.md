# Phát triển và bảo trì

## Phạm vi repository

| Khu vực | Trách nhiệm |
| --- | --- |
| `src/types.ts` | Hợp đồng dữ liệu dùng chung |
| `src/adaptiveParser.ts`, `src/ccttFixedParsers.ts` | Đọc Excel và ánh xạ dữ liệu |
| `src/indexBuilder.ts`, `src/sqlite.ts` | Lập chỉ mục, cache, profile và lưu trữ |
| `src/searchIndexCore.ts`, `src/relevanceScore.ts` | Tìm kiếm trong bộ nhớ và xếp hạng |
| `src/ccttReply*.ts` | Trích xuất, đối chiếu, mẫu và văn bản CCTT |
| `src/quickFileSearch*.ts` | Quét tệp, sao chép và báo cáo |
| `test/core.test.mjs` | Kiểm thử với tệp và database tạm |

Các tệp `src/index.ts`, `src/search.ts`, `src/shared.ts`, `src/cctt.ts` và `src/file-search.ts` tập hợp API theo entry point trong `package.json`. SQLite và contracts có entry point riêng.

## Ranh giới tích hợp

Thư viện nhận dữ liệu, đường dẫn, callback và cấu hình từ ứng dụng. Không đưa vào lõi các phụ thuộc như Electron `BrowserWindow`, React, đăng nhập, cấu hình riêng của ứng dụng hoặc token NocoDB.

Ứng dụng tích hợp chịu trách nhiệm:

- Cung cấp nguồn hồ sơ ngoài Excel và quyết định cách xử lý khi nguồn lỗi.
- Quản lý UI, IPC/HTTP, worker, lịch công việc và trạng thái sẵn sàng.
- Phân biệt lỗi tìm kiếm với kết quả rỗng; quản lý bí mật và quyền truy cập.
- Đóng database và dừng tài nguyên do ứng dụng tạo.

## Cài đặt và kiểm thử

```bash
npm ci
npm run build
npm test
npm pack --dry-run
```

Bộ kiểm thử hiện bao gồm parser/index và cache, SQLite, tra cứu, rà soát CCTT, PDF/DOCX, quét và copy tệp. Dữ liệu được tạo trong thư mục tạm; không dùng dữ liệu nghiệp vụ.

`npm test` chạy bằng Node và cần native module tương thích Node. Khi thư mục phụ thuộc đang dùng binary build cho Electron, hãy dùng môi trường cài phụ thuộc riêng để kiểm thử Node hoặc chạy bộ test với Electron ở chế độ Node sau khi build:

```bash
ELECTRON_RUN_AS_NODE=1 /duong-dan/den/electron test/core.test.mjs
```

Cú pháp gán biến trên áp dụng cho Bash. Trên PowerShell dùng `$env:ELECTRON_RUN_AS_NODE = "1"` trước lệnh và xóa biến sau khi chạy. Kiểm tra trên từng hệ điều hành/runtime cần hỗ trợ; thành công trên Linux không thay thế kiểm tra Windows.

## Thay đổi API và lưu trữ

1. Xác định entry point và kiểu công khai bị ảnh hưởng; giữ tương thích hoặc ghi rõ thay đổi cho ứng dụng tích hợp.
2. Bổ sung kiểm thử với dữ liệu tổng hợp cho hành vi mới hoặc lỗi được sửa.
3. Nếu đổi parser, cache hoặc schema SQLite, xem xét riêng phiên bản index, schema và khả năng đọc dữ liệu cũ.
4. Không xóa dữ liệu người dùng để xử lý migration. Kiểm tra phương án sao lưu và khôi phục SQLite có WAL trên bản sao dữ liệu.
5. Build, test và kiểm tra tarball trước khi cập nhật commit được ứng dụng sử dụng.

Version hiện nằm trong `package.json`. Package đang ở `0.x` và `private: true`; chưa có chính sách phát hành registry hay cam kết ổn định API. Không giả định một nhánh Git hoặc phiên bản mới tự cập nhật trong ứng dụng.

## Khi repository này là submodule

Submodule là một repository Git riêng. Sau khi sửa thư viện, commit và push trong repository này. Sau đó, ở repository ứng dụng, kiểm thử và commit con trỏ submodule mới. Khi cập nhật ứng dụng, chạy `git submodule update --init --recursive` để checkout commit đã được ứng dụng ghim.

## Xử lý sự cố

| Triệu chứng | Kiểm tra |
| --- | --- |
| `Cannot find module` trong `dist` | Chạy `npm ci` và `npm run build`; import đúng entry point công khai |
| `NODE_MODULE_VERSION` không khớp | Cài/rebuild `better-sqlite3` cho Node hoặc Electron đang chạy |
| Build index báo thành công nhưng thiếu bản ghi | Kiểm tra `errors`, quyền thư mục, tag và nguồn bổ sung |
| Rà soát trả `khong-co` bất ngờ | Kiểm tra index đã sẵn sàng, nguồn đầy đủ và callback tìm kiếm không che lỗi |
| PDF trích chữ rỗng | Kiểm tra PDF có lớp chữ; thư viện không OCR |
| Không tìm được tệp mạng | Kiểm tra quyền đọc, đường dẫn mount hoặc UNC và hệ điều hành |
