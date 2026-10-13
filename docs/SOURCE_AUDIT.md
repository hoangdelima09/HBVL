# SOURCE_AUDIT — Kiểm kê nguồn WordPress `HBVL/RiseUp`

Ngày audit: 2026-10-10. Người thực hiện: phiên triển khai đầu tiên (đọc code thật, restore SQL thật vào MariaDB tạm).
Nhãn bằng chứng dùng xuyên suốt tài liệu:

| Nhãn | Ý nghĩa |
|---|---|
| **[CODE]** | Thấy trực tiếp trong mã nguồn theme/PHP/JS |
| **[DOC]** | Chỉ có trong tài liệu, chưa thấy trong code |
| **[NO-DATA]** | Tính năng có trong code nhưng snapshot dữ liệu không có bản ghi |
| **[NEW]** | Yêu cầu nâng cấp mới, không có ở bản cũ |
| **[RUNTIME-NOT-VERIFIED]** | Chưa chạy WordPress cũ nên chưa kiểm chứng runtime |

## 1. Phạm vi và cách audit

- Nguồn: `HBVL/RiseUp/` (git HEAD `60edccf "Update bản đồ"`, **cây làm việc có nhiều thay đổi chưa commit** — không chạm vào, chỉ đọc).
- Remote tham chiếu `https://github.com/Hug-leo/RiseUp` : `git ls-remote` truy cập được (nhánh `CONGPHAT`, `Duchoang`, HEAD). **Không fetch nội dung** vì local đã đủ; không khẳng định gì về nội dung remote.
- WordPress/PHP **không chạy được** trên máy này (không có PHP/Apache; Docker có nhưng không dựng WP cũ) → mọi thứ về hành vi WP cũ là **suy ra từ mã tĩnh** + ảnh chụp trong `docs/screenshots` (tham chiếu tĩnh, có thể cũ). Không có phát biểu nào "đã kiểm chứng runtime bản cũ".
- SQL `database/sampleweb_wp_export.sql` được restore vào MariaDB 11.4 tạm (`hbvl-wp-restore`, container riêng, cổng 127.0.0.1:33061) và đọc bằng truy vấn SELECT; dump gốc không bị sửa.

## 2. Tệp tham chiếu nhưng KHÔNG tồn tại

| Tham chiếu | Nơi nhắc | Thực tế |
|---|---|---|
| `Y_Tuong_De_Muc_Website_HBVL.md` ("source of truth" chuyên mục) | README | Không có. Nguồn thay thế: `charity_content_groups()` trong `functions.php` + `config/content-pillars.json` |
| `.planning/` (PROJECT, ROADMAP…) | README | Không có |
| Ảnh hero `assets/img/hero-bg.jpg` | `functions.php` custom-header | Không có trong `assets/img` |
| `CLAUDE_IMPLEMENTATION_PROMPT.md` | `HBVLFINAL/READING_NOTES.md` | Không có trong thư mục đích (yêu cầu được cung cấp trực tiếp trong phiên) |

`SKILL.md` ở gốc nguồn là prompt thiết kế chung ("gpt-taste"), **không phải** đặc tả dự án; bỏ qua.
`config/content-pillars.json` có tên chuyên mục **không dấu** ("TIN TUC") – chỉ là tham chiếu; slug đúng lấy từ `charity_content_groups()`.

## 3. Phiên bản và sự không nhất quán

