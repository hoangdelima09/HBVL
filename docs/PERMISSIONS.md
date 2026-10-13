# PERMISSIONS — Ma trận quyền (Admin / Cộng tác viên / Thành viên / Khách)

Nguồn đối chiếu: `HBVL/RiseUp/.../inc/access-control.php`, `inc/submissions.php`, `inc/contact.php`, `functions.php` (**[CODE]**) và bảng yêu cầu bàn giao (**[NEW]** khi khác bản cũ).
Quyền được **thực thi ở NestJS** (decorator `@Auth({roles, verified, mfa})` ở `apps/api/src/auth/auth.decorators.ts` + chính sách theo trạng thái ở `apps/api/src/posts/state-machine.ts` và `workflow.service.ts`), UI chỉ ẩn/hiện. Mọi ma trận dưới đây có test tự động trong `tests/integration/{auth,workflow,engagement,inboxes,content,admin-map}.spec.ts` và E2E `tests/e2e/*.spec.ts`.

## 1. Vai trò

| Vai trò | Nguồn WP | Ghi chú |
|---|---|---|
| `ADMIN` | `administrator` (`manage_options`) | Tạo/quản lý user, role, settings, import, xuất bản |
| `COLLABORATOR` | `riseup_collaborator` | **Xử lý mọi việc kiểm duyệt nội dung** (duyệt, đăng, từ chối, thu hồi, sửa, xóa, khôi phục bài; kiểm duyệt/gỡ bình luận; xử lý tố cáo; hạn chế/khóa **thành viên**) — **trừ những thứ thuộc quản trị viên** (xem §2a) |
| `MEMBER` | `riseup_member`, `subscriber` | Đăng ký công khai chỉ tạo role này |
| Khách | — | chưa đăng nhập |
| Role WP khác | (không có trong snapshot) | **Không nâng quyền**: map thành `MEMBER`, `MigrationIssue(UNKNOWN_ROLE)` để admin xem lại |

Trạng thái tài khoản: `ACTIVE`, `SUSPENDED` (khóa, giữ dữ liệu), `PENDING_RESET` (tài khoản migrate chưa đặt mật khẩu), `DELETED` (ẩn danh hóa). Email xác minh: `emailVerifiedAt`.

## 2. Ma trận khả năng

`✔` được, `✘` không, `own` chỉ tài nguyên của chính mình, `V` yêu cầu email đã xác minh.

