// Compasses point to magnetic north; the sky is laid out around true north.
import { magvar } from 'magvar';

/** WMM2025 is valid 2025.0–2030.0; clamp so it never warns (the field drifts only ~0.1°/year). */
function decimalYear(d: Date): number {
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const frac = (d.getTime() - start) / (Date.UTC(y + 1, 0, 1) - start);
  return Math.min(2029.99, Math.max(2025, y + frac));
}

/** Degrees to add to a magnetic heading to get a true heading (east positive). */
export function declination(lat: number, lon: number, date: Date): number {
  try {
    const d = magvar(lat, lon, 0, decimalYear(date));
    return Number.isFinite(d) ? d : 0;
  } catch {
    return 0;
  }
}
