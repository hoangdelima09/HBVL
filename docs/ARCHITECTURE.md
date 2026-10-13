# ARCHITECTURE

Học Bổng Vươn Lên / Rise Up (Quỹ Khuyến Học Đông Du) — chuyển từ WordPress sang ứng dụng TypeScript. Tài liệu này mô tả **những gì đã được xây và chạy** (số liệu kiểm chứng ở `TEST_REPORT.md`); quyết định ban đầu nằm ở `IMPLEMENTATION_PLAN.md`.

## 1. Sơ đồ

```mermaid
flowchart LR
  B[Trình duyệt] -->|HTTPS| P[Reverse proxy<br/>Caddy: TLS, nén, HSTS]
  P --> W[web — Next.js 16<br/>App Router, SSR, standalone]
  W -->|/api/v1/* proxy, runtime| A[api — NestJS 12<br/>REST + OpenAPI]
  W -.->|SSR đọc dữ liệu công khai<br/>(không chuyển cookie)| A
  A --> PG[(PostgreSQL 17)]
  A --> R[(Redis 8<br/>phiên · cache · rate-limit · hàng đợi)]
  A --> S3[(S3-compatible<br/>ảnh riêng tư)]
  PG -->|outbox| K[worker — NestJS + BullMQ]
  K --> R
  K -->|SMTP| M[Mail server<br/>Mailpit khi dev]
  T[CLI tools<br/>migrate · bootstrap-admin · ops] --> PG
  T --> S3
```

Một monorepo pnpm (Node 24.21.0 ghim):

| Đường dẫn | Vai trò |
|---|---|
| `apps/web` | Next.js: trang công khai (VI mặc định không prefix, `/en`), khu thành viên, **2 console tách biệt** `/admin` và `/cong-tac-vien` |
| `apps/api` | NestJS: REST `/api/v1`, OpenAPI, worker (`dist/worker.js`), CLI (`bootstrap:admin`, `migrate:legacy`, `ops`, `seed:dev`, `openapi:export`) |
| `packages/contracts` | Zod schema, hằng giới hạn, hàm bỏ dấu tiếng Việt/slug/`safeReturnTo` dùng chung web+api |
| `packages/database` | Prisma schema, migration SQL, seed tham chiếu (17 chuyên mục, 97 tỉnh + ánh xạ 63→34, settings) |
| `tests` | integration (Vitest+Supertest), migration, E2E+a11y (Playwright), smoke, load (k6) |
| `infra` | init Postgres, `compose.prod.yaml`, Caddyfile |

## 2. Quyết định cốt lõi