| Khả năng | Khách | Member | CTV | Admin | Căn cứ |
|---|---|---|---|---|---|
| Đọc nội dung/bản đồ/tỉnh công khai | ✔ | ✔ | ✔ | ✔ | [CODE] |
| Đăng ký (chỉ tạo MEMBER) | ✔ | — | — | tạo user bất kỳ role | [CODE] |
| Like / bình luận bài **PUBLISHED** | ✘ | ✔ V | ✔ V | ✔ V | [CODE] like+comment cần login; V = [NEW] |
| Tạo / lưu nháp bài của mình | ✘ | ✔ | ✔ | ✔ | [CODE] |
| Sửa bài của mình khi `DRAFT`/`CHANGES_REQUESTED` | ✘ | own | own | own | [CODE] `charity_submission_editable` |
| Gửi duyệt (`DRAFT|CHANGES_REQUESTED → PENDING_REVIEW`) | ✘ | own V | own V | own V | [CODE]; V = [NEW] |
| Xem bài của mình (mọi trạng thái, kèm lý do phản hồi) | ✘ | own | own | ✔ | [CODE] "Bài của tôi" |
| Xem hàng chờ & nội dung bài `PENDING_REVIEW` của người khác | ✘ | ✘ | ✔ | ✔ | [CODE] CTV `edit_others_posts`; **thu hẹp** (không thấy draft/private người khác) [NEW] |
| Biên tập bài `PENDING_REVIEW` (nội dung/chuyên mục/ảnh) | ✘ | ✘ | ✔ | ✔ | [CODE] |
| Yêu cầu người gửi sửa (cần lý do 1–2000) | ✘ | ✘ | ✔ | ✔ | [CODE] |
| Từ chối (lý do 1–2000) | ✘ | ✘ | ✔ (không phải bài của mình, không phải bài của admin) | ✔ | [NEW] CTV được từ chối (WP cũ: chỉ admin) |
| Xuất bản (`PENDING_REVIEW → PUBLISHED`) | ✘ | ✘ | ✔ (không tự duyệt bài của mình) | ✔ | [NEW] theo yêu cầu: CTV được duyệt/xuất bản (WP cũ: `publish_posts=false`); xuất bản lại bài `PRIVATE` vẫn chỉ Admin |
| Sửa / thu hồi (`PUBLISHED → PRIVATE`) / xuất bản lại bài | ✘ | ✘ | ✔ (bài không thuộc admin) | ✔ | [NEW] theo yêu cầu: CTV xử lý mọi thứ trừ nội dung của admin |
| Xóa bài (soft delete → thùng rác) / khôi phục | ✘ | ✘ | mọi bài của người khác & của mình, **trừ bài do admin viết** | mọi bài | [NEW] (WP cũ: CTV chỉ xóa bài của mình chưa đăng) |
| Gửi góp ý | ✘ | ✔ V | ✔ V | ✔ V | [CODE]; V = [NEW] |
| Đọc/xử lý hộp **góp ý** | ✘ | ✘ | ✔ | ✔ | [CODE] |
| Gửi liên hệ | ✘ | ✔ V | ✔ V | ✔ V | [CODE] cần login |
| Đọc/xử lý hộp **liên hệ** | ✘ | ✘ | ✘ | ✔ | [CODE] `manage_options` |
| Kiểm duyệt bình luận thường (duyệt/ẩn/spam/xóa) | ✘ | ✘ | ✔ | ✔ | [CODE] `moderate_comments` |
| **Tố cáo** một bình luận (lý do + ghi chú tuỳ chọn; không tố cáo bình luận của mình) | ✘ | ✔ V | ✔ V | ✔ V | [NEW] |
| Xem & xử lý hàng đợi tố cáo (nhận xử lý / bỏ qua / gỡ / gỡ + hạn chế / gỡ + khóa) | ✘ | ✘ | ✔ (không thấy tố cáo về bình luận của admin) | ✔ (tất cả) | [NEW] ai thao tác trước thì xử lý, người sau nhận 409 |
| **Hạn chế** tài khoản (đăng nhập & đọc được, không bình luận/thích/gửi bài/gửi ý kiến/liên hệ; có thời hạn hoặc đến khi gỡ) | ✘ | ✘ | ✔ chỉ tài khoản `MEMBER` | ✔ mọi tài khoản trừ chính mình | [NEW] |
| **Khóa / mở khóa** tài khoản (đăng xuất mọi thiết bị, không đăng nhập được) | ✘ | ✘ | ✔ chỉ tài khoản `MEMBER` | ✔ mọi tài khoản trừ chính mình (không khóa admin cuối cùng) | [NEW] |
| Sửa/xóa/ẩn/spam bình luận của **admin** | ✘ | ✘ | ✘ | ✔ | [CODE] `map_meta_cap` |
| Tạo/mời user, đổi vai trò, ẩn danh hóa tài khoản | ✘ | ✘ | ✘ | ✔ | [NEW] (WP: wp-admin) |
| **Đặt lại mật khẩu về mặc định `123456789`** (bắt buộc đổi ở lần đăng nhập sau) | ✘ | ✘ | ✘ | ✔ mọi tài khoản **trừ ADMIN**, trừ chính mình, trừ tài khoản chưa kích hoạt | [NEW] |
| Nhận thông báo trong web khi có **ý kiến mới** (mất đi khi người đó đã đọc) | ✘ | ✘ | ✔ | ✔ | [NEW] |
| Nhận **email** khi có bài gửi duyệt | ✘ | ✘ | ✔ (không phải người gửi) | chỉ thông báo trong web | [NEW] |
| Settings, nội dung trang chủ, import, media admin, audit log, redirect | ✘ | ✘ | ✘ | ✔ | [NEW]/WP wp-admin |
| Quản lý học viên/danh bạ/tỉnh | ✘ | ✘ | ✘ | ✔ | [NEW] |
| Quản lý chuyên mục, trang, sự kiện, chương trình | ✘ | ✘ | ✘ | ✔ | [CODE] qua wp-admin |
| MFA TOTP bắt buộc để vào `/admin` | — | — | tùy chọn | **bắt buộc** | [NEW] |

