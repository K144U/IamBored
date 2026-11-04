// A small offline city list so people can pick a place without typing coordinates
// (and without sending what they type to a geocoding service).

export interface City {
  name: string;
  country: string;
  lat: number;
  lon: number;
}

const RAW: [string, string, number, number][] = [
  ['Accra', 'Ghana', 5.56, -0.2],
  ['Addis Ababa', 'Ethiopia', 9.03, 38.74],
  ['Ahmedabad', 'India', 23.03, 72.58],
  ['Amsterdam', 'Netherlands', 52.37, 4.9],
  ['Anchorage', 'USA', 61.22, -149.9],
  ['Athens', 'Greece', 37.98, 23.73],
  ['Atlanta', 'USA', 33.75, -84.39],
  ['Auckland', 'New Zealand', -36.85, 174.76],
  ['Bangalore', 'India', 12.97, 77.59],
  ['Bangkok', 'Thailand', 13.76, 100.5],
  ['Barcelona', 'Spain', 41.39, 2.17],
  ['Beijing', 'China', 39.9, 116.4],
  ['Berlin', 'Germany', 52.52, 13.4],
  ['Bogotá', 'Colombia', 4.71, -74.07],
  ['Boston', 'USA', 42.36, -71.06],
  ['Brisbane', 'Australia', -27.47, 153.03],
  ['Brussels', 'Belgium', 50.85, 4.35],
  ['Bucharest', 'Romania', 44.43, 26.1],
  ['Budapest', 'Hungary', 47.5, 19.04],
  ['Buenos Aires', 'Argentina', -34.6, -58.38],
  ['Cairo', 'Egypt', 30.04, 31.24],
  ['Cape Town', 'South Africa', -33.92, 18.42],
  ['Chennai', 'India', 13.08, 80.27],
  ['Chicago', 'USA', 41.88, -87.63],
  ['Copenhagen', 'Denmark', 55.68, 12.57],
  ['Dallas', 'USA', 32.78, -96.8],
  ['Delhi', 'India', 28.61, 77.21],
  ['Denver', 'USA', 39.74, -104.99],
  ['Dhaka', 'Bangladesh', 23.81, 90.41],
  ['Dubai', 'UAE', 25.2, 55.27],
  ['Dublin', 'Ireland', 53.35, -6.26],
  ['Edinburgh', 'UK', 55.95, -3.19],
  ['Hanoi', 'Vietnam', 21.03, 105.85],
  ['Helsinki', 'Finland', 60.17, 24.94],
  ['Ho Chi Minh City', 'Vietnam', 10.82, 106.63],
  ['Hong Kong', 'China', 22.32, 114.17],
  ['Honolulu', 'USA', 21.31, -157.86],
  ['Houston', 'USA', 29.76, -95.37],
  ['Hyderabad', 'India', 17.39, 78.49],
  ['Istanbul', 'Türkiye', 41.01, 28.98],
  ['Jakarta', 'Indonesia', -6.21, 106.85],
  ['Jerusalem', 'Israel', 31.77, 35.21],
  ['Johannesburg', 'South Africa', -26.2, 28.05],
  ['Karachi', 'Pakistan', 24.86, 67.01],
  ['Kathmandu', 'Nepal', 27.72, 85.32],
  ['Kolkata', 'India', 22.57, 88.36],
  ['Kuala Lumpur', 'Malaysia', 3.14, 101.69],
  ['Lagos', 'Nigeria', 6.52, 3.38],
  ['Lahore', 'Pakistan', 31.55, 74.34],
  ['Lima', 'Peru', -12.05, -77.04],
  ['Lisbon', 'Portugal', 38.72, -9.14],
  ['London', 'UK', 51.51, -0.13],
  ['Los Angeles', 'USA', 34.05, -118.24],
  ['Madrid', 'Spain', 40.42, -3.7],
  ['Manchester', 'UK', 53.48, -2.24],
  ['Manila', 'Philippines', 14.6, 120.98],
  ['Melbourne', 'Australia', -37.81, 144.96],
  ['Mexico City', 'Mexico', 19.43, -99.13],
  ['Miami', 'USA', 25.76, -80.19],
  ['Milan', 'Italy', 45.46, 9.19],
  ['Montreal', 'Canada', 45.5, -73.57],
  ['Moscow', 'Russia', 55.76, 37.62],
  ['Mumbai', 'India', 19.08, 72.88],
  ['Munich', 'Germany', 48.14, 11.58],
  ['Nairobi', 'Kenya', -1.29, 36.82],
  ['New York', 'USA', 40.71, -74.01],
  ['Osaka', 'Japan', 34.69, 135.5],
  ['Oslo', 'Norway', 59.91, 10.75],
  ['Paris', 'France', 48.86, 2.35],
  ['Perth', 'Australia', -31.95, 115.86],
  ['Phoenix', 'USA', 33.45, -112.07],
  ['Prague', 'Czechia', 50.08, 14.44],
  ['Pune', 'India', 18.52, 73.86],
  ['Reykjavík', 'Iceland', 64.15, -21.94],
  ['Rio de Janeiro', 'Brazil', -22.91, -43.17],
  ['Riyadh', 'Saudi Arabia', 24.71, 46.68],
  ['Rome', 'Italy', 41.9, 12.5],
  ['San Francisco', 'USA', 37.77, -122.42],
  ['Santiago', 'Chile', -33.45, -70.67],
  ['São Paulo', 'Brazil', -23.55, -46.63],
  ['Seattle', 'USA', 47.61, -122.33],
  ['Seoul', 'South Korea', 37.57, 126.98],
  ['Shanghai', 'China', 31.23, 121.47],
  ['Singapore', 'Singapore', 1.35, 103.82],
  ['Stockholm', 'Sweden', 59.33, 18.07],
  ['Sydney', 'Australia', -33.87, 151.21],
  ['Taipei', 'Taiwan', 25.03, 121.57],
  ['Tehran', 'Iran', 35.69, 51.39],
  ['Tokyo', 'Japan', 35.68, 139.69],
  ['Toronto', 'Canada', 43.65, -79.38],
  ['Vancouver', 'Canada', 49.28, -123.12],
  ['Vienna', 'Austria', 48.21, 16.37],
  ['Warsaw', 'Poland', 52.23, 21.01],
  ['Washington', 'USA', 38.91, -77.04],
  ['Wellington', 'New Zealand', -41.29, 174.78],
  ['Zürich', 'Switzerland', 47.38, 8.54],
];

export const CITIES: City[] = RAW.map(([name, country, lat, lon]) => ({ name, country, lat, lon }));

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