- `functions.php`: theme **2.3.9**; `style.css`: 2.0.0; README: 2.2.0; `docs/PLAN.md`: 2.1. Chọn **code (2.3.9)** là baseline.
- `docs/PLAN.md` liệt kê "Media gallery, Search, Social sharing, SEO" là kế hoạch; code hiện có search (`search.php`), OG tags **không thấy** trong theme (README nói có Phase 4 — **[DOC]**), share buttons **không có** trong `single.php` → mục [NEW].
- `docs/SITE_AUDIT.md` ghi "Trang Đăng bài hiện dẫn tới Google Drive" nhưng mục đầu file nói đã thay bằng form nội bộ; code thật: `charity_drive_upload_url()` còn tồn tại trong `functions.php` nhưng **không được tham chiếu** ở template nào đã đọc. Luồng chính = form nội bộ (`/gui-bai/`).
- `functions.php` còn handler cũ `vuonlen_submit_post` (AJAX, status `pending`, trường `author_name/author_email` → meta `_guest_author_*`). Template `page-submit-post.php` dùng luồng mới `charity_save_submission`. Handler cũ là **mã chết/legacy** → không port.
- `student-map.js` thực chất chỉ là loader `import('./hbvl-map.js')`; phần còn lại trong file là **mã chết** (popup, `vuonlenMap`). `wp_localize_script('vuonlenMap')` (tính từ `province-directory.json`) không còn được `hbvl-map.js` dùng.

## 4. Inventory SQL snapshot (`sampleweb_wp`, MariaDB 10.4 dump)

**Phát hiện quan trọng:** snapshot SQL **không phải dữ liệu HBVL hiện hành**. Nó là website tiền thân "Nuoitoi" (`blogname=Nuoitoi`) dựng từ theme *Nook*/mẫu "Câu lạc bộ Tình Nguyện" (quận 3, TP.HCM): trang giới thiệu CLB, 3 bài blog tiếng Anh mẫu, menu DB 24 mục của CLB. Nội dung HBVL thật (hero, sứ mệnh, 5 chuyên mục, liên hệ Quỹ Đông Du) **nằm trong code theme**, không nằm trong DB.

| Bảng | Số dòng | Ghi chú |
|---|---|---|
| wp_users | 2 | `Qm1719` (administrator), `commentor1` (subscriber); mật khẩu dạng `$wp$2y$…` (WP ≥ 6.8: bcrypt prefix `$wp`). Email thật của admin → **không chép vào tài liệu/log** |
| wp_usermeta | 36 | chỉ capabilities/level/nickname… |
| wp_posts | 57 | xem bảng dưới |
| wp_postmeta | 211 | 24×7 menu meta; `_edit_lock`, `_wp_attached_file`… **Không có** `_submission*`, `_post_likes`, `_contact_*` |
| wp_terms / term_taxonomy | 15 / 15 | `category`: Uncategorized, Charity; 10 `post_tag`; 2 `nav_menu`; `wp_theme`. **Không có 5 chuyên mục HBVL** (theme tự tạo ở hook `init` lúc chạy) |
| wp_term_relationships | 43 | chủ yếu menu |
| wp_comments | 1 | bình luận mẫu "A WordPress Commenter" trên bài đã trash, status `post-trashed` |
| wp_options | 166 | allowlist cần: `blogname` (**stale "Nuoitoi"**), `timezone_string=Asia/Ho_Chi_Minh`, `permalink_structure=/%postname%/`, `page_on_front=11`, `page_for_posts=57`, `users_can_register=1`, `default_role=subscriber`, `comment_registration=0` (code ép `true` bằng filter) |
| wp_commentmeta / wp_termmeta / wp_links | 0 | rỗng |

`wp_posts` theo loại/trạng thái:

| post_type | status | n | Xử lý migration |
|---|---|---|---|
| page | publish | 16 | Giữ slug + cây cha–con; **cờ `needsReview`** (nội dung CLB tiền thân) |
| page | draft | 1 | `privacy-policy` → DRAFT |
| post | publish | 3 | 3 bài tiếng Anh mẫu (tác giả ID 1, 2026-02-28…03-10) → PUBLISHED, **không có category HBVL** → category `Uncategorized` map vào "Chưa phân loại" + cờ review |
| post | trash | 1 | `Hello world!` → TRASHED (soft-delete, không public) |
| post | auto-draft | 3 | bỏ (quarantine, 0 nội dung) |
| attachment | inherit | 2 | PNG tháng 03 (site icon); **file không có trên đĩa** |
| revision | inherit | 4 | lưu `PostRevision` loại `WP_REVISION` |
| nav_menu_item | publish | 24 | **không migrate** (menu HBVL do code dựng; menu DB là của CLB) — ghi vào báo cáo "intentionally skipped" |
| customize_changeset / wp_global_styles / wp_navigation | 1/1/1 | bỏ (cấu hình theme WP) |
| event, program, riseup_feedback, riseup_contact | — | **[NO-DATA] 0 bản ghi** — tính năng vẫn phải xây |

