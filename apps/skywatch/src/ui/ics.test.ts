import { describe, expect, it } from 'vitest';
import { buildIcs, icsEscape, icsFold } from './ics';

describe('iCalendar export', () => {
  const ics = buildIcs(
    [
      {
        uid: '25544-20190605T124330Z@skywatch',
        start: new Date('2019-06-05T12:43:30Z'),
        end: new Date('2019-06-05T12:49:00Z'),
        summary: 'ISS pass, up to 67°',
        description: 'Look WNW; it rises, then fades in the SE.\nAbout 6 minutes.',
        alarmMinutes: 10,
      },
    ],
    new Date('2019-06-01T00:00:00Z'),
  );
  const lines = ics.split('\r\n');

  it('is a valid single-event calendar with CRLF line endings', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(lines).toContain('DTSTART:20190605T124330Z');
    expect(lines).toContain('DTEND:20190605T124900Z');
    expect(lines).toContain('TRIGGER:-PT10M');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
  });

  it('escapes text and folds long lines at 75 octets', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\;c\\\\d\\ne');
    const long = `DESCRIPTION:${'°'.repeat(60)}`;
    const folded = icsFold(long).split('\r\n');
    expect(folded.length).toBeGreaterThan(1);
    for (const l of folded) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(long);
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
  });
});
