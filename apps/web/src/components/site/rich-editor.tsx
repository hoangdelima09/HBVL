'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Quote, Redo2, Undo2 } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { ApiError, post } from '@/lib/client';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (html: string) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
  errorId?: string;
  invalid?: boolean;
}

/** Tiptap editor producing HTML. The server re-sanitises everything on save; the browser's output is never trusted. */
export function RichEditor({ value, onChange, label, placeholder, disabled, invalid, errorId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } } }),
      Image.configure({ HTMLAttributes: { loading: 'lazy' } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
        ...(errorId ? { 'aria-describedby': errorId } : {}),
        class: 'prose-hbvl min-h-64 max-w-none px-4 py-3 focus:outline-none',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });
  if (!editor) return <div className="min-h-72 animate-pulse rounded-md bg-slate-100" aria-hidden />;

  const btn = (active: boolean) => cn('grid h-9 w-9 place-items-center rounded-md text-ink-2 hover:bg-brand-50 disabled:opacity-40', active && 'bg-brand-100 text-brand-900');
  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL (https://…)', prev ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) {
      toast.error('Chỉ chấp nhận liên kết http(s), mailto hoặc tel.');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };
  const upload = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await post<{ urls: { large: string } }>('/media/images', undefined, { form });
      editor.chain().focus().setImage({ src: r.urls.large, alt: '' }).run();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không tải được ảnh.');
    }
  };

  return (
    <div className={cn('rounded-md border bg-white shadow-sm', invalid ? 'border-danger-600' : 'border-slate-300')}>
      <div role="toolbar" aria-label="Định dạng văn bản" className="flex flex-wrap items-center gap-0.5 border-b border-line p-1.5">
        <button
          type="button"
          aria-label="In đậm"
          aria-pressed={editor.isActive('bold')}
          className={btn(editor.isActive('bold'))}
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={disabled}
        >
          <Bold className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="In nghiêng"
          aria-pressed={editor.isActive('italic')}
          className={btn(editor.isActive('italic'))}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={disabled}
        >
          <Italic className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Tiêu đề 2"
          aria-pressed={editor.isActive('heading', { level: 2 })}
          className={btn(editor.isActive('heading', { level: 2 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          disabled={disabled}
        >
          <Heading2 className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Tiêu đề 3"
          aria-pressed={editor.isActive('heading', { level: 3 })}
          className={btn(editor.isActive('heading', { level: 3 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          disabled={disabled}
        >
          <Heading3 className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Danh sách chấm"
          aria-pressed={editor.isActive('bulletList')}
          className={btn(editor.isActive('bulletList'))}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          disabled={disabled}
        >
          <List className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Danh sách số"
          aria-pressed={editor.isActive('orderedList')}
          className={btn(editor.isActive('orderedList'))}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          disabled={disabled}
        >
          <ListOrdered className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Trích dẫn"
          aria-pressed={editor.isActive('blockquote')}
          className={btn(editor.isActive('blockquote'))}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          disabled={disabled}
        >
          <Quote className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" aria-label="Chèn liên kết" aria-pressed={editor.isActive('link')} className={btn(editor.isActive('link'))} onClick={setLink} disabled={disabled}>
          <Link2 className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" aria-label="Chèn ảnh" className={btn(false)} onClick={() => fileRef.current?.click()} disabled={disabled}>
          <ImagePlus className="h-4 w-4" aria-hidden />
        </button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button type="button" aria-label="Hoàn tác" className={btn(false)} onClick={() => editor.chain().focus().undo().run()} disabled={disabled || !editor.can().undo()}>
          <Undo2 className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" aria-label="Làm lại" className={btn(false)} onClick={() => editor.chain().focus().redo().run()} disabled={disabled || !editor.can().redo()}>
          <Redo2 className="h-4 w-4" aria-hidden />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
