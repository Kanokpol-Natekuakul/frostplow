/**
 * FrostPlow villages: road layouts and procedural prop placement.
 * Roads are SVG path data in a 0-100 map space (1 unit = 0.9 m), stroked with round caps by Path2D.
 */
import type { WeatherType } from './types.ts';

export interface RoadStroke {
  width: number;
  d: string;
}

export interface VillageDef {
  name: string;
  weather: WeatherType;
  pay: number; // coin multiplier: later villages are bigger jobs
  seed: number; // prop layout seed, so a village always looks the same
  roads: RoadStroke[];
}

const ring = (cx: number, cy: number, r: number) =>
  `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} Z`;

export const VILLAGES: VillageDef[] = [
  {
    name: 'Pinewood Hollow',
    weather: 'flurries',
    pay: 1,
    seed: 11,
    roads: [
      { width: 8.2, d: ring(50, 50, 36) },
      { width: 8.2, d: 'M 14 50 L 86 50 M 50 14 L 50 86' },
      { width: 8.2, d: ring(50, 50, 14) },
      { width: 5.5, d: 'M 30 30 L 22 22 M 70 30 L 78 22 M 30 70 L 22 78 M 70 70 L 78 78' },
    ],
  },
  {
    name: 'Larchwood Valley',
    weather: 'sunny',
    pay: 1.5,
    seed: 23,
    roads: [
      // Two winding high streets crossing in the square, inside a narrow ring lane with dead-end spurs
      { width: 7.4, d: 'M 12 22 C 32 22, 30 50, 50 50 S 68 78, 88 78' },
      { width: 7.4, d: 'M 12 78 C 32 78, 30 50, 50 50 S 68 22, 88 22' },
      { width: 5.6, d: 'M 22 12 L 78 12 Q 88 12 88 22 L 88 78 Q 88 88 78 88 L 22 88 Q 12 88 12 78 L 12 22 Q 12 12 22 12 Z' },
      { width: 5.6, d: 'M 50 12 L 50 30 M 50 88 L 50 70' },
    ],
  },
  {
    name: 'Frostpeak Pass',
    weather: 'blizzard',
    pay: 2,
    seed: 37,
    roads: [
      // Switchbacks up the pass, a service road cutting across them, squares at both ends
      { width: 6.4, d: 'M 14 86 L 76 80 Q 90 78 80 66 L 24 58 Q 10 56 20 45 L 76 38 Q 90 36 80 25 L 26 16' },
      { width: 5, d: 'M 56 88 L 56 14' },
      // Squares: a near-zero-length stroke with round caps is a filled disc (a thick ring leaves a hole)
      { width: 18, d: 'M 22 15 l 0.01 0' },
      { width: 14, d: 'M 14 86 l 0.01 0' },
    ],
  },
];

export interface PropLayout {
  chalets: { x: number; z: number; rot: number }[];
  trees: { x: number; z: number }[];
  lamps: { x: number; z: number }[];
  snowman: { x: number; z: number };
}

/** Distance in pixels from every pixel to the nearest road pixel (two-pass chamfer). */
export function roadDistance(road: Uint8Array, size: number): Float32Array {
  const d = new Float32Array(size * size);
  for (let i = 0; i < d.length; i++) d[i] = road[i] ? 0 : 1e9;
  const D2 = Math.SQRT2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - size] + 1);
        if (x > 0) v = Math.min(v, d[i - size - 1] + D2);
        if (x < size - 1) v = Math.min(v, d[i - size + 1] + D2);
      }
      d[i] = v;
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      let v = d[i];
      if (x < size - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < size - 1) {
        v = Math.min(v, d[i + size] + 1);
        if (x < size - 1) v = Math.min(v, d[i + size + 1] + D2);
        if (x > 0) v = Math.min(v, d[i + size - 1] + D2);
      }
      d[i] = v;
    }
  }
  return d;
}

/** Small deterministic PRNG (mulberry32). */
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chalets beside the roads with doors facing them, lamps on the verges, trees in the open; nothing on a road. */
export function layoutProps(road: Uint8Array, size: number, worldSize: number, seed: number): PropLayout {
  const dist = roadDistance(road, size);
  const m = worldSize / size; // metres per pixel
  const rand = seededRandom(seed);
  const toWorld = (p: number) => (p + 0.5) * m - worldSize / 2;

  const margin = Math.ceil(7 / m); // keep clear of the perimeter hills
  const cands: number[] = [];
  for (let y = margin; y < size - margin; y += 3) {
    for (let x = margin; x < size - margin; x += 3) cands.push(y * size + x);
  }
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }

  const taken: { x: number; z: number; r: number }[] = [];
  const place = (minM: number, maxM: number, r: number, max: number) => {
    const out: { i: number; x: number; z: number }[] = [];
    for (const i of cands) {
      if (out.length >= max) break;
      const d = dist[i] * m;
      if (d < minM || d > maxM) continue;
      const x = toWorld(i % size);
      const z = toWorld(Math.floor(i / size));
      if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r)) continue;
      taken.push({ x, z, r });
      out.push({ i, x, z });
    }
    return out;
  };

  const chalets = place(4.8, 7.5, 6, 8).map(({ i, x, z }) => {
    // The door is +z in model space: turn it down the distance gradient, i.e. towards the road
    const gx = dist[i + 1] - dist[i - 1];
    const gz = dist[i + size] - dist[i - size];
    return { x, z, rot: Math.atan2(-gx, -gz) };
  });
  const lamps = place(1.2, 2.2, 6, 8).map(({ x, z }) => ({ x, z }));
  const snowman = place(3, 8, 2, 1).map(({ x, z }) => ({ x, z }))[0] ?? { x: 0, z: 0 };
  const trees = place(3, Infinity, 2.2, 22).map(({ x, z }) => ({ x, z }));
  return { chalets, trees, lamps, snowman };
}
