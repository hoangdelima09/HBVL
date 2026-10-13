# MIGRATION — WordPress → HBVL

Công cụ: `apps/api/src/migration/*` + CLI `pnpm migrate:legacy`. Kiểm thử: `pnpm test:migration` (22 test trên fixture **tổng hợp**) và các lần chạy thật trên dump gốc (mục 6). Nguồn WordPress **chỉ được đọc** (tài khoản `SELECT`, giao dịch `READ ONLY`); repo nguồn `HBVL/RiseUp` không bị sửa.

## 1. Quy trình

```bash
# 0. Khôi phục dump vào MariaDB tạm (container riêng, chỉ bind 127.0.0.1; dump gốc không bị sửa)
LEGACY_SQL_DUMP=/đường/dẫn/sampleweb_wp_export.sql node scripts/migration/restore-legacy.mjs

# 1. Chuẩn bị DB đích (đã migrate + seed tham chiếu). Diễn tập nên dùng DB riêng:
pnpm db:create hbvl_migration            # hoặc dùng DB thật đã `pnpm db:migrate && pnpm db:seed`

# 2. Kiểm kê nguồn (không ghi gì)
pnpm migrate:legacy inventory

# 3. Chạy thử: toàn bộ chạy trong 1 transaction rồi ROLLBACK; chỉ ghi bản ghi run + báo cáo
pnpm migrate:legacy dry-run   --uploads-dir … --members-file … [--report-dir …]

# 4. Áp dụng (idempotent — chạy lại an toàn)
pnpm migrate:legacy apply     --uploads-dir … --members-file …

# 5. Nếu bị ngắt giữa chừng
pnpm migrate:legacy resume    --uploads-dir … --members-file …

# 6. Xem lại báo cáo
pnpm migrate:legacy report [--run <id>]
```

Biến môi trường (đường dẫn **ngoài** repo, không hardcode): `LEGACY_MYSQL_URL`, `LEGACY_UPLOADS_DIR`, `LEGACY_THEME_DIR` (suy ra `province-directory.json` + ảnh tỉnh), `LEGACY_MEMBERS_FILE` (`.xlsx|.csv|.json`). Đường dẫn tương đối được tính từ nơi gõ lệnh (`INIT_CWD`). Báo cáo `.md/.json` ghi vào `reports/migration/` (git-ignored) — chỉ gồm **ID, mã, số lượng**.

An toàn: CLI từ chối host MySQL không phải loopback (trừ `LEGACY_ALLOW_REMOTE=1`); lỗi hạ tầng (S3/DB) làm run `FAILED` thay vì lẳng lặng bỏ qua tệp.

## 2. Nguyên tắc

| Nguyên tắc | Cách thực hiện |
|---|---|
| Idempotent | mỗi bản ghi nguồn có dòng `legacy_id_map(source, legacyType, legacyId) → entityId` + `sourceChecksum` + `importedChecksum`; chạy lại ⇒ `unchanged` |
| Không ghi đè sửa đổi ở hệ thống mới | nguồn đổi + bài/trang **chưa bị sửa** (checksum nội dung khớp `importedChecksum`) ⇒ cập nhật; đã bị sửa ⇒ **bỏ qua + cảnh báo `EDITED_IN_NEW_SYSTEM`** |
| Resume | `resume` dùng lại cùng `migration_runs` (cùng fingerprint nguồn), ghi checkpoint theo phase; mọi phase được đánh giá lại, bản ghi đã nhập bị bỏ qua theo checksum ⇒ không tạo trùng; issue không báo hai lần |
| Dry-run thật | cùng mã nguồn chạy trong transaction bị rollback; không ghi S3 (vẫn giải mã ảnh để kiểm) |
| Không bịa dữ liệu | mất dữ liệu ghi `MigrationIssue`, không tự điền |
| PII tối thiểu | báo cáo/issue không chứa e-mail, tên, mật khẩu, nội dung thư; tên học viên **không** xuất hiện trong issue (chỉ số dòng) |

