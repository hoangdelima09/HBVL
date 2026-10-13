# TEST_REPORT

Chỉ ghi những gì **đã chạy thật** trên máy phát triển (Linux, 16 vCPU, 23 GiB RAM, Docker local) ngày **2026-10-10**, Node 24.21.0, pnpm 12.10.1. Mọi thứ chưa chạy được đánh dấu **NOT RUN / BLOCKED** ở mục 4. Không có tuyên bố "production-ready".

## 1. Tóm tắt

| Cổng | Lệnh | Kết quả |
|---|---|---|
| Typecheck (5 package) | `pnpm typecheck` | **PASS** |
| Lint (`--max-warnings 0`) | `pnpm lint` | **PASS** |
| Định dạng | `pnpm format:check` | **PASS** |
| Build production (contracts, database, api, web) | `pnpm build` | **PASS** |
| Audit phụ thuộc production | `pnpm audit --prod` | **PASS** — "No known vulnerabilities found" |
| Unit | `pnpm test:unit` | **96 pass** (contracts 16 · web 6 · api 74) |
| Integration (Postgres/Redis/S3/Mailpit thật) | `pnpm test:integration` | **77 pass** (8 file) |
| Migration | `pnpm test:migration` | **22 pass** (fixture tổng hợp + MariaDB tạm) |
| E2E + a11y + Firefox | `pnpm test:e2e` | **79 pass** — chromium 55 · a11y (axe, WCAG 2.2 AA) 22 · firefox smoke 2 |
| Smoke production build | `pnpm test:smoke` | **12/12 pass** |
| Tải k6 | `pnpm test:load` | **PASS ngưỡng** (xem mục 3) |
| Docker image (api, worker, web, tools) | `docker build --target …` | **build OK**; api chạy healthy với non-root uid 1000 |
| Backup/restore drill | `pnpm ops drill` | **verified** (mục 3) |
| Migration WordPress thật (dump gốc) | `pnpm migrate:legacy dry-run/apply/apply` | **0 ERROR**, lần 2 không tạo gì (xem `MIGRATION.md`) |

Độ ổn định E2E: sau các sửa lỗi ở mục 5, **3 lần chạy liên tiếp đều 79/79** (cùng ngày). Trước đó đã quan sát flake thật (mục 5), nên con số này chỉ chứng minh trong 3 lần chạy, không phải bảo đảm tuyệt đối.

## 2. Phạm vi từng bộ test

**Integration (77)** — `auth` 13 (đăng ký, mass-assignment, xác minh e-mail một lần, CSRF/Origin, cổng đăng nhập, MFA, reset) · `workflow` 18 (máy trạng thái, 404 vs 403, revision, ETag/409, idempotency song song, khoá bài chờ duyệt) · `engagement` 7 (like theo tài khoản, bình luận, spam) · `inboxes` 8 (góp ý chỉ CTV+admin, liên hệ chỉ admin, outbox) · `worker` 3 (gửi qua BullMQ → Mailpit, không gửi trùng) · `content` 8 (sanitize, upload giả mạo/pixel bomb, ảnh riêng tư tới khi xuất bản, tìm kiếm bỏ dấu) · `admin-map` 15 (người dùng/vai trò/admin cuối, bản đồ 34/63, import học viên, danh bạ) · `ratelimit` 5 (**bật throttle thật**: 429 + `Retry-After` theo IP, khoá tài khoản sau 10 lần sai, đăng ký ≤3/phút, quên mật khẩu không lộ tài khoản, trạng thái nằm trong Redis có TTL).

**Migration (22)** — đọc chỉ-đọc + từ chối host không loopback; dry-run không ghi gì; run lỗi giữa chừng giữ checkpoint và `resume` dùng lại cùng run; ánh xạ vai trò không nâng quyền; trạng thái bài/trang/bình luận; submission feedback → review events; sanitize + ảnh + liên kết; trang trùng route; học viên/danh bạ; chuyển hướng; allowlist cài đặt; **quét mọi bảng không có hash/secret/IP/e-mail**; đối soát; **idempotent**; cập nhật nguồn chỉ áp dụng lên nội dung chưa bị sửa.

