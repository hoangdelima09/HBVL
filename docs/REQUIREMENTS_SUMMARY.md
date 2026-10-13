# REQUIREMENTS_SUMMARY — yêu cầu gốc rút gọn (để tiếp tục giữa các phiên)

Nguồn: yêu cầu ban đầu của người dùng (tiếng Việt, 2026-10-10): hoàn tất việc chuyển website **Học Bổng Vươn Lên / Rise Up (Quỹ Khuyến Học Đông Du)** từ WordPress sang ứng dụng TypeScript. Đây là bản **tóm tắt trung thành** các ràng buộc, không phải bản sao nguyên văn.

## Ràng buộc cứng
- Không sửa/reset/clean dự án nguồn `HBVL/RiseUp` (cây git đang bẩn). Mọi mã/tài liệu/đầu ra mới chỉ nằm trong `HBVLFINAL`; tệp tạm ở thư mục tạm; **không hardcode đường dẫn máy**.
- Không mua dịch vụ, không đổi DNS, không gửi e-mail thật, không ghi vào production.
- Không tuyên bố "production-ready / an toàn 100% / mọi test đã qua" khi không có bằng chứng; mục không chạy được ghi **BLOCKED/NOT RUN**.
- Không đặt SQL dump, workbook, thông tin xác thực, dữ liệu cá nhân vào `public/`, bundle frontend, artifact CI công khai hay log.
- **Không** chép hash mật khẩu WordPress vào cột Argon2id (tài khoản migrate: `PENDING_RESET` + kích hoạt).
- **Không** đưa lại luồng upload Google Drive.
- Hoàng Sa/Trường Sa **không** là tỉnh; mã `p11…` của theme **không** phải mã hành chính; **không** gộp hai người theo tên; `User` và `ScholarshipMember` tách biệt.
- Dev seed không được mang mật khẩu mặc định lên production.
- Cập nhật `docs/PROGRESS.md` sau mỗi mốc; giữ `READING_NOTES.md` có sẵn.

## Stack bắt buộc
Node LTS ghim phiên bản · monorepo pnpm · Next.js App Router + React + Tailwind · NestJS REST + OpenAPI · PostgreSQL + Prisma · Redis (phiên/cache/rate-limit/hàng đợi) · BullMQ worker + transactional outbox · S3-compatible · SMTP/Mailpit · Vitest/Supertest/Playwright/axe/k6 · Docker Compose + Dockerfile đa tầng + CI.

## Phạm vi
Trang công khai ngang bằng bản cũ (5 trụ cột/12 mục con, trang chủ, chuyên mục, bài, thông báo, sự kiện/chương trình, tìm kiếm bỏ dấu tiếng Việt, liên hệ, trang tỉnh, bản đồ 34/63 đơn vị + 17 nhãn đảo, VI mặc định không prefix + `/en`, SEO/sitemap/robots/redirect) · khu thành viên · **console riêng** `/admin` và `/cong-tac-vien` · vai trò ADMIN/COLLABORATOR/MEMBER thực thi ở server · workflow DRAFT→PENDING_REVIEW→CHANGES_REQUESTED/REJECTED/PUBLISHED có revision, ETag/409, idempotency bền · ảnh riêng tư tới khi xuất bản · hộp góp ý (CTV+admin) và liên hệ (admin) qua outbox e-mail · bình luận, like theo tài khoản (giữ tổng cũ) · xác minh e-mail · MFA TOTP cho admin · audit log · cài đặt · import học viên · **migration WordPress thật** (dump → MariaDB tạm, dry-run/apply/resume/idempotent, ánh xạ vai trò, media/orphan, redirect, báo cáo vấn đề) · hardening bảo mật · load test k6 100 VU/5 phút · backup/restore · tài liệu triển khai/vận hành.

## Tài liệu bắt buộc
SOURCE_AUDIT, ARCHITECTURE, DATABASE, PERMISSIONS, FEATURE_PARITY, MIGRATION, SECURITY, TEST_REPORT, DEPLOYMENT, OPERATIONS, PROGRESS, IMPLEMENTATION_PLAN + README (lệnh: `pnpm lint/typecheck/test:unit/test:integration/test:e2e/test:a11y/build/test:smoke/test:migration/test:load`).

## Báo cáo cuối phải có
Ngắn gọn: đường dẫn, cách chạy, URL, cách tạo tài khoản an toàn, kết quả test pass/fail/not-run, số liệu migration/load thật, và những gì cần thông tin triển khai bên ngoài.