| Chủ đề | Quyết định | Lý do |
|---|---|---|
| Xác thực | **Phiên opaque phía server**: token ngẫu nhiên 256 bit, DB chỉ lưu HMAC của nó; vai trò đọc từ DB **mỗi request** | đổi quyền/khoá tài khoản có hiệu lực ngay; không JWT tự chứa quyền |
| Cookie | `HttpOnly`, `SameSite=Lax`, tiền tố `__Host-` + `Secure` khi `COOKIE_SECURE` | chống XSS đánh cắp phiên, giảm CSRF |
| CSRF | kiểm `Origin` theo allowlist + **double-submit token gắn với phiên** (HMAC); client đọc cookie lúc gửi | cookie auth ⇒ mọi method ghi phải có CSRF |
| Mật khẩu | Argon2id (19 MiB, t=2), tối đa 128 ký tự; khoá tài khoản sau 10 lần sai | |
| MFA | TOTP tự cài theo RFC 6238 (kiểm bằng test vector), bí mật mã hoá AES-GCM, mã khôi phục băm, chống phát lại trong Redis; **bắt buộc cho `/admin`** | |
| Phân quyền | decorator `@Auth({roles, verified, mfa})` + chính sách theo trạng thái; **404 cho tài nguyên không được phép biết, 403 cho hành động bị cấm** | không lộ sự tồn tại |
| Workflow bài | máy trạng thái thuần + CHECK ở DB; `version`/ETag/`If-Match` ⇒ 409; `Idempotency-Key` bền | tránh ghi đè mất dữ liệu, tránh gửi trùng khi nhấn đúp |
| Thư | **transactional outbox** (ghi cùng transaction) → worker (`FOR UPDATE SKIP LOCKED`) → BullMQ → SMTP; trạng thái `QUEUED/SENT_TO_PROVIDER/FAILED`, **không bao giờ tự nhận "DELIVERED"** | không mất sự kiện khi queue/SMTP lỗi |
| Media | `sharp` giải mã + mã hoá lại (bỏ EXIF), giới hạn pixel, khoá object do server sinh; **riêng tư cho tới khi bài chứa nó được xuất bản**; phục vụ qua `/api/v1/media/:id/:variant` | ảnh nháp không lộ; không tin tên/MIME của client |
| Rich text | Tiptap ở client, **sanitize-html allowlist ở server** (loại script/handler/iframe ngoài YouTube/Vimeo) | không tin HTML từ trình duyệt |
| Tìm kiếm | cột `searchText` đã bỏ dấu + chỉ mục trigram; truy vấn bỏ dấu cùng hàm | "dong thap" tìm được "Đồng Tháp" |
| i18n | VI không prefix, EN dưới `/en`; `PostTranslation` có fallback rõ ràng (hiện nhãn "chưa có bản dịch") | giữ URL cũ, cache theo URL |
| Cache | Redis, vô hiệu hoá bằng **namespace version** khi xuất bản/sửa/thu hồi; HTML công khai **không chứa dữ liệu cá nhân** nên có thể cache ở CDN | phần cá nhân hydrate phía client từ `/auth/me` |
| CSP | nonce theo request (`proxy.ts`), `strict-dynamic`, không `unsafe-eval`; `frame-ancestors 'none'` | |

## 3. Luồng chính

### Gửi bài → duyệt → xuất bản
`MEMBER/CTV` lưu nháp (`DRAFT`) → gửi duyệt (`PENDING_REVIEW`, cần e-mail đã xác minh, `Idempotency-Key`, `If-Match`) → CTV/Admin biên tập hoặc **yêu cầu sửa** (`CHANGES_REQUESTED`, bắt buộc lý do) → người gửi sửa và gửi lại → **chỉ Admin** xuất bản/từ chối. Mỗi bước ghi `review_events` (bất biến) + `post_revisions`; xuất bản chuyển ảnh liên quan sang `PUBLIC`, vô hiệu cache, tạo thông báo. Không còn luồng Google Drive của bản cũ.

### E-mail
Nghiệp vụ ghi `outbox_events` (payload mã hoá) cùng transaction → relay chuyển vào BullMQ → `email.processor` gửi SMTP, retry có backoff, xoá payload sau khi gửi. Hộp **góp ý** chỉ CTV+Admin đọc; hộp **liên hệ** chỉ Admin đọc.

### Bản đồ
`provinces` (LEGACY_63 và CURRENT_34) + `province_mappings`; thống kê một nguồn duy nhất từ `scholarship_members`. Hình học (34 + 63 + 17 nhãn đảo) phục vụ qua `GET /map/geometry?v=<hash>` (cache bất biến). Hoàng Sa/Trường Sa là nhãn đảo, **không** là tỉnh.

## 4. Giới hạn đã biết (trung thực)

- API và worker chạy **một tiến trình mỗi dịch vụ** trong các phép đo; mở rộng ngang đã được thiết kế (trạng thái ở Postgres/Redis, khoá `SKIP LOCKED`/advisory) nhưng **chưa được kiểm thử nhiều bản sao**.
- OpenAPI mô tả route/tham số/phản hồi cơ bản; **body request được xác thực bằng Zod trong controller** nên chưa nằm đầy đủ trong tài liệu OpenAPI.
- Chưa có CDN/WAF/giám sát bên ngoài: cần thông tin triển khai thật (xem `DEPLOYMENT.md`).
- Phần danh bạ tỉnh (`directory_contacts`) từ theme là **dữ liệu mẫu**, mặc định ẩn cho tới khi admin xác minh.
