import { cellToBoundary, cellsToMultiPolygon, latLngToCell } from 'h3-js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ClaimResult, Game } from '../game/claim';
import type { Player } from '../game/types';

export class GameMap {
  readonly map: L.Map;
  private territory = L.layerGroup();
  private anim = L.layerGroup();
  private trails = L.layerGroup();
  private renderer = L.canvas({ padding: 0.5 });
  private animToken = 0;

  constructor(el: HTMLElement) {
    this.map = L.map(el, { preferCanvas: true, zoomControl: true, worldCopyJump: true }).setView([30, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(this.map);
    this.territory.addTo(this.map);
    this.trails.addTo(this.map);
    this.anim.addTo(this.map);
  }

  /** Paint everyone's land: solid = owned, faint + dashed = fading. */
  renderTerritory(game: Game, players: Player[], now: number) {
    this.territory.clearLayers();
    const color = new Map(players.map((p) => [p.id, p.color]));
    for (const [owner, cells] of game.territory(now)) {
      const c = color.get(owner) ?? '#888';
      if (cells.fading.length) {
        L.geoJSON(
          { type: 'MultiPolygon', coordinates: cellsToMultiPolygon(cells.fading, true) } as GeoJSON.MultiPolygon,
          { style: { color: c, weight: 1.5, dashArray: '4 5', fillColor: c, fillOpacity: 0.14 }, renderer: this.renderer, interactive: false } as L.GeoJSONOptions,
        ).addTo(this.territory);
      }
      if (cells.owned.length) {
        L.geoJSON(
          { type: 'MultiPolygon', coordinates: cellsToMultiPolygon(cells.owned, true) } as GeoJSON.MultiPolygon,
          { style: { color: c, weight: 2, fillColor: c, fillOpacity: 0.42 }, renderer: this.renderer, interactive: false } as L.GeoJSONOptions,
        ).addTo(this.territory);
      }
    }
  }

  showTrail(result: ClaimResult | null, color = '#111') {
    this.trails.clearLayers();
    if (!result) return;
    for (const seg of result.segments) {
      L.polyline(
        seg.map((p) => [p.lat, p.lon] as L.LatLngTuple),
        { color, weight: 3, opacity: 0.9, dashArray: '1 6', lineCap: 'round', renderer: this.renderer, interactive: false },
      ).addTo(this.trails);
    }
  }

  fitTo(results: ClaimResult[]) {
    const pts: L.LatLngTuple[] = [];
    for (const r of results) for (const s of r.segments) for (const p of s) pts.push([p.lat, p.lon]);
    if (pts.length) this.map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
  }

  /** Animated replay: the trail draws itself, then the captured land floods in. */
  async replay(result: ClaimResult, color: string, opts: { trailMs?: number; floodMs?: number } = {}) {
    const token = ++this.animToken;
    const { trailMs = 1800, floodMs = 1400 } = opts;
    this.anim.clearLayers();
    this.trails.clearLayers();
    const alive = () => token === this.animToken;
    const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

    const all = result.segments.map((s) => s.map((p) => [p.lat, p.lon] as L.LatLngTuple));
    const total = all.reduce((n, s) => n + s.length, 0);
    const lines = all.map(() =>
      L.polyline([], { color, weight: 4, opacity: 1, renderer: this.renderer, interactive: false }).addTo(this.anim),
    );
    const head = L.circleMarker(all[0]?.[0] ?? [0, 0], {
      radius: 7, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1, renderer: this.renderer, interactive: false,
    }).addTo(this.anim);

    const t0 = performance.now();
    while (alive()) {
      const f = Math.min(1, (performance.now() - t0) / trailMs);
      let left = Math.round(f * total);
      let last: L.LatLngTuple | undefined;
      all.forEach((seg, i) => {
        const k = Math.min(seg.length, left);
        lines[i].setLatLngs(seg.slice(0, k));
        if (k > 0) last = seg[k - 1];
        left -= k;
      });
      if (last) head.setLatLng(last);
      if (f >= 1) break;
      await frame();
    }
    head.remove();

    const waves = result.waves;
    const per = waves.length ? floodMs / waves.length : 0;
    for (const wave of waves) {
      if (!alive()) return;
      for (const h of wave) {
        L.polygon(cellToBoundary(h) as L.LatLngTuple[], {
          color, weight: 0.5, fillColor: color, fillOpacity: 0.55, renderer: this.renderer, interactive: false,
        }).addTo(this.anim);
      }
      const until = performance.now() + per;
      while (performance.now() < until && alive()) await frame();
    }
    if (!alive()) return;
    await new Promise((r) => setTimeout(r, 400));
    if (!alive()) return;
    this.anim.clearLayers();
  }

  stopAnimation() {
    this.animToken++;
    this.anim.clearLayers();
  }

  onCellClick(res: number, fn: (h3: string, latlng: L.LatLng) => void) {
    this.map.on('click', (e: L.LeafletMouseEvent) => fn(latLngToCell(e.latlng.lat, e.latlng.lng, res), e.latlng));
  }
}
