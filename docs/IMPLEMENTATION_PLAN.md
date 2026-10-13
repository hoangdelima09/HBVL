# IMPLEMENTATION_PLAN — Kế hoạch triển khai theo mốc

Tiến độ thực tế nằm ở `docs/PROGRESS.md`. Quyết định kiến trúc chi tiết: `docs/ARCHITECTURE.md`. Mỗi mốc kết thúc bằng một sản phẩm **chạy được** + test thật.

## Quyết định cốt lõi (đã chốt, lý do ngắn)

| Chủ đề | Quyết định | Lý do |
|---|---|---|
| Runtime | Node.js **24 LTS** (24.21.0), pnpm 12 | Node 26 còn là "Current" (LTS chỉ từ cuối 10/2026); 22 ở Maintenance |
| Backend | NestJS (REST + OpenAPI), modular monolith | theo yêu cầu |
| Web | Next.js App Router (16.x) + React 19 + Tailwind 4 | theo yêu cầu |
| DB | PostgreSQL 17 + Prisma 7, migrations versioned | quan hệ rõ, ràng buộc |
| Auth | **Session opaque** (token ngẫu nhiên 256 bit, lưu **hash** trong bảng `Session`), cookie HttpOnly/SameSite=Lax/Secure(prod); role đọc từ DB mỗi request | đổi quyền có hiệu lực ngay; không JWT |
| CSRF | Kiểm `Origin`/`Referer` + double-submit token (header `X-CSRF-Token` = cookie `csrf`) cho mọi method ghi, gồm login/logout | cookie auth |
| Mật khẩu | Argon2id (`argon2` npm), max 128 ký tự | |
| Rate limit | `@nestjs/throttler` + storage Redis (key theo actor/IP) | dùng chung đa instance |
| Hàng đợi | BullMQ trên Redis; **transactional outbox** trong Postgres → publisher chuyển vào BullMQ | không mất event khi queue lỗi |
| Storage | S3-compatible; local **MinIO pin**; bucket private + public-derivative (bài PUBLISHED) | draft không lộ |
| Ảnh | `sharp` decode + re-encode, giới hạn pixel; đuôi/MIME do server quyết | |
| Rich text | Tiptap (client) → HTML; **sanitize-html** allowlist phía server; lưu `contentHtml` + `contentText` (cho tìm kiếm) | |
| Tìm kiếm | `pg_trgm` + cột chuẩn hoá (bỏ dấu, `đ→d`) tính ở app; GIN trigram | không giả định stemming VN |
| i18n | VI không prefix, EN `/en/…`; `PostTranslation` + fallback rõ | cache tách theo URL |
| Cache | API cache Redis cho đọc công khai + vô hiệu hoá khi publish/unpublish/sửa; SSR HTML **không chứa dữ liệu cá nhân** (phần cá nhân hydrate client) ⇒ có thể cache ở CDN | không dùng cache file cục bộ của Next giữa nhiều instance |
| Test | Vitest (unit + integration NestJS/Supertest trên Postgres+Redis thật), Playwright E2E + axe, k6 | |
| Font | `@fontsource-variable/be-vietnam-pro`, `@fontsource-variable/newsreader` (subset `vietnamese`) self-host | ảnh QA cũ lỗi dấu do thiếu glyph |

## Dữ liệu hành chính (34/63)

- Khóa tỉnh: `AdminSystem` (`CURRENT_34` | `LEGACY_63`) + `code`. Bảng `Province(id, system, code, nameVi, nameEn, slug, kind)`, `ProvinceMapping(legacyId → currentId)`.
- Mã chính thức của 34/63 đơn vị **không có trong repo nguồn**. Cách làm: lưu `code` = mã **tạm "legacy-theme" `p11…`** *kèm* `officialCode` nullable; điền `officialCode` bằng seed nhập từ Quyết định 19/2025/QĐ-TTg (bảng danh mục & mã đã liệt kê trong `docs/province-data-sources.md`). Khi chưa xác minh, `officialCode = NULL` và báo cáo `docs/MIGRATION.md`. **Không** mặc định `p11` là mã chính thức.
- Hình học: copy nguyên `vietnam-provinces.json` (34 + 63 + 17 đảo + toạ độ `position63`) → `packages/database/data/geometry/` (versioned, checksum), phục vụ qua `GET /api/v1/map/geometry?v=<hash>` (Cache-Control immutable). Validate Polygon/MultiPolygon + mapping 63→34 khi seed và trong unit test.
- Thống kê: query `ScholarshipMember` JOIN `Province`/`ProvinceMapping`; một nguồn duy nhất cho homepage/map/tỉnh/admin.

## Mốc

| Mốc | Nội dung | Tiêu chí xong |
|---|---|---|
| **M1** | Audit nguồn, parity, quyền, kế hoạch, kiến trúc/ERD, baseline UI | 4 tài liệu + `ARCHITECTURE.md`, `DATABASE.md` (ERD) có nội dung kiểm chứng được |
| **M2** | Monorepo pnpm, Docker Compose (Postgres/Redis/MinIO/Mailpit), Prisma schema + migration đầu, seed, health/readiness, CI skeleton | `docker compose up` + `pnpm db:migrate` + `curl /api/v1/health/ready` OK |
| **M3** | Auth/session/CSRF/rate-limit/authz, đăng ký/đăng nhập/reset/verify, MFA admin, shell account/admin/CTV | integration auth+permissions xanh; đăng nhập UI thật |
| **M4** | Content/categories/media/public pages + **migration WP đợt đầu** (restore dump → Postgres, report) | trang công khai đọc dữ liệu thật; `pnpm test:migration` |
| **M5** | Submission/review/revision/idempotency/concurrency + E2E 3 role | E2E member→CTV→admin→public |
| **M6** | Feedback/contact/comment/like, outbox+worker+Mailpit, admin tools | integration + E2E |
| **M7** | Bản đồ/tỉnh/học viên/danh bạ/import, i18n, SEO, redirect | parity hoàn thiện |
| **M8** | Polish UI/mobile/a11y, hardening, production build/smoke, load k6, backup/restore, tài liệu triển khai | `TEST_REPORT.md` với số liệu thật |

## Quy tắc làm việc

1. Mọi hành vi mới có test cùng commit; không `skip` test bắt buộc.
2. Không hardcode đường dẫn máy; mọi đường dẫn nguồn qua env (`LEGACY_SOURCE_DIR`, `LEGACY_SQL_DUMP`, …) — nằm **ngoài** repo đích.
3. SQL/xlsx/ảnh nguồn không đưa vào `public/`, bundle, artifact CI. Seed dùng JSON đã khử thông tin cá nhân (chỉ tên + tỉnh, như bản cũ đã public).
4. Dev seed (tài khoản/bài mẫu) chỉ chạy khi `NODE_ENV!=production` và **ghi rõ là dữ liệu demo**; mật khẩu sinh ngẫu nhiên và in ra một lần.
5. Khi blocker (thiếu quyền/mạng/tool) → ghi **BLOCKED/NOT RUN** ở `PROGRESS.md`/`TEST_REPORT.md`, làm tiếp phần độc lập.
