# OPERATIONS — vận hành hằng ngày

## 1. Thành phần và kiểm tra sống

| Thành phần | Kiểm tra | Ghi chú |
|---|---|---|
| api | `GET /api/v1/health/live` (tiến trình), `/ready` (DB + Redis; 503 nếu một trong hai down) | healthcheck Docker dùng `/live` để DB lỗi **không** làm khởi động lại api đang khoẻ |
| worker | log `ctx` OutboxRelay / EmailProcessor; hàng đợi BullMQ trong Redis | không có cổng HTTP |
| web | `GET /` < 500 | healthcheck Docker |
| postgres/redis | `pg_isready` / `redis-cli ping` | trong compose |

Log là JSON (pino) ra stdout: có `requestId`, `method`, `path`, `status`, `ms`; **đã che** cookie/authorization/CSRF/mật khẩu; không log body. Thu thập bằng driver log của Docker/Loki/ELK tuỳ hạ tầng (chưa cấu hình trong repo).

## 2. Tác vụ nền (worker, mỗi 60 s, khoá advisory 727001 nên nhiều bản sao không chạy trùng)
- đưa outbox kẹt `PROCESSING` > 15 phút về `PENDING`;
- xoá ảnh `STAGED` quá 24 giờ chưa gắn vào bài (và object S3);
- xoá phiên hết hạn/thu hồi > 7 ngày, token hết hạn > 7 ngày, bản ghi idempotency hết hạn;
- đăng bài `SCHEDULED` đến giờ và vô hiệu cache công khai.

## 3. Sao lưu và khôi phục

Hai kho có trạng thái: **PostgreSQL** và **bucket S3**. Redis (phiên/cache/hàng đợi) **không** sao lưu — mất Redis chỉ đăng xuất người dùng; thư vẫn an toàn vì outbox nằm ở Postgres.

```bash
pnpm ops backup  --out /ổ/sao-luu              # hbvl-<thời-điểm>/{db.dump, objects/, manifest.json}
pnpm ops restore --from /ổ/sao-luu/hbvl-… --db hbvl_restore --bucket hbvl-restore
pnpm ops verify  --from /ổ/sao-luu/hbvl-… --db hbvl_restore --bucket hbvl-restore
pnpm ops drill                                  # sao lưu → khôi phục vào <db>_drill → kiểm → xoá bản thử
```
- Cần `pg_dump/pg_restore` (≥ phiên bản server) trên máy chạy lệnh, `POSTGRES_ADMIN_PASSWORD` để tạo DB đích (restore **chỉ vào DB mới, rỗng**).
- `verify` so: số dòng từng bảng, SHA-256 từng object, và sự tồn tại của trigger bất biến (`audit_log_*`, `review_events_no_update`). `restore` từ chối `db.dump` sai checksum.
- Đo thực tế (738 dòng/40 bảng + 544 object, 26,6 MB): backup 1,6 s, restore 3,1 s, verify 1,6 s — **chỉ là quy mô nhỏ**; hãy chạy `drill` định kỳ trên dữ liệu thật để biết RTO thật.
- Bản sao lưu **chứa dữ liệu cá nhân** (e-mail, hộp thư liên hệ): mã hoá (age/gpg/KMS), giới hạn quyền, đặt thời hạn giữ. Công cụ không in nội dung.
- Khuyến nghị lịch: hằng ngày (giữ 14 ngày) + hằng tuần (giữ 8 tuần) + ngay trước mỗi lần triển khai/migration lớn; kiểm `drill` mỗi tháng. *Lịch này là khuyến nghị — repo chưa kèm cron.*

### Khôi phục sự cố (runbook)
1. Dừng `api`/`worker`/`web` (tránh ghi trong lúc khôi phục).
2. `pnpm ops restore --from … --db hbvl_new --bucket hbvl-new` → `pnpm ops verify …`.
3. Trỏ `DATABASE_URL`/`MIGRATION_DATABASE_URL`/`S3_BUCKET_PRIVATE` sang đích mới (hoặc đổi tên DB), chạy `pnpm db:migrate` (phòng khi bản sao cũ hơn code).
4. Khởi động lại; `GET /ready`; xoá cache Redis nếu cần (`FLUSHDB` trên DB số của app) — phiên người dùng sẽ mất.
5. Ghi sự cố, rà `outbox_events` (thư chưa gửi vẫn ở trạng thái `PENDING/FAILED`).

## 4. Hộp thư và hàng đợi
- Trạng thái thư: `QUEUED → SENT_TO_PROVIDER` hoặc `FAILED` (sau `EMAIL_ATTEMPTS` lần, backoff `EMAIL_BACKOFF_MS`). **Không có `DELIVERED`** trừ khi nhà cung cấp gửi sự kiện (chưa tích hợp).
- Thư tồn đọng: `SELECT status, count(*) FROM outbox_events GROUP BY 1;` — `FAILED/DEAD` cần xem log worker (SMTP lỗi? sai `MAIL_FROM`?). Sau khi sửa, đưa `FAILED` về `PENDING` thủ công.
- Liên hệ lưu ngay cả khi thư lỗi; admin xem trong console `/admin/lien-he` (`mailState` hiển thị rõ).

