import { z } from 'zod';
import { LIMITS, LOCALES } from './limits';
import { hasForbiddenControlChars } from './text';

const noControl = (v: string) => !hasForbiddenControlChars(v);
const plain = (min: number, max: number) => z.string().trim().min(min).max(max).refine(noControl, 'Invalid characters');
/** Multi-line text: trims outer whitespace, keeps inner newlines and backslashes verbatim. */
const longText = (max: number) => z.string().trim().min(1).max(max).refine(noControl, 'Invalid characters');

export const usernameSchema = z
  .string()
  .trim()
  .min(LIMITS.usernameMin)
  .max(LIMITS.usernameMax)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u, 'Letters, digits, dot, underscore, hyphen only');

export const emailSchema = z.string().trim().max(LIMITS.contactEmailMax).pipe(z.email());

export const passwordSchema = z.string().min(LIMITS.passwordMin, `At least ${LIMITS.passwordMin} characters`).max(LIMITS.passwordMax);

export const registerSchema = z
  .strictObject({
    displayName: plain(1, LIMITS.displayNameMax),
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string().max(LIMITS.passwordMax),
    website: z.string().max(200).optional(), // honeypot
  })
  .refine((v) => v.password === v.passwordConfirm, { path: ['passwordConfirm'], message: 'Passwords do not match' });

export const loginSchema = z.strictObject({
  portal: z.enum(['ADMIN', 'COLLABORATOR', 'MEMBER']),
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(LIMITS.passwordMax),
  rememberMe: z.boolean().optional().default(false),
  returnTo: z.string().max(500).optional(),
});

export const mfaVerifySchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^(\d{6}|[A-Za-z0-9-]{8,20})$/),
});

export const forgotPasswordSchema = z.strictObject({ email: emailSchema });
export const resetPasswordSchema = z.strictObject({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export const verifyEmailSchema = z.strictObject({ token: z.string().min(20).max(200) });
/** 6-digit code e-mailed next to the link. */
export const emailCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Mã gồm 6 chữ số.');
export const verifyEmailCodeSchema = z.strictObject({ code: emailCodeSchema });
export const resetPasswordCodeSchema = z.strictObject({ email: emailSchema, code: emailCodeSchema, password: passwordSchema });
export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(LIMITS.passwordMax),
  newPassword: passwordSchema,
});
export const updateProfileSchema = z.strictObject({
  displayName: plain(1, LIMITS.displayNameMax).optional(),
  bio: z.string().trim().max(500).optional(),
  locale: z.enum(LOCALES).optional(),
});

// ───── posts ─────
export const submissionIntentSchema = z.enum(['draft', 'submit']);

/** Create/update a submission. Drafts may be incomplete; `submit` is validated stricter in the service. */
export const postDraftSchema = z.strictObject({
  title: plain(1, LIMITS.postTitleMax),
  categoryId: z.uuid(),
  contentHtml: z
    .string()
    .max(LIMITS.postContentMax * 4)
    .default(''), // markup is longer than visible text; visible-length rule is applied after sanitising
  featuredAssetId: z.uuid().nullable().optional(),
});
export type PostDraftInput = z.infer<typeof postDraftSchema>;

export const reasonSchema = z.strictObject({ reason: longText(LIMITS.reasonMax) });

export const staffEditSchema = z.strictObject({
  title: plain(1, LIMITS.postTitleMax).optional(),
  categoryId: z.uuid().optional(),
  contentHtml: z
    .string()
    .max(LIMITS.postContentMax * 4)
    .optional(),
  featuredAssetId: z.uuid().nullable().optional(),
});

// ───── inboxes ─────
export const feedbackSchema = z.strictObject({
  subject: plain(1, LIMITS.feedbackSubjectMax),
  message: longText(LIMITS.feedbackMessageMax),
  website: z.string().max(200).optional(), // honeypot
});

export const contactSchema = z.strictObject({
  name: plain(1, LIMITS.contactNameMax),
  email: emailSchema,
  subject: z.string().trim().max(LIMITS.contactSubjectMax).refine(noControl).optional().default(''),
  message: longText(LIMITS.contactMessageMax),
});

export const commentSchema = z.strictObject({
  body: longText(LIMITS.commentMax),
  parentId: z.uuid().nullable().optional(),
});

export const REPORT_REASONS = ['SPAM', 'ABUSE', 'HATE', 'MISINFO', 'OTHER'] as const;
export const reportCommentSchema = z.strictObject({
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(LIMITS.reportNoteMax).refine(noControl, 'Invalid characters').optional(),
});

// ───── moderation (collaborator + admin) ─────
export const REPORT_ACTIONS = ['DISMISS', 'REMOVE_COMMENT', 'REMOVE_AND_RESTRICT', 'REMOVE_AND_BLOCK'] as const;
export const resolveReportSchema = z.strictObject({
  action: z.enum(REPORT_ACTIONS),
  /** Only for REMOVE_AND_RESTRICT: restriction length in days (omitted = until lifted). */
  days: z.number().int().min(1).max(365).optional(),
  note: z.string().trim().max(LIMITS.reportNoteMax).refine(noControl, 'Invalid characters').optional(),
});
export const restrictUserSchema = z.strictObject({
  days: z.number().int().min(1).max(365).optional(),
  reason: plain(1, 300),
});
export const blockUserSchema = z.strictObject({ reason: plain(1, 300) });

// ───── admin ─────
export const adminCreateUserSchema = z.strictObject({
  username: usernameSchema,
  email: emailSchema,
  displayName: plain(1, LIMITS.displayNameMax),
  role: z.enum(['ADMIN', 'COLLABORATOR', 'MEMBER']),
});
export const adminUpdateUserSchema = z.strictObject({
  role: z.enum(['ADMIN', 'COLLABORATOR', 'MEMBER']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  displayName: plain(1, LIMITS.displayNameMax).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
});

/** Public site assistant. History is plain text only (never sent as model roles) so a client cannot forge assistant turns. */
export const chatRequestSchema = z.strictObject({
  message: longText(LIMITS.chatMessageMax),
  locale: z.enum(LOCALES).default('vi'),
  history: z
    .array(z.strictObject({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(LIMITS.chatHistoryTurnMax).refine(noControl, 'Invalid characters') }))
    .max(LIMITS.chatHistoryTurns)
    .default([]),
});
