# Ghi chú khảo sát HBVL để soạn prompt

Ngày khảo sát: 2026-10-10. Đây là khảo sát mã nguồn và dữ liệu local phục vụ viết prompt, chưa phải kết quả triển khai ứng dụng mới.

## Đã đọc/đối chiếu

- `HBVL/RiseUp/README.md`, các tài liệu submissions/contact/site audit/development/translation/plan/checklist/province-data-sources/stitch-redesign-reference.
- Theme `charity-hcm`: functions, access-control, submissions, contact; các phần liên quan của auth, category, homepage, province detail, single và card templates; token CSS và mã bản đồ.
- Các test cũ về site/feedback/contact/submission/comment/map để trích xuất acceptance criteria.
- Cấu trúc SQL export và bảng dữ liệu; schema JSON bản đồ/học viên/danh bạ; cấu trúc source workbook/build script, không đưa dữ liệu cá nhân vào báo cáo.
- Đã xem ảnh `docs/screenshots/qa-redesign-1440.png`. Ảnh này là tham chiếu tĩnh; không khẳng định nó giống hoàn toàn source hiện tại.

## Phát hiện chính

| Mục | Quan sát |
|---|---|
| Source root | `HBVL/RiseUp/` |
| Theme version trong code | `2.3.9`; README còn ghi `2.2.0` |
| Nội dung | 5 chuyên mục chính, 12 mục con; có post/page/event/program |
| Tài khoản | administrator, riseup_collaborator, riseup_member; subscriber được xem là member |
| Gửi bài | Form nội bộ; draft/pending/changes/rejected/published; không còn dùng Drive làm luồng chính |
| CTV | Biên tập bài chờ duyệt, yêu cầu sửa; không publish/reject cuối cùng/sửa bài published/xóa bài người khác |
| Góp ý | Admin và CTV có quyền inbox |
| Liên hệ | Chỉ admin có quyền inbox; lưu DB trước khi gửi email |
| Bình luận | Cần login, auto-approve role website nhưng giữ spam/trash; CTV không sửa comment admin |
| Like | Cần login; code cũ lưu trạng thái theo cookie và tổng postmeta |
| Bản đồ | 34/63 chế độ, 17 nhãn đảo/quần đảo, JSON nguồn local |
| Học viên map snapshot | 31 record với name/oldProvince/currentProvince |
| Danh bạ tỉnh | 63 entry, nguồn riêng với member/contact cần đối chiếu |
| SQL | 12 bảng WordPress chuẩn trong DDL; chưa restore để đối soát record đầy đủ |
| Media uploads local | 6 file; ảnh theme nằm riêng trong assets |
| Test cũ | Một số hardcode đường dẫn Windows/XAMPP; cần port test hành vi |
| Working tree nguồn | Có nhiều thay đổi; không chỉnh sửa hoặc reset |

## Kiểm tra đã thực chạy

```bash
python HBVL/RiseUp/scripts/validate_hbvl_map.py
```

Kết quả:

```text
PASS: 34 current, 63 historical, 31 unique members, 0 unmatched; totals equal; zero states safe (Quảng Trị, Quảng Trị).
```

Đây chỉ là validator dữ liệu bản đồ của project cũ. Chưa chạy PHP integration/browser E2E của WordPress, chưa khởi động website cũ, chưa thực hiện migration PostgreSQL hoặc test ứng dụng mới.

## Cách dùng prompt

Mở Claude Code ở `PROJECTHBVL` và gửi:

```text
Đọc toàn bộ HBVLFINAL/CLAUDE_IMPLEMENTATION_PROMPT.md, sau đó thực hiện đầy đủ yêu cầu trong đó. Source gốc ở HBVL/RiseUp. Hãy bắt đầu bằng audit mã và dữ liệu, rồi viết ứng dụng mới ngay trong HBVLFINAL, chạy test và sửa lỗi đến khi đạt tiêu chí bàn giao. Giữ nguyên project nguồn và tài liệu prompt hiện có. Cập nhật docs/PROGRESS.md để tiếp tục qua nhiều phiên; báo đúng những test đã thực chạy, không tuyên bố hoàn thành khi chỉ có scaffold hoặc giao diện giả.
```

## Lựa chọn kỹ thuật

Đề xuất Next.js + NestJS trên Node.js, viết bằng TypeScript; PostgreSQL + Prisma; Redis và S3-compatible storage. Đây là lựa chọn kiến trúc cho dữ liệu quan hệ và luồng phân quyền của HBVL, không phải kết quả benchmark.

Đã tra tài liệu chính thức về Node.js LTS, NestJS auth/authorization/throttling, Next.js self-hosting, Prisma connection pooling và PostgreSQL backup. Liên kết nằm cuối prompt. Trang GitHub được thử mở nhưng trình duyệt công cụ báo `Cache miss`; khảo sát nghiệp vụ dựa trên nguồn local đã có, không tuyên bố đã kiểm tra remote main.
