# Hướng dẫn 1/2 — Cài đặt và chạy dự án trên máy cá nhân (local)

Dành cho người **chưa từng chạy dự án này**. Làm tuần tự từ trên xuống. File thứ hai
(`HUONG_DAN_02_CAU_HINH_VA_SU_DUNG.md`) nói về gửi email thật, chatbot AI, nhập danh sách bản đồ, chạy test.

> Dự án gồm: **web** (Next.js, cổng 3100), **API** (NestJS, cổng 3101), **worker** gửi email, và 4 dịch vụ chạy bằng Docker:
> PostgreSQL, Redis, kho ảnh S3 (SeaweedFS), hộp thư thử Mailpit.

---

## 1. Chuẩn bị máy

| Cần có | Kiểm tra | Ghi chú |
|---|---|---|
| **Docker** (có `docker compose`) | `docker --version` | Docker Desktop hoặc Docker Engine; phải đang chạy |
| **mise** (quản lý Node/pnpm) | `mise --version` | https://mise.jdx.dev — hoặc tự cài Node **24.21.0** và pnpm **12.10.1** |
| **git** | `git --version` | Không bắt buộc nếu đã có thư mục mã nguồn |

Các **cổng** phải đang trống trên máy: `3100`, `3101`, `55432`, `56379`, `58333`, `58025`, `51025`.
(Cổng 3000 thường là ứng dụng khác, không ảnh hưởng.) Kiểm tra nhanh:

```bash
ss -ltn | grep -E ':(3100|3101|55432|56379|58333|58025|51025)\b'   # không in ra gì = ổn
```

---

## 2. Cài đặt lần đầu (chỉ làm một lần)

Mở terminal, vào thư mục dự án:

```bash
cd /đường/dẫn/tới/HBVLFINAL
```

**Bước 1 — Chọn đúng phiên bản Node/pnpm.** Phải chạy lệnh này ở **mỗi terminal mới** trước khi dùng `pnpm`:

```bash
mise install            # lần đầu: tải Node 24.21.0 + pnpm 12.10.1
eval "$(mise env)"
node -v && pnpm -v      # phải ra v24.21.0 và 12.10.1
```

**Bước 2 — Cài thư viện:**

```bash
pnpm install
```

**Bước 3 — Tạo file cấu hình `.env`** (tự sinh mật khẩu ngẫu nhiên, file bị git bỏ qua):

```bash
pnpm setup:env
```

**Bước 4 — Bật các dịch vụ Docker** (Postgres, Redis, kho ảnh, Mailpit):

```bash
pnpm infra:up           # chờ đến khi cả 4 dịch vụ "healthy"
```

**Bước 5 — Tạo bảng dữ liệu và dữ liệu tham chiếu** (17 chuyên mục, 63 tỉnh cũ → 34 tỉnh mới):

```bash
pnpm db:migrate
pnpm db:seed
pnpm storage:init       # tạo bucket chứa ảnh
```

**Bước 6 — Build một lần:**

```bash
pnpm build
```

**Bước 7 — Tạo tài khoản admin đầu tiên** (thay email của bạn):

```bash
BOOTSTRAP_ADMIN_EMAIL=ban@example.com BOOTSTRAP_ADMIN_USERNAME=admin pnpm bootstrap:admin
```

Lệnh in **mật khẩu dùng một lần** — chép lại ngay, không hiện lần nữa. Lệnh từ chối chạy nếu đã có admin.

> Chỉ muốn xem thử với dữ liệu mẫu? Chạy `pnpm seed:dev` — tạo bài viết demo, học viên mẫu và vài tài khoản
> demo (mật khẩu ngẫu nhiên in một lần). **Không** dùng cho môi trường thật.

---

## 3. Chạy hằng ngày

Cần **3 terminal** (mỗi terminal gõ `eval "$(mise env)"` trước). Trước hết bật dịch vụ nền:

```bash
pnpm infra:up
```

| Terminal | Lệnh | Việc |
|---|---|---|
| 1 | `pnpm --filter @hbvl/api dev` | API — http://localhost:3101 |
| 2 | `pnpm --filter @hbvl/api dev:worker` | Worker gửi email (thiếu cái này thì **không có email nào được gửi**) |
| 3 | `pnpm --filter @hbvl/web dev` | Web — http://localhost:3100 |

Mẹo: `pnpm dev` chạy gộp API + web trong một terminal (worker vẫn phải chạy riêng như dòng 2).
Lần đầu mở trang web sẽ chậm vài giây vì Next.js biên dịch theo yêu cầu.

### Kiểm tra đã chạy được chưa

```bash
curl http://localhost:3101/api/v1/health/ready      # {"status":"ok","checks":{"database":"up","redis":"up"}}
```

