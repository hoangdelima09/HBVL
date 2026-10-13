import Link from 'next/link';
import { Button } from '@/components/ui/button';

/** Rendered with HTTP 404 for unknown routes, missing posts/provinces and anything not public (drafts, private, trashed). */
export default function NotFound() {
  return (
    <section className="mx-auto grid max-w-2xl place-items-center px-4 py-24 text-center">
      <p className="font-serif text-8xl font-semibold text-brand-600">404</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold">Trang không tìm thấy · Page not found</h1>
      <p className="mt-3 text-muted">
        Trang bạn tìm có thể đã bị xóa, đổi tên hoặc tạm thời không khả dụng.
        <br />
        The page you are looking for may have been removed, renamed, or is temporarily unavailable.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild>
          <Link href="/">← Trang chủ</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/en">Home (EN)</Link>
        </Button>
      </div>
    </section>
  );
}
