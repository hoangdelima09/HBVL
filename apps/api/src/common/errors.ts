import { HttpException } from '@nestjs/common';

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'FORBIDDEN_ACTION'
  | 'ACCOUNT_RESTRICTED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'STATE_LOCKED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'REQUEST_IN_PROGRESS'
  | 'RATE_LIMITED'
  | 'CSRF'
  | 'EMAIL_NOT_VERIFIED'
  | 'MFA_REQUIRED'
  | 'MFA_ENROLL_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'REGISTRATION_FAILED'
  | 'TOKEN_INVALID'
  | 'CODE_INVALID'
  | 'CAPTCHA_REQUIRED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA'
  | 'INTERNAL';

export class AppError extends HttpException {
  constructor(
    status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const E = {
  validation: (details: unknown, message = 'Dữ liệu không hợp lệ.') => new AppError(400, 'VALIDATION', message, details),
  unauthenticated: (message = 'Bạn cần đăng nhập.') => new AppError(401, 'UNAUTHENTICATED', message),
  forbidden: (message = 'Bạn không có quyền thực hiện thao tác này.', code: ErrorCode = 'FORBIDDEN') => new AppError(403, code, message),
  locked: (message = 'Bài viết đang bị khóa ở trạng thái hiện tại.') => new AppError(403, 'STATE_LOCKED', message),
  notFound: (message = 'Không tìm thấy.') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message: string, code: ErrorCode = 'CONFLICT', details?: unknown) => new AppError(409, code, message, details),
  versionConflict: (currentVersion: number) => new AppError(409, 'VERSION_CONFLICT', 'Nội dung đã được người khác cập nhật. Hãy tải lại phiên bản mới nhất.', { currentVersion }),
  idempotencyReused: () => new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã được dùng với nội dung khác.'),
  rateLimited: (retryAfterSeconds: number) => new AppError(429, 'RATE_LIMITED', 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.', { retryAfterSeconds }),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Thông tin đăng nhập hoặc cổng truy cập không đúng.'),
  accountLocked: (retryAfterSeconds: number) => new AppError(429, 'ACCOUNT_LOCKED', 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau.', { retryAfterSeconds }),
  tokenInvalid: () => new AppError(400, 'TOKEN_INVALID', 'Liên kết không hợp lệ hoặc đã hết hạn.'),
  /** The client must solve the CAPTCHA (site key in `details`) and send again; `failed`: a token was sent but did not verify. */
  captchaRequired: (siteKey: string, failed: boolean) =>
    new AppError(
      400,
      'CAPTCHA_REQUIRED',
      failed ? 'Xác minh không thành công. Vui lòng xác minh lại rồi gửi.' : 'Bạn đã nhập sai nhiều lần. Vui lòng xác minh bạn không phải robot rồi gửi lại.',
      { captcha: 'turnstile', siteKey },
    ),
  codeInvalid: () => new AppError(400, 'CODE_INVALID', 'Mã không đúng hoặc đã hết hạn. Vui lòng kiểm tra lại hoặc yêu cầu mã mới.'),
  csrf: () => new AppError(403, 'CSRF', 'Yêu cầu không hợp lệ (CSRF).'),
};