## 3. Ánh xạ

### Người dùng
| WordPress | HBVL |
|---|---|
| `administrator` | `ADMIN` |
| `riseup_collaborator` | `COLLABORATOR` |
| `riseup_member`, `subscriber` | `MEMBER` |
| vai trò khác (`editor`, `shop_manager`, …) | **`MEMBER`** + `UNKNOWN_ROLE` (không bao giờ nâng quyền) |
| không có vai trò / `wp_capabilities` hỏng / là đối tượng PHP | `MEMBER` + `NO_ROLE` (parser `unserialize` **không khởi tạo đối tượng**) |
| nhiều vai trò | vai trò cao nhất **đã biết** + `MULTIPLE_ROLES` |

Tài khoản nhập: `status=PENDING_RESET`, `passwordHash=NULL` (CHECK ở DB), `emailVerifiedAt=NULL`. **Hash mật khẩu WordPress không bao giờ được đọc.** Người dùng đặt mật khẩu bằng "Quên mật khẩu/kích hoạt" (cũng chứng minh sở hữu e-mail ⇒ đặt `emailVerifiedAt`).
Xung đột: trùng e-mail với tài khoản có sẵn ⇒ `USER_EMAIL_CONFLICT` (không gộp; `--link-existing-by-email` để liên kết tường minh); trùng tên đăng nhập ⇒ hậu tố `-wp<ID>`; tên đăng nhập không hợp lệ ⇒ chuẩn hoá hoặc `wp-user-<ID>`; không e-mail hợp lệ ⇒ `USER_NO_VALID_EMAIL` (nội dung của họ mất liên kết tác giả). **Không bao giờ gộp theo tên.**

### Bài viết / sự kiện / chương trình
| WordPress | HBVL |
|---|---|
| `post` / `event` / `program` | `Post.kind` POST / EVENT / PROGRAM (`origin=WORDPRESS`) |
| `publish` | `PUBLISHED` (`publishedAt` từ `post_date_gmt`, nếu trống thì chuyển `post_date` theo `timezone_string`) |
| `future` | `SCHEDULED` |
| `private` | `PRIVATE` |
| `trash` | `TRASHED` (`deletedAt` từ `_wp_trash_meta_time`); slug bỏ hậu tố `__trashed` |
| `pending` | `PENDING_REVIEW` (chỉ bài; sự kiện/chương trình ⇒ `DRAFT`) |
| `draft` + `_submission_review=changes` | `CHANGES_REQUESTED` + `review_events(REQUEST_CHANGES, lý do=_submission_reason)` |
| `draft` + `_submission_review=rejected` | `REJECTED` + `review_events(REJECT, …)` |
| bài có mật khẩu | `PRIVATE` + `needsReview`; **mật khẩu không được nhập** |
| `auto-draft` | bỏ (đếm) |
| trạng thái lạ | `DRAFT` + `UNKNOWN_POST_STATUS` |
| `revision` | `post_revisions(kind=WP_REVISION)` chỉ cho bài đã nhập |
| `_post_likes` | `legacyLikeCount` (tổng cũ; **không** có danh sách người thích) |
| `_thumbnail_id` | `featuredAssetId` |
| chuyên mục WP | khớp **theo slug** với 17 chuyên mục hệ thống; không khớp ⇒ xếp `tin-tuc` + `needsReview` + `CATEGORY_UNMAPPED` |
| `post_tag` | `tags` |
| nội dung tiếng Anh gốc | `originalLocale=en` + `post_translations(en)` (nhận diện bằng mật độ từ chức năng tiếng Anh, **không** bị đánh lừa bởi tên riêng tiếng Việt) |

