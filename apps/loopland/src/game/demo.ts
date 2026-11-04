// A synthetic demo season so people can see the game without uploading anything.
import { rectangle, trackFromOffsets } from './testkit';
import type { Activity, Player } from './types';

export const DEMO_ORIGIN = { lat: 40.7812, lon: -73.9665, label: 'Central Park, NYC' };

export const DEMO_PLAYERS: Player[] = [
  { id: 'blaze', name: 'Blaze', color: '#2f80ff' },
  { id: 'nova', name: 'Nova', color: '#ffb000' },
];

export function demoActivities(youId: string, now = Date.now()): Activity[] {
  const day = 86_400_000;
  const at = (daysAgo: number, hour: number) => {
    const d = new Date(now - daysAgo * day);
    d.setHours(hour, 0, 0, 0);
    return Math.min(d.getTime(), now - 2 * 3600_000);
  };
  const mk = (id: string, playerId: string, name: string, start: number, wps: [number, number][], seed: number, speed = 3): Activity => ({
    id: `demo-${id}`,
    playerId,
    name,
    startedAt: start,
    source: 'demo',
    points: trackFromOffsets(DEMO_ORIGIN, wps, { start, speed, everyS: 3, jitterM: 4, seed }),
  });
  return [
    mk('1', 'nova', 'Old loop (fading)', at(20, 7), rectangle(-1500, 900, 500, 400), 7),
    mk('2', youId, 'First loop', at(6, 7), rectangle(0, 0, 900, 700), 1),
    mk('3', 'blaze', 'Raid on the east side', at(5, 18), rectangle(550, 150, 700, 600), 2, 3.4),
    mk('4', 'nova', 'Figure eight', at(3, 6), [[-1200, -900], [-800, -500], [-400, -900], [-400, -500], [-800, -900], [-1200, -500], [-1200, -900]], 3),
    mk('5', youId, 'Revenge excursion', at(2, 7), [[0, -250], [1050, -250], [1050, 300], [150, 300]], 4),
    mk('6', 'blaze', 'Long out-and-back', at(1, 19), [[-200, 1300], [1800, 1300], [-200, 1300]], 5, 3.6),
    mk('7', 'nova', 'Southern strip', at(0, 6), rectangle(-200, -520, 700, 500), 6),
  ];
}
