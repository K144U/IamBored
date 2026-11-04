import { describe, expect, it } from 'vitest';
import { identify, type Candidate } from './identify';

const moon: Candidate = { key: 'body:moon', kind: 'body', label: 'Moon', az: 120, el: 30, mag: -11 };
const sun: Candidate = { key: 'body:sun', kind: 'body', label: 'Sun', az: 200, el: 20, mag: -26 };
const iss: Candidate = { key: 'sat:25544', kind: 'sat', label: 'ISS', az: 125, el: 32, status: 'visible', important: true };
const dark: Candidate = { key: 'sat:1', kind: 'sat', label: 'Dark sat', az: 121, el: 30, status: 'eclipsed' };

describe('identify', () => {
  it('picks the Moon when pointing right at it', () => {
    const m = identify({ az: 120, el: 30 }, [moon, iss, dark], 3);
    expect(m[0].candidate.label).toBe('Moon');
    expect(m[0].confidence).toBeGreaterThan(0.6);
  });

  it('a nearby visible ISS beats an invisible satellite in Earth’s shadow', () => {
    const m = identify({ az: 124, el: 32 }, [iss, dark], 3);
    expect(m[0].candidate.label).toBe('ISS');
  });

  it('never suggests the Sun', () => {
    expect(identify({ az: 200, el: 20 }, [sun], 5)).toHaveLength(0);
  });

  it('nothing nearby → no answers', () => {
    expect(identify({ az: 300, el: 60 }, [moon, iss], 3)).toHaveLength(0);
  });

  it('confidences sum to less than 1 (room for "something else")', () => {
    const m = identify({ az: 122, el: 31 }, [moon, iss, dark], 12);
    const sum = m.reduce((s, x) => s + x.confidence, 0);
    expect(sum).toBeLessThan(1);
    expect(sum).toBeGreaterThan(0.8);
  });
});
