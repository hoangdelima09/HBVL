'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Flag, Heart, History, MessageCircle, Pencil, Reply, Share2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePathname } from 'next/navigation';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Alert, Skeleton } from '@/components/ui/misc';
import { RestrictionNotice } from './restriction-notice';
import { Field, Textarea } from '@/components/ui/form';
import { ApiError, del, get, patch, post, put } from '@/lib/client';
import { formatDate, localePath, tr, type Locale } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const loginHref = (locale: Locale, returnTo: string) => `${localePath(locale, '/dang-nhap-thanh-vien')}?returnTo=${encodeURIComponent(returnTo)}`;

/** Like state is per ACCOUNT (server-side), fetched in the browser so the cached page HTML is identical for everybody. PUT/DELETE are idempotent. */
export function LikeButton({ postId, locale, initialLikes }: { postId: string; locale: Locale; initialLikes: number }) {
  const t = tr(locale);
  const { user } = useSession();
  const pathname = usePathname();
  const [state, setState] = useState({ likes: initialLikes, liked: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) {
      setState((s) => ({ ...s, liked: false }));
      return;
    }
    get<{ likes: number; likedByMe: boolean }>(`/posts/${postId}/engagement`)
      .then((r) => setState({ likes: r.likes, liked: r.likedByMe }))
      .catch(() => undefined);
  }, [postId, user]);

  const toggle = async () => {
    if (!user) return;
    const next = !state.liked;
    setBusy(true);
    setState((s) => ({ likes: s.likes + (next ? 1 : -1), liked: next })); // optimistic
    try {
      const r = await (next ? put : del)<{ likes: number; likedByMe: boolean }>(`/posts/${postId}/like`);
      setState({ likes: r.likes, liked: r.likedByMe });
    } catch (e) {
      setState((s) => ({ likes: s.likes + (next ? -1 : 1), liked: !next })); // rollback
      toast.error(e instanceof ApiError ? e.message : t('Không thể cập nhật lượt thích.', 'Could not update the like.'));
    } finally {
      setBusy(false);
    }
  };

  const count = (
    <span data-testid="like-count" aria-live="polite">
      {state.likes}
    </span>
  );
  if (!user) {
    return (
      <Link
        href={loginHref(locale, pathname ?? '/')}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-2 hover:bg-brand-50"
      >
        <Heart className="h-4 w-4" aria-hidden />
        {count} {t('lượt thích — đăng nhập để thích', 'likes — sign in to like')}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={state.liked}
      data-testid="like-button"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
        state.liked ? 'border-red-200 bg-danger-50 text-danger-600' : 'border-line bg-white text-ink-2 hover:bg-brand-50',
      )}
    >
      <Heart className={cn('h-4 w-4', state.liked && 'fill-current')} aria-hidden />
      {count} {state.liked ? t('Đã thích', 'Liked') : t('Thích bài viết', 'Like post')}
    </button>
  );
}

/** Share: Facebook / Zalo (URL-encoded), native share sheet when available, copy-link with a non-secure-context fallback. */
export function ShareButtons({ url, title, locale }: { url: string; title: string; locale: Locale }) {
  const t = tr(locale);
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent(url);
  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url);
      else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('copy failed');
      }
      setCopied(true);
      toast.success(t('Đã sao chép liên kết', 'Link copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('Không sao chép được. Hãy chọn và sao chép liên kết thủ công.', 'Could not copy. Please copy the link manually.'));
      window.prompt(t('Sao chép liên kết:', 'Copy link:'), url);
    }
  };
  const btn = 'inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-2 hover:bg-brand-50';
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('Chia sẻ bài viết', 'Share this post')}>
      <a className={btn} target="_blank" rel="noopener noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${enc}`}>
        <span aria-hidden className="grid h-4 w-4 place-items-center rounded-sm bg-[#1877f2] text-[11px] font-bold leading-none text-white">
          f
        </span>
        Facebook
      </a>
      <a className={btn} target="_blank" rel="noopener noreferrer" href={`https://sp.zalo.me/plugins/share?url=${enc}`}>
        <MessageCircle className="h-4 w-4" aria-hidden />
        Zalo
      </a>
      <button type="button" className={btn} onClick={copy} data-testid="copy-link">
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {t('Sao chép liên kết', 'Copy link')}
      </button>
      {typeof navigator !== 'undefined' && 'share' in navigator && (
        <button type="button" className={btn} onClick={() => navigator.share({ title, url }).catch(() => undefined)}>
          <Share2 className="h-4 w-4" aria-hidden />
          {t('Chia sẻ…', 'Share…')}
        </button>
      )}
    </div>
  );
}

