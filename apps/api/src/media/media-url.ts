/** Public path of one stored image variant (served by MediaController with its own access check). */
export const mediaUrl = (id: string, variant: 'thumb' | 'card' | 'large' | 'original' = 'large') => `/api/v1/media/${id}/${variant}`;

/** Profile picture URL: `thumb` = 96 px square (lists, comments), `card` = 256 px square (profile, header). */
export const avatarUrl = (assetId: string | null | undefined, variant: 'thumb' | 'card' = 'card'): string | null => (assetId ? mediaUrl(assetId, variant) : null);