Nội dung: bỏ comment block WP, `wpautop` cho văn bản thô, `[caption]` giữ ruột, `[gallery]`… bị loại và báo cáo, **sanitize** như nội dung do người dùng gửi (script/handler/form bị loại, báo cáo `CONTENT_TAGS_REMOVED`), liên kết về site cũ ⇒ tương đối, `?p=ID` ⇒ URL mới, ảnh trong `uploads` ⇒ `/api/v1/media/<id>/large`; ảnh không còn tệp bị **gỡ khỏi bài** + `MEDIA_REFERENCE_UNRESOLVED` + `needsReview`.

### Trang
Giữ cây cha/con và slug. Trang `page_on_front`/`page_for_posts` bị thay bằng route của hệ thống (`SYSTEM_PAGE_REPLACED`). Trang có đường dẫn gốc trùng route ứng dụng (`/lien-he`, `/tim-kiem`, …; danh sách `RESERVED_TOP_LEVEL_PATHS` dùng chung với form admin) nhập ở dạng `DRAFT` + `RESERVED_PATH` (nếu không sẽ không bao giờ truy cập được). Tiêu đề đã mất dấu `?` trong dump ⇒ `DATA_LOSS_ENCODING`.

### Bình luận / góp ý / liên hệ
- Bình luận: `1→APPROVED`, `0→PENDING`, `spam→SPAM`, `trash/post-trashed→TRASHED`; bỏ pingback/trackback; chỉ giữ **tên hiển thị** (e-mail/IP/URL/user-agent **không** nhập); bình luận trên trang/bài không nhập bị bỏ + báo cáo.
- `riseup_feedback` ⇒ `feedbacks` (`NEW`); `riseup_contact` ⇒ `contact_messages` (mã `LH-WP-<ID>`, `_contact_status`, `_contact_mail`: `accepted→SENT_TO_PROVIDER`, `failed→FAILED` — **không** suy ra `DELIVERED`). Mục đã xoá (thùng rác) bị bỏ.

### Media
Quét `uploads`: JPEG/PNG/WebP đi qua pipeline upload thường (giải mã, mã hoá lại, bỏ EXIF, 4 biến thể) ⇒ `LEGACY_IMPORT`, `ORPHAN`, **`PRIVATE`**; ảnh dùng trong bài đã xuất bản mới chuyển `PUBLIC`/`ACTIVE`. Tệp trùng byte lưu một bản (`MEDIA_DUPLICATE`); kích thước phái sinh (`-300x200`) bỏ qua; loại khác/quá lớn/hỏng ⇒ cảnh báo. Attachment không còn tệp ⇒ `MEDIA_FILE_MISSING`. Ảnh tỉnh của theme ⇒ `PROVINCE_PHOTO` **cờ `isPlaceholder`** (nguồn/bản quyền chưa xác minh).

### Học viên, danh bạ, cài đặt, chuyển hướng
- **Học viên**: chỉ đọc *họ tên + tỉnh* (cột khác của workbook — giới tính, năm học… — không bao giờ được đọc). Cùng luật và cùng mã định danh với trình nhập của admin: trùng họ tên+tỉnh trong tệp ⇒ **không nhập tự động** (`MEMBER_DUPLICATE_ROW`, admin thêm tay với "khác người"); cùng tên khác tỉnh ⇒ nhập là hai người (INFO); tỉnh không nhận ra ⇒ ERROR theo số dòng.
- **Danh bạ tỉnh** (`province-directory.json`): dữ liệu mẫu ⇒ `UNVERIFIED_SAMPLE` (ẩn công khai), khớp tỉnh theo slug/tên **không dùng mã `pNN`**, liên kết ngoài bị thay bằng `/lien-he`.
- **Cài đặt**: chỉ allowlist 13 khoá không bí mật lưu thành **một** bản ghi tham khảo `legacy.wordpress` (không áp lên site; `blogname` WP đã cũ). Mọi option khác (SMTP, salt, plugin, cron…) bị bỏ.
- **Chuyển hướng** (từ dữ liệu thật): `/?p=ID`, `/?page_id=ID`, `/<post_name>`, `/<đường dẫn trang cũ>`, `/blog`, `/category/<slug>`, `/tag/<slug>` (kèm tiền tố đường dẫn của `siteurl`, ví dụ `/sampleweb/wordpress/…`). Chỉ cho nội dung **đang công khai**; một bước; không chuỗi/vòng lặp; slug bị đổi tên không "cướp" URL của bài gốc. Không có "mọi thứ → trang chủ".

