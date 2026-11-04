// Web Worker: keeps thousands of satellites off the UI thread.
import type { OMMJsonObject, SatRec } from 'satellite.js';
import { predictPasses, satState, satrecFromOmm, sunEci, toGeodetic, type Observer, type Pass } from '../engine/satellites';

export type WorkerRequest =
  | { type: 'load'; group: string; records: OMMJsonObject[] }
  | { type: 'unload'; group: string }
  | { type: 'compute'; reqId: number; time: number; observer: Observer; minEl: number }
  /** visible passes of every satellite in `groups` (slow: seconds, so it has its own request id) */
  | { type: 'passes'; reqId: number; time: number; observer: Observer; hours: number; groups: string[] };

export interface PassItem {
  g: string;
  i: number;
  pass: Pass;
}

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
  | { type: 'result'; reqId: number; time: number; samples: SatSample[]; total: number; ms: number }
  | { type: 'passes'; reqId: number; items: PassItem[]; ms: number };

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
  } else if (msg.type === 'passes') {
    const t0 = performance.now();
    const items: PassItem[] = [];
    const start = new Date(msg.time);
    for (const g of msg.groups) {
      const recs = groups.get(g);
      if (!recs) continue;
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i];
        if (!rec) continue;
        // 60 s steps are plenty for passes that climb above 10° (they last 4+ minutes)
        for (const pass of predictPasses(rec, msg.observer, start, { hours: msg.hours, minMaxEl: 10, stepS: 60 })) {
          if (pass.visibleFrom) items.push({ g, i, pass });
        }
      }
    }
    ctx.postMessage({ type: 'passes', reqId: msg.reqId, items, ms: performance.now() - t0 });
  }
};
