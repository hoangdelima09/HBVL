# Học Bổng Vươn Lên / Rise Up — Quỹ Khuyến Học Đông Du

Website của Quỹ Khuyến Học Đông Du, **chuyển từ WordPress sang TypeScript**: Next.js (App Router) + NestJS (REST/OpenAPI) + PostgreSQL/Prisma + Redis + BullMQ + S3-compatible. Có trang công khai (VI mặc định, `/en`), khu thành viên, và **hai console riêng**: `/admin` (Quản trị viên, bắt buộc MFA) và `/cong-tac-vien` (Cộng tác viên — xử lý mọi việc kiểm duyệt trừ nội dung của admin). Ngôn ngữ: Tiếng Việt, English (`/en`), 日本語 (`/ja`).

> Trạng thái trung thực: toàn bộ tính năng trong `docs/FEATURE_PARITY.md` đã làm và có test chạy thật tại local (xem `docs/TEST_REPORT.md`). **Chưa triển khai production** (cần hạ tầng/tên miền/secret thật) và còn các hạng mục NOT RUN được liệt kê ở `TEST_REPORT.md §4`. Không có tuyên bố "an toàn tuyệt đối" — xem `docs/SECURITY.md`.

## Chạy nhanh (phát triển)

Yêu cầu: Docker, [mise](https://mise.jdx.dev) (hoặc Node **24.21.0** + pnpm **12.10.1** tự cài), `pg_dump/pg_restore` nếu dùng `pnpm ops`.

```bash
eval "$(mise env)"                 # Node 24.21.0 + pnpm 12.10.1 (máy có thể mặc định Node khác)
pnpm install
pnpm setup:env                     # sinh .env với bí mật ngẫu nhiên (git-ignored)
pnpm infra:up                      # Postgres 17, Redis 8, SeaweedFS (S3), Mailpit
pnpm db:migrate && pnpm db:seed    # schema + dữ liệu tham chiếu (17 chuyên mục, tỉnh/thành, ánh xạ 63→34)
pnpm storage:init                  # tạo bucket riêng tư
pnpm seed:dev                      # TUỲ CHỌN, chỉ dev: dữ liệu DEMO + 4 tài khoản demo; mật khẩu ngẫu nhiên in MỘT lần
pnpm build
pnpm --filter @hbvl/api dev        # API  http://localhost:3101  (OpenAPI: http://localhost:3101/api/v1/docs nếu ENABLE_OPENAPI=true)
pnpm --filter @hbvl/api dev:worker # worker gửi e-mail (outbox → BullMQ → SMTP)
pnpm --filter @hbvl/web dev        # Web  http://localhost:3100
```

| URL (dev) | Nội dung |
|---|---|
| http://localhost:3100 | trang công khai (VI); `/en` tiếng Anh |
| `/dang-nhap-thanh-vien`, `/dang-nhap-cong-tac-vien`, `/dang-nhap-quan-tri` | 3 cổng đăng nhập (sai cổng ⇒ lỗi chung) |
| `/tai-khoan`, `/gui-bai`, `/bai-cua-toi`, `/gui-y-kien` | khu thành viên |
| `/cong-tac-vien`, `/admin` | console CTV / Admin (Admin cần MFA) |
| http://localhost:58025 | Mailpit (xem e-mail dev) |

### Email thật (SMTP) và mã 6 số
Mặc định dev gửi vào Mailpit (http://localhost:58025). Muốn gửi thật (ví dụ Gmail) sửa `SMTP_HOST/PORT/SECURE/USER/PASSWORD` và `MAIL_FROM` trong `.env`, rồi khởi động lại API + worker; `MAIL_FROM` phải trùng tài khoản đăng nhập. Đăng ký, quên mật khẩu và lời mời của admin gửi **mã 6 số** (kèm liên kết) qua email. Test tự động luôn dùng Mailpit.

### Trợ lý AI (tuỳ chọn)
Widget "Hỏi trợ lý" ở góc phải mọi trang công khai. Đặt `GEMINI_API_KEY` trong `.env` (khoá chỉ ở server) rồi khởi động lại API. Để trống khoá ⇒ trợ lý vẫn chạy ở chế độ dự phòng (liệt kê bài liên quan, không sinh văn bản). Chi tiết bảo mật: `docs/SECURITY.md`.

### Tài khoản — cách an toàn
- **Production**: *không có* tài khoản mặc định. Admin đầu tiên: `BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_USERNAME=admin pnpm bootstrap:admin` (mật khẩu ngẫu nhiên in một lần; từ chối nếu đã có admin). Sau đó bật MFA ở `/tai-khoan`.
- **Dev**: `pnpm seed:dev` tạo dữ liệu **DEMO** và in mật khẩu ngẫu nhiên một lần; lệnh **từ chối chạy** khi `NODE_ENV/APP_ENV` là `production`/`staging`.
- **Tài khoản từ WordPress**: nhập với trạng thái `PENDING_RESET` (không có mật khẩu); người dùng kích hoạt qua "Quên mật khẩu".

## Lệnh

| Lệnh | Việc |
|---|---|
| `pnpm lint` · `pnpm typecheck` · `pnpm format:check` | chất lượng mã (ESLint `--max-warnings 0`, tsc, prettier) |
| `pnpm build` | build production (contracts → database → api → web standalone) |
| `pnpm test:unit` | unit (contracts, web, api) |
| `pnpm test:integration` | Vitest + Supertest trên Postgres/Redis/S3/Mailpit thật |
| `pnpm test:migration` | migration WordPress với fixture tổng hợp (cần Docker) |
| `pnpm test:e2e` · `pnpm test:a11y` | Playwright trên build production (+ axe WCAG 2.2 AA, Firefox smoke) |
| `pnpm test:smoke` | build production + HTTP probe + bootstrap an toàn |
| `pnpm test:load` | k6 (Docker) — mặc định 100 VU / 5 phút (`VUS`, `DURATION`) |
| `pnpm import:members <tệp.xlsx\|.csv\|.json> [--commit] [--replace]` | nhập danh sách học viên lên bản đồ (mặc định chỉ xem trước) |
| `pnpm migrate:legacy inventory\|dry-run\|apply\|resume\|report` | chuyển dữ liệu WordPress (xem `docs/MIGRATION.md`) |
| `pnpm ops backup\|restore\|verify\|drill` | sao lưu/khôi phục Postgres + S3 có kiểm tra |
| `pnpm openapi:export` | ghi `docs/openapi.json` (cần `pnpm build` trước) |
| `pnpm db:create <tên>` | tạo DB trống đã migrate+seed (diễn tập) · `pnpm docs:erd` sinh ERD |
| `docker build --target api\|worker\|web\|tools .` | image đa tầng, non-root |

## Cấu trúc

```
apps/api        NestJS: REST /api/v1, worker (outbox → BullMQ), CLI (migrate, bootstrap, ops…)
apps/web        Next.js 16: site công khai + khu thành viên + console admin/CTV
packages/contracts   Zod schema, giới hạn, bỏ dấu tiếng Việt (dùng chung)
packages/database    Prisma schema + migration SQL + seed tham chiếu
tests           integration · migration · e2e (Playwright) · smoke · load (k6)
infra           init Postgres · compose.prod.yaml · Caddyfile
docs            tài liệu (bảng dưới)
```

## Tài liệu

| File | Nội dung |
|---|---|
| `docs/HUONG_DAN_01_CAI_DAT_VA_CHAY_LOCAL.md` | **Hướng dẫn 1/2** (tiếng Việt): cài đặt từ đầu và chạy local |
| `docs/HUONG_DAN_02_CAU_HINH_VA_SU_DUNG.md` | **Hướng dẫn 2/2**: email Gmail, mã 6 số, chatbot, nhập danh sách bản đồ, test |
| `docs/SOURCE_AUDIT.md` | audit hệ thống WordPress nguồn (code, SQL, dữ liệu) |
| `docs/FEATURE_PARITY.md` | đối chiếu 46 tính năng cũ → mới, kèm test |
| `docs/PERMISSIONS.md` | ma trận quyền Admin/CTV/Thành viên/Khách |
| `docs/ARCHITECTURE.md` | kiến trúc, luồng, quyết định, giới hạn |
| `docs/DATABASE.md` | mô hình dữ liệu, ràng buộc, vai trò DB, **ERD tự sinh** |
| `docs/MIGRATION.md` | chuyển dữ liệu WordPress: quy trình, ánh xạ, kết quả chạy thật, cutover |
| `docs/SECURITY.md` | mô hình đe doạ, biện pháp + bằng chứng, rủi ro còn lại |
| `docs/TEST_REPORT.md` | số liệu test/đo thật, NOT RUN, lỗi đã tìm ra |
| `docs/DEPLOYMENT.md` | triển khai (compose, env, bootstrap admin, rollback) |
| `docs/OPERATIONS.md` | vận hành: sao lưu/khôi phục, hàng đợi, xoay khoá, sự cố |
| `docs/PROGRESS.md` · `docs/IMPLEMENTATION_PLAN.md` | tiến độ và kế hoạch (để tiếp tục ở phiên mới) |
| `docs/openapi.json` | OpenAPI 3 sinh từ API (`pnpm openapi:export`) |
| `docs/screenshots/` | ảnh chụp 9 trang × 390/768/1024/1440 |

## Điểm cần lưu ý
- **Nguồn WordPress** (`HBVL/RiseUp`) không bị sửa; dump/xlsx **không** nằm trong repo, `public/`, bundle, image hay artifact CI (đường dẫn qua biến môi trường `LEGACY_*`).
- **Không** bỏ Hoàng Sa/Trường Sa vào danh sách tỉnh; mã `p11…` của theme **không** phải mã hành chính; học viên và tài khoản là hai thực thể tách biệt (không ghép theo tên).
- Danh bạ tỉnh trong theme là **dữ liệu mẫu** → nhập `UNVERIFIED_SAMPLE`, ẩn công khai tới khi admin xác minh. Ảnh tỉnh có cờ `placeholder`.
- Việc cần thông tin bên ngoài để đi production: tên miền/DNS, host, S3/SMTP thật (SPF/DKIM), dump WordPress production mới, chính sách lưu giữ/sao lưu — xem `docs/DEPLOYMENT.md §9`.

Giấy phép: chưa chọn (mã nguồn nội bộ của Quỹ). Danh sách phụ thuộc và phiên bản ghim: `pnpm-lock.yaml`; `pnpm audit --prod` sạch ngày 2026-10-10.
