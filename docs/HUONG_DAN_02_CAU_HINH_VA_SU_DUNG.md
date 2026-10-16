# Hướng dẫn 2/2 — Cấu hình, sử dụng và kiểm thử khi chạy local

Đọc sau `HUONG_DAN_01_CAI_DAT_VA_CHAY_LOCAL.md`. File này nói về: gửi **email thật** (Gmail), **mã 6 số**,
**chatbot AI**, **bản đồ Vươn Lên** (nhập danh sách từ Excel), **chạy test** và **xóa dữ liệu**.

Mọi thay đổi trong `.env` chỉ có hiệu lực sau khi **khởi động lại API và worker** (Ctrl+C rồi chạy lại).

---

## 1. Ba vai trò và ba cổng đăng nhập

| Vai trò | Cổng đăng nhập | Làm được gì |
|---|---|---|
| **Quản trị viên** (Admin) | `/dang-nhap-quan-tri` → `/admin` | Tất cả: người dùng, mời CTV, duyệt/đăng bài, học viên & bản đồ, cài đặt. **Bắt buộc MFA** |
| **Cộng tác viên** (CTV) | `/dang-nhap-cong-tac-vien` → `/cong-tac-vien` | **Xử lý mọi việc kiểm duyệt** (xem mục 1a), trừ những thứ thuộc quản trị viên |
| **Thành viên** | `/dang-nhap-thanh-vien` | Gửi bài, bình luận, gửi ý kiến, quản lý hồ sơ |

Đăng nhập sai cổng sẽ báo lỗi chung (cố ý, để không lộ tài khoản nào tồn tại). Ma trận quyền chi tiết: `docs/PERMISSIONS.md`.

### 1a. CTV làm được gì, admin làm được gì

| Việc | CTV | Admin |
|---|---|---|
| Duyệt, đăng, yêu cầu sửa, **từ chối**, **thu hồi**, **sửa bài đã đăng**, **xóa**/khôi phục bài | ✔ (trừ bài do admin viết, và không tự duyệt bài của mình) | ✔ tất cả |
| Kiểm duyệt / xóa bình luận | ✔ (trừ bình luận của admin) | ✔ tất cả |
| Xử lý **bình luận bị tố cáo** (mục 8) | ✔ (không thấy tố cáo về bình luận của admin) | ✔ tất cả |
| **Hạn chế** hoặc **khóa** tài khoản | ✔ chỉ tài khoản *Thành viên* | ✔ mọi tài khoản (trừ chính mình) |
| Mời CTV, đổi vai trò, cài đặt site, học viên & bản đồ, chuyên mục, nhật ký… | ✘ | ✔ |

CTV vào ở `/cong-tac-vien`: **Hàng chờ duyệt**, **Quản lý bài viết**, **Kiểm duyệt bình luận**, **Bình luận bị tố cáo**, **Thành viên**.
Chuông 🔔 ở góc trên hiện thông báo mới (bài chờ duyệt, bình luận bị tố cáo).

**Mời CTV:** `/admin/nguoi-dung` → mời bằng email. Người được mời nhận email có **mã 6 số + liên kết** để đặt mật khẩu
(xem mục 3).

---

## 2. Gửi email thật bằng Gmail

