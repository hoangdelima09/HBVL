# DEPLOYMENT

> **Trạng thái:** repo cung cấp image Docker, `infra/compose.prod.yaml`, Caddyfile và CI, nhưng **chưa có lần triển khai thật nào** (không có host, tên miền, DNS, SMTP, bucket thật trong môi trường làm việc). Mọi bước dưới đây phải do người vận hành thực hiện với thông tin thật. Những gì đã kiểm chứng tại local được ghi trong `TEST_REPORT.md`.

## 1. Cần chuẩn bị (thông tin bên ngoài repo)

| Hạng mục | Ghi chú |
|---|---|
| Máy chủ Linux có Docker Compose v2 (hoặc nền tảng container tương đương) | một host đủ cho quy mô hiện tại; đo trên 1 tiến trình/dịch vụ: RSS đỉnh api ≈ 470 MiB, web ≈ 790 MiB, worker ≈ 240 MiB |
| Tên miền + DNS trỏ về host (`SITE_DOMAIN`) | Caddy tự cấp/gia hạn TLS khi DNS đúng; **repo không đổi DNS** |
| PostgreSQL 17 (container hoặc managed) | cần 3 vai trò: superuser (khởi tạo/restore), `hbvl_migrator`, `hbvl_app` — `infra/postgres/init/01-roles.sh` |
| Redis 8 có mật khẩu | phiên, cache, rate-limit, BullMQ; `maxmemory-policy noeviction` |
| S3-compatible (AWS S3, R2, SeaweedFS…) | **một bucket riêng tư** (`S3_BUCKET_PRIVATE`); trình duyệt không bao giờ gọi S3 trực tiếp |
| SMTP gửi thư thật + SPF/DKIM/DMARC cho `MAIL_FROM` | thiếu SPF/DKIM thư dễ vào spam; trạng thái chỉ tới `SENT_TO_PROVIDER` |
| Hộp thư nhận liên hệ `CONTACT_INBOX_EMAIL` | mặc định theo theme cũ — **đổi theo thực tế** |
| Nơi lưu bí mật (secret manager / file `.env.production` quyền 600) | không commit |

## 2. Biến môi trường production

Sinh bí mật **riêng cho từng môi trường** (`openssl rand -base64 48`; `MFA_ENCRYPTION_KEY` = 32 byte base64). Mẫu: `.env.example`. Ứng dụng **từ chối khởi động** nếu thiếu/sai (đã kiểm: image chạy với `.env` dev bị báo lỗi cấu hình rõ ràng).

