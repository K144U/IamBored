// Magnetic declination (angle from true north to magnetic north, east positive)
// from NOAA's World Magnetic Model. Phone compasses report magnetic headings.
import geomagnetism from 'geomagnetism';

let cached: { key: string; value: number } | null = null;

export function declination(lat: number, lon: number, date = new Date()): number {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${date.getUTCFullYear()}-${date.getUTCMonth()}`;
  if (cached?.key === key) return cached.value;
  let value = 0;
  try {
    value = geomagnetism.model(date, { allowOutOfBoundsModel: true }).point([lat, lon]).decl;
  } catch {
    value = 0;
  }
  cached = { key, value };
  return value;
}