Lỗi dữ liệu trong dump: tiêu đề trang ID 11 ("Trang ch?") và 57 ("Tin t?c & Blog") bị **mất dấu tiếng Việt thành ký tự `?` (0x3F)** ngay trong file SQL (hex xác nhận) → mất dữ liệu từ lúc export, không khôi phục tự động. Migration báo `MigrationIssue(DATA_LOSS_ENCODING)`; hai trang này vốn là trang home/blog WP sẽ bị thay bằng route code.

URL cũ thấy trong dữ liệu: `http://localhost/sampleweb/wordpress/...` (siteurl) → cần chuẩn hóa tiền tố khi tạo redirect.

## 5. Media / uploads

- `wordpress/wp-content/uploads/2026/`: thư mục 05, 06 rỗng; 08 có 5 JPEG; 09 có 1 JPEG. MD5: 2 file `dda64aed….jpg` (08 và 09) **trùng checksum**. → 5 asset duy nhất.
- **Không file nào có bản ghi `wp_posts` attachment** (DB chỉ có 2 PNG tháng 03 mà đĩa không có). Hệ quả: 5 ảnh là "orphan" (có thể là ảnh test/ảnh bài gửi đã bị xóa DB). Migration đưa chúng vào thư viện media ở trạng thái **UNATTACHED/PRIVATE**, không tự gắn vào bài, không public.
- `assets/img/provinces/*.jpg`: 63 ảnh; **30 ảnh có cùng MD5 `397dd6ee…`** (91 538 B) → ảnh placeholder dùng chung, chỉ 33 ảnh riêng biệt. Ghi vào danh sách "ảnh cần thay" và `ProvincePhoto.isPlaceholder=true`.
- `assets/img/dong-du-logo.jpg` (logo), `vietnam-map.jpg`, `vietnam-34-provinces.svg`, `vietnam-63-provinces.svg`.
- Provenance/license: geometry 34 từ *ThangLeQuoc/vietnamese-provinces-database* (MIT; tác giả gốc bản đồ = NXB TN-MT-BĐVN), geometry 63 từ Highcharts `vn-all.geo.json` (file ghi `Copyright (c) 2026 Highsoft AS, Based on data from Natural Earth`, v2.3.3, CRS EPSG:32648; **không có điều khoản license trong file — phải xác minh license Highsoft Map Collection trước khi phát hành**; bản thân Natural Earth là public domain) [theo `docs/province-data-sources.md`]. Theme **không có** OG/canonical/hreflang/JSON-LD (grep rỗng) — README ghi "Open Graph" chỉ là **[DOC]**. Ảnh tỉnh/logo: **chưa rõ nguồn/license**.

## 6. Dữ liệu bản đồ / học viên / danh bạ