**E2E (79)** — `public` 14 (trang chủ, chuyên mục, bài, tìm kiếm bỏ dấu, tỉnh, EN, SEO/sitemap/robots, 404/redirect) · `auth` 8 (đăng ký → xác minh → tài khoản; 3 cổng; returnTo an toàn; reset; MFA) · `workflow` 10 (member → CTV → admin → công khai, yêu cầu sửa, từ chối, khoá khi chờ duyệt, nhấn đúp) · `inbox` 5 · `engagement` 4 · `map` 7 (34/63, bàn phím, 17 nhãn đảo, không có Hoàng Sa/Trường Sa như tỉnh) · `zz-admin` 7 (admin đổi nội dung → UI công khai đổi theo, redirect, audit) · `a11y` 22 (axe WCAG 2.2 AA: công khai ở 1440 & 390, bản đồ có chọn tỉnh, menu mobile, khu thành viên, console admin/CTV) · `cross-browser` 2 (Firefox).

**Smoke (12)** — health (DB+Redis); header bảo mật, CSP nonce không `unsafe-eval`, **HTML ẩn danh không có `Set-Cookie`**; EN; các trang chính; 404 thật; robots/sitemap; proxy API; console & API admin từ chối khách (vỏ console `noindex`); CSRF; không lộ `.env`/`package.json`/`.git`/`.sql`; **dev seed từ chối chạy ở production**; **bootstrap admin đầu tiên chỉ qua CLI (lần 2 bị từ chối) và `/admin` cần MFA**.

## 3. Số liệu đo

### Tải — k6, 100 VU, 5 phút (`tests/load/hbvl.js`)
Môi trường: **một tiến trình** mỗi dịch vụ (API, worker, Next standalone) + Postgres/Redis/SeaweedFS trong Docker, cùng một máy 16 vCPU với k6. DB: 311 bài đã xuất bản (300 sinh tự động + demo), 5 thành viên. Production build, `NODE_ENV=production`. Lưu lượng: 95 VU khách (trang chủ 30 %, bài 20 %, chuyên mục 15 %, tìm kiếm 10 %, bản đồ 8 %, EN 5 %, API công khai 12 %, có thời gian suy nghĩ 0,5–2 s) + 5 VU thành viên (đăng nhập một lần; `/auth/me`, `/me/posts`, đọc bài, like + unlike).

| Chỉ số | Kết quả |
|---|---|
| Số request | **25 911** trong 5 phút (≈ **85,8 req/s**, 22 993 vòng) |
| Lỗi HTTP / checks | **0 %** / **100 %** |
| Độ trễ tổng | p50 24 ms · p90 53 ms · **p95 65 ms** · p99 98 ms · max 941 ms |
| Trang HTML | **p95 70 ms** (ngưỡng < 1500 ms) |
| API | **p95 20,5 ms** (ngưỡng < 600 ms) |
| RSS đỉnh | api 470 MiB · worker 241 MiB · web (Next) 786 MiB |
| Ngưỡng k6 | tất cả đạt |

Lưu ý trung thực: (1) đây là mô hình **vòng kín có thời gian suy nghĩ**, không phải đo thông lượng tối đa; (2) k6 và dịch vụ chung một máy; (3) mọi VU chung một IP nên giới hạn theo IP được **nâng cho lần chạy này** (`GLOBAL_RATE_LIMIT_PER_MIN=1000000`, `RATE_LIMIT_MULTIPLIER=1000`) — giới hạn production được kiểm bằng `ratelimit.spec.ts`; (4) không đo nhiều bản sao/mạng thật/CDN.

### Backup / restore drill (`pnpm ops drill`, trên DB đã migrate dữ liệu WordPress)
738 dòng / 40 bảng + 544 object S3 (26,6 MB): **backup 1,6 s · restore 3,1 s · verify 1,6 s**; số dòng mọi bảng khớp, checksum SHA-256 mọi object khớp, trigger bất biến (`audit_log_*`, `review_events_no_update`) còn nguyên sau restore. Bản sao drill được xoá sau khi kiểm.