Bất biến: một CTV **không bao giờ** thấy hay tác động được vào bài/bình luận/tố cáo/tài khoản thuộc quản trị viên (trả `404`, không lộ sự tồn tại); không tự duyệt bài của chính mình; không tự hạn chế/khóa chính mình.

Bất biến: **không thể** hạ quyền / khóa / xóa ADMIN hoạt động cuối cùng; user không tự đổi role của mình; client không gửi được `role`, `authorId`, `status` (DTO strict, từ chối field thừa).

## 2a. "Thuộc quản trị viên" nghĩa là gì [NEW]

CTV làm được **mọi thao tác kiểm duyệt nội dung và cộng đồng**, ngoại trừ những thứ sau — chỉ ADMIN:

- Bài viết do tài khoản ADMIN viết, bình luận của ADMIN và các tố cáo về bình luận đó.
- Tài khoản CTV và ADMIN (hạn chế/khóa/đổi vai trò), tạo/mời người dùng, ẩn danh hóa.
- Cài đặt site, trang chủ, chuyên mục, trang tĩnh, sự kiện, chương trình, học viên & bản đồ, danh bạ, chuyển hướng, nhật ký hệ thống, hộp thư **liên hệ**.
- Mọi endpoint `/admin/*` (yêu cầu MFA đã qua).

Admin không bị giới hạn nào ngoài các bất biến an toàn (admin hoạt động cuối cùng, không tự khóa mình).

## 3. Xác minh email [NEW] — quy tắc không làm hỏng tài khoản migrate

- Tài khoản mới đăng ký: vào được `/tai-khoan/` ngay để hoàn tất xác minh; cho phép đọc, sửa hồ sơ, lưu nháp, gửi lại email xác minh. **Cần email đã xác minh** để: gửi duyệt, bình luận, like, gửi góp ý, gửi liên hệ.
- Tài khoản migrate từ WP: `status=PENDING_RESET`, `emailVerifiedAt=null`, **không có mật khẩu dùng được** (không copy hash WP). Họ vào bằng "Quên mật khẩu / kích hoạt" → hoàn tất link đặt mật khẩu **chính là chứng minh sở hữu email** ⇒ đặt `emailVerifiedAt`. Vì vậy quy tắc V không bao giờ chặn tài khoản migrate sau khi kích hoạt.
- Tài khoản do admin tạo: gửi lời mời đặt mật khẩu (cùng cơ chế) ⇒ verified khi đặt xong. Tài khoản bootstrap admin (CLI) tạo sẵn verified.
- Lỗi tài khoản không có email: không kích hoạt được → báo cáo migration + admin gán email thủ công.

## 4. Mã trạng thái chống lộ tài nguyên

| Tình huống | Mã |
|---|---|
| Chưa đăng nhập, endpoint cần login | `401` |
| Đã đăng nhập nhưng thiếu role (endpoint thuộc chức năng, vd `/admin/*`) | `403` |
| Tài nguyên không tồn tại **hoặc** người gọi không có quyền biết nó tồn tại (bài nháp của người khác, ảnh bài chưa xuất bản, inbox không thuộc quyền) | `404` |
| Tài nguyên thấy được nhưng hành động bị cấm bởi trạng thái/quyền (vd member sửa bài PENDING của chính mình, CTV publish) | `403` (`code: STATE_LOCKED` / `FORBIDDEN_ACTION`) |
| Bản cũ (`version` lệch) | `409` + `currentVersion` |
| Idempotency key tái dùng khác payload | `422` `IDEMPOTENCY_KEY_REUSED` |
| Rate limit | `429` + `Retry-After` |
| Thiếu/ sai CSRF, Origin không hợp lệ | `403` `CSRF` |