## 4. Danh mục mã vấn đề (`migration_issues.code`)

| Mức | Mã | Ý nghĩa / hành động |
|---|---|---|
| ERROR | `USER_NO_VALID_EMAIL`, `USER_EMAIL_CONFLICT` | không kích hoạt được / xung đột — admin xử lý |
| ERROR | `MEMBER_UNKNOWN_PROVINCE`, `MEMBER_INVALID_ROW`, `MEMBERS_FILE_MISSING`, `REFERENCE_DATA_MISSING`, `RUN_ABORTED`, `RECONCILE_MISMATCH` | sửa nguồn/chạy `pnpm db:seed`/xem log rồi `resume` |
| WARNING | `UNKNOWN_ROLE`, `NO_ROLE`, `MULTIPLE_ROLES` | kiểm tra vai trò |
| WARNING | `CATEGORY_UNMAPPED`, `POST_CATEGORY_DEFAULTED`, `POST_AUTHOR_MISSING`, `SLUG_CONFLICT_RENAMED`, `PASSWORD_PROTECTED`, `UNKNOWN_POST_STATUS` | bài `needsReview` — biên tập viên xem |
| WARNING | `MEDIA_FILE_MISSING`, `MEDIA_REFERENCE_UNRESOLVED`, `MEDIA_UNREADABLE`, `MEDIA_TOO_LARGE`, `MEDIA_UNSUPPORTED_TYPE`, `SHORTCODE_UNSUPPORTED` | thiếu tệp/nội dung — cần nguồn gốc |
| WARNING | `DATA_LOSS_ENCODING`, `RESERVED_PATH`, `EDITED_IN_NEW_SYSTEM`, `PAGE_PARENT_MISSING`, `REDIRECT_CHAIN_SKIPPED` | xem từng ca |
| INFO | `SYSTEM_PAGE_REPLACED`, `CONTENT_LANGUAGE_EN`, `CONTENT_TAGS_REMOVED`, `MEDIA_ORPHAN_FILE`, `MEDIA_DUPLICATE`, `MEDIA_SITE_ICON`, `COMMENT_PII_DROPPED`, `LEGACY_BLOGNAME_NOT_APPLIED`, `PROVINCE_PHOTOS_PLACEHOLDER`, `DIRECTORY_SAMPLE_DATA`, `SOURCE_CHANGED_NOT_APPLIED`, … | thông tin |

## 5. Giới hạn đã biết
- Snapshot đọc **toàn bộ bảng vào bộ nhớ** (đủ cho site cỡ nghìn dòng như site này); site lớn hơn nhiều cần đọc theo trang.
- Cập nhật khi chạy lại chỉ áp dụng cho **bài/trang** (nội dung, trạng thái, lượt thích cũ); thay đổi chuyên mục/thẻ ở nguồn sau lần nhập đầu **không** được đồng bộ; user/comment đã nhập không bị ghi đè (chỉ báo `SOURCE_CHANGED_NOT_APPLIED`).
- Mỗi phase (trừ media/ảnh tỉnh) là **một transaction**; phase lỗi bị rollback và `resume` làm lại phase đó.
- Không gửi e-mail kích hoạt hàng loạt (không có e-mail thật ở môi trường này): sau khi cutover, admin kích hoạt/mời tài khoản qua giao diện hoặc người dùng tự "Quên mật khẩu".

## 6. Kết quả chạy thật trên dump gốc (`sampleweb_wp_export.sql`, 2026-10-10)