Mặc định dev gửi vào **Mailpit** (http://localhost:58025), không ra ngoài. Để gửi ra hộp thư thật:

### 2.1. Lấy "mật khẩu ứng dụng" của Gmail

1. Tài khoản Google dùng để gửi phải bật **Xác minh 2 bước**.
2. Vào https://myaccount.google.com/apppasswords, tạo mật khẩu ứng dụng (tên tùy ý, ví dụ `hbvl`).
3. Google hiện **16 ký tự** (có thể có dấu cách). Đây không phải mật khẩu Gmail thường.

### 2.2. Sửa `.env`

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tai-khoan-gui@gmail.com          # tài khoản Gmail dùng để GỬI
SMTP_PASSWORD=abcdefghijklmnop              # 16 ký tự ở bước trên, KHÔNG dán vào chỗ khác
MAIL_FROM="Học Bổng Vươn Lên <tai-khoan-gui@gmail.com>"   # phải trùng SMTP_USER, nếu không Gmail đổi/từ chối người gửi
```

Lưu ý hay nhầm:

- `SMTP_HOST` chỉ là **tên máy chủ** `smtp.gmail.com` — không phải mật khẩu, không phải địa chỉ email.
- `SMTP_USER` là hộp thư **gửi đi**. `CONTACT_INBOX_EMAIL` là hộp thư **nhận** tin nhắn từ form "Liên hệ" — hai thứ khác nhau.
  Đang thử nghiệm thì nên đổi `CONTACT_INBOX_EMAIL` sang email của bạn để không gửi nhầm vào hộp thư của Quỹ.
- Không để dấu `#` ghi chú ngay sau giá trị chứa ký tự đặc biệt; bọc `MAIL_FROM` trong dấu nháy kép như trên.

### 2.3. Khởi động lại và thử

Khởi động lại **API và worker**. Rồi gửi thử một email thật bằng cách dùng một chức năng gửi mail
(ví dụ "Quên mật khẩu" với email của bạn, hoặc mời CTV ở `/admin/nguoi-dung`).
Nếu không tới: kiểm tra thư mục **Spam**, và xem trạng thái hàng đợi ở bảng `email_delivery_attempts`
(worker thử lại tối đa `EMAIL_ATTEMPTS` lần rồi đánh dấu FAILED kèm lý do).

> Muốn quay lại hộp thư thử: đặt `SMTP_HOST=127.0.0.1`, `SMTP_PORT=51025`, xóa `SMTP_USER`/`SMTP_PASSWORD`.
> Các bài **test tự động luôn dùng Mailpit**, không bao giờ gửi mail thật.

---

## 3. Mã 6 số qua email (đăng ký, quên mật khẩu, lời mời)

Có ba tình huống, mỗi email đều kèm **mã 6 số** và một **liên kết** (dùng cái nào cũng được):

| Tình huống | Cách dùng mã |
|---|---|
| **Đăng ký tài khoản** | Điền form "Tạo tài khoản thành viên" ngay dưới ô đăng nhập ở `/dang-nhap-thanh-vien` → email "Mã xác minh email: 123456" → vào **`/tai-khoan`**, nhập mã ở khung "Xác minh email" |
| **Quên mật khẩu** | `/quen-mat-khau` → nhập email → bấm "Gửi mã về email" → **bước 2**: nhập mã + mật khẩu mới |
| **Được admin mời** | Dùng đúng form `/quen-mat-khau` với email được mời; hoặc bấm liên kết trong thư |

Quy tắc của mã:

- Hiệu lực **60 phút** (mã/lời mời kích hoạt của admin: **7 ngày**), **dùng một lần**.
- Nhập sai **tối đa 5 lần** thì mã bị hủy, phải xin mã mới.
- Xin mã mới sẽ **làm mã cũ mất hiệu lực** — luôn dùng mã trong thư mới nhất.
- Đặt lại mật khẩu xong, mọi phiên đăng nhập cũ bị đăng xuất.
- Email không tồn tại, mã sai, mã hết hạn đều hiện **cùng một thông báo** — cố ý, để kẻ xấu không dò được tài khoản.

> Liên kết trong email trỏ về `http://localhost:3100/...`, nên chỉ mở được khi web đang chạy trên chính máy này.

---

## 4. Chatbot AI trên trang công khai

Nút "Hỏi trợ lý" ở góc phải mọi trang. Bot trả lời dựa trên **bài viết/trang đã đăng** và thông tin liên hệ của site.

1. Lấy khóa Gemini miễn phí ở https://aistudio.google.com/apikey.
2. Điền vào `.env`: `GEMINI_API_KEY=...` (khóa chỉ nằm ở server, không bao giờ gửi xuống trình duyệt).
3. Khởi động lại API.

Hành vi:

- Không có khóa, hoặc Google lỗi/quá tải → bot **vẫn chạy ở chế độ dự phòng** (liệt kê bài liên quan / thông tin liên hệ).
- Mô hình chính `gemini-flash-latest`, tự chuyển sang `gemini-3.5-flash-lite` khi quá tải (đổi bằng `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`).
- Giới hạn: 12 câu/phút và 150 câu/ngày cho mỗi người dùng/IP.
- Bot chỉ trả lời từ dữ liệu có thật của site; hỏi ngoài phạm vi sẽ được từ chối lịch sự.
- Chưa có bài viết nào đã đăng thì bot không có gì để trích dẫn — hãy đăng vài bài trước khi thử.

---

**Bot lấy dữ liệu từ đâu?** Mỗi câu hỏi, bot đọc trực tiếp từ cơ sở dữ liệu: phần giới thiệu và liên hệ ở `/admin/cai-dat`, danh sách chuyên mục, số học viên theo tỉnh trên bản đồ, khoảng 30 bài/sự kiện/chương trình mới nhất và các bài khớp nhất với câu hỏi. Đăng bài, sửa cài đặt hay nhập học viên xong là câu hỏi kế tiếp đã biết — không cần khởi động lại. Bài nháp, bài chờ duyệt và tên học viên không bao giờ được đưa cho bot.

Nếu bot trả lời "chưa tìm thấy thông tin" cho bài đã đăng từ trước bản cập nhật này, chạy một lần `pnpm reindex:search` (đánh chỉ mục lại tiêu đề bài).

## 5. Bản đồ Vươn Lên: nhập danh sách học viên từ Excel

Bản đồ ở `/category/dong-du-ky/ban-do-vuon-len` đếm học viên theo tỉnh/thành. Dữ liệu lấy từ bảng học viên.

### 5.1. Tệp Excel cần có dạng nào

Hệ thống chỉ đọc **Họ tên** và **Tỉnh/thành quê quán**; giới tính, năm học và mọi cột khác bị **bỏ qua** (dữ liệu cá nhân,
site không công bố). Với `.xlsx`, bố cục mặc định là sheet đầu tiên, cột **A** = số thứ tự (số), cột **B** = họ tên,
cột **E** = tỉnh. Dòng tiêu đề/dòng trống tự bị bỏ qua.

### 5.2. Nhập bằng dòng lệnh (khuyên dùng cho .xlsx)

```bash
eval "$(mise env)"
# 1) Xem trước — KHÔNG ghi gì, in từng dòng và trạng thái:
pnpm import:members "DANH SÁCH HBVL 26 - 27.xlsx"

# 2) Ghi vào cơ sở dữ liệu (chạy lại nhiều lần an toàn, không tạo trùng):
pnpm import:members "DANH SÁCH HBVL 26 - 27.xlsx" --commit

# 3) Thay toàn bộ danh sách hiện có bằng danh sách trong tệp:
pnpm import:members "DANH SÁCH HBVL 26 - 27.xlsx" --commit --replace
```

Bản đồ cập nhật ngay (bộ nhớ đệm công khai tự được làm mới); không cần khởi động lại.

Trạng thái từng dòng khi xem trước:

| Trạng thái | Ý nghĩa | Cách xử lý |
|---|---|---|
| `OK` | Nhận diện được tỉnh, sẽ được nhập | — |
| `ALREADY_EXISTS` | Đã có trong danh sách | Bỏ qua (bình thường khi chạy lại) |
| `UNKNOWN_PROVINCE` | Không nhận ra tên tỉnh | Sửa chính tả trong tệp, hoặc báo để thêm tên gọi tắt |
| `DUPLICATE_IN_FILE` | Trùng họ tên + tỉnh với dòng trên | Nếu thật sự là 2 người, thêm tay ở `/admin/hoc-vien` với "khác người" |
| `AMBIGUOUS_SAME_NAME` | Trùng tên với người ở tỉnh khác | Lệnh này **không tự nhập**; xác nhận ở màn hình admin |
| `INVALID` | Họ tên trống/quá dài | Sửa tệp |

**Quy ước tỉnh** (bản đồ tính theo 63 tỉnh cũ rồi gộp sang 34 đơn vị mới):

- `TP. THỦ ĐỨC`, `TP. HỒ CHÍ MINH`, `TPHCM`… → TP. Hồ Chí Minh.
- `ĐẮC LẮK`/`ĐẮK LẮK` → Đắk Lắk.
- Ghi chú dạng **`ĐẮC LẮK(phú yên cũ)`** → hiểu là quê quán gốc **Phú Yên** (nội dung trong ngoặc "… cũ" là tỉnh cần khớp).
- Học viên **không bao giờ được ghép với tài khoản đăng nhập theo tên** — hai thứ là hai thực thể tách biệt.

### 5.3. Nhập/sửa bằng giao diện admin

`/admin/hoc-vien` (đăng nhập admin có MFA): tải tệp **CSV UTF-8** (cột `name`, `province`) hoặc **JSON**, xem trước, rồi xác nhận.
Giao diện này **chưa đọc `.xlsx`** — với Excel hãy dùng lệnh ở 5.2 hoặc xuất sang CSV UTF-8 trước.
Đánh dấu **"Thay toàn bộ danh sách"** trước khi chọn tệp để tệp thay hẳn danh sách hiện có (giống `--replace`; có hộp xác nhận).

Quản lý danh sách (admin toàn quyền):

- **Lọc** theo tên, tỉnh (63 đơn vị), trạng thái (hoạt động/lưu trữ), hiển thị (hiện/ẩn).
- **Sửa** từng học viên: họ tên, quê quán, trạng thái, hiện/ẩn. Nếu đã có người cùng tên, hệ thống hỏi xác nhận "là người khác".
- **Xóa** vĩnh viễn (muốn giữ hồ sơ thì dùng "Lưu trữ").
- **Chọn nhiều** (hoặc "Chọn cả trang") để ẩn/hiện, lưu trữ/khôi phục, **chuyển sang tỉnh khác** hoặc xóa cùng lúc.
- **Xuất CSV** danh sách đang lọc (mở bằng Excel; nhập lại được ngay) — nên xuất để sao lưu trước khi thay toàn bộ.

Mọi thay đổi hiện ngay trên bản đồ và được ghi vào nhật ký (`/admin/nhat-ky`). Danh bạ tỉnh xác minh ở `/admin/danh-ba`.

---

## 6. Chạy kiểm thử

Test dùng **cơ sở dữ liệu, Redis DB, bucket và hộp thư riêng** (`hbvl_test`, Redis db 5, `hbvl-test`, Mailpit) nên **không đụng dữ liệu dev** của bạn.
Cần `pnpm infra:up` đang chạy.

| Lệnh | Kiểm tra gì | Thời gian |
|---|---|---|
| `pnpm lint && pnpm typecheck && pnpm format:check` | Chất lượng mã | ~1–2 phút |
| `pnpm test:unit` | Unit test | < 1 phút |
| `pnpm test:integration` | API trên Postgres/Redis/S3/Mailpit thật (~100 test) | vài phút |
| `pnpm test:e2e` | Trình duyệt thật (Playwright) trên bản build, kèm kiểm tra trợ năng | lâu nhất, vài chục phút |
| `pnpm test:smoke` | Build production + thăm dò HTTP | vài phút |

Chạy riêng một file: `cd tests && pnpm test:integration admin-map`.
Lần đầu chạy e2e, nếu thiếu trình duyệt: `cd tests && pnpm exec playwright install chromium firefox`.
Kết quả chi tiết và các hạng mục chưa chạy: `docs/TEST_REPORT.md`.

---

## 7. Dọn dữ liệu / làm lại từ đầu

| Muốn | Cách |
|---|---|
| Xóa **toàn bộ** (DB, Redis, ảnh) | `docker compose down -v`, rồi làm lại các bước 4–5 của file hướng dẫn 1 |
| Chỉ xóa vài tài khoản/bài | Dùng giao diện `/admin` (có ghi nhật ký) |
| Sao lưu trước khi xóa | `pnpm ops backup` (cần `pg_dump`) hoặc `docker exec <container-postgres> pg_dump -U postgres -Fc hbvl > hbvl.dump` |

Lưu ý: bảng `audit_logs` (nhật ký) và `review_events` (lịch sử duyệt bài) được cơ sở dữ liệu **chặn sửa/xóa** theo thiết kế.
`docker compose down -v` xóa được vì xóa cả ổ lưu trữ.

---

---

### Sửa và xóa bình luận

- Dưới bình luận của chính mình có nút **Sửa** và **Xóa**. Sửa xong, bình luận hiện chữ **"đã chỉnh sửa"**; ai cũng bấm vào đó để xem các bản trước khi sửa.
- Xóa: bình luận biến mất; nếu đã có người trả lời thì chỗ của nó hiện "Bình luận này đã bị xóa" để cuộc trò chuyện còn đọc được.
- CTV và admin có nút **Xóa** trên bình luận của người khác (CTV không xóa được bình luận của admin), nhưng **không ai sửa được lời của người khác**.
- Tối đa 20 lần sửa mỗi bình luận; bài đã khóa bình luận thì không sửa được nữa (vẫn xóa được).

## 8. Tố cáo bình luận, hạn chế và khóa thành viên

### 7.1. Thành viên tố cáo một bình luận

- Dưới mỗi bình luận có nút **Tố cáo** (cần đăng nhập và đã xác minh email; không tố cáo được bình luận của chính mình).
- Chọn lý do (spam, xúc phạm, thù ghét, thông tin sai lệch, khác) + ghi chú tuỳ chọn → **Gửi tố cáo**. Tố cáo hai lần cùng một bình luận là vô hại.
- Giới hạn chống lạm dụng: 5 tố cáo/phút và 40/ngày cho mỗi tài khoản.

### 7.2. Ai nhận và xử lý thế nào

1. **Mọi CTV và admin** nhận thông báo (chuông 🔔 ở console, mục *Thông báo* ở `/tai-khoan`). **CTV còn nhận email** kèm nội dung bình luận, lý do và liên kết tới hàng đợi tố cáo (admin chỉ nhận thông báo trong web). Một bình luận chỉ báo **một lần** dù có nhiều người tố cáo.
   Tố cáo về bình luận **của admin** chỉ báo cho admin.
2. Mở **Bình luận bị tố cáo** (`/cong-tac-vien/to-cao` hoặc `/admin/to-cao`):
   - **Nhận xử lý**: đánh dấu "tôi đang làm". Người khác thấy tên bạn; CTV khác không xử lý chen ngang được (admin được tiếp quản).
   - **Bỏ qua** (tố cáo sai) · **Gỡ bình luận** · **Gỡ + hạn chế** (chọn 1–90 ngày hoặc đến khi gỡ) · **Gỡ + khóa tài khoản**.
3. **Ai bấm trước thì người đó xử lý**: người bấm sau nhận thông báo "đã được người khác xử lý" kèm tên, không có thao tác nào bị áp dụng hai lần.
   Xử lý xong, thông báo chưa đọc của những người còn lại tự biến mất; tác giả bình luận được báo bình luận đã bị gỡ.
4. Tab **Đã xử lý** lưu lại ai làm, lúc nào, ghi chú gì. Mọi thao tác nằm trong **Nhật ký hệ thống**.

### 7.3. Hạn chế và khóa

| | Hạn chế | Khóa |
|---|---|---|
| Đăng nhập, đọc nội dung | ✔ | ✘ (bị đăng xuất mọi thiết bị) |
| Bình luận, thích, gửi bài, gửi ý kiến, liên hệ | ✘ | ✘ |
| Thời hạn | 1–365 ngày hoặc đến khi gỡ (hết hạn tự động) | đến khi mở khóa |
| Người bị áp dụng thấy | biểu ngữ ở `/tai-khoan` và dưới khung bình luận, kèm **lý do** | không đăng nhập được |

Làm thủ công ở `/cong-tac-vien/thanh-vien` (CTV) hoặc `/admin/nguoi-dung` (admin).

### 7.4. Ảnh đại diện

- Mọi tài khoản (admin, CTV, thành viên) tự tải ảnh ở **`/tai-khoan` → "Ảnh đại diện"**: JPEG/PNG/WebP tối đa 5 MB; hệ thống tự cắt vuông (ưu tiên vùng có khuôn mặt), xóa thông tin EXIF/GPS và tạo các cỡ 96/256/512 px. Có nút **Đổi ảnh** và **Gỡ ảnh**.
- Ảnh hiện **công khai** cạnh tên ở bình luận, thanh tài khoản trên đầu trang và danh sách người dùng trong trang quản lý. Ai chưa có ảnh thì hiện chữ cái đầu của tên.
- Giống bình luận: cần **đã xác minh email** và **không bị hạn chế** mới đặt/đổi ảnh được (gỡ ảnh thì luôn được).
- Ảnh không phù hợp: bấm **"Gỡ ảnh"** cạnh tài khoản ở `/cong-tac-vien/thanh-vien` (CTV — chỉ tài khoản thành viên) hoặc `/admin/nguoi-dung` (admin — mọi tài khoản), nhập lý do. Người dùng nhận thông báo kèm lý do; thao tác ghi vào nhật ký.
- Ảnh cũ bị xóa khỏi kho lưu trữ mỗi khi đổi/gỡ ảnh, và khi admin "Xóa (ẩn danh)" tài khoản.

---

## 9. Thông báo, email cho CTV và đặt lại mật khẩu

### Thông báo
- Chuông 🔔 ở console (admin/CTV) **chỉ hiện thông báo chưa đọc**; đọc xong thì hết hiện. Mở thông báo là coi như đã đọc; có nút "Đánh dấu đã đọc" cho tất cả.
- **Ý kiến thành viên gửi lên**: mọi CTV và admin đang hoạt động nhận thông báo trong web (không gửi email). Bấm vào thông báo → mở thẳng ý kiến đó (`/cong-tac-vien/gop-y?open=…`). Ai đã mở thì thông báo của người đó mất; của người khác vẫn còn tới khi họ đọc.
- **Bình luận bị tố cáo**: mọi CTV nhận **email** (một lần cho mỗi bình luận, dù có nhiều người tố cáo) và thông báo trong web; admin chỉ nhận thông báo trong web. Tố cáo về bình luận của admin không gửi cho CTV.
- **Thành viên gửi bài duyệt**: mọi CTV nhận **email** (kèm liên kết tới *Hàng chờ duyệt*) và thông báo trong web; admin chỉ nhận thông báo trong web. Cần worker đang chạy (`dev:worker`) để email được gửi.

### Admin đặt lại mật khẩu (về `123456789`)
1. `/admin/nguoi-dung` → dòng của người cần đặt lại → **Đặt lại mật khẩu** → xác nhận.
2. Mật khẩu của họ thành **`123456789`**, họ bị đăng xuất khỏi mọi thiết bị. Hãy **báo mật khẩu tạm thời cho họ qua kênh riêng** (hệ thống chỉ gửi email báo "đã được đặt lại", không kèm mật khẩu).
3. Lần đăng nhập kế tiếp họ chỉ thấy màn hình **đổi mật khẩu** (nhập `123456789` làm mật khẩu hiện tại), đổi xong mới dùng được website.
4. Không áp dụng cho tài khoản **quản trị viên**, cho chính bạn, hay tài khoản chưa kích hoạt (dùng "Gửi lại kích hoạt").

---

## 9b. Quên mật khẩu hoặc mất thiết bị xác thực 2 lớp

| Ai | Quên mật khẩu | Mất thiết bị xác thực (điện thoại) |
|---|---|---|
| **CTV / thành viên** | `/quen-mat-khau` → mã 6 số qua email | Đăng nhập bằng mật khẩu → ở bước nhập mã bấm **"Mất thiết bị xác thực?"** → **Gửi mã xác nhận về email** → nhập mã (+ lời nhắn) → yêu cầu gửi tới admin. Admin nhận thông báo + email, xử lý ở **`/admin/yeu-cau-xac-thuc`** (Gỡ / Từ chối kèm lý do). Người yêu cầu nhận email kết quả; được gỡ thì đăng nhập lại chỉ bằng mật khẩu và nên bật lại 2 lớp |
| **Admin** | Ở trang đăng nhập quản trị bấm **"Quên mật khẩu?"** → nhận **liên kết** (không có mã) | Đăng nhập bằng mật khẩu → **"Mất thiết bị xác thực?"** → **Gửi liên kết gỡ xác thực về email** → mở thư, bấm liên kết, bấm **Gỡ xác thực 2 lớp** → đăng nhập lại, vào `/tai-khoan` **bật lại** (khu quản trị khóa tới khi bật) |

- Còn mã khôi phục thì cứ nhập mã khôi phục ở ô mã xác thực — nhanh nhất.
- Quên **cả hai** (mật khẩu và thiết bị): đặt lại mật khẩu trước, rồi làm bước "Mất thiết bị xác thực".
- Email admin hiện tại: **duchoanganhhung@gmail.com**. Ai chiếm được hộp thư này *và* biết mật khẩu admin thì gỡ được 2 lớp — hãy bật xác thực 2 lớp cho chính tài khoản Gmail đó.
- Admin trước khi bấm **Gỡ** cho người khác nên gọi điện / gặp trực tiếp để chắc là đúng người.

## 10. Tiếng Nhật và chọn ngôn ngữ

- Ba ngôn ngữ: **Tiếng Việt** (mặc định, địa chỉ không tiền tố), **English** (`/en/...`), **日本語** (`/ja/...`).
- **Lần đầu mở web** (chưa có cookie `hbvl_lang`) sẽ hiện hộp *Chọn ngôn ngữ*. Chọn xong, lựa chọn được nhớ 1 năm; đóng hộp thì giữ ngôn ngữ của trang đang xem.
- **Đổi bất kỳ lúc nào** bằng nút `VI | EN | JA` ở đầu trang (giữ nguyên trang đang xem). Có thể lưu ngôn ngữ ưa thích trong `/tai-khoan`.
- Chuỗi giao diện tiếng Nhật nằm ở **`apps/web/src/lib/ja.ts`**, khoá là câu tiếng Việt gốc. Câu chưa có bản dịch sẽ hiện tiếng Anh (không bao giờ để trống).
  Thêm chuỗi mới ở code: `t('Tiếng Việt', 'English', '日本語')` — tham số thứ ba là tiếng Nhật (có thể bỏ nếu đã có trong `ja.ts`).
- Nội dung: tên chuyên mục tiếng Nhật được nạp bởi `pnpm db:seed` (không ghi đè chỗ admin đã sửa). Bài viết cần bản dịch riêng:
  admin gọi `PUT /api/v1/admin/posts/:id/translations/ja`; chưa có bản dịch thì trang hiện bản tiếng Việt kèm thông báo.
- Trợ lý AI trả lời bằng tiếng Nhật khi người dùng đang ở `/ja` (nội dung nguồn vẫn là tiếng Việt, Gemini dịch khi trả lời).
- Khu vực quản trị (`/admin`, `/cong-tac-vien`) chỉ có tiếng Việt.

---

## 11. Bảng nhanh: việc cần làm → ở đâu

| Việc | Ở đâu |
|---|---|
| Xem email dev đã gửi | http://localhost:58025 |
| Bật MFA / đổi mật khẩu | `/tai-khoan` |
| Mời CTV, khóa/mở tài khoản | `/admin/nguoi-dung` |
| Duyệt, đăng bài | `/admin/bai-viet` hoặc `/cong-tac-vien` |
| Học viên & bản đồ | `/admin/hoc-vien` · lệnh `pnpm import:members` |
| Tin nhắn liên hệ / góp ý | `/admin/lien-he` · `/admin/gop-y` |
| Cài đặt site (tên, liên hệ, mạng xã hội) | `/admin/cai-dat` |
| Nhật ký thao tác | `/admin/nhat-ky` |
| Khóa/biến cấu hình | file `.env` (mẫu: `.env.example`) |
