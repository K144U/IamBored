// "What's that?": rank sky objects near where the phone is pointing.
import type { SatStatus } from './satellites';
import { azElToVec, separation } from './orientation';

export interface Candidate {
  key: string;
  kind: 'sat' | 'body';
  label: string;
  az: number;
  el: number;
  status?: SatStatus;
  important?: boolean;
  /** visual magnitude, bodies only */
  mag?: number;
}

export interface Match {
  candidate: Candidate;
  sepDeg: number;
  /** 0..1 share of the plausible answers */
  confidence: number;
}

/** How likely is it that this is the light you noticed? (brighter / visible = more likely) */
export function prior(c: Candidate): number {
  if (c.kind === 'body') {
    if (c.key === 'body:sun') return 0; // never point people at the Sun
    if (c.key === 'body:moon') return 4;
    const mag = c.mag ?? 5;
    return mag < -2 ? 3 : mag < 1 ? 2 : mag < 2.5 ? 0.8 : 0.2;
  }
  switch (c.status) {
    case 'visible':
      return c.important ? 2.5 : 1.2;
    case 'daylight':
      return 0.15;
    case 'eclipsed':
      return 0.02;
    default:
      return 0;
  }
}

/**
 * @param sigmaDeg expected pointing error (≈12° uncalibrated compass, ≈3° after calibration)
 * @param unknownWeight weight of "something not in the catalogue" (a star, a plane, a drone…)
 */
export function identify(
  pointing: { az: number; el: number },
  candidates: Candidate[],
  sigmaDeg: number,
  maxResults = 3,
  unknownWeight = 0.2,
): Match[] {
  const p = azElToVec(pointing.az, pointing.el);
  const scored: { candidate: Candidate; sepDeg: number; score: number }[] = [];
  for (const c of candidates) {
    if (c.el < -1) continue;
    const w = prior(c);
    if (w <= 0) continue;
    const sep = separation(p, azElToVec(c.az, c.el));
    if (sep > 3 * sigmaDeg) continue;
    scored.push({ candidate: c, sepDeg: sep, score: w * Math.exp(-(sep * sep) / (2 * sigmaDeg * sigmaDeg)) });
  }
  const total = scored.reduce((s, x) => s + x.score, 0) + unknownWeight;
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ candidate, sepDeg, score }) => ({ candidate, sepDeg, confidence: score / total }));
}