## 5. Quyền theo endpoint (rút gọn; bản đầy đủ có trong OpenAPI `x-roles`)

| Endpoint | Guard |
|---|---|
| `GET /api/v1/posts`, `/posts/:slug`, `/categories`, `/search`, `/map/*`, `/provinces/*`, `/events`, `/programs`, `/pages/:slug` | public (chỉ `PUBLISHED`, đúng locale) |
| `PUT/DELETE /posts/:id/like` | `Session` + `V` + post PUBLISHED |
| `POST /posts/:id/comments` | `Session` + `V` + post PUBLISHED + `commentsOpen` |
| `GET/POST/PATCH /me/posts*` | `Session`, ownership + state |
| `POST /me/posts/:id/submit` | owner + `V` + state ∈ {DRAFT, CHANGES_REQUESTED} + `Idempotency-Key` + `If-Match` |
| `GET /staff/review-queue`, `GET /staff/posts`, `GET/PATCH /staff/posts/:id`, `POST /staff/posts/:id/{publish,request-changes,reject,unpublish,restore}`, `DELETE /staff/posts/:id` (CTV không tự duyệt bài của mình, không đụng bài của admin) | `COLLABORATOR|ADMIN` |
| `POST /admin/users/:id/reset-password` | `ADMIN` (+ MFA đã qua); từ chối ADMIN/chính mình/PENDING_RESET |
| `POST /me/notifications/:id/read`, `POST /me/notifications/read` | `Session` (chỉ thông báo của chính mình) |
| `POST /comments/:id/report` | `Session` + `V` + rate limit 5/phút, 40/ngày |
| `GET /staff/reports`, `GET /staff/reports/count`, `POST /staff/reports/:commentId/{claim,resolve}` | `COLLABORATOR|ADMIN` (CTV: không thấy tố cáo về bình luận admin) |
| `GET /staff/members`, `POST /staff/users/:id/{restrict,unrestrict,block,unblock}` | `COLLABORATOR` (chỉ MEMBER) · `ADMIN` (mọi tài khoản trừ chính mình) |
| `POST /admin/posts/:id/publish|reject|unpublish`, `PATCH /admin/posts/:id` | `ADMIN` (+ MFA đã qua trong session) |
| `POST /feedback` | `Session` + `V` + rate limit 60 s/user |
| `GET /staff/feedback*`, `PATCH /staff/feedback/:id` | `COLLABORATOR|ADMIN` |
| `POST /contact` | `Session` + `V` |
| `GET/PATCH /admin/contact*` | `ADMIN` |
| `GET/PATCH /staff/comments*` | `COLLABORATOR|ADMIN` (+ chặn comment của admin với CTV; gỡ bình luận tự đóng các tố cáo của nó) |
| `/admin/users*`, `/admin/settings*`, `/admin/import*`, `/admin/members*`, `/admin/audit*`, `/admin/media*` | `ADMIN` |

## 6. Session & thay đổi quyền

- Mỗi request đọc `Session` → `User` từ DB (khóa theo hash token): đổi role / khóa tài khoản có hiệu lực **ngay lập tức**, không cache role trong session.
- Đổi mật khẩu, reset, khóa, hạ quyền ⇒ revoke toàn bộ session của user (trừ session hiện tại khi tự đổi mật khẩu).
- Rotate session ID khi đăng nhập, khi nâng/hạ quyền, khi bật MFA.
- Cổng đăng nhập `/dang-nhap-*` chỉ là **UI alias**: server vẫn kiểm role phù hợp cổng (sai cổng → lỗi chung, không lộ tồn tại tài khoản) rồi redirect theo role. `returnTo` chỉ chấp nhận đường dẫn nội bộ tuyệt đối-tương-đối (`/x`, không `//`, không `\`, không scheme) — áp dụng cho **mọi role** (bản cũ chỉ member).
