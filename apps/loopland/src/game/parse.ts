// Read GPX / TCX files exported from Strava, Garmin, Coros, Apple Health apps, etc.
import type { TrackPoint } from './types';

export interface ParsedFile {
  name: string;
  points: TrackPoint[];
  format: 'gpx' | 'tcx';
}

function text(el: Element | null | undefined): string | undefined {
  return el?.textContent?.trim() || undefined;
}

/** All descendants with this local name, ignoring XML namespaces / prefixes. */
function all(root: Document | Element, tag: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === tag);
}

function first(root: Document | Element, tag: string): Element | null {
  for (const e of Array.from(root.getElementsByTagName('*'))) if (e.localName === tag) return e;
  return null;
}

export function parseActivityFile(xml: string, filename = 'run'): ParsedFile {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`${filename}: not a valid XML file`);
  const fallbackName = filename.replace(/\.(gpx|tcx)$/i, '');

  const trkpts = all(doc, 'trkpt');
  if (trkpts.length) {
    const points: TrackPoint[] = [];
    for (const p of trkpts) {
      const lat = Number(p.getAttribute('lat'));
      const lon = Number(p.getAttribute('lon'));
      const time = text(first(p, 'time'));
      const t = time ? Date.parse(time) : undefined;
      points.push(t !== undefined && Number.isFinite(t) ? { lat, lon, t } : { lat, lon });
    }
    const trk = first(doc, 'trk');
    const name = text(trk ? first(trk, 'name') : null) ?? text(first(doc, 'name')) ?? fallbackName;
    return { name, points, format: 'gpx' };
  }

  const tps = all(doc, 'Trackpoint');
  if (tps.length) {
    const points: TrackPoint[] = [];
    for (const p of tps) {
      const lat = Number(text(first(p, 'LatitudeDegrees')));
      const lon = Number(text(first(p, 'LongitudeDegrees')));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
      const time = text(first(p, 'Time'));
      const t = time ? Date.parse(time) : undefined;
      points.push(t !== undefined && Number.isFinite(t) ? { lat, lon, t } : { lat, lon });
    }
    const name = text(first(doc, 'Notes')) ?? text(first(doc, 'Id')) ?? fallbackName;
    return { name, points, format: 'tcx' };
  }

  if (/\.fit$/i.test(filename)) throw new Error(`${filename}: FIT files aren't supported yet. Export as GPX instead.`);
  throw new Error(`${filename}: no GPS track found (supported: GPX, TCX)`);
}

/** Write a track as GPX (used for the demo download and for tests). */
export function toGpx(name: string, points: TrackPoint[]): string {
  const pts = points
    .map(
      (p) =>
        `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${p.t !== undefined ? `<time>${new Date(p.t).toISOString()}</time>` : ''}</trkpt>`,
    )
    .join('\n');
  const safe = name.replace(/[<>&]/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="LoopLand" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${safe}</name><type>running</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