| Nhóm | Biến |
|---|---|
| URL | `PUBLIC_ORIGIN` (https://…), `API_INTERNAL_URL` (web → api), `TRUST_PROXY` (số hop proxy; Caddy + Next ⇒ 2 cho API) |
| App | `NODE_ENV=production`, `APP_ENV=production`, `COOKIE_SECURE=true` (bắt buộc), `SESSION_COOKIE_NAME` |
| DB | `DATABASE_URL` (user `hbvl_app`), `MIGRATION_DATABASE_URL` (user `hbvl_migrator`), `DB_POOL_MAX` (tổng = số bản sao × giá trị này ≤ ngân sách `max_connections`) |
| Redis | `REDIS_URL` |
| S3 | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET_PRIVATE`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` |
| Mail | `SMTP_HOST/PORT/SECURE/USER/PASSWORD`, `MAIL_FROM`, `CONTACT_INBOX_EMAIL` |
| Bí mật | `CSRF_SECRET`, `TOKEN_HASH_PEPPER`, `MFA_ENCRYPTION_KEY` |
| CAPTCHA | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` — key thật từ dash.cloudflare.com → Turnstile (tên miền = `SITE_DOMAIN`); API **từ chối khởi động** với key thử nghiệm |
| Giới hạn | `GLOBAL_RATE_LIMIT_PER_MIN` (mặc định 1200/IP/phút), `RATE_LIMIT_MULTIPLIER=1` (**giữ 1**) |

## 3. Triển khai bằng Compose (tham chiếu)

```bash
cp .env.example .env.production        # điền giá trị thật; chmod 600
docker compose -f infra/compose.prod.yaml --env-file .env.production build
docker compose -f infra/compose.prod.yaml --env-file .env.production up -d
```

Thứ tự được compose bảo đảm: `postgres` healthy → **`migrate`** (một lần, `prisma migrate deploy`) → `api` + `worker` → `web` (chờ api healthy) → `caddy`. Container ứng dụng chạy **non-root**, `read_only`, `cap_drop: ALL`, `no-new-privileges`; chỉ Caddy mở cổng 80/443; Postgres/Redis không công bố cổng ra ngoài.

Khởi tạo một lần (dùng image `tools`, mạng nội bộ):
```bash
docker compose -f infra/compose.prod.yaml --env-file .env.production run --rm migrate pnpm db:seed         # dữ liệu tham chiếu: 17 chuyên mục, tỉnh, ánh xạ
docker compose -f infra/compose.prod.yaml --env-file .env.production run --rm migrate pnpm storage:init    # tạo bucket nếu chưa có
```

> `compose.prod.yaml` đã được kiểm bằng `docker compose config` (cú pháp + biến bắt buộc) nhưng **chưa `up` trên host thật**. Nếu dùng Postgres/Redis/S3 managed: xoá service tương ứng và trỏ URL tới dịch vụ đó (vẫn cần `CREATE EXTENSION pg_trgm, pgcrypto` và hai vai trò).

## 4. Tạo quản trị viên đầu tiên (an toàn)

Không có tài khoản mặc định ở production (dev seed **từ chối chạy** khi `NODE_ENV/APP_ENV=production|staging`).
```bash
docker compose … run --rm -e BOOTSTRAP_ADMIN_EMAIL=ban@vidu.org -e BOOTSTRAP_ADMIN_USERNAME=admin migrate pnpm bootstrap:admin
```
Mật khẩu ngẫu nhiên in **một lần** (hoặc đặt `BOOTSTRAP_ADMIN_PASSWORD` ≥ 12 ký tự). Chỉ chạy được khi chưa có admin hoạt động (`--force` để cứu hộ). Sau đó: đăng nhập `/dang-nhap-quan-tri` → vào `/tai-khoan` bật MFA TOTP → đăng nhập lại; `/admin` từ chối phiên chưa qua MFA. Mời CTV/thành viên trong console.

## 5. Chuyển dữ liệu WordPress
Xem `MIGRATION.md` (§1 quy trình, §7 cutover/rollback). Tóm tắt: khôi phục dump mới vào MariaDB tạm → `dry-run` → xử lý ERROR → `apply` → rà `needsReview` → người dùng tự kích hoạt tài khoản qua "Quên mật khẩu".

## 6. Reverse proxy / CDN
- Caddy (đi kèm) chỉ proxy tới `web:3100`; Next chuyển `/api/v1/*` sang API qua `API_INTERNAL_URL` (đọc lúc chạy). Có thể định tuyến `/api/v1` thẳng tới API ở proxy nếu muốn.
- HTML công khai ẩn danh **không có cookie và không chứa dữ liệu cá nhân** ⇒ có thể cache ở CDN (đã kiểm: smoke "no Set-Cookie"); bỏ qua cache khi có cookie phiên. Ảnh phục vụ qua `/api/v1/media/:id/:variant` với header cache phù hợp.
- Đặt `TRUST_PROXY` đúng số hop để rate-limit/audit thấy IP thật; sai giá trị có thể cho phép giả mạo `X-Forwarded-For`.
- **Cloudflare (khuyên dùng, chống DDoS):** bật proxy (đám mây cam) cho bản ghi DNS, SSL/TLS = **Full (strict)**. Caddyfile chỉ tin `CF-Connecting-IP` khi kết nối đến từ dải IP của Cloudflare (`trusted_proxies`), nên rate-limit/CAPTCHA/nhật ký thấy IP thật của người dùng; header giả từ nơi khác bị bỏ qua. Dải IP lấy từ https://www.cloudflare.com/ips/ — cập nhật nếu Cloudflare đổi. `TRUST_PROXY` giữ nguyên.
- **Giấu IP gốc:** khi đã dùng Cloudflare, chỉ cho cổng 80/443 nhận kết nối từ dải IP Cloudflare bằng **firewall của nhà cung cấp VPS** (Docker tự mở cổng và **bỏ qua `ufw`**), hoặc dùng Cloudflare Tunnel (không mở cổng nào). Không để lộ IP VPS ở bản ghi DNS khác (ví dụ `mail.`, `ftp.` không qua proxy).
- Caddy đặt timeout đọc header/body (chống slowloris) và giới hạn body 8 MB; API giới hạn mọi request theo IP (`GLOBAL_RATE_LIMIT_PER_MIN`) và từng endpoint nhạy cảm (đăng nhập, đăng ký, quên mật khẩu, bình luận, upload, chatbot).

## 7. Triển khai bản mới / rollback
1. `docker compose … build` (hoặc kéo image đã gắn thẻ `HBVL_TAG`).
2. **Sao lưu trước** (`OPERATIONS.md`).
3. `up -d`: `migrate` chạy trước; migration chỉ **thêm** (mở rộng-rồi-thu hẹp) để bản cũ còn chạy được trong lúc cuốn chiếu.
4. Kiểm `/api/v1/health/ready`, `pnpm test:smoke` ở staging.
5. Rollback ứng dụng: chạy lại thẻ image cũ. Rollback schema: **khôi phục từ bản sao lưu** (không có migration "down").

## 8. Kiểm tra sau triển khai
- `GET /api/v1/health/live` (tiến trình) và `/ready` (DB + Redis) — dùng cho healthcheck/giám sát.
- Header: `Content-Security-Policy` có nonce, `Strict-Transport-Security`, cookie `__Host-…; Secure; HttpOnly`.
- Gửi thử một liên hệ → thư tới `CONTACT_INBOX_EMAIL`; kiểm `outbox_events` không tồn đọng.
- `docs/openapi.json` (`pnpm openapi:export`) phản ánh API đang chạy.

## 9. Việc cần quyết định/cung cấp thêm
Tên miền & DNS · nhà cung cấp S3/SMTP/hosting · chính sách giữ log và sao lưu (thời hạn, nơi lưu, mã hoá) · người nhận cảnh báo · dump WordPress production mới + thư mục `uploads` thật · xác minh danh bạ tỉnh thật · ảnh tỉnh có bản quyền · nội dung các trang cũ (`gioi-thieu`, `chuyen-trang`… trông như nội dung mẫu của template khác).
