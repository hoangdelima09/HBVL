/** Plain, accessible transactional e-mails (Vietnamese; the UI locale of the user is applied when known). */
const BRAND = 'Học Bổng Vươn Lên — Quỹ Khuyến Học Đông Du';

const wrapHtml = (title: string, bodyHtml: string) =>
  `<!doctype html><html lang="vi"><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.6;max-width:560px;margin:0 auto;padding:16px">` +
  `<h2 style="color:#1d4ed8;margin:0 0 12px">${title}</h2>${bodyHtml}<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"><p style="color:#64748b;font-size:12px">${BRAND}</p></body></html>`;

/** Big, copy-friendly code block shared by all code e-mails. */
const codeHtml = (code: string) =>
  `<p style="margin:16px 0"><span style="display:inline-block;font:700 28px/1.2 'Courier New',monospace;letter-spacing:8px;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;border-radius:8px;padding:12px 18px">${code}</span></p>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function verifyEmailMail(name: string, link: string, code: string) {
  return {
    subject: `Mã xác minh email: ${code} — Học Bổng Vươn Lên`,
    text: `Xin chào ${name},\n\nMã xác minh email của bạn là: ${code}\nNhập mã này vào trang tài khoản (hiệu lực 48 giờ, tối đa 5 lần nhập).\n\nHoặc mở liên kết:\n${link}\n\nNếu bạn không đăng ký, hãy bỏ qua thư này. Không chia sẻ mã cho bất kỳ ai.\n\n${BRAND}`,
    html: wrapHtml(
      'Xác minh email',
      `<p>Xin chào ${esc(name)},</p><p>Mã xác minh email của bạn:</p>${codeHtml(code)}<p>Nhập mã này vào trang tài khoản (hiệu lực 48 giờ, tối đa 5 lần nhập). Hoặc <a href="${esc(link)}">bấm vào đây để xác minh</a>.</p><p style="color:#64748b">Nếu bạn không đăng ký, hãy bỏ qua thư này. Không chia sẻ mã cho bất kỳ ai.</p>`,
    ),
  };
}

export function resetPasswordMail(name: string, link: string, activation: boolean, code: string) {
  const title = activation ? 'Kích hoạt tài khoản' : 'Đặt lại mật khẩu';
  const hours = activation ? '7 ngày' : '60 phút';
  const action = activation ? 'kích hoạt tài khoản và đặt mật khẩu' : 'đặt lại mật khẩu';
  return {
    subject: `${title}: mã ${code} — Học Bổng Vươn Lên`,
    text: `Xin chào ${name},\n\nMã để ${action}: ${code}\nNhập mã cùng email của bạn tại trang "Quên mật khẩu" (hiệu lực ${hours}, dùng một lần, tối đa 5 lần nhập).\n\nHoặc mở liên kết:\n${link}\n\nNếu bạn không yêu cầu, hãy bỏ qua thư này. Không chia sẻ mã cho bất kỳ ai.\n\n${BRAND}`,
    html: wrapHtml(
      title,
      `<p>Xin chào ${esc(name)},</p><p>Mã để ${action}:</p>${codeHtml(code)}<p>Nhập mã cùng email của bạn tại trang “Quên mật khẩu” (hiệu lực ${hours}, dùng một lần, tối đa 5 lần nhập). Hoặc <a href="${esc(link)}">bấm vào đây</a>.</p><p style="color:#64748b">Nếu bạn không yêu cầu, hãy bỏ qua thư này. Không chia sẻ mã cho bất kỳ ai.</p>`,
    ),
  };
}

export function contactNotifyMail(p: { receiptCode: string; name: string; email: string; subject: string; message: string }) {
  return {
    subject: `[Liên hệ ${p.receiptCode}] ${p.subject}`,
    text: `Mã tiếp nhận: ${p.receiptCode}\nHọ tên: ${p.name}\nEmail: ${p.email}\n\n${p.message}`,
    html: wrapHtml(
      `Liên hệ mới ${esc(p.receiptCode)}`,
      `<p><b>Họ tên:</b> ${esc(p.name)}<br><b>Email:</b> ${esc(p.email)}</p><p style="white-space:pre-wrap">${esc(p.message)}</p>`,
    ),
  };
}

export function postStatusMail(p: { name: string; title: string; status: 'CHANGES_REQUESTED' | 'REJECTED' | 'PUBLISHED' | 'PENDING_REVIEW'; reason?: string; link: string }) {
  const label = { CHANGES_REQUESTED: 'cần chỉnh sửa', REJECTED: 'không được duyệt', PUBLISHED: 'đã được xuất bản', PENDING_REVIEW: 'đã được gửi duyệt' }[p.status];
  return {
    subject: `Bài viết "${p.title}" ${label}`,
    text: `Xin chào ${p.name},\n\nBài viết "${p.title}" ${label}.${p.reason ? `\n\nLý do / phản hồi:\n${p.reason}` : ''}\n\nXem tại: ${p.link}\n\n${BRAND}`,
    html: wrapHtml(
      'Cập nhật bài viết',
      `<p>Xin chào ${esc(p.name)},</p><p>Bài viết <b>${esc(p.title)}</b> ${label}.</p>${p.reason ? `<blockquote style="border-left:3px solid #f59e0b;margin:12px 0;padding:4px 12px;white-space:pre-wrap">${esc(p.reason)}</blockquote>` : ''}<p><a href="${esc(p.link)}">Xem bài viết</a></p>`,
    ),
  };
}

/** Sent to every collaborator when a post is submitted for review. */
export function postSubmittedMail(p: { name: string; title: string; author: string; link: string }) {
  return {
    subject: `Bài mới chờ duyệt: "${p.title}"`,
    text: `Xin chào ${p.name},\n\n${p.author} vừa gửi bài "${p.title}" chờ duyệt.\n\nMở hàng chờ duyệt: ${p.link}\n\nBài này cũng có trong chuông thông báo khi bạn đăng nhập. Người nào xử lý trước thì bài thuộc người đó.\n\n${BRAND}`,
    html: wrapHtml(
      'Có bài mới chờ duyệt',
      `<p>Xin chào ${esc(p.name)},</p><p><b>${esc(p.author)}</b> vừa gửi bài <b>${esc(p.title)}</b> chờ duyệt.</p><p><a href="${esc(p.link)}">Mở hàng chờ duyệt</a></p><p style="color:#64748b">Bài này cũng có trong chuông thông báo khi bạn đăng nhập.</p>`,
    ),
  };
}

/** Told to the account owner when an administrator resets the password. The new password is never e-mailed. */
export function passwordResetByAdminMail(p: { name: string; link: string }) {
  return {
    subject: 'Mật khẩu của bạn đã được quản trị viên đặt lại',
    text: `Xin chào ${p.name},\n\nQuản trị viên vừa đặt lại mật khẩu tài khoản của bạn. Hãy liên hệ quản trị viên để biết mật khẩu tạm thời, đăng nhập và đổi sang mật khẩu mới ngay.\n\nĐăng nhập: ${p.link}\n\nNếu bạn không nhờ đặt lại mật khẩu, hãy báo cho quản trị viên.\n\n${BRAND}`,
    html: wrapHtml(
      'Mật khẩu đã được đặt lại',
      `<p>Xin chào ${esc(p.name)},</p><p>Quản trị viên vừa đặt lại mật khẩu tài khoản của bạn. Hãy liên hệ quản trị viên để biết mật khẩu tạm thời, đăng nhập và <b>đổi sang mật khẩu mới ngay</b>.</p><p><a href="${esc(p.link)}">Đăng nhập</a></p><p style="color:#64748b">Nếu bạn không nhờ đặt lại mật khẩu, hãy báo cho quản trị viên.</p>`,
    ),
  };
}
