const R = 6_371_008.8;
const RAD = Math.PI / 180;

export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Move a point by metres east / north (fine for small offsets). */
export function offset(lat: number, lon: number, eastM: number, northM: number): { lat: number; lon: number } {
  return {
    lat: lat + northM / 111_320,
    lon: lon + eastM / (111_320 * Math.cos(lat * RAD)),
  };
}
