// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseActivityFile, toGpx } from './parse';

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
 <metadata><time>2026-11-01T07:00:00Z</time></metadata>
 <trk><name>Morning Run</name><type>running</type>
  <trkseg>
   <trkpt lat="40.7812000" lon="-73.9665000"><ele>30.1</ele><time>2026-11-01T07:00:00Z</time></trkpt>
   <trkpt lat="40.7813000" lon="-73.9664000"><ele>30.3</ele><time>2026-11-01T07:00:05Z</time></trkpt>
  </trkseg>
 </trk>
</gpx>`;

const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
 <Activities><Activity Sport="Running"><Id>2026-11-01T07:00:00Z</Id><Lap><Track>
  <Trackpoint><Time>2026-11-01T07:00:00Z</Time><Position><LatitudeDegrees>51.5</LatitudeDegrees><LongitudeDegrees>-0.12</LongitudeDegrees></Position></Trackpoint>
  <Trackpoint><Time>2026-11-01T07:00:03Z</Time><HeartRateBpm><Value>140</Value></HeartRateBpm></Trackpoint>
  <Trackpoint><Time>2026-11-01T07:00:06Z</Time><Position><LatitudeDegrees>51.5001</LatitudeDegrees><LongitudeDegrees>-0.1201</LongitudeDegrees></Position></Trackpoint>
 </Track></Lap></Activity></Activities>
</TrainingCenterDatabase>`;

describe('activity file parsing', () => {
  it('reads a Strava-style GPX', () => {
    const f = parseActivityFile(GPX, 'a.gpx');
    expect(f.format).toBe('gpx');
    expect(f.name).toBe('Morning Run');
    expect(f.points).toHaveLength(2);
    expect(f.points[1]).toEqual({ lat: 40.7813, lon: -73.9664, t: Date.parse('2026-11-01T07:00:05Z') });
  });

  it('reads a Garmin TCX and skips points without a position', () => {
    const f = parseActivityFile(TCX, 'b.tcx');
    expect(f.format).toBe('tcx');
    expect(f.points).toHaveLength(2);
    expect(f.points[0].lat).toBe(51.5);
  });

  it('keeps points without time (they get rejected later as a planned route)', () => {
    const f = parseActivityFile(GPX.replace(/<time>[^<]+<\/time>/g, ''), 'c.gpx');
    expect(f.points[0].t).toBeUndefined();
  });

  it('round-trips through toGpx', () => {
    const pts = [
      { lat: 1.5, lon: 2.5, t: Date.parse('2026-01-01T00:00:00Z') },
      { lat: 1.6, lon: 2.6, t: Date.parse('2026-01-01T00:00:10Z') },
    ];
    const f = parseActivityFile(toGpx('Demo <run>', pts), 'd.gpx');
    expect(f.name).toBe('Demo run');
    expect(f.points).toEqual(pts);
  });

  it('gives helpful errors', () => {
    expect(() => parseActivityFile('not xml at all <', 'x.gpx')).toThrow(/valid XML/);
    expect(() => parseActivityFile('<gpx></gpx>', 'y.gpx')).toThrow(/no GPS track/);
    expect(() => parseActivityFile('<x/>', 'z.fit')).toThrow(/FIT/);
  });
});