## 5. Tài khoản
- Quản trị viên đầu tiên: `pnpm bootstrap:admin` (xem `DEPLOYMENT.md §4`). Đổi/khoá/hạ quyền trong console `/admin/nguoi-dung`; **không thể** hạ/khoá/xoá admin hoạt động cuối cùng.
- Mất thiết bị MFA: dùng **mã khôi phục** (dùng một lần). Nếu mất hết mã: **chưa có giao diện để admin khác đặt lại MFA** — cần can thiệp DB có kiểm soát bằng vai trò migrator (`UPDATE users SET "mfaEnabled"=false, "mfaSecretEnc"=NULL WHERE username='…'`; xoá các dòng `mfa_recovery_codes` của người đó và thu hồi phiên), ghi lại vào sổ vận hành; người đó đăng nhập rồi bật MFA lại. (`pnpm totp` chỉ sinh mã TOTP từ một secret để thử nghiệm.)
- Xoá tài khoản = ẩn danh hoá (giữ nội dung đã xuất bản không tên). Yêu cầu xoá dữ liệu cá nhân của người dùng: ẩn danh hoá + xoá hộp liên hệ/góp ý của họ nếu chính sách yêu cầu (chưa có giao diện riêng).

## 6. Xoay khoá bí mật
| Khoá | Hậu quả khi đổi | Cách làm |
|---|---|---|
| `CSRF_SECRET` | token CSRF cũ vô hiệu (client tự lấy lại) | đổi + khởi động lại |
| `TOKEN_HASH_PEPPER` | **mọi phiên và token e-mail đang có vô hiệu**; `ipHash` cũ không khớp | đổi lúc ít người dùng; thông báo đăng nhập lại |
| `MFA_ENCRYPTION_KEY` | secret MFA đã mã hoá **không giải mã được** | chưa có công cụ xoay tự động: cần script giải mã bằng khoá cũ → mã hoá bằng khoá mới trước khi đổi (**NOT IMPLEMENTED**) |
| Mật khẩu DB/Redis/S3/SMTP | kết nối mới dùng khoá mới | đổi ở dịch vụ → cập nhật secret → khởi động lại rolling |

## 7. Migration dữ liệu WordPress và lần chạy lại
`pnpm migrate:legacy …` an toàn khi chạy lại (idempotent). Báo cáo `reports/migration/*.md|json` chỉ có ID/mã/số lượng nhưng vẫn nên lưu nội bộ. Xem `MIGRATION.md`.

## 8. Khắc phục sự cố thường gặp
| Triệu chứng | Nguyên nhân thường gặp | Xử lý |
|---|---|---|
| API không khởi động, in `Invalid environment configuration` | thiếu/sai biến (đặc biệt `COOKIE_SECURE=true`, URL, bí mật) | sửa env theo thông báo |
| Mọi form ghi trả 403 `CSRF` | `PUBLIC_ORIGIN` không khớp URL người dùng thấy; proxy bỏ/ghi đè `Origin`; hoặc dùng `EXTRA_ALLOWED_ORIGINS` | đặt `PUBLIC_ORIGIN` đúng; kiểm proxy |
| Mọi người bị 429 | `TRUST_PROXY` sai ⇒ mọi request có cùng IP (IP của proxy) | đặt đúng số hop |
| Trang 500 khi nhiều người truy cập cùng lúc | giới hạn `GLOBAL_RATE_LIMIT_PER_MIN` thấp so với lưu lượng thật qua một IP (NAT/CDN) | nâng giá trị; đảm bảo CDN chuyển IP thật |
| Ảnh 404 sau khi xuất bản | bài chưa thực sự `PUBLISHED`, hoặc object mất khỏi bucket | kiểm `media_assets.visibility/status` và object; khôi phục bucket |
| Thư không đến | SMTP/`MAIL_FROM`/SPF-DKIM; worker không chạy | xem `outbox_events`, log worker |
| Số liệu bản đồ lệch | học viên `ARCHIVED`/`isPublic=false`; tỉnh gốc chưa ánh xạ | console `/admin/hoc-vien`; hàm tổng hợp một nguồn duy nhất |

## 9. Giới hạn vận hành đã biết
Chưa có giám sát/cảnh báo, chưa có cron sao lưu đi kèm, chưa có công cụ xoay `MFA_ENCRYPTION_KEY`, chưa kiểm thử nhiều bản sao. Xem `SECURITY.md §3` và `TEST_REPORT.md §4`.
