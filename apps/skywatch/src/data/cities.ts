// A small offline city list so people can pick a place without typing coordinates
// (and without sending what they type to a geocoding service).

export interface City {
  name: string;
  country: string;
  lat: number;
  lon: number;
  /** IANA time zone */
  tz: string;
}

const RAW: [string, string, number, number, string][] = [
  ['Accra', 'Ghana', 5.56, -0.2, 'Africa/Accra'],
  ['Addis Ababa', 'Ethiopia', 9.03, 38.74, 'Africa/Addis_Ababa'],
  ['Ahmedabad', 'India', 23.03, 72.58, 'Asia/Kolkata'],
  ['Amsterdam', 'Netherlands', 52.37, 4.9, 'Europe/Amsterdam'],
  ['Anchorage', 'USA', 61.22, -149.9, 'America/Anchorage'],
  ['Athens', 'Greece', 37.98, 23.73, 'Europe/Athens'],
  ['Atlanta', 'USA', 33.75, -84.39, 'America/New_York'],
  ['Auckland', 'New Zealand', -36.85, 174.76, 'Pacific/Auckland'],
  ['Bangalore', 'India', 12.97, 77.59, 'Asia/Kolkata'],
  ['Bangkok', 'Thailand', 13.76, 100.5, 'Asia/Bangkok'],
  ['Barcelona', 'Spain', 41.39, 2.17, 'Europe/Madrid'],
  ['Beijing', 'China', 39.9, 116.4, 'Asia/Shanghai'],
  ['Berlin', 'Germany', 52.52, 13.4, 'Europe/Berlin'],
  ['Bogotá', 'Colombia', 4.71, -74.07, 'America/Bogota'],
  ['Boston', 'USA', 42.36, -71.06, 'America/New_York'],
  ['Brisbane', 'Australia', -27.47, 153.03, 'Australia/Brisbane'],
  ['Brussels', 'Belgium', 50.85, 4.35, 'Europe/Brussels'],
  ['Bucharest', 'Romania', 44.43, 26.1, 'Europe/Bucharest'],
  ['Budapest', 'Hungary', 47.5, 19.04, 'Europe/Budapest'],
  ['Buenos Aires', 'Argentina', -34.6, -58.38, 'America/Argentina/Buenos_Aires'],
  ['Cairo', 'Egypt', 30.04, 31.24, 'Africa/Cairo'],
  ['Cape Town', 'South Africa', -33.92, 18.42, 'Africa/Johannesburg'],
  ['Chennai', 'India', 13.08, 80.27, 'Asia/Kolkata'],
  ['Chicago', 'USA', 41.88, -87.63, 'America/Chicago'],
  ['Copenhagen', 'Denmark', 55.68, 12.57, 'Europe/Copenhagen'],
  ['Dallas', 'USA', 32.78, -96.8, 'America/Chicago'],
  ['Delhi', 'India', 28.61, 77.21, 'Asia/Kolkata'],
  ['Denver', 'USA', 39.74, -104.99, 'America/Denver'],
  ['Dhaka', 'Bangladesh', 23.81, 90.41, 'Asia/Dhaka'],
  ['Dubai', 'UAE', 25.2, 55.27, 'Asia/Dubai'],
  ['Dublin', 'Ireland', 53.35, -6.26, 'Europe/Dublin'],
  ['Edinburgh', 'UK', 55.95, -3.19, 'Europe/London'],
  ['Hanoi', 'Vietnam', 21.03, 105.85, 'Asia/Ho_Chi_Minh'],
  ['Helsinki', 'Finland', 60.17, 24.94, 'Europe/Helsinki'],
  ['Ho Chi Minh City', 'Vietnam', 10.82, 106.63, 'Asia/Ho_Chi_Minh'],
  ['Hong Kong', 'China', 22.32, 114.17, 'Asia/Hong_Kong'],
  ['Honolulu', 'USA', 21.31, -157.86, 'Pacific/Honolulu'],
  ['Houston', 'USA', 29.76, -95.37, 'America/Chicago'],
  ['Hyderabad', 'India', 17.39, 78.49, 'Asia/Kolkata'],
  ['Istanbul', 'Türkiye', 41.01, 28.98, 'Europe/Istanbul'],
  ['Jakarta', 'Indonesia', -6.21, 106.85, 'Asia/Jakarta'],
  ['Jerusalem', 'Israel', 31.77, 35.21, 'Asia/Jerusalem'],
  ['Johannesburg', 'South Africa', -26.2, 28.05, 'Africa/Johannesburg'],
  ['Karachi', 'Pakistan', 24.86, 67.01, 'Asia/Karachi'],
  ['Kathmandu', 'Nepal', 27.72, 85.32, 'Asia/Kathmandu'],
  ['Kolkata', 'India', 22.57, 88.36, 'Asia/Kolkata'],
  ['Kuala Lumpur', 'Malaysia', 3.14, 101.69, 'Asia/Kuala_Lumpur'],
  ['Lagos', 'Nigeria', 6.52, 3.38, 'Africa/Lagos'],
  ['Lahore', 'Pakistan', 31.55, 74.34, 'Asia/Karachi'],
  ['Lima', 'Peru', -12.05, -77.04, 'America/Lima'],
  ['Lisbon', 'Portugal', 38.72, -9.14, 'Europe/Lisbon'],
  ['London', 'UK', 51.51, -0.13, 'Europe/London'],
  ['Los Angeles', 'USA', 34.05, -118.24, 'America/Los_Angeles'],
  ['Madrid', 'Spain', 40.42, -3.7, 'Europe/Madrid'],
  ['Manchester', 'UK', 53.48, -2.24, 'Europe/London'],
  ['Manila', 'Philippines', 14.6, 120.98, 'Asia/Manila'],
  ['Melbourne', 'Australia', -37.81, 144.96, 'Australia/Melbourne'],
  ['Mexico City', 'Mexico', 19.43, -99.13, 'America/Mexico_City'],
  ['Miami', 'USA', 25.76, -80.19, 'America/New_York'],
  ['Milan', 'Italy', 45.46, 9.19, 'Europe/Rome'],
  ['Montreal', 'Canada', 45.5, -73.57, 'America/Toronto'],
  ['Moscow', 'Russia', 55.76, 37.62, 'Europe/Moscow'],
  ['Mumbai', 'India', 19.08, 72.88, 'Asia/Kolkata'],
  ['Munich', 'Germany', 48.14, 11.58, 'Europe/Berlin'],
  ['Nairobi', 'Kenya', -1.29, 36.82, 'Africa/Nairobi'],
  ['New York', 'USA', 40.71, -74.01, 'America/New_York'],
  ['Osaka', 'Japan', 34.69, 135.5, 'Asia/Tokyo'],
  ['Oslo', 'Norway', 59.91, 10.75, 'Europe/Oslo'],
  ['Paris', 'France', 48.86, 2.35, 'Europe/Paris'],
  ['Perth', 'Australia', -31.95, 115.86, 'Australia/Perth'],
  ['Phoenix', 'USA', 33.45, -112.07, 'America/Phoenix'],
  ['Prague', 'Czechia', 50.08, 14.44, 'Europe/Prague'],
  ['Pune', 'India', 18.52, 73.86, 'Asia/Kolkata'],
  ['Reykjavík', 'Iceland', 64.15, -21.94, 'Atlantic/Reykjavik'],
  ['Rio de Janeiro', 'Brazil', -22.91, -43.17, 'America/Sao_Paulo'],
  ['Riyadh', 'Saudi Arabia', 24.71, 46.68, 'Asia/Riyadh'],
  ['Rome', 'Italy', 41.9, 12.5, 'Europe/Rome'],
  ['San Francisco', 'USA', 37.77, -122.42, 'America/Los_Angeles'],
  ['Santiago', 'Chile', -33.45, -70.67, 'America/Santiago'],
  ['São Paulo', 'Brazil', -23.55, -46.63, 'America/Sao_Paulo'],
  ['Seattle', 'USA', 47.61, -122.33, 'America/Los_Angeles'],
  ['Seoul', 'South Korea', 37.57, 126.98, 'Asia/Seoul'],
  ['Shanghai', 'China', 31.23, 121.47, 'Asia/Shanghai'],
  ['Singapore', 'Singapore', 1.35, 103.82, 'Asia/Singapore'],
  ['Stockholm', 'Sweden', 59.33, 18.07, 'Europe/Stockholm'],
  ['Sydney', 'Australia', -33.87, 151.21, 'Australia/Sydney'],
  ['Taipei', 'Taiwan', 25.03, 121.57, 'Asia/Taipei'],
  ['Tehran', 'Iran', 35.69, 51.39, 'Asia/Tehran'],
  ['Tokyo', 'Japan', 35.68, 139.69, 'Asia/Tokyo'],
  ['Toronto', 'Canada', 43.65, -79.38, 'America/Toronto'],
  ['Vancouver', 'Canada', 49.28, -123.12, 'America/Vancouver'],
  ['Vienna', 'Austria', 48.21, 16.37, 'Europe/Vienna'],
  ['Warsaw', 'Poland', 52.23, 21.01, 'Europe/Warsaw'],
  ['Washington', 'USA', 38.91, -77.04, 'America/New_York'],
  ['Wellington', 'New Zealand', -41.29, 174.78, 'Pacific/Auckland'],
  ['Zürich', 'Switzerland', 47.38, 8.54, 'Europe/Zurich'],
];

export const CITIES: City[] = RAW.map(([name, country, lat, lon, tz]) => ({ name, country, lat, lon, tz }));

/** Nearest listed city within `maxKm`, used to guess the time zone of typed coordinates. */
export function nearestCity(lat: number, lon: number, maxKm = 500): City | null {
  const r = Math.PI / 180;
  let best: City | null = null;
  let bestKm = maxKm;
  for (const c of CITIES) {
    const h =
      Math.sin(((c.lat - lat) * r) / 2) ** 2 + Math.cos(lat * r) * Math.cos(c.lat * r) * Math.sin(((c.lon - lon) * r) / 2) ** 2;
    const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  }
  return best;
}

export const cityLabel = (c: City) => `${c.name}, ${c.country}`;

/** "é" → "e", lower case, so "zurich" finds "Zürich". */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Exact label or name first, then the first city whose name starts with the query. */
export function findCity(query: string): City | null {
  const q = fold(query);
  if (!q) return null;
  return (
    CITIES.find((c) => fold(cityLabel(c)) === q || fold(c.name) === q) ??
    CITIES.find((c) => fold(c.name).startsWith(q)) ??
    null
  );
}

/** "40.71, -74.01" or "40.71 -74.01" → coordinates, or null. */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