| Địa chỉ | Là gì |
|---|---|
| http://localhost:3100 | Trang công khai (tiếng Việt); thêm `/en` cho tiếng Anh |
| http://localhost:3100/dang-nhap-quan-tri | Đăng nhập **Quản trị viên** → vào `/admin` |
| http://localhost:3100/dang-nhap-cong-tac-vien | Đăng nhập **Cộng tác viên** → vào `/cong-tac-vien` |
| http://localhost:3100/dang-nhap-thanh-vien | Đăng nhập **Thành viên** |
| http://localhost:3100/category/dong-du-ky/ban-do-vuon-len | **Bản đồ Vươn Lên** |
| http://localhost:3101/api/v1/docs | Tài liệu API (OpenAPI) |
| http://localhost:58025 | **Mailpit** — hộp thư thử: mọi email dev gửi ra đều nằm ở đây |

### Đăng nhập admin lần đầu (bắt buộc bật MFA)

1. Vào `/dang-nhap-quan-tri`, đăng nhập bằng `admin` + mật khẩu một lần ở Bước 7.
2. Vào `/tai-khoan`, đổi mật khẩu và **bật xác thực 2 bước (MFA)**: quét mã QR bằng ứng dụng
   Google Authenticator / Microsoft Authenticator / Authy trên điện thoại, nhập mã 6 số để xác nhận,
   **lưu lại mã khôi phục**.
3. Đăng xuất rồi đăng nhập lại: lần này sẽ hỏi mã 6 số từ ứng dụng. Chưa xong MFA thì `/admin` bị chặn (403).

---

## 4. Dừng và chạy lại

| Muốn | Làm |
|---|---|
| Dừng web/API/worker | `Ctrl + C` ở từng terminal |
| Tắt dịch vụ Docker, **giữ dữ liệu** | `pnpm infra:down` |
| Mở lại sau khi khởi động lại máy | `eval "$(mise env)"` → `pnpm infra:up` → 3 lệnh ở mục 3 (không cần cài đặt lại) |
| **Xóa sạch dữ liệu làm lại từ đầu** | `docker compose down -v` rồi làm lại từ Bước 4 (mất hết bài viết, tài khoản, ảnh) |

Sau khi sửa code API/web, chế độ `dev` tự nạp lại. Nếu sửa trong `packages/contracts` hoặc `packages/database`,
chạy lại `pnpm build` (hoặc `pnpm db:generate` khi đổi schema) rồi khởi động lại API.

---

## 5. Lỗi thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `Unsupported engine` / lệnh `pnpm` báo sai phiên bản | Chưa chạy `eval "$(mise env)"` ở terminal này |
| `run pnpm setup:env first` khi `infra:up` | Chưa có `.env` → `pnpm setup:env` |
| `ECONNREFUSED 127.0.0.1:55432` (hoặc 56379) | Docker chưa bật dịch vụ → `pnpm infra:up`, kiểm tra `docker ps` |
| `port is already allocated` / `EADDRINUSE` | Cổng bị chiếm: `ss -ltnp \| grep :3100` rồi tắt tiến trình đó, hoặc đổi cổng trong `.env` |
| API báo thiếu `dist/main.js` | Chưa `pnpm build` |
| Trang mở được nhưng không có bài viết | Bình thường khi DB trống: đăng bài ở `/admin` hoặc `pnpm seed:dev` |
| Email không thấy đâu | Worker chưa chạy (Terminal 2) → bật `dev:worker`; xem Mailpit ở http://localhost:58025 |
| `/admin` báo 403 sau khi đăng nhập | Admin chưa bật MFA — xem "Đăng nhập admin lần đầu" |
| Cảnh báo "hydration" trong console trình duyệt | Thường do tiện ích trình duyệt (ví dụ Bitdefender) chèn thuộc tính vào trang; thử cửa sổ ẩn danh |
| Quên mật khẩu admin | `BOOTSTRAP_ADMIN_EMAIL=... pnpm bootstrap:admin --force` tạo admin mới, hoặc dùng "Quên mật khẩu" |

---

## 6. Bảo mật khi làm việc ở local

- **Không** đưa file `.env` lên git, không dán nội dung vào chat/email. File có quyền `600`.
- Khóa/mật khẩu nào lỡ để lộ (Gmail app password, khóa Gemini…) thì **thu hồi và tạo lại**.
- Bảng nhật ký `audit_logs` được cơ sở dữ liệu chặn sửa/xóa theo thiết kế — đó không phải lỗi.

Tiếp theo: **`HUONG_DAN_02_CAU_HINH_VA_SU_DUNG.md`**.