| File | Nội dung thực | Dùng ở |
|---|---|---|
| `assets/data/hbvl-members.json` | `{members[31]: {name, oldProvince, currentProvince}, meta}` — **nguồn bản đồ thực** | `hbvl-map.js` |
| `assets/data/vietnam-provinces.json` | `modes.34` (34 Feature Multi/Polygon, có `constituents`), `modes.63` (63 Feature), `islands[17]` (15 đảo + QĐ. Hoàng Sa/Trường Sa; có `position` toạ độ địa lý & `position63` toạ độ chiếu riêng) | `hbvl-map.js` |
| `assets/js/province-mapping.js` | `NEW_34_TO_OLD_63` — ánh xạ 34→63 (đã kiểm: 34 khóa, 63 tiền thân, không trùng) | map + validator |
| `data/province-directory.json` | 63 entry (`p11…p73`), có `name/name_en/slug/members[]` — **162 "thành viên"** | `page-tinh.php` (`/tinh/{slug}/`) |
| `data/contact-dongdu.json` | 34 entry `p11…p44` với danh bạ khác `province-directory` | không thấy được dùng ở code đã đọc |
| `data-source/DANH SÁCH HBVL 26 - 27.xlsx` | 1 sheet "Sheet2", dimension A1:Q783, cột: họ tên, giới tính, "sv năm N", quê quán (tên tỉnh viết thô, vd "TP. THỦ ĐỨC", "ĐẮC LẮK") | nguồn gốc `hbvl-members.json` (script `build_hbvl_map_data.py`) |
| `data-source/vietnam-34-api/*.json`, `vietnam-63-provinces-source.geo.json`, `vietnam-63-islands.json`, `vietnam-islands.json` | nguồn hình học | script build geometry |

Nhận định (có bằng chứng):

1. Validator cũ chạy lại hôm nay: `PASS: 34 current, 63 historical, 31 unique members, 0 unmatched; totals equal` (chỉ là validator dữ liệu, không phải test runtime). Phân bố 31 học viên theo 34 đơn vị: HCM 10, Đồng Tháp 3, Quảng Ngãi 3, Khánh Hòa 3, Đắk Lắk 2, Đồng Nai 2, An Giang 2, Đà Nẵng 2, Vĩnh Long/Gia Lai/Cần Thơ/Tây Ninh 1.
2. **`province-directory.json` có dấu hiệu là dữ liệu mẫu/sinh tự động**: mỗi tỉnh 2–4 người theo mẫu cố định (người đầu luôn "Đại diện tỉnh"), tên **lặp lại giữa các tỉnh** (vd "Nguyễn Văn An", "Trần Thu Dung" xuất hiện ở nhiều tỉnh), tất cả `contact: "/lien-he"`; `contact-dongdu.json` dùng "Nguyễn Văn An/Trần Thị Bình/Lê Minh Cường" (tên mẫu kinh điển). Không có nguồn xác nhận người thật. → Quyết định: import vào `DirectoryContact` với `verification = UNVERIFIED_SAMPLE`, **không hiển thị công khai mặc định**; admin xác minh/ẩn/hiện. Bản cũ hiển thị chúng công khai → chênh lệch có chủ đích (ghi trong parity).
3. Mã `p11…p73` là mã **nội bộ của theme** (xuất phát từ VietMap), không phải mã hành chính chính thức; trùng mã giữa 34 (`p11-p44`) và 63 (`p11-p73`) nhưng nghĩa khác nhau (vd `p12` = HCM ở cả hai nhưng `p13` = Đà Nẵng(34) vs Hải Phòng(63 directory)) → **không dùng làm khóa**. Khóa mới: `(adminSystem, code chính thức)` với mã theo Quyết định 19/2025/QĐ-TTg (cần nhập từ nguồn chính thức đã trích trong `province-data-sources.md`; mã không có trong repo nguồn → xem IMPLEMENTATION_PLAN §Dữ liệu hành chính).
4. Nhãn địa danh trong workbook cần normalize: "TP. THỦ ĐỨC"→TP. Hồ Chí Minh, "ĐẮC LẮK"→Đắk Lắk… (có bảng alias trong `province-normalization.js`).
5. Workbook chứa giới tính + năm học = thông tin cá nhân; payload công khai chỉ gồm `name` (+ tỉnh), như bản cũ.
6. Số `63 / 34`, `5`, `20+` trên hero là chuỗi hard-code trong `front-page.php` ("20+ năm khuyến học" **không có nguồn dữ liệu** → giữ như nội dung biên tập trong `SiteSetting`, đánh dấu cần xác nhận).

