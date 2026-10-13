'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/misc';
import { get } from '@/lib/client';
import { foldVietnamese } from '@hbvl/contracts';
import { localePath, tr, type Locale } from '@/lib/i18n';
import type { MapProvince, MapSummary } from '@/lib/types';
import { buildPaths, type GeometryFile } from './map-geometry';
import { cn } from '@/lib/utils';

type Mode = '34' | '63';
interface SearchResult {
  provinces: { slug: string; nameVi: string; nameEn: string; count: number }[];
  members: { name: string; provinceSlug: string; provinceNameVi: string; provinceNameEn: string }[];
}

/** Interactive 34/63-unit map: SVG from the vendored geometry, keyboard operable, search with latest-request-wins, honest loading/error/empty states. */
export function MapExplorer({ locale, initialVersion }: { locale: Locale; initialVersion: string }) {
  const t = tr(locale);
  const [mode, setMode] = useState<Mode>('34');
  const [geometry, setGeometry] = useState<GeometryFile | null>(null);
  const [summaries, setSummaries] = useState<Partial<Record<Mode, MapSummary>>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [members, setMembers] = useState<{ items: { name: string }[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const atlas = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLHeadingElement>(null);

  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  // Geometry: one versioned static asset, fetched once per page view.
  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/map/geometry?v=${initialVersion}`)
      .then((r) => {
        if (!r.ok) throw new Error('geometry');
        return r.json() as Promise<GeometryFile>;
      })
      .then((g) => {
        if (alive) setGeometry(g);
      })
      .catch(() => {
        if (alive) setError(t('Không thể tải dữ liệu bản đồ.', 'Could not load map data.'));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVersion, attempt]);

  // Counts per mode (cached in state so switching back is instant).
  const haveSummary = !!summaries[mode];
  useEffect(() => {
    if (haveSummary) return;
    let alive = true;
    get<MapSummary>(`/map/summary?system=${mode}`)
      .then((s) => {
        if (alive) setSummaries((prev) => ({ ...prev, [mode]: s }));
      })
      .catch(() => {
        if (alive) setError(t('Không thể tải dữ liệu bản đồ.', 'Could not load map data.'));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, haveSummary, attempt]);

  const summary = summaries[mode];
  const byName = useMemo(() => new Map((summary?.provinces ?? []).map((p) => [p.nameVi, p])), [summary]);
  const drawn = useMemo(() => (geometry ? buildPaths(geometry, mode) : null), [geometry, mode]);
  const current: MapProvince | undefined = summary?.provinces.find((p) => p.slug === selected);

  // Selecting a province loads its member list (cancel stale responses).
  useEffect(() => {
    if (!selected) {
      setMembers(null);
      return;
    }
    const ac = new AbortController();
    setMembers(null);
    get<{ items: { name: string }[]; total: number }>(`/map/provinces/${mode}/${selected}/members`, { signal: ac.signal })
      .then(setMembers)
      .catch((e) => {
        if (e?.name !== 'AbortError') setMembers({ items: [], total: -1 });
      });
    return () => ac.abort();
  }, [selected, mode]);

  const choose = (slug: string, focusPanel = true) => {
    setSelected(slug);
    if (focusPanel) panel.current?.focus({ preventScroll: false });
  };
  const switchMode = (m: Mode) => {
    setMode(m);
    setSelected(null);
    setTip(null);
    setQuery('');
    setResults(null);
  };

  // ───── search (debounced; only the latest request may update the UI) ─────
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (foldVietnamese(q).length < 2) {
      setResults(null);
      return;
    }
    const id = ++seq.current;
    const ac = new AbortController();
    const h = setTimeout(() => {
      get<SearchResult>(`/map/search?system=${mode}&q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => {
          if (id === seq.current) setResults(r);
        })
        .catch(() => {
          if (id === seq.current) setResults({ provinces: [], members: [] });
        });
    }, 250);
    return () => {
      clearTimeout(h);
      ac.abort();
    };
  }, [query, mode]);

  const name = (p: { nameVi: string; nameEn: string }) => t(p.nameVi, p.nameEn);
  const showTip = (e: React.PointerEvent | React.FocusEvent, text: string) => {
    const box = atlas.current?.getBoundingClientRect();
    if (!box) return;
    if ('clientX' in e) setTip({ x: Math.min(e.clientX - box.left + 12, box.width - 220), y: Math.max(e.clientY - box.top - 34, 8), text });
    else setTip({ x: 16, y: 16, text });
  };

  return (
    <section aria-labelledby="map-heading" className="rounded-2xl bg-white p-4 shadow-card sm:p-8" data-testid="map-explorer">
      <h2 id="map-heading" className="font-serif text-3xl font-semibold">
        {t('Bản đồ sinh viên Vươn Lên', 'Rise Up student origins')}
      </h2>
      <p className="mt-1 text-muted">
        {t('Khám phá quê quán và nơi kết nối của các thành viên Vươn Lên trên khắp Việt Nam.', 'Explore the hometowns and connection points of Rise Up members across Vietnam.')}
      </p>

      <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div
          role="group"
          aria-label={t('Chọn hệ thống đơn vị hành chính cấp tỉnh', 'Select provincial-level administrative system')}
          className="inline-flex rounded-full border border-line bg-paper p-1"
        >
          {(['34', '63'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => switchMode(m)}
              data-map={m}
              className={cn('rounded-full px-4 py-2 text-sm font-semibold', mode === m ? 'bg-brand-600 text-white' : 'text-ink-2 hover:bg-white')}
            >
              {m === '34' ? t('34 tỉnh/thành hiện hành', '34 current provinces/cities') : t('63 tỉnh/thành trước sắp xếp', '63 before reorganisation')}
            </button>
          ))}
        </div>
        <div className="relative w-full lg:max-w-sm">
          <label htmlFor="map-search" className="sr-only">
            {t('Tìm tỉnh, thành hoặc thành viên', 'Search provinces, cities or members')}
          </label>
          <Search className="pointer-events-none absolute left-3.5 top-3 h-5 w-5 text-slate-500" aria-hidden />
          <input
            id="map-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                setResults(null);
              }
            }}
            placeholder={t('Tìm tỉnh/thành hoặc thành viên', 'Search province/city or member')}
            aria-controls={results ? 'map-search-results' : undefined}
            className="h-11 w-full rounded-full border border-slate-300 bg-white pl-11 pr-4 text-sm placeholder:text-slate-500"
          />
          {results && (
            <div
              id="map-search-results"
              role="listbox"
              aria-label={t('Kết quả tìm kiếm', 'Search results')}
              className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-lift"
            >
              {results.provinces.length === 0 && results.members.length === 0 && <p className="px-3 py-2 text-sm text-muted">{t('Không tìm thấy kết quả', 'No results')}</p>}
              {results.provinces.map((p) => (
                <button
                  key={`p-${p.slug}`}
                  role="option"
                  aria-selected={false}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-brand-50"
                  onClick={() => {
                    choose(p.slug);
                    setQuery('');
                    setResults(null);
                  }}
                >
                  <strong>{name(p)}</strong>
                  <span className="text-muted">
                    {p.count} {t('thành viên', 'members')}
                  </span>
                </button>
              ))}
              {results.members.map((m, i) => (
                <button
                  key={`m-${i}`}
                  role="option"
                  aria-selected={false}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-brand-50"
                  onClick={() => {
                    choose(m.provinceSlug);
                    setQuery('');
                    setResults(null);
                  }}
                >
                  <strong>{m.name}</strong>
                  <span className="text-muted">{t(m.provinceNameVi, m.provinceNameEn)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error ? (
        <div className="mt-6">
          <Alert kind="error">
            {error}{' '}
            <Button size="sm" variant="outline" className="ml-2" onClick={load}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t('Thử lại', 'Retry')}
            </Button>
          </Alert>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div ref={atlas} className="relative rounded-xl bg-slate-50 p-3">
            {!drawn || !summary ? (
              <Skeleton className="mx-auto aspect-[620/850] w-full max-w-md" />
            ) : (
              <svg
                viewBox={`0 0 ${drawn.width} ${drawn.height}`}
                role="group"
                aria-label={
                  mode === '34'
                    ? t('34 tỉnh, thành hiện hành', '34 current provinces and cities')
                    : t('63 tỉnh, thành trước sắp xếp', '63 provinces and cities before reorganisation')
                }
                className="mx-auto w-full max-w-md overflow-visible"
                data-testid="map-svg"
                data-mode={mode}
              >
                {drawn.features.map((f) => {
                  const p = byName.get(f.name);
                  const count = p?.count ?? 0;
                  const label = p ? name(p) : f.name;
                  return (
                    <path
                      key={f.name}
                      d={f.d}
                      data-province={p?.slug ?? f.name}
                      tabIndex={0}
                      role="button"
                      aria-pressed={selected === p?.slug}
                      aria-label={`${label}, ${count} ${t('thành viên HBVL', 'HBVL members')}`}
                      className={cn('map-province', count > 0 ? 'has-members' : 'has-no-members', selected === p?.slug && 'is-selected')}
                      onClick={() => p && choose(p.slug)}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && p) {
                          e.preventDefault();
                          choose(p.slug);
                        }
                      }}
                      onPointerMove={(e) => showTip(e, `${label} · ${count} ${t('thành viên', 'members')}`)}
                      onPointerLeave={() => setTip(null)}
                      onFocus={(e) => showTip(e, `${label} · ${count} ${t('thành viên', 'members')}`)}
                      onBlur={() => setTip(null)}
                    />
                  );
                })}
                <g role="group" aria-label={t('Các đảo và quần đảo Việt Nam', 'Islands and archipelagos of Vietnam')}>
                  {geometry!.islands.map((isl) => {
                    const [x, y] = drawn.project(mode === '34' ? isl.position : isl.position63);
                    return (
                      <g key={isl.name} className={cn('map-island', isl.archipelago && 'map-island--archipelago')} transform={`translate(${x},${y})`}>
                        <title>{isl.name}</title>
                        {!isl.archipelago && <circle r={3} />}
                        <text x={isl.labelOffset[0]} y={isl.labelOffset[1]} textAnchor={isl.archipelago ? 'middle' : isl.labelOffset[0] < 0 ? 'end' : 'start'}>
                          {isl.name}
                        </text>
                        {isl.archipelago && (
                          <text y={isl.labelOffset[1] + 13} textAnchor="middle">
                            VIỆT NAM
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              </svg>
            )}
            {tip && (
              <div
                role="tooltip"
                className="pointer-events-none absolute z-10 rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white shadow-lift"
                style={{ left: tip.x, top: tip.y }}
              >
                {tip.text}
              </div>
            )}
            <ul aria-label={t('Chú giải bản đồ', 'Map legend')} className="mt-3 flex flex-wrap justify-center gap-4 text-xs font-medium text-ink-2">
              <li className="flex items-center gap-1.5">
                <i className="h-3 w-3 rounded-sm bg-slate-200 ring-1 ring-slate-400" />
                {t('Chưa có thành viên', 'No members')}
              </li>
              <li className="flex items-center gap-1.5">
                <i className="h-3 w-3 rounded-sm bg-blue-200 ring-1 ring-slate-400" />
                {t('Có thành viên', 'Has members')}
              </li>
              <li className="flex items-center gap-1.5">
                <i className="h-3 w-3 rounded-sm bg-brand-600" />
                {t('Đang chọn', 'Selected')}
              </li>
            </ul>
          </div>

          <aside aria-live="polite" aria-labelledby="map-detail-title" className="rounded-xl border-t-4 border-leaf-600 bg-paper p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-leaf-700">{t('Tỉnh/thành đang chọn', 'Selected province/city')}</p>
            <h3 id="map-detail-title" ref={panel} tabIndex={-1} className="mt-1 font-serif text-3xl font-semibold">
              {current ? name(current) : t('Chọn một tỉnh/thành', 'Choose a province/city')}
            </h3>
            <p className="mt-1 text-lg font-semibold text-brand-700" data-testid="map-count">
              {current
                ? `${current.count} ${t('thành viên', 'members')}`
                : summary
                  ? `${summary.totals.members} ${t('thành viên', 'members')} · ${summary.totals.unitsWithMembers}/${summary.totals.units} ${t('tỉnh/thành có thành viên', 'units with members')}`
                  : '—'}
            </p>
            {current?.constituents && current.constituents.length > 1 && (
              <div className="mt-5" data-testid="map-constituents">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted">{t('Hình thành từ', 'Formed from')}</h4>
                <ul className="mt-2 space-y-1 text-sm">
                  {current.constituents.map((c) => (
                    <li key={c.slug}>
                      {name(c)} {t('cũ', '(former)')} · {c.count} {t('thành viên', 'members')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted">{t('Thành viên HBVL', 'HBVL members')}</h4>
              {!current ? (
                <p className="mt-2 italic text-muted">
                  {t('Nhấp hoặc dùng bàn phím để chọn một tỉnh/thành trên bản đồ.', 'Click or use the keyboard to choose a province/city on the map.')}
                </p>
              ) : members === null ? (
                <Skeleton className="mt-2 h-24 w-full" />
              ) : members.total < 0 ? (
                <Alert kind="error" className="mt-2">
                  {t('Không tải được danh sách.', 'Could not load the list.')}
                </Alert>
              ) : members.items.length === 0 ? (
                <p className="mt-2 italic text-muted" data-testid="map-empty">
                  {t(
                    `Hiện chưa có thành viên HBVL tại ${current.nameVi}.`,
                    `No HBVL members in ${current.nameEn} yet.`,
                    `${t(current.nameVi, current.nameEn)}にはまだHBVL会員がいません。`,
                  )}
                </p>
              ) : (
                <ol className="mt-2 list-decimal space-y-1 pl-5" data-testid="map-members">
                  {members.items.map((m, i) => (
                    <li key={`${m.name}-${i}`}>{m.name}</li>
                  ))}
                </ol>
              )}
            </div>
            {current && (
              <Link href={localePath(locale, `/tinh/${current.slug}`)} className="mt-6 inline-block text-sm font-semibold text-brand-700 hover:underline">
                {t('Xem trang tỉnh', 'Open province page')} →
              </Link>
            )}
          </aside>
        </div>
      )}
      <p className="mt-6 text-sm text-muted">
        {t(
          'Bản đồ hỗ trợ 34 đơn vị hành chính cấp tỉnh hiện hành và 63 đơn vị ngay trước sắp xếp năm 2025. Số lượng được tính trực tiếp từ danh sách thành viên HBVL. Các đảo và quần đảo được thể hiện bằng ký hiệu vị trí, không tính thành tỉnh/thành riêng.',
          'The map supports the 34 current provincial-level units and the 63 units immediately before the 2025 reorganisation. Counts are derived directly from the HBVL member list. Islands and archipelagos are shown with location symbols and are not counted as separate provinces.',
        )}
      </p>
    </section>
  );
}
