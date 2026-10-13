'use client';

import { useEffect, useState } from 'react';
import { buildPaths, type GeometryFile } from './map-geometry';

/** Static (non-interactive) preview of the 34-unit map for the homepage. Geometry is the same versioned asset the interactive map uses. */
export function MapPreview({ version, label }: { version: string; label: string }) {
  const [data, setData] = useState<ReturnType<typeof buildPaths> | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/map/geometry?v=${version}`)
      .then((r) => r.json())
      .then((g: GeometryFile) => {
        if (alive) setData(buildPaths(g, '34'));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [version]);
  if (!data) return <div aria-hidden className="aspect-[620/850] w-full max-w-sm animate-pulse rounded-xl bg-slate-200/70" />;
  return (
    <svg viewBox={`0 0 ${data.width} ${data.height}`} role="img" aria-label={label} className="mx-auto w-full max-w-sm">
      {data.features.map((f) => (
        <path key={f.name} d={f.d} className="map-province has-members" style={{ cursor: 'default', pointerEvents: 'none' }} />
      ))}
    </svg>
  );
}
