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

/** Administrators recover by link only (no code): the link is long and unguessable, a 6-digit code is not. */
export function adminResetPasswordMail(name: string, link: string) {
  return {
    subject: 'Đặt lại mật khẩu quản trị — Học Bổng Vươn Lên',
    text: `Xin chào ${name},\n\nCó yêu cầu đặt lại mật khẩu cho tài khoản quản trị của bạn. Mở liên kết sau để đặt mật khẩu mới (hiệu lực 60 phút, dùng một lần):\n${link}\n\nNếu bạn không yêu cầu, hãy bỏ qua thư này — mật khẩu hiện tại vẫn giữ nguyên. Không chuyển tiếp thư này cho bất kỳ ai.\n\n${BRAND}`,
    html: wrapHtml(
      'Đặt lại mật khẩu quản trị',
      `<p>Xin chào ${esc(name)},</p><p>Có yêu cầu đặt lại mật khẩu cho tài khoản quản trị của bạn.</p><p><a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Đặt mật khẩu mới</a></p><p>Liên kết có hiệu lực 60 phút và chỉ dùng được một lần.</p><p style="color:#64748b">Nếu bạn không yêu cầu, hãy bỏ qua thư này — mật khẩu hiện tại vẫn giữ nguyên. Không chuyển tiếp thư này cho bất kỳ ai.</p>`,
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

/** Sent to every collaborator when a comment is reported (once per comment: further reports join the same open item). */
export function commentReportedMail(p: { name: string; reason: string; comment: string; postTitle: string; link: string }) {
  return {
    subject: `Bình luận bị tố cáo: ${p.reason} — bài "${p.postTitle}"`,
    text: `Xin chào ${p.name},\n\nMột bình luận trong bài "${p.postTitle}" vừa bị tố cáo (${p.reason}):\n\n"${p.comment}"\n\nXử lý tại: ${p.link}\n\nAi xử lý trước thì tố cáo thuộc người đó; nếu đã có người nhận, bạn sẽ thấy tên họ trong hàng đợi.\n\n${BRAND}`,
    html: wrapHtml(
      'Có bình luận bị tố cáo',
      `<p>Xin chào ${esc(p.name)},</p><p>Một bình luận trong bài <b>${esc(p.postTitle)}</b> vừa bị tố cáo: <b>${esc(p.reason)}</b>.</p><blockquote style="border-left:3px solid #dc2626;margin:12px 0;padding:4px 12px;white-space:pre-wrap">${esc(p.comment)}</blockquote><p><a href="${esc(p.link)}">Mở hàng đợi tố cáo</a></p><p style="color:#64748b">Ai xử lý trước thì tố cáo thuộc người đó; nếu đã có người nhận, bạn sẽ thấy tên họ trong hàng đợi.</p>`,
    ),
  };
}

// ───────────────────────── lost authenticator (two-factor) ─────────────────────────
const btn = (link: string, label: string) =>
  `<p><a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">${esc(label)}</a></p>`;

/** Step 1 for a collaborator/member: prove the mailbox before a request reaches the administrators. */
export function mfaRecoveryCodeMail(name: string, code: string) {
  return {
    subject: `Mã xác nhận yêu cầu gỡ xác thực 2 lớp: ${code}`,
    text: `Xin chào ${name},\n\nMã xác nhận để gửi yêu cầu gỡ xác thực 2 lớp tới quản trị viên: ${code}\n(hiệu lực 30 phút, tối đa 5 lần nhập)\n\nNếu không phải bạn, ai đó đã biết mật khẩu của bạn: hãy đổi mật khẩu ngay và báo cho quản trị viên.\n\n${BRAND}`,
    html: wrapHtml(
      'Xác nhận yêu cầu gỡ xác thực 2 lớp',
      `<p>Xin chào ${esc(name)},</p><p>Mã xác nhận để gửi yêu cầu gỡ xác thực 2 lớp tới quản trị viên:</p>${codeHtml(code)}<p>Hiệu lực 30 phút, tối đa 5 lần nhập.</p><p style="color:#b91c1c">Nếu không phải bạn, ai đó đã biết mật khẩu của bạn: hãy đổi mật khẩu ngay và báo cho quản trị viên.</p>`,
    ),
  };
}

export function mfaRequestReceivedMail(name: string) {
  return {
    subject: 'Đã gửi yêu cầu gỡ xác thực 2 lớp tới quản trị viên',
    text: `Xin chào ${name},\n\nYêu cầu gỡ xác thực 2 lớp của bạn đã được gửi tới quản trị viên. Bạn sẽ nhận email khi yêu cầu được xử lý.\n\nNếu không phải bạn gửi, hãy đổi mật khẩu ngay và báo cho quản trị viên.\n\n${BRAND}`,
    html: wrapHtml(
      'Đã gửi yêu cầu',
      `<p>Xin chào ${esc(name)},</p><p>Yêu cầu gỡ xác thực 2 lớp của bạn đã được gửi tới quản trị viên. Bạn sẽ nhận email khi yêu cầu được xử lý.</p><p style="color:#b91c1c">Nếu không phải bạn gửi, hãy đổi mật khẩu ngay và báo cho quản trị viên.</p>`,
    ),
  };
}

/** To every administrator. Contains no secret: the decision is taken in the admin area. */
export function mfaRequestAdminMail(p: { adminName: string; who: string; username: string; role: string; note?: string | null; link: string }) {
  return {
    subject: `Yêu cầu gỡ xác thực 2 lớp: ${p.who} (${p.role})`,
    text: `Xin chào ${p.adminName},\n\n${p.who} (${p.username}, ${p.role}) báo mất thiết bị xác thực và yêu cầu gỡ xác thực 2 lớp. Người này đã đăng nhập đúng mật khẩu và xác nhận qua mã gửi tới email tài khoản.${p.note ? `\n\nLời nhắn: ${p.note}` : ''}\n\nXem và xử lý: ${p.link}\n\nHãy xác minh người yêu cầu qua một kênh khác (điện thoại, gặp trực tiếp) trước khi đồng ý.\n\n${BRAND}`,
    html: wrapHtml(
      'Yêu cầu gỡ xác thực 2 lớp',
      `<p>Xin chào ${esc(p.adminName)},</p><p><b>${esc(p.who)}</b> (${esc(p.username)}, ${esc(p.role)}) báo mất thiết bị xác thực và yêu cầu gỡ xác thực 2 lớp. Người này đã đăng nhập đúng mật khẩu và xác nhận qua mã gửi tới email tài khoản.</p>${p.note ? `<blockquote style="border-left:3px solid #f59e0b;margin:12px 0;padding:4px 12px;white-space:pre-wrap">${esc(p.note)}</blockquote>` : ''}${btn(p.link, 'Xem và xử lý')}<p style="color:#64748b">Hãy xác minh người yêu cầu qua một kênh khác (điện thoại, gặp trực tiếp) trước khi đồng ý.</p>`,
    ),
  };
}

export function mfaRequestDecisionMail(p: { name: string; approved: boolean; note?: string | null; link: string }) {
  const title = p.approved ? 'Đã gỡ xác thực 2 lớp cho tài khoản của bạn' : 'Yêu cầu gỡ xác thực 2 lớp bị từ chối';
  const body = p.approved
    ? 'Quản trị viên đã gỡ xác thực 2 lớp. Bạn đăng nhập lại bằng mật khẩu như bình thường; nên bật lại xác thực 2 lớp với thiết bị mới trong trang Tài khoản.'
    : 'Quản trị viên chưa đồng ý gỡ xác thực 2 lớp cho tài khoản của bạn.';
  return {
    subject: `${title} — Học Bổng Vươn Lên`,
    text: `Xin chào ${p.name},\n\n${body}${p.note ? `\n\nGhi chú của quản trị viên: ${p.note}` : ''}\n\nĐăng nhập: ${p.link}\n\n${BRAND}`,
    html: wrapHtml(
      title,
      `<p>Xin chào ${esc(p.name)},</p><p>${esc(body)}</p>${p.note ? `<blockquote style="border-left:3px solid #64748b;margin:12px 0;padding:4px 12px;white-space:pre-wrap">${esc(p.note)}</blockquote>` : ''}${btn(p.link, 'Đăng nhập')}`,
    ),
  };
}

/** Administrators only: a one-time link that removes two-factor authentication (after a correct password). */
export function adminMfaResetMail(name: string, link: string) {
  return {
    subject: 'Liên kết gỡ xác thực 2 lớp cho tài khoản quản trị',
    text: `Xin chào ${name},\n\nBạn vừa đăng nhập đúng mật khẩu và yêu cầu gỡ xác thực 2 lớp vì mất thiết bị. Mở liên kết sau để gỡ (hiệu lực 30 phút, dùng một lần):\n${link}\n\nSau khi gỡ, đăng nhập lại và bật xác thực 2 lớp với thiết bị mới — khu quản trị bị khóa cho tới khi bạn bật lại.\n\nNẾU KHÔNG PHẢI BẠN: ai đó đã biết mật khẩu quản trị. Đừng mở liên kết; hãy đổi mật khẩu ngay.\n\n${BRAND}`,
    html: wrapHtml(
      'Gỡ xác thực 2 lớp',
      `<p>Xin chào ${esc(name)},</p><p>Bạn vừa đăng nhập đúng mật khẩu và yêu cầu gỡ xác thực 2 lớp vì mất thiết bị.</p>${btn(link, 'Gỡ xác thực 2 lớp')}<p>Liên kết có hiệu lực 30 phút và chỉ dùng được một lần. Sau khi gỡ, đăng nhập lại và bật xác thực 2 lớp với thiết bị mới — khu quản trị bị khóa cho tới khi bạn bật lại.</p><p style="color:#b91c1c"><b>Nếu không phải bạn:</b> ai đó đã biết mật khẩu quản trị. Đừng mở liên kết; hãy đổi mật khẩu ngay.</p>`,
    ),
  };
}

export function mfaRemovedMail(name: string, link: string) {
  return {
    subject: 'Xác thực 2 lớp đã được gỡ khỏi tài khoản của bạn',
    text: `Xin chào ${name},\n\nXác thực 2 lớp vừa được gỡ khỏi tài khoản của bạn và mọi phiên đăng nhập đã bị đăng xuất. Hãy đăng nhập và bật lại xác thực 2 lớp với thiết bị mới.\n\nĐăng nhập: ${link}\n\nNếu không phải bạn, hãy đổi mật khẩu ngay.\n\n${BRAND}`,
    html: wrapHtml(
      'Đã gỡ xác thực 2 lớp',
      `<p>Xin chào ${esc(name)},</p><p>Xác thực 2 lớp vừa được gỡ khỏi tài khoản của bạn và mọi phiên đăng nhập đã bị đăng xuất. Hãy đăng nhập và bật lại xác thực 2 lớp với thiết bị mới.</p>${btn(link, 'Đăng nhập')}<p style="color:#b91c1c">Nếu không phải bạn, hãy đổi mật khẩu ngay.</p>`,
    ),
  };
}