## 7. Luồng nghiệp vụ trong code (đã đọc)

Chi tiết từng tính năng xem `FEATURE_PARITY.md`. Tóm tắt các điểm dễ sai khi port:

- **Gửi bài** (`inc/submissions.php`): form `/gui-bai/` ↔ list `/bai-cua-toi/` cùng template. Lưu: `post_status` = `draft` (lưu nháp) hoặc `pending` (gửi duyệt); meta `_submission=1`; yêu cầu sửa/từ chối = đưa về `draft` + `_submission_review ∈ {changes, rejected}` + `_submission_reason`. `charity_submission_editable`: tác giả = user, status `draft`, review ≠ `rejected`. Idempotency bằng transient `submission_{user}_{request_id}` 24h + khóa option `add_option` (không bền với nhiều node). Ảnh: ≤5 MB, MIME thực ∈ {jpeg,png,webp}; upload trước khi lưu bài, lỗi → trả lỗi (nội dung giữ ở form). Tiêu đề ≤200, nội dung ≤50 000, category phải tồn tại, `submit` yêu cầu nội dung sau strip tags không rỗng. Review (`charity_review_submission`): chỉ khi `pending`; `changes` cho CTV/admin; `rejected` chỉ admin; lý do 1–2000. Publish = admin bấm Đăng trong wp-admin (không có code riêng).
- **Quyền CTV** (`access-control.php`): `edit_others_posts`, `edit_private_posts`, `read_private_posts`, `delete_posts`, `delete_private_posts`, `upload_files`, `moderate_comments`, feedback caps; **không** `publish_posts`, `edit_published_posts`, `delete_others_posts`, `delete_published_posts`. Lưu ý: CTV WP **thấy mọi draft/private** của người khác — bản mới **thu hẹp** (chỉ bài PENDING_REVIEW + bài đang xử lý), có chủ đích theo yêu cầu.
- **Cổng đăng nhập**: 3 route; `charity_portal_accepts_user` — admin cổng chỉ nhận `manage_options`; CTV cổng nhận `riseup_collaborator`; cổng member nhận `riseup_member|subscriber`. Sai cổng → đăng xuất + thông báo chung. Redirect: admin→`wp-admin`, CTV→`edit.php`, member→`/tai-khoan/`; `redirect_to` chỉ áp dụng cho **member** qua `wp_validate_redirect`.
- **Đăng ký**: chỉ tạo `riseup_member`; username 3–60, mật khẩu ≥10 ký tự + nhập lại, email hợp lệ, honeypot `user_website`, tự đăng nhập. **Không có xác minh email** (→ [NEW]). Không thấy giới hạn tối đa độ dài mật khẩu.
- **Góp ý** (`riseup_feedback`, status `private`): cần đăng nhập, nonce, honeypot, subject 1–160, message 1–5000, giới hạn 60 s (transient). Không có trạng thái xử lý (**docs nói rõ chưa có**) → trạng thái/ghi chú nội bộ là [NEW].
- **Liên hệ** (`riseup_contact`): cần đăng nhập; tên ≤120, email ≤254 + `is_email`, subject ≤200 (mặc định "Liên hệ từ website"), message 1–5000; 60 s; lưu DB rồi `wp_mail` tới địa chỉ Quỹ (`quykhuyenhocdongdu@gmail.com`, có sẵn trong code) với Reply-To; meta `_contact_mail ∈ {accepted, failed}`, `_contact_status ∈ {new, done}`. Không retry (**docs xác nhận**). Mã tiếp nhận = post ID.
- **Bình luận**: bắt buộc đăng nhập (filter ép `comment_registration`), auto-approve cho admin/CTV/member nếu không phải spam/trash, form còn hiện ô name/email (thừa khi đã login). CTV không sửa/trash/spam bình luận của admin; member không kiểm duyệt.
- **Like**: AJAX `toggle_post_like`, cần login, chỉ `post` + `publish` + không password-protected; trạng thái bằng **cookie** `vuonlen_liked_{id}` + tổng `_post_likes` (toggle không idempotent, có thể lệch). Nút like hiện ở `single.php`, `content-card.php`, `page-announcements.php`.
- **Tìm kiếm**: WP search mặc định (`?s=`), không xử lý dấu/đ.
- **Ngôn ngữ**: cookie `charity_lang` + `?lang=`; **không có** hreflang/URL riêng; nội dung bài không dịch, chỉ UI qua `charity_t(vi,en)`; tên category lấy từ DB (đơn ngữ) trừ chỗ tra bảng nhóm.
- **Menu**: dựng cứng từ `charity_content_groups()` (5 nhóm, 12 mục con) + Trang chủ / Đăng bài (khi login) / Liên hệ / Tài khoản|Đăng nhập / ô tìm kiếm. `wp_nav_menu_objects` map `/blog/` → `tin-tuc`; `template_redirect` 301 `*/blog` → category `tin-tuc`.
- **Trang chủ** (`front-page.php`): hero (3 CTA + 3 stat), mission 3 thẻ, pillars 5 thẻ, "Tin nổi bật" (5 bài mới nhất: 1 lead + 4), "Cập nhật mới nhất" (tối đa 5 nhóm × 3 bài, loại trừ bài nổi bật), map feature (ảnh SVG 34 + legend + CTA). Không có khối sự kiện/chương trình trên homepage (prompt cũ lo "homepage chủ yếu hiển thị bài viết").
- **Category** (`category.php`): breadcrumb, banner, panel "Các mục nhỏ" cho nhóm cha, bản đồ khi slug `ban-do-vuon-len`, lưới bài với 4 kiểu card: `card` (mặc định), `profile` (`guong-mat-vuon-len`), `song` (`tong-hop-bai-hat`), `tip` (`bi-kip`, `the-gioi-quanh-ta`); phân trang WP; empty state có CTA gửi bài.
- **Single**: banner+breadcrumb, meta (category đầu, ngày, tác giả, thời gian đọc = từ/200), ảnh đại diện, nội dung, tags, like, author box, prev/next, sidebar (bài gần đây + danh mục), bình luận.
- **Announcements** (`page-announcements.php`, template page): 12 bài mới nhất + tab lọc category **chỉ lọc client-side trên 12 bài đã tải** (không phải lọc thật) → bản mới lọc server-side, trong URL.
- **Province page** `/tinh/{slug}/`: ảnh tỉnh (fallback ảnh bản đồ), tên VI/EN, bảng thành viên (tên/vai trò/"Liên hệ"), 404 nếu slug không có. Map hiện tại **không liên kết** tới trang này.
- **Contact page**: 4 thẻ (địa chỉ `43D/46 Hồ Văn Huê, P. Đức Nhuận, TP. HCM`; điện thoại `084.3214.142 (Thanh Vẹn)`; email `quykhuyenhocdongdu@gmail.com`; giờ làm việc T2–T6 8:00–17:00, T7 8:00–11:30) + iframe Google Maps (toạ độ gần đúng 10.8, 106.68 — nhúng bên thứ 3) + form. Footer dùng email khác `contact@hocbongvuonlen.vn` (**không nhất quán**, nguồn chưa xác nhận) và địa chỉ "TP. Hồ Chí Minh" chung.

