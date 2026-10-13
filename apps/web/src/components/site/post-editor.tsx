'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { LIMITS } from '@hbvl/contracts';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Alert, Badge, Skeleton } from '@/components/ui/misc';
import { ApiError, get, newIdempotencyKey, post, put } from '@/lib/client';
import { localePath, tr, type Locale } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { CategoryNode } from '@/lib/types';
import { RichEditor } from './rich-editor';

export interface OwnPost {
  id: string;
  status: string;
  version: number;
  title: string;
  contentHtml: string;
  categoryId: string | null;
  featured: { id: string; card: string } | null;
  feedback: { action: string; reason: string; at: string } | null;
}
export const STATUS: Record<string, { vi: string; en: string; tone: 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' }> = {
  DRAFT: { vi: 'Nháp', en: 'Draft', tone: 'neutral' },
  PENDING_REVIEW: { vi: 'Chờ duyệt', en: 'Pending review', tone: 'brand' },
  CHANGES_REQUESTED: { vi: 'Cần sửa', en: 'Changes requested', tone: 'warn' },
  REJECTED: { vi: 'Từ chối', en: 'Rejected', tone: 'danger' },
  PUBLISHED: { vi: 'Đã đăng', en: 'Published', tone: 'ok' },
  PRIVATE: { vi: 'Riêng tư', en: 'Private', tone: 'neutral' },
  SCHEDULED: { vi: 'Đã lên lịch', en: 'Scheduled', tone: 'brand' },
  TRASHED: { vi: 'Đã xóa', en: 'Deleted', tone: 'neutral' },
};
const EDITABLE = new Set(['DRAFT', 'CHANGES_REQUESTED']);

