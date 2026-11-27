# Bắt đầu sử dụng VPĐK Core

## Yêu cầu

| Thành phần | Yêu cầu |
| --- | --- |
| Runtime | Node.js 20 trở lên |
| Hệ điều hành | Windows hoặc Linux; cài module native trên hệ điều hành đích |
| TypeScript | Cấu hình hiểu package `exports`, ví dụ `module` và `moduleResolution` là `NodeNext` |
| Electron | `better-sqlite3` phải được rebuild cho phiên bản Electron sử dụng |

Các entry point I/O dùng hệ thống tệp và các API Node. Chỉ `/shared` và kiểu từ `/contracts` được thiết kế không phụ thuộc API Node; hãy kiểm tra bundler và môi trường sử dụng trước khi đưa vào trình duyệt.

## Cài môi trường phát triển

```bash
git clone https://github.com/chanh-vpdkdd/vpdk-core.git
cd vpdk-core
npm ci
npm run build
npm test
```

Lệnh build tạo JavaScript và khai báo kiểu trong `dist/`. Lệnh test build lại trước khi chạy các kiểm thử với dữ liệu tổng hợp.

## Tích hợp bằng tarball nội bộ

Repository hiện không có bước tự build khi cài trực tiếp từ Git. Hãy build và tạo tarball trước:

```bash
npm ci
npm run build
npm pack
```

`npm pack` in ra tên tệp, ví dụ `cn-vpdk-my-tra-cuu-core-0.1.0.tgz`. Trong dự án sử dụng, thay đường dẫn và tên tệp theo kết quả thực tế:

```bash
npm install /duong-dan/den/cn-vpdk-my-tra-cuu-core-0.1.0.tgz
```

Commit lockfile của dự án sử dụng theo quy trình của dự án đó. Package có `private: true`; việc xuất bản lên registry cần một quyết định và quy trình phát hành riêng.

## Sử dụng như submodule

Ứng dụng có thể gắn repository này tại đường dẫn mong muốn rồi import mã nguồn qua cấu hình build của ứng dụng. Sau khi clone ứng dụng đã có submodule:

```bash
git submodule update --init --recursive
```

Submodule được ghim vào một commit bởi repository ứng dụng. Để thay đổi thư viện: commit và push trong repository thư viện; sau đó kiểm thử, cập nhật và commit con trỏ submodule trong repository ứng dụng. Hai thao tác push là độc lập.

Khi clone submodule, Git thường checkout ở trạng thái `detached HEAD`. Chuyển sang nhánh làm việc trước khi sửa và commit:

```bash
git switch main
```

## Kiểm tra module native

Nếu gặp lỗi `NODE_MODULE_VERSION`, module `better-sqlite3` đã được biên dịch cho runtime khác. Cài lại phụ thuộc trong môi trường đang dùng; với Electron, dùng công cụ rebuild của ứng dụng Electron và kiểm tra cả gói đã đóng.

Không dùng chung một bản native được build cho Node với Electron khi ABI khác nhau. Trong workspace có cả hai runtime, kiểm thử mỗi runtime với bản native phù hợp.

## Bước tiếp theo

- [Lập chỉ mục và tra cứu](INDEX_VA_TRA_CUU.md)
- [Văn bản CCTT](VAN_BAN_CCTT.md)
- [Tìm tệp](TIM_TEP.md)
