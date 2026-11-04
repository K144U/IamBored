import type { OMMJsonObject } from 'satellite.js';

/**
 * ISS elements from the well-known satellite.js README example TLE
 * (epoch 2019-06-05 12:12:58 UTC), converted to OMM JSON (CelesTrak format).
 * Only for tests: real use always fetches fresh data.
 */
export const ISS_2019: OMMJsonObject = {
  OBJECT_NAME: 'ISS (ZARYA)',
  OBJECT_ID: '1998-067A',
  EPOCH: '2019-06-05T12:12:57.999',
  MEAN_MOTION: 15.51174618,
  ECCENTRICITY: 0.0008217,
  INCLINATION: 51.6433,
  RA_OF_ASC_NODE: 59.2583,
  ARG_OF_PERICENTER: 16.4489,
  MEAN_ANOMALY: 347.6017,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 25544,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 17344,
  BSTAR: 0.59442e-4,
  MEAN_MOTION_DOT: 0.00003075,
  MEAN_MOTION_DDOT: 0,
};

export const T_2019 = new Date('2019-06-05T12:00:00Z');