## 8. Giao diện baseline (đối chiếu runtime ↔ ảnh)

- CSS thực (`main.css`, 3 977 dòng): token `--primary #1d4ed8`, `--accent #f59e0b`, `--primary-dark #0f172a`, nền `#f8fafc`; font Be Vietnam Pro (UI) + Newsreader (heading); radius 8/12/16/24; container 1200/1320/760; breakpoint 1560 (menu mobile!), 1024, 768, 480.
- Ảnh `docs/screenshots/qa-redesign-1440.png` (tham chiếu tĩnh): nền giấy ấm `#f6f4ef`-like + khối xanh nhạt chéo, tiêu đề Newsreader lớn, xanh lá nhấn cho kicker, thẻ bản đồ có viền trên xanh lá — **đến từ phương án Stitch "Direction B" (`docs/stitch-redesign-reference.md`)**, không hoàn toàn giống CSS hiện hành (CSS hiện hành thiên về "SaaS": sapphire/amber).  Ảnh chụp có lỗi hiển thị dấu ("kê´t nô´i", "đô`ng") do font thiếu glyph kết hợp → chứng cứ cho việc phải self-host font hỗ trợ tiếng Việt đầy đủ.
- **Baseline được chọn**: giữ bảng màu code (sapphire `#1d4ed8`/amber `#f59e0b`) + bổ sung nền giấy ấm & xanh lá của Direction B ở mức token có chủ đích (kicker, viền thẻ bản đồ); heading Newsreader, body Be Vietnam Pro self-host. Lý do: code là trạng thái sau cùng (v2.3.9), Direction B được chọn có chủ đích trong tài liệu thiết kế và khớp với ảnh QA mới nhất.
- Ảnh bản đồ `map-islands-34-1280.png`: 17 nhãn đảo hiển thị, Hoàng Sa/Trường Sa nhãn đỏ "VIỆT NAM" — baseline để đối chiếu.