export function PostEditor({ locale, postId }: { locale: Locale; postId?: string }) {
  const t = tr(locale);
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [loaded, setLoaded] = useState(!postId);
  const [loadError, setLoadError] = useState<string>();
  const [id, setId] = useState<string | undefined>(postId);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState('DRAFT');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [html, setHtml] = useState('');
  const [featured, setFeatured] = useState<{ id: string; url: string } | null>(null);
  const [feedback, setFeedback] = useState<OwnPost['feedback']>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'error' | 'success' | 'warning'; text: string; conflict?: boolean }>();
  const [busy, setBusy] = useState<'draft' | 'submit' | 'image' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const keyRef = useRef<{ sig: string; key: string }>({ sig: '', key: '' });

  const apply = useCallback((p: OwnPost) => {
    setId(p.id);
    setVersion(p.version);
    setStatus(p.status);
    setTitle(p.title);
    setHtml(p.contentHtml);
    setCategoryId(p.categoryId ?? '');
    setFeatured(p.featured ? { id: p.featured.id, url: p.featured.card } : null);
    setFeedback(p.feedback);
    setDirty(false);
    setEditorKey((k) => k + 1);
  }, []);

  useEffect(() => {
    get<{ items: CategoryNode[] }>(`/categories?locale=${locale}`)
      .then((r) => setTree(r.items))
      .catch(() => undefined);
  }, [locale]);
  // `reload` must keep a STABLE identity (it is an effect dependency): messages are built from `locale`, not from the per-render `t` closure.
  const reload = useCallback(async () => {
    if (!postId) return;
    const tt = tr(locale);
    try {
      const r = await get<OwnPost>(`/me/posts/${postId}`);
      apply(r);
      setLoaded(true);
      setBanner(undefined);
    } catch (e) {
      setLoadError(
        e instanceof ApiError && e.status === 404
          ? tt('Không tìm thấy bài viết hoặc bạn không có quyền xem.', 'Post not found or you do not have access.')
          : tt('Không tải được bài viết.', 'Could not load the post.'),
      );
    }
  }, [postId, apply, locale]);
  useEffect(() => {
    if (user?.id) void reload();
  }, [user?.id, reload]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const editable = EDITABLE.has(status);
  const payload = useMemo(() => ({ title, categoryId, contentHtml: html, featuredAssetId: featured?.id ?? null }), [title, categoryId, html, featured]);
  const idemKey = () => {
    const sig = JSON.stringify(payload);
    if (keyRef.current.sig !== sig) keyRef.current = { sig, key: newIdempotencyKey() };
    return keyRef.current.key;
  };

  const save = async (): Promise<{ id: string; version: number } | null> => {
    setErrors({});
    try {
      if (!id) {
        const r = await post<OwnPost>('/me/posts', payload, { headers: { 'Idempotency-Key': idemKey() } });
        setId(r.id);
        setVersion(r.version);
        setStatus(r.status);
        setDirty(false);
        router.replace(localePath(locale, `/gui-bai/${r.id}`));
        return { id: r.id, version: r.version };
      }
      const r = await put<OwnPost>(`/me/posts/${id}`, payload, { headers: { 'If-Match': `"${version}"` } });
      setVersion(r.version);
      setStatus(r.status);
      setDirty(false);
      return { id: r.id, version: r.version };
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT')
        setBanner({
          kind: 'warning',
          conflict: true,
          text: t(
            'Bài viết đã được cập nhật ở nơi khác. Nội dung bạn nhập vẫn được giữ trên màn hình; hãy tải phiên bản mới nhất rồi áp dụng lại thay đổi.',
            'This post was updated elsewhere. Your text is still on screen; load the latest version and re-apply your changes.',
          ),
        });
      else if (e instanceof ApiError && e.status === 400) {
        setErrors(e.fieldErrors());
        setBanner({ kind: 'error', text: t('Vui lòng kiểm tra lại các trường được đánh dấu.', 'Please check the highlighted fields.') });
      } else
        setBanner({
          kind: 'error',
          text:
            e instanceof ApiError
              ? e.message
              : t('Chưa lưu được. Nội dung của bạn vẫn còn trong form — hãy thử lại.', 'Not saved. Your content is still in the form — please retry.'),
        });
      return null;
    }
  };

  const onDraft = async () => {
    setBusy('draft');
    setBanner(undefined);
    const r = await save();
    if (r) {
      toast.success(t('Đã lưu nháp.', 'Draft saved.'));
      setBanner({ kind: 'success', text: t('Đã lưu nháp.', 'Draft saved.') });
    }
    setBusy(null);
  };
  const onSubmit = async () => {
    setBusy('submit');
    setBanner(undefined);
    const r = await save();
    if (r) {
      try {
        await post(`/me/posts/${r.id}/submit`, undefined, { headers: { 'Idempotency-Key': newIdempotencyKey(), 'If-Match': `"${r.version}"` } });
        toast.success(t('Đã gửi duyệt.', 'Submitted for review.'));
        router.push(localePath(locale, '/bai-cua-toi'));
        return;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED')
          setBanner({
            kind: 'warning',
            text: t(
              'Bài đã được lưu nháp. Hãy xác minh email trong Tài khoản trước khi gửi duyệt.',
              'Saved as a draft. Verify your e-mail in Account before submitting for review.',
            ),
          });
        else if (e instanceof ApiError && e.status === 400) {
          setErrors(e.fieldErrors());
          setBanner({ kind: 'error', text: e.message });
        } else setBanner({ kind: 'error', text: e instanceof ApiError ? e.message : t('Không gửi được.', 'Could not submit.') });
      }
    }
    setBusy(null);
  };
  const onPreview = async () => {
    try {
      setPreview((await post<{ html: string }>('/me/posts/preview', { contentHtml: html })).html);
    } catch {
      toast.error(t('Không tạo được bản xem trước.', 'Could not build the preview.'));
    }
  };
  const onImage = async (file: File) => {
    setBusy('image');
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await post<{ id: string; urls: { card: string } }>('/media/images', undefined, { form });
      setFeatured({ id: r.id, url: r.urls.card });
      setDirty(true);
    } catch (e) {
      setErrors((x) => ({ ...x, featuredAssetId: e instanceof ApiError ? e.message : t('Không tải được ảnh.', 'Could not upload the image.') }));
    }
    setBusy(null);
  };

  if (sessionLoading)
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  if (!user)
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Alert kind="info">
          {t('Vui lòng đăng nhập để gửi bài.', 'Please sign in to submit a story.')}{' '}
          <Link className="font-semibold underline" href={`${localePath(locale, '/dang-nhap-thanh-vien')}?returnTo=${encodeURIComponent(localePath(locale, '/gui-bai'))}`}>
            {t('Đăng nhập', 'Sign in')}
          </Link>
        </Alert>
      </div>
    );
  if (loadError)
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Alert kind="error">{loadError}</Alert>
      </div>
    );
  if (!loaded)
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Skeleton className="h-96 w-full" />
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-4xl font-semibold">{id ? t('Sửa bài', 'Edit post') : t('Viết bài mới', 'New post')}</h1>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS[status]?.tone}>{t(STATUS[status]?.vi ?? status, STATUS[status]?.en ?? status)}</Badge>
          <Link href={localePath(locale, '/bai-cua-toi')} className="text-sm font-semibold text-brand-700 underline">
            {t('Bài của tôi', 'My posts')}
          </Link>
        </div>
      </div>
      <p className="mt-2 text-ink-2">
        {t(
          'Lưu nháp để viết tiếp, hoặc gửi ban biên tập duyệt. Ban biên tập sẽ xem xét và quyết định xuất bản.',
          'Save a draft to keep writing, or send it to the editors. The editorial team reviews and decides on publishing.',
        )}
      </p>
      {user && !user.emailVerified && (
        <Alert kind="warning" className="mt-4">
          {t(
            'Email chưa xác minh: bạn có thể lưu nháp, nhưng cần xác minh email trong Tài khoản để gửi duyệt.',
            'E-mail not verified: you can save drafts, but you need to verify it in Account to submit for review.',
          )}
        </Alert>
      )}
      {feedback && (
        <Alert kind="warning" className="mt-4" title={feedback.action === 'REJECT' ? t('Bài bị từ chối', 'Post rejected') : t('Yêu cầu chỉnh sửa', 'Changes requested')}>
          <span className="whitespace-pre-wrap">{feedback.reason}</span>
        </Alert>
      )}
      {!editable && (
        <Alert kind="info" className="mt-4">
          {t('Bài viết đang bị khóa với người gửi ở trạng thái này.', 'This post is locked for the sender in its current state.')}
        </Alert>
      )}
      {banner && (
        <Alert kind={banner.kind} className="mt-4">
          {banner.text}
          {banner.conflict && (
            <>
              {' '}
              <button type="button" className="font-semibold underline" onClick={() => void reload()}>
                {t('Tải phiên bản mới nhất', 'Load latest version')}
              </button>
            </>
          )}
        </Alert>
      )}

      <form
        className="mt-6 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void onDraft();
        }}
        noValidate
      >
        <Field label={t('Tiêu đề', 'Title')} required error={errors.title} hint={`${title.length}/${LIMITS.postTitleMax}`}>
          {(p) => (
            <Input
              {...p}
              value={title}
              maxLength={LIMITS.postTitleMax}
              disabled={!editable}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          )}
        </Field>
        <Field label={t('Chuyên mục', 'Section')} required error={errors.categoryId}>
          {(p) => (
            <Select
              {...p}
              value={categoryId}
              disabled={!editable}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setDirty(true);
              }}
            >
              <option value="" disabled>
                {t('— Chọn chuyên mục —', '— Choose a section —')}
              </option>
              {tree.map((g) => (
                <optgroup key={g.slug} label={g.name}>
                  {g.children.map((c) => (
                    <option key={c.slug} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
        <div>
          <p className="block text-sm font-semibold">
            {t('Nội dung', 'Content')}{' '}
            <span aria-hidden className="text-danger-600">
              *
            </span>
          </p>
          <div className="mt-1.5">
            <RichEditor
              key={editorKey}
              value={html}
              disabled={!editable}
              onChange={(v) => {
                setHtml(v);
                setDirty(true);
              }}
              label={t('Nội dung bài viết', 'Post content')}
              placeholder={t('Viết câu chuyện của bạn…', 'Write your story…')}
              invalid={!!errors.contentHtml}
              errorId="content-error"
            />
          </div>
          {errors.contentHtml && (
            <p id="content-error" role="alert" className="mt-1.5 text-sm font-medium text-danger-600">
              {errors.contentHtml}
            </p>
          )}
          <p className="mt-1.5 text-sm text-muted">
            {t(
              `Tối đa ${LIMITS.postContentMax.toLocaleString('vi-VN')} ký tự hiển thị. Ảnh trong bài được lưu riêng tư cho tới khi bài được xuất bản.`,
              `Up to ${LIMITS.postContentMax.toLocaleString('en-US')} visible characters. Images stay private until the post is published.`,
              `表示される文字は最大${LIMITS.postContentMax.toLocaleString('ja-JP')}文字です。記事に使った画像は、記事が公開されるまで非公開のまま保管されます。`,
            )}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold">{t('Ảnh đại diện (JPEG, PNG, WebP; tối đa 5 MB)', 'Featured image (JPEG, PNG, WebP; max 5 MB)')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            {featured && <img src={featured.url} alt={t('Ảnh đại diện đã chọn', 'Selected featured image')} className="h-24 w-40 rounded-md object-cover" />}
            <label
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold hover:bg-brand-50 ${!editable ? 'pointer-events-none opacity-50' : ''}`}
            >
              <ImagePlus className="h-4 w-4" aria-hidden />
              {busy === 'image' ? t('Đang tải…', 'Uploading…') : featured ? t('Đổi ảnh', 'Change image') : t('Chọn ảnh', 'Choose image')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={!editable}
                data-testid="featured-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void onImage(f);
                }}
              />
            </label>
            {featured && editable && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFeatured(null);
                  setDirty(true);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                {t('Bỏ ảnh', 'Remove')}
              </Button>
            )}
          </div>
          {errors.featuredAssetId && (
            <p role="alert" className="mt-1.5 text-sm font-medium text-danger-600">
              {errors.featuredAssetId}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3 border-t border-line pt-6">
          {editable && (
            <Button type="submit" variant="outline" loading={busy === 'draft'} disabled={busy !== null && busy !== 'draft'} data-testid="save-draft">
              {t('Lưu nháp', 'Save draft')}
            </Button>
          )}
          {editable && (
            <Button type="button" loading={busy === 'submit'} disabled={busy !== null && busy !== 'submit'} onClick={() => void onSubmit()} data-testid="submit-review">
              {t('Gửi duyệt', 'Submit for review')}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => void onPreview()}>
            {t('Xem trước', 'Preview')}
          </Button>
        </div>
      </form>
      {preview !== null && (
        <section aria-label={t('Bản xem trước', 'Preview')} className="mt-10 rounded-xl border border-dashed border-slate-300 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-2xl font-semibold">{title || t('(chưa có tiêu đề)', '(untitled)')}</h2>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              {t('Đóng', 'Close')}
            </Button>
          </div>
          <div className="prose-hbvl mt-4" dangerouslySetInnerHTML={{ __html: preview /* sanitised by the server preview endpoint */ }} />
        </section>
      )}
    </div>
  );
}
