# PROGRESS — nhật ký tiến độ

> Cách tiếp tục ở phiên mới: đọc file này → `README.md` → `docs/TEST_REPORT.md` (đã chạy gì, NOT RUN gì) → `docs/FEATURE_PARITY.md`. Yêu cầu gốc rút gọn ở `docs/REQUIREMENTS_SUMMARY.md`.

## Trạng thái (cập nhật cuối: 2026-10-10)
**Mọi mốc M1–M8 đã xong ở mức local/CI-cục-bộ.** Không còn dòng `PLANNED` trong `FEATURE_PARITY.md` (43 DONE · 1 PARTIAL · 2 N/A). **Chưa triển khai production** — cần thông tin bên ngoài (`DEPLOYMENT.md §9`).

| Mốc | Trạng thái | Bằng chứng chính |
|---|---|---|
| M1 audit/parity/quyền/kế hoạch | XONG | `SOURCE_AUDIT`, `FEATURE_PARITY`, `PERMISSIONS`, `IMPLEMENTATION_PLAN` |
| M2 monorepo/Docker/DB | XONG | compose healthy; 40 model/41 bảng, 4 migration; Dockerfile đa tầng; `compose.prod.yaml`; CI |
| M3 auth/authz | XONG | integration `auth` 13 + `ratelimit` 5; smoke bootstrap an toàn |
| M4 content + migration WP | XONG | CLI `migrate:legacy`; 22 test migration; chạy thật trên dump gốc (0 ERROR, idempotent) |
| M5 submission/review | XONG | integration `workflow` 18; E2E member→CTV→admin→public |
| M6 feedback/contact/comment/like/outbox | XONG | integration + E2E |
| M7 bản đồ/tỉnh/học viên/danh bạ/i18n/SEO/redirect | XONG | integration `admin-map` 15; E2E `map` 7 |
| M8 polish/hardening/deploy/load/backup | XONG (local) | a11y axe 22; smoke 12; k6 100 VU/5 phút; `ops drill`; Lighthouse; ảnh chụp |

## Kết quả cuối (xem số liệu đầy đủ ở `TEST_REPORT.md`)
typecheck/lint/format/build/audit **PASS** · unit 96 · integration 77 · migration 22 · E2E 79 (chromium 55 + a11y 22 + firefox 2; 3 lần chạy liên tiếp đều 79/79) · smoke 12/12 · k6: 25 911 request, 0 % lỗi, p95 65 ms (1 tiến trình/dịch vụ, chung máy với k6).

## Việc còn lại / cần người quyết định (không phải lỗi ẩn)
1. Triển khai thật: host, tên miền/DNS, S3/SMTP thật + SPF/DKIM, secret manager — `DEPLOYMENT.md`.
2. Dump WordPress **production mới** + `uploads` thật; rà các cảnh báo `needsReview`; xác minh danh bạ tỉnh; ảnh tỉnh có bản quyền; nội dung các trang cũ (`gioi-thieu`…) trông như nội dung mẫu của template khác.
3. Chưa làm/chưa kiểm: chạy CI trên GitHub; nhiều bản sao API/worker; WebKit/thiết bị thật; pentest/fuzz/quét virus; xoay `MFA_ENCRYPTION_KEY` tự động; giám sát/cảnh báo; cron sao lưu; hiển thị liên kết mạng xã hội ở giao diện (khoá `social` có sẵn, chưa có URL nguồn); tối ưu LCP (3,4–4,0 s mobile mô phỏng).
4. Giữ nguyên: nguồn `HBVL/RiseUp` **không bị sửa**; `READING_NOTES.md` giữ nguyên.

## Môi trường đã chốt
- Node **24.21.0** (mise `.mise.toml`; máy dev mặc định Node 26 ⇒ dùng `eval "$(mise env)"` hoặc `export PATH=$HOME/.local/share/mise/installs/node/24.21.0/bin:$HOME/.local/share/mise/installs/pnpm/12.10.1:$PATH`), pnpm 12.10.1.
- Cổng dev: web 3100, API 3101 (3000 bị dự án khác chiếm); E2E 3200/3201; smoke 3300/3301; load 3400/3401. Postgres 55432, Redis 56379, S3 58333, SMTP 51025, Mailpit UI 58025.
- Nest 12 chỉ ESM; API build CJS (`module: node20`) và chạy từ `dist/`; **không** chạy Nest bằng tsx (thiếu decorator metadata) — CLI cần DI (`openapi:export`) chạy từ `dist/`.
- Container `hbvl-wp-restore` (MariaDB 11.4, 127.0.0.1:33061) chứa dump WP gốc — tạo bằng `scripts/migration/restore-legacy.mjs`, **chỉ đọc**. Cuối phiên đã **gỡ** container này và các DB diễn tập (`hbvl_migration`, `hbvl_load`, `hbvl_smoke`, `hbvl_migtest`) vì chứa dữ liệu từ dump thật/synthetic; tái tạo bằng `LEGACY_SQL_DUMP=… node scripts/migration/restore-legacy.mjs` + `pnpm db:create hbvl_migration` (~30 s). Tiến trình `next-server` đổi tên khi chạy: kill theo cổng/nhóm tiến trình, không theo pid wrapper.

## Lệnh tiếp tục
```bash
cd HBVLFINAL && eval "$(mise env)"
pnpm setup:env && pnpm infra:up && pnpm install && pnpm db:migrate && pnpm db:seed && pnpm storage:init
pnpm build && pnpm test:integration && pnpm test:migration && pnpm test:e2e && pnpm test:smoke
```