## 9. Test cũ (hành vi nghiệp vụ cần port)

| Test cũ | Hành vi nghiệp vụ → test mới |
|---|---|
| `test_site.cjs` | link nội bộ không lỗi; cookie ngôn ngữ; menu mobile Escape/resize; login CTV qua form thật; like không đụng contact private; submit giữ backslash/pending; ảnh sai không tạo bài thừa → E2E + integration |
| `test_submissions.cjs`, `test_submission_rules.php` | state machine, locked states, lý do, ảnh, idempotent → integration/E2E |
| `test_feedback.cjs` | 4 vai trò, dữ liệu sai, gửi lặp, quyền inbox |
| `test_contact.php` | lưu private, email lỗi không mất tin, rate limit, quyền, đánh dấu xử lý |
| `test_comment_permissions.php` | auto-approve role, giữ spam, CTV không sửa comment admin, member không kiểm duyệt, guest bị chặn |
| `test_map_islands.cjs`, `validate_hbvl_map.py` | 34/63, 17 nhãn, đảo thuộc đúng tỉnh, tổng khớp, tỉnh 0 học viên |
Các test này hardcode `C:/xampp/php/php.exe`, `localhost/sampleweb/wordpress` → **không dùng lại nguyên bản**.

## 10. Rủi ro & câu hỏi mở (không chặn tiến độ)

1. Nội dung CLB tiền thân (16 trang + 3 bài) có nên public? → mặc định giữ PUBLISHED như snapshot + cờ review + khuyến nghị rà soát trước go-live.
2. Danh bạ `province-directory.json` là dữ liệu mẫu hay thật? → mặc định ẩn (UNVERIFIED_SAMPLE).
3. Email liên hệ chính thức (`quykhuyenhocdongdu@gmail.com` vs `contact@hocbongvuonlen.vn`) → dùng email trong trang Liên hệ (mục đích nhận thư), settings cho admin đổi.
4. License Highcharts Map data & ảnh tỉnh/logo → cần xác minh trước phát hành.
5. Mã hành chính chính thức của 34/63 đơn vị không có trong repo → nhập từ Quyết định 19/2025/QĐ-TTg theo nguồn đã liệt kê; xem kế hoạch.
6. Dữ liệu hồi sinh sau cutover: snapshot SQL cũ hơn code → cần **xuất SQL mới từ production WordPress** (nếu tồn tại) trước cutover thật; migration đã viết để chạy lại trên dump mới.
