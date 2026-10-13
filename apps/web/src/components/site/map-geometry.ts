/** Pure projection helpers for the Vietnam map (ported from the legacy `hbvl-map.js`: same viewport, same per-mode extent). */
export type Position = [number, number];
interface Geometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
}
export interface GeometryFile {
  modes: Record<'34' | '63', { properties: { name: string }; geometry: Geometry }[]>;
  islands: { name: string; position: Position; position63: Position; labelOffset: Position; archipelago?: boolean }[];
}
export const VIEW = { width: 620, height: 850, padding: 24 };

const polygons = (g: Geometry): number[][][][] => (g.type === 'Polygon' ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]));
const points = (g: Geometry) => polygons(g).flatMap((p) => p.flatMap((r) => r));

function bounds(features: { geometry: Geometry }[]) {
  return features
    .flatMap((f) => points(f.geometry))
    .reduce((b, p) => ({ minX: Math.min(b.minX, p[0]!), maxX: Math.max(b.maxX, p[0]!), minY: Math.min(b.minY, p[1]!), maxY: Math.max(b.maxY, p[1]!) }), {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
    });
}

export function projector(b: { minX: number; maxX: number; minY: number; maxY: number }) {
  const scale = Math.min((VIEW.width - VIEW.padding * 2) / (b.maxX - b.minX), (VIEW.height - VIEW.padding * 2) / (b.maxY - b.minY));
  const ox = (VIEW.width - (b.maxX - b.minX) * scale) / 2;
  const oy = (VIEW.height - (b.maxY - b.minY) * scale) / 2;
  return ([x, y]: Position): Position => [ox + (x - b.minX) * scale, VIEW.height - oy - (y - b.minY) * scale];
}

/** The 34-unit source uses geographic coordinates; the 63-unit source uses the publisher's projected space — each mode has its own extent (legacy behaviour). */
export function extentFor(mode: '34' | '63', g: GeometryFile) {
  if (mode === '34') return { minX: 102, maxX: 118.4, minY: 6.8, maxY: 23.6 };
  const b = bounds(g.modes['63']);
  return { ...b, maxX: b.maxX + 200 };
}

export function pathOf(geometry: Geometry, project: (p: Position) => Position): string {
  return polygons(geometry)
    .map((poly) =>
      poly
        .map(
          (ring) =>
            ring
              .map((pt, i) => {
                const [x, y] = project([pt[0]!, pt[1]!]);
                return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
              })
              .join(' ') + ' Z',
        )
        .join(' '),
    )
    .join(' ');
}

export function buildPaths(g: GeometryFile, mode: '34' | '63') {
  const project = projector(extentFor(mode, g));
  return {
    width: VIEW.width,
    height: VIEW.height,
    project,
    features: g.modes[mode].map((f) => ({ name: f.properties.name, d: pathOf(f.geometry, project) })),
  };
}
