/** Single source of truth for validation limits (legacy parity: see docs/FEATURE_PARITY.md). */
export const LIMITS = {
  postTitleMax: 200,
  postContentMax: 50_000,
  reasonMax: 2_000,
  feedbackSubjectMax: 160,
  feedbackMessageMax: 5_000,
  contactNameMax: 120,
  contactEmailMax: 254,
  contactSubjectMax: 200,
  contactMessageMax: 5_000,
  chatMessageMax: 500,
  reportNoteMax: 500,
  chatHistoryTurns: 6,
  chatHistoryTurnMax: 1_000,
  commentMax: 5_000,
  commentMaxDepth: 4,
  usernameMin: 3,
  usernameMax: 60,
  displayNameMax: 100,
  passwordMin: 10,
  passwordMax: 128,
  imageMaxBytes: 5 * 1024 * 1024,
  imageMaxPixels: 40_000_000, // decompression-bomb guard
  imageMaxSide: 10_000,
  /** Minimum seconds between two successful feedback / contact submissions per account (legacy: 60 s). */
  submitCooldownSeconds: 60,
  pageSizeDefault: 12,
  pageSizeMax: 50,
} as const;

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME)[number];

export const ROLES = ['ADMIN', 'COLLABORATOR', 'MEMBER'] as const;
export type RoleName = (typeof ROLES)[number];

export const POST_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'PUBLISHED', 'SCHEDULED', 'PRIVATE', 'TRASHED'] as const;
export type PostStatusName = (typeof POST_STATUSES)[number];

export const LOCALES = ['vi', 'en', 'ja'] as const;
export type LocaleName = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: LocaleName = 'vi';

/** Legacy login portals (route aliases) and the role each accepts. */
export const PORTALS = {
  'dang-nhap-quan-tri': 'ADMIN',
  'dang-nhap-cong-tac-vien': 'COLLABORATOR',
  'dang-nhap-thanh-vien': 'MEMBER',
} as const satisfies Record<string, RoleName>;
export type PortalSlug = keyof typeof PORTALS;

/**
 * First URL segments owned by application routes (Next.js static segments win over the CMS catch-all), plus `/en`, `/api`, `/admin`…
 * A CMS page with one of these as its top-level slug could never be reached, so admin page creation and the WordPress migration refuse them.
 */
export const RESERVED_TOP_LEVEL_PATHS = [
  'admin',
  'api',
  'bai-cua-toi',
  'bai-viet',
  'blog',
  'brand',
  'category',
  'chuong-trinh',
  'cong-tac-vien',
  'dang-ky',
  'dang-nhap-cong-tac-vien',
  'dang-nhap-quan-tri',
  'dang-nhap-thanh-vien',
  'dat-lai-mat-khau',
  'dong-gop-y-kien',
  'en',
  'ja',
  'gui-bai',
  'gui-y-kien',
  'lien-he',
  'media',
  'quen-mat-khau',
  'su-kien',
  'tai-khoan',
  'thong-bao',
  'tim-kiem',
  'tinh',
  'vi',
  'xac-minh-email',
] as const;
export const isReservedTopLevelPath = (segment: string): boolean => (RESERVED_TOP_LEVEL_PATHS as readonly string[]).includes(segment.toLowerCase());