Dump là snapshot **của site tiền thân** ("Nuoitoi"/CLB Tình nguyện — xem `SOURCE_AUDIT.md`), không phải toàn bộ nội dung HBVL; nội dung HBVL thật nằm ở code theme và dữ liệu JSON/xlsx.

| Nguồn | Kết quả ở DB đích (DB diễn tập `hbvl_migration`) |
|---|---|
| 2 user | 2 (1 ADMIN, 1 MEMBER) — đều `PENDING_RESET`, không hash |
| 4 post (3 publish, 1 trash) + 3 auto-draft | 4 (3 `PUBLISHED`, 1 `TRASHED`); 3 auto-draft bỏ; cả 4 phát hiện là tiếng Anh ⇒ `originalLocale=en` |
| 17 trang | 15 nhập (13 `PUBLISHED`, 2 `DRAFT` — gồm `lien-he` bị hạ vì trùng route), 2 trang hệ thống (home/blog) bị thay |
| 1 comment | 1 (`TRASHED`) |
| 15 term | 10 tag; `charity` không ánh xạ được; 3 term menu/theme bỏ |
| 4 revision | 4 `WP_REVISION` |
| 6 tệp ảnh trong `uploads` + 2 attachment | 5 media duy nhất (`ORPHAN`/`PRIVATE`), 1 trùng; **2 attachment mất tệp** (icon site) |
| 31 dòng workbook | 31 học viên |
| 162 liên hệ mẫu trong theme | 162 `UNVERIFIED_SAMPLE` |
| 63 ảnh tỉnh | 63 (`isPlaceholder`) |
| — | 62 chuyển hướng (`LEGACY_MIGRATION`) |

Thời gian: **dry-run 11,2 s · apply 13,9 s · apply lần 2 0,9 s (không tạo gì)**. 0 ERROR. Cảnh báo: `POST_CATEGORY_DEFAULTED` ×4, `MEDIA_FILE_MISSING` ×2, `DATA_LOSS_ENCODING` ×2 (tiêu đề hai trang "Trang ch?", "Tin t?c & Blog" **đã mất dấu ngay trong file dump**, hex xác nhận), `CATEGORY_UNMAPPED` ×1, `RESERVED_PATH` ×1. Đối soát: `mismatches: []`.

Sau khi apply, API trên DB này đã được thử thật: bài tiếng Anh đọc được, `/?p=7` ⇒ 301 tới `/bai-viet/…`, trang `gioi-thieu/tong-quan` có nội dung, trang `lien-he` (draft) 404, ảnh tỉnh phục vụ công khai, ảnh orphan **404** với khách.

## 7. Cutover và rollback (kế hoạch — cần thông tin triển khai thật)

1. **Trước**: xuất dump **mới** từ WordPress production (dump hiện có cũ hơn code theme — mất `_submission*`, feedback/contact…). Chạy lại `dry-run` trên dump mới, xử lý ERROR, rà WARNING.
2. Đóng băng WP (chế độ bảo trì/chỉ đọc) → xuất dump + sao `uploads` lần cuối.
3. Hệ thống mới: `pnpm db:migrate`, `db:seed`, `storage:init`, `bootstrap:admin`, rồi `migrate:legacy apply`. Kiểm `report`.
4. Admin: đăng nhập `/dang-nhap-quan-tri`, bật MFA, rà `needsReview`, kích hoạt/mời CTV & thành viên, xác minh danh bạ tỉnh thật.
5. Chuyển DNS/proxy (ngoài phạm vi repo) — redirect từ bảng `redirects` xử lý URL cũ.
6. **Rollback**: giữ WP nguyên trạng đến khi ổn định; nếu cần quay lại chỉ việc trỏ DNS về WP. Dữ liệu phát sinh ở hệ thống mới (bài/bình luận mới) **không tự đồng bộ ngược** — phải xuất tay. `pnpm ops backup` ngay trước và sau cutover.
