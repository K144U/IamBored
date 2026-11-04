// Satellite orbit data from CelesTrak, with polite caching and fallbacks.
import type { OMMJsonObject } from 'satellite.js';
import { idbGet, idbSet } from './idb';

export interface GroupInfo {
  id: string;
  label: string;
  /** large groups are off by default */
  big?: boolean;
}

export const GROUPS: GroupInfo[] = [
  { id: 'stations', label: 'Space stations' },
  { id: 'visual', label: 'Brightest' },
  { id: 'last-30-days', label: 'New launches (30 days)' },
  { id: 'starlink', label: 'Starlink', big: true },
];

export interface GroupData {
  group: string;
  records: OMMJsonObject[];
  fetchedAt: number;
  source: 'live' | 'cache' | 'snapshot' | 'stale-cache';
}

/** CelesTrak updates about every 2 hours and asks clients not to download more often. */
const FRESH_MS = 2 * 3600_000;

function looksLikeOmm(x: unknown): x is OMMJsonObject[] {
  return Array.isArray(x) && x.length > 0 && typeof x[0] === 'object' && x[0] !== null && 'MEAN_MOTION' in x[0];
}

async function fetchJson(url: string): Promise<OMMJsonObject[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // CelesTrak answers with plain text (not JSON) when it rate-limits a client.
  const text = await res.text();
  const data: unknown = JSON.parse(text);
  if (!looksLikeOmm(data)) throw new Error('unexpected response');
  return data;
}

export async function loadGroup(group: string): Promise<GroupData> {
  const key = `group:${group}`;
  const cached = await idbGet<{ records: OMMJsonObject[]; fetchedAt: number }>(key);
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) {
    return { group, ...cached, source: 'cache' };
  }
  try {
    const records = await fetchJson(
      `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`,
    );
    const fetchedAt = Date.now();
    await idbSet(key, { records, fetchedAt });
    return { group, records, fetchedAt, source: 'live' };
  } catch (liveErr) {
    // A slightly old cache beats a daily snapshot.
    if (cached) return { group, ...cached, source: 'stale-cache' };
    try {
      const records = await fetchJson(`${import.meta.env.BASE_URL}data/tle/${group}.json`);
      const meta = await fetch(`${import.meta.env.BASE_URL}data/tle/meta.json`)
        .then((r) => r.json() as Promise<{ fetchedAt: number }>)
        .catch(() => ({ fetchedAt: 0 }));
      return { group, records, fetchedAt: meta.fetchedAt, source: 'snapshot' };
    } catch {
      throw new Error(`Could not load "${group}" satellites (${(liveErr as Error).message})`);
    }
  }
}
