declare module 'magvar' {
  /** Magnetic declination in degrees (east positive) from the World Magnetic Model 2025. */
  export function magvar(latitude: number, longitude: number, altitudeKm?: number, when?: number | Date): number;
}