const REPORT_REASONS = ['SPAM', 'ABUSE', 'HATE', 'MISINFO', 'OTHER'] as const;

/** "Report this comment": staff (collaborators and admins) are notified; whoever sees it first handles it. */
function ReportDialog({ commentId, locale, onClose }: { commentId: string | null; locale: Locale; onClose: () => void }) {
  const t = tr(locale);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>('ABUSE');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const label: Record<(typeof REPORT_REASONS)[number], string> = {
    SPAM: t('Spam hoặc quảng cáo', 'Spam or advertising', 'スパム・宣伝'),
    ABUSE: t('Xúc phạm, quấy rối', 'Insulting or harassing', '侮辱・嫌がらせ'),
    HATE: t('Thù ghét, phân biệt đối xử', 'Hateful or discriminatory', 'ヘイト・差別'),
    MISINFO: t('Thông tin sai lệch', 'Misleading information', '誤解を招く情報'),
    OTHER: t('Lý do khác', 'Something else', 'その他'),
  };
  const send = async () => {
    if (!commentId) return;
    setBusy(true);
    setErr(undefined);
    try {
      await post(`/comments/${commentId}/report`, { reason, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(
        t(
          'Đã gửi tố cáo. Cảm ơn bạn — ban quản trị sẽ xem xét.',
          'Report sent. Thank you — our team will review it.',
          '通報を送信しました。ありがとうございます。運営チームが確認します。',
        ),
      );
      setNote('');
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 400)
        setErr(t('Bạn không thể tố cáo bình luận của chính mình.', 'You cannot report your own comment.', 'ご自身のコメントは通報できません。'));
      else if (e instanceof ApiError && e.code === 'ACCOUNT_RESTRICTED')
        setErr(t('Tài khoản của bạn đang bị hạn chế tương tác.', 'Your account is restricted.', 'アカウントが制限されています。'));
      else if (e instanceof ApiError && e.status === 429)
        setErr(t('Bạn thao tác quá nhanh. Vui lòng thử lại sau.', 'You are doing this too fast. Please try again later.', '操作が早すぎます。しばらくしてからお試しください。'));
      else setErr(t('Không gửi được. Vui lòng thử lại.', 'Could not send. Please try again.', '送信できませんでした。もう一度お試しください。'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!commentId}
      onOpenChange={(o) => !o && onClose()}
      title={t('Tố cáo bình luận', 'Report this comment', 'コメントを通報')}
      description={t(
        'Hãy chọn lý do. Cộng tác viên và quản trị viên sẽ xem xét; bạn không cần cung cấp thêm thông tin.',
        'Pick a reason. Our collaborators and administrators will review it; no further details are required.',
        '理由を選択してください。コラボレーターと管理者が確認します。詳細の入力は必須ではありません。',
      )}
      closeLabel={t('Đóng', 'Close', '閉じる')}
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">{t('Lý do tố cáo', 'Reason', '通報の理由')}</legend>
        {REPORT_REASONS.map((r) => (
          <label key={r} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-paper-2">
            <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="h-4 w-4" data-testid={`report-reason-${r}`} />
            <span>{label[r]}</span>
          </label>
        ))}
      </fieldset>
      <Field label={t('Ghi chú (tuỳ chọn)', 'Note (optional)', 'メモ（任意）')} className="mt-4">
        {(p) => <Textarea {...p} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="report-note" />}
      </Field>
      {err && (
        <Alert kind="error" className="mt-3">
          {err}
        </Alert>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {t('Huỷ', 'Cancel', 'キャンセル')}
        </Button>
        <Button loading={busy} onClick={() => void send()} data-testid="report-submit">
          {t('Gửi tố cáo', 'Send report', '通報する')}
        </Button>
      </div>
    </Modal>
  );
}

interface CommentRow {
  id: string;
  parentId: string | null;
  depth: number;
  body: string;
  author: string;
  authorRole: string | null;
  /** 96 px profile picture, null → initials (and always null for a removed comment). */
  authorAvatar: string | null;
  createdAt: string;
  editedAt: string | null;
  editCount: number;
  deleted: boolean;
  mine: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/** Earlier versions of an edited comment — public, so nobody can quietly rewrite what they said. */
function CommentHistory({ id, locale }: { id: string; locale: Locale }) {
  const t = tr(locale);
  const [data, setData] = useState<{ current: { body: string; writtenAt: string }; items: { body: string; writtenAt: string; replacedAt: string }[] } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    get<NonNullable<typeof data>>(`/comments/${id}/revisions`)
      .then(setData)
      .catch(() => setErr(true));
  }, [id]);
  if (err) return <p className="mt-2 text-xs text-red-700">{t('Không tải được lịch sử chỉnh sửa.', 'Could not load the edit history.', '編集履歴を読み込めませんでした。')}</p>;
  if (!data) return <Skeleton className="mt-2 h-10 w-full" />;
  return (
    <ol className="mt-2 space-y-2 border-l-2 border-amber-200 pl-3" data-testid="comment-history">
      {data.items.map((r, i) => (
        <li key={i} className="text-sm">
          <p className="text-xs text-muted">
            {t('Bản viết lúc', 'Version written', '投稿日時')} {formatDate(locale, r.writtenAt, true)} · {t('được sửa lúc', 'replaced', '編集日時')}{' '}
            {formatDate(locale, r.replacedAt, true)}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-ink-2">{r.body}</p>
        </li>
      ))}
    </ol>
  );
}

function CommentItem({
  c,
  locale,
  canReply,
  canReport,
  onReply,
  onReport,
  onChanged,
}: {
  c: CommentRow;
  locale: Locale;
  canReply: boolean;
  canReport: boolean;
  onReply: () => void;
  onReport: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = tr(locale);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const indent = { marginLeft: `${Math.min(c.depth, 4) * 1.25}rem` };

  if (c.deleted)
    return (
      <li id={`comment-${c.id}`} style={indent} className="rounded-xl border border-dashed border-line bg-paper/60 p-4 text-sm italic text-muted" data-testid="comment-deleted">
        {t('Bình luận này đã bị xóa.', 'This comment was deleted.', 'このコメントは削除されました。')}
      </li>
    );

  const save = async () => {
    const body = draft.trim();
    if (!body) {
      setErr(t('Bình luận không được để trống.', 'The comment cannot be empty.', 'コメントを空にすることはできません。'));
      return;
    }
    setBusy(true);
    setErr(undefined);
    try {
      const r = await patch<{ awaitingModeration: boolean }>(`/comments/${c.id}`, { body });
      setEditing(false);
      if (r.awaitingModeration) toast.info(t('Bình luận đã sửa đang chờ kiểm duyệt.', 'Your edited comment is awaiting moderation.', '編集したコメントは承認待ちです。'));
      else toast.success(t('Đã lưu chỉnh sửa.', 'Changes saved.', '変更を保存しました。'));
      await onChanged();
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? (e.fieldErrors().body ?? e.message)
          : t('Không lưu được. Vui lòng thử lại.', 'Could not save. Please try again.', '保存できませんでした。もう一度お試しください。'),
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await del(`/comments/${c.id}`);
      toast.success(t('Đã xóa bình luận.', 'Comment deleted.', 'コメントを削除しました。'));
      setConfirmDelete(false);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('Không xóa được.', 'Could not delete.', '削除できませんでした。'));
    } finally {
      setBusy(false);
    }
  };
  const action = 'inline-flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer';

  return (
    <li id={`comment-${c.id}`} style={indent} className="rounded-xl border border-line bg-white p-4.5 shadow-subtle transition-colors hover:border-slate-300" data-testid="comment">
      <div className="flex flex-wrap items-center gap-x-3 text-sm">
        {!c.deleted && <Avatar src={c.authorAvatar} name={c.author} size={28} />}
        <strong className="font-semibold text-ink">{c.author}</strong>
        {c.authorRole === 'ADMIN' && (
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-900 ring-1 ring-brand-200">{t('Quản trị', 'Admin')}</span>
        )}
        <time className="text-xs text-muted" dateTime={c.createdAt}>
          {formatDate(locale, c.createdAt, true)}
        </time>
        {c.editedAt && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted underline-offset-2 hover:text-brand-700 hover:underline"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((v) => !v)}
            data-testid="comment-edited"
            title={t('Xem nội dung trước khi sửa', 'See what it said before', '編集前の内容を見る')}
          >
            <History className="h-3 w-3" aria-hidden />
            {t('đã chỉnh sửa', 'edited', '編集済み')}
            {c.editCount > 1 ? ` (${c.editCount})` : ''}
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <label htmlFor={`edit-${c.id}`} className="sr-only">
            {t('Sửa bình luận', 'Edit comment', 'コメントを編集')}
          </label>
          <Textarea id={`edit-${c.id}`} rows={3} maxLength={5000} value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="comment-edit-body" autoFocus />
          <p className="text-xs text-muted">
            {t('Nội dung cũ vẫn được lưu và mọi người có thể xem lại.', 'The previous text is kept and anyone can still see it.', '以前の内容は保存され、誰でも確認できます。')}
          </p>
          {err && <Alert kind="error">{err}</Alert>}
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={!draft.trim() || draft.trim() === c.body} onClick={() => void save()} data-testid="comment-edit-save">
              {t('Lưu', 'Save', '保存')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(false);
                setDraft(c.body);
                setErr(undefined);
              }}
            >
              {t('Huỷ', 'Cancel', 'キャンセル')}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-2" data-testid="comment-body-text">
          {c.body}
        </p>
      )}
      {showHistory && c.editedAt && <CommentHistory id={c.id} locale={locale} />}
      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {canReply && (
            <button type="button" className={cn(action, 'text-brand-700 hover:text-brand-900')} onClick={onReply}>
              <Reply className="h-3.5 w-3.5" aria-hidden />
              {t('Trả lời', 'Reply')}
            </button>
          )}
          {c.canEdit && (
            <button
              type="button"
              className={cn(action, 'text-ink-2 hover:text-brand-700')}
              onClick={() => {
                setDraft(c.body);
                setEditing(true);
              }}
              data-testid="comment-edit"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t('Sửa', 'Edit', '編集')}
            </button>
          )}
          {c.canDelete && (
            <button type="button" className={cn(action, 'text-ink-2 hover:text-red-700')} onClick={() => setConfirmDelete(true)} data-testid="comment-delete">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t('Xóa', 'Delete', '削除')}
            </button>
          )}
          {canReport && !c.mine && (
            <button type="button" className={cn(action, 'font-medium text-muted hover:text-red-700')} onClick={onReport} data-testid="report-comment">
              <Flag className="h-3.5 w-3.5" aria-hidden />
              {t('Tố cáo', 'Report', '通報')}
            </button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(false)}
        title={t('Xóa bình luận này?', 'Delete this comment?', 'このコメントを削除しますか？')}
        description={
          c.mine
            ? t(
                'Bình luận sẽ biến mất khỏi bài viết. Nếu đã có người trả lời, chỗ của nó hiện “Bình luận này đã bị xóa”.',
                'The comment disappears from the post. If someone replied, its place shows “This comment was deleted”.',
                'コメントは記事から削除されます。返信がある場合は「このコメントは削除されました」と表示されます。',
              )
            : t(
                'Bạn đang xóa bình luận của người khác với tư cách người kiểm duyệt.',
                'You are deleting someone else’s comment as a moderator.',
                'モデレーターとして他の人のコメントを削除します。',
              )
        }
        confirmLabel={t('Xóa', 'Delete', '削除')}
        cancelLabel={t('Huỷ', 'Cancel', 'キャンセル')}
        danger
        loading={busy}
        onConfirm={() => void remove()}
      />
    </li>
  );
}

export function CommentsSection({ postId, locale, open }: { postId: string; locale: Locale; open: boolean }) {
  const t = tr(locale);
  const { user } = useSession();
  const pathname = usePathname();
  const [items, setItems] = useState<CommentRow[] | null>(null);
  const [error, setError] = useState(false);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [fieldError, setFieldError] = useState<string>();
  const [reporting, setReporting] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      setItems((await get<{ items: CommentRow[] }>(`/posts/${postId}/comments`)).items);
    } catch {
      setError(true);
    }
  }, [postId]);
  // reload when the viewer signs in or out: which comments are "mine" (edit/delete) is decided by the server per viewer
  useEffect(() => {
    void load();
  }, [load, user?.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setFieldError(undefined);
    try {
      const r = await post<{ status: string; awaitingModeration: boolean }>(`/posts/${postId}/comments`, { body, parentId: replyTo });
      setBody('');
      setReplyTo(null);
      if (r.awaitingModeration) toast.info(t('Bình luận của bạn đang chờ kiểm duyệt.', 'Your comment is awaiting moderation.'));
      else toast.success(t('Đã gửi bình luận.', 'Comment posted.'));
      void load(); // refresh the list without keeping the form busy while it loads
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACCOUNT_RESTRICTED') {
        setFieldError(
          t(
            'Tài khoản của bạn đang bị hạn chế tương tác nên chưa thể bình luận.',
            'Your account is restricted, so you cannot comment right now.',
            'アカウントが制限されているため、現在コメントできません。',
          ),
        );
      } else if (err instanceof ApiError) {
        setFieldError(err.fieldErrors().body ?? err.message);
      } // the typed text is kept
      else setFieldError(t('Không gửi được. Vui lòng thử lại.', 'Could not send. Please try again.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="comments" aria-labelledby="comments-title" className="mt-12 scroll-mt-24">
      <h2 id="comments-title" className="flex items-center gap-2 font-serif text-2xl font-semibold">
        <MessageCircle className="h-6 w-6" aria-hidden />
        {t('Bình luận', 'Comments')} {items && <span className="text-muted">({items.filter((c) => !c.deleted).length})</span>}
      </h2>
      {error ? (
        <Alert kind="error" className="mt-4">
          {t('Không tải được bình luận.', 'Could not load comments.')}{' '}
          <button className="font-semibold underline" onClick={() => void load()}>
            {t('Thử lại', 'Retry')}
          </button>
        </Alert>
      ) : items === null ? (
        <Skeleton className="mt-4 h-24 w-full" />
      ) : items.length === 0 ? (
        <p className="mt-4 text-muted">{t('Chưa có bình luận nào.', 'No comments yet.')}</p>
      ) : (
        <ol className="mt-6 space-y-4">
          {items.map((c) => (
            <CommentItem
              key={`${c.id}-${c.editCount}`}
              c={c}
              locale={locale}
              canReply={!!(open && user && c.depth < 4)}
              canReport={!!user?.emailVerified}
              onReply={() => {
                setReplyTo(c.id);
                taRef.current?.focus();
              }}
              onReport={() => setReporting(c.id)}
              onChanged={load}
            />
          ))}
        </ol>
      )}

      <div className="mt-8">
        {!open ? (
          <p className="text-muted">{t('Bình luận đã đóng.', 'Comments are closed.')}</p>
        ) : !user ? (
          <p>
            {t('Bạn phải', 'You must')}{' '}
            <Link className="font-semibold text-brand-700 underline" href={loginHref(locale, `${pathname}#comments`)}>
              {t('đăng nhập', 'sign in')}
            </Link>{' '}
            {t('để bình luận.', 'to post a comment.')}
          </p>
        ) : user.restriction ? (
          <RestrictionNotice locale={locale} restriction={user.restriction} />
        ) : !user.emailVerified ? (
          <Alert kind="warning">
            {t('Hãy xác minh email trong ', 'Verify your e-mail in ')}
            <Link className="font-semibold underline" href={localePath(locale, '/tai-khoan')}>
              {t('Tài khoản', 'Account')}
            </Link>
            {t(' để bình luận.', ' to comment.')}
          </Alert>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-3">
            {replyTo && (
              <p className="text-sm text-muted">
                {t('Đang trả lời một bình luận.', 'Replying to a comment.')}{' '}
                <button type="button" className="font-semibold underline" onClick={() => setReplyTo(null)}>
                  {t('Huỷ', 'Cancel')}
                </button>
              </p>
            )}
            <Field label={t('Để lại bình luận', 'Leave a comment')} required error={fieldError}>
              {(p) => (
                <Textarea
                  ref={taRef}
                  id={p.id}
                  aria-describedby={p['aria-describedby']}
                  aria-invalid={p['aria-invalid']}
                  required
                  maxLength={5000}
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t('Chia sẻ suy nghĩ của bạn…', 'Share your thoughts…')}
                  data-testid="comment-body"
                />
              )}
            </Field>
            <Button type="submit" loading={sending} disabled={!body.trim()} data-testid="comment-submit">
              {t('Gửi bình luận', 'Post comment')}
            </Button>
          </form>
        )}
      </div>
      <ReportDialog commentId={reporting} locale={locale} onClose={() => setReporting(null)} />
    </section>
  );
}