### Lighthouse 13.5 (mobile, mô phỏng throttle; build production, DB demo)
| Trang | Performance | Accessibility | Best-practices | SEO | FCP | LCP | TBT | CLS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` | 87 | 100 | 100 | 100 | 2,7 s | 3,4 s | 50 ms | 0,02 |
| `/bai-viet/…` | 90 | 100 | 100 | 100 | 2,1 s | 3,4 s | 90 ms | 0,008 |
| bản đồ | 83 | 100 | 96 | 100 | 2,3 s | 4,0 s | 160 ms | 0,001 |

LCP 3,4–4,0 s dưới throttle mobile mô phỏng là điểm cần cải thiện (font/ảnh hero; chưa có CDN). Một cảnh báo `label-content-name-mismatch` ở liên kết logo đã được sửa sau lần đo này (**chưa đo lại**).

### Ảnh chụp
36 ảnh toàn trang (9 trang × 390/768/1024/1440) ở `docs/screenshots/*.webp`, tạo bằng `tests/e2e/shots.mjs`; không có lỗi console khi chụp.

## 4. NOT RUN / BLOCKED (không giả vờ đã kiểm)

| Hạng mục | Lý do |
|---|---|
| **Workflow CI trên GitHub** (`.github/workflows/ci.yml`) | Chưa chạy trên GitHub Actions (không có remote/runner); các bước tương ứng đã chạy cục bộ. Phiên bản action chỉ ghim theo major, chưa ghim SHA. |
| Gửi e-mail thật (SPF/DKIM, hộp thư thật) | Không có SMTP thật; chỉ kiểm tới Mailpit. |
| S3 đám mây thật / Postgres/Redis managed | Chỉ SeaweedFS/Postgres/Redis trong Docker. |
| Triển khai production, TLS, DNS | Cần hạ tầng/tên miền/secret thật (`DEPLOYMENT.md`). `infra/compose.prod.yaml` mới được `docker compose config` kiểm cú pháp/biến bắt buộc, **chưa `up`**. |
| Nhiều bản sao API/worker, failover | Chỉ đo một tiến trình mỗi dịch vụ. |
| Safari/WebKit, thiết bị thật, trình đọc màn hình thật | Chỉ Chromium (đầy đủ) và Firefox (smoke); axe tự động không thay cho kiểm thử thủ công với trình đọc màn hình. |
| Pentest, fuzzing, quét virus tệp tải lên | Chưa thực hiện. |
| Dump WordPress **production mới** | Chỉ có snapshot cũ (site tiền thân) — số liệu migration thật nằm ở `MIGRATION.md §6`. |
| Lighthouse sau sửa logo, LCP tối ưu | Chưa đo lại. |

## 5. Lỗi tìm thấy khi chạy test và đã sửa (không che giấu)

| Phát hiện | Nguyên nhân gốc | Sửa |
|---|---|---|
| Trang đăng nhập đôi khi **hai ô nhập** tạm thời / trang trắng khi tải đồng thời | `useSearchParams` bọc `<Suspense>` ép stream + hydrate lại phía client | Đọc `returnTo`/`token` từ `searchParams` của server page (không còn Suspense) |
| Lệnh tới API thỉnh thoảng treo | keep-alive 5 s mặc định của Node API ngắn hơn proxy Next | `keepAliveTimeout=65s`, `headersTimeout=66s` |
| Form bình luận bị khoá sau khi gửi | submit `await load()` giữ trạng thái bận | tải lại danh sách không chặn form |
| Test bình luận flake | `getByText` khớp cả `<textarea>` (React phản chiếu value vào text) | khoanh vùng vào danh sách bình luận |
| Test nhấn đúp "like" flake | HTML cache có thể mang số đếm cũ trước khi trình duyệt tải trạng thái theo tài khoản | test chờ phản hồi `/engagement`; dùng bài riêng |
| `apiLogin` 403 CSRF ngẫu nhiên | cookie CSRF được trang đang mở cấp lại giữa hai request | đọc cookie hiện hành lúc gửi + thử lại 1 lần |
| Truy cập một số URL giả `/api/v1/posts/<id>/like` trả 404 trong k6 | cache Redis còn bản của lần chạy trước (UUID cũ) | runner xoá Redis namespace trước mỗi lần chạy |
| Tiến trình Next còn sót lại sau test, phục vụ bản build cũ | `kill` chỉ giết wrapper | spawn theo nhóm tiến trình và kill cả nhóm |
| `redirects.fromPath` unique chặn `/?p=6`, `/?p=7` | ràng buộc cũ | migration `…0300` unique `(fromPath, COALESCE(fromQuery,''))` |

## 6. Cách chạy lại
```bash
eval "$(mise env)"; pnpm setup:env && pnpm infra:up && pnpm install && pnpm db:migrate && pnpm db:seed && pnpm storage:init
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm test:unit
pnpm test:integration && pnpm test:migration
pnpm test:e2e && pnpm test:smoke
VUS=100 DURATION=5m pnpm test:load        # cần Docker (grafana/k6 ghim phiên bản)
pnpm ops drill                              # cần pg_dump/pg_restore trên máy
```
