// Web Worker: keeps thousands of satellites off the UI thread.
import type { OMMJsonObject, SatRec } from 'satellite.js';
import { satState, satrecFromOmm, sunEci, toGeodetic, type Observer } from '../engine/satellites';

export type WorkerRequest =
  | { type: 'load'; group: string; records: OMMJsonObject[] }
  | { type: 'unload'; group: string }
  | { type: 'compute'; reqId: number; time: number; observer: Observer; minEl: number };

export interface SatSample {
  g: string;
  i: number;
  az: number;
  el: number;
  rangeKm: number;
  altKm: number;
  shadow: number;
}

export type WorkerResponse =
  | { type: 'loaded'; group: string; ok: number; failed: number }
  | { type: 'result'; reqId: number; time: number; samples: SatSample[]; total: number; ms: number };

const groups = new Map<string, (SatRec | null)[]>();
const ctx = self as unknown as {
  postMessage(msg: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    const recs = msg.records.map(satrecFromOmm);
    groups.set(msg.group, recs);
    const ok = recs.filter(Boolean).length;
    ctx.postMessage({ type: 'loaded', group: msg.group, ok, failed: recs.length - ok });
  } else if (msg.type === 'unload') {
    groups.delete(msg.group);
  } else if (msg.type === 'compute') {
    const t0 = performance.now();
    const date = new Date(msg.time);
    const obs = toGeodetic(msg.observer);
    const sun = sunEci(date);
    const samples: SatSample[] = [];
    let total = 0;
    for (const [g, recs] of groups) {
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i];
        if (!rec) continue;
        total++;
        const s = satState(rec, date, obs, sun);
        if (s && s.el >= msg.minEl) {
          samples.push({ g, i, az: s.az, el: s.el, rangeKm: s.rangeKm, altKm: s.altKm, shadow: s.shadow });
        }
      }
    }
    ctx.postMessage({ type: 'result', reqId: msg.reqId, time: msg.time, samples, total, ms: performance.now() - t0 });
  }
};
