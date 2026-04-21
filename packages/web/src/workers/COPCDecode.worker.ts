// COPC decode worker — handles LAZ decompression + point conversion off the main thread.
// Each message fetches one node's point data, decodes it (laz-perf WASM), converts
// XYZ + RGB/CLS/INT to Float32Arrays, and posts them back as Transferables.
//
// Caches the CopcData instance per URL so Copc.create() (which parses the LAS
// header) is only called once per file regardless of how many nodes are decoded.

import { Copc } from 'copc';

// ─── Types shared with COPCWorkerPoolLoader ───────────────────────────────────

export interface DecodeRequest {
  id: number;
  url: string;
  pointDataOffset: number;
  pointDataLength: number;
  pointCount: number;
}

export interface DecodeResult {
  id: number;
  positions: Float32Array;
  colors: Float32Array;
  colorsClass: Float32Array;
  colorsIntensity: Float32Array;
}

export interface DecodeError {
  id: number;
  error: string;
}

// ─── Classification colour palette (ASPRS + IGN LiDAR HD) ────────────────────

const CLASS_COLORS: readonly [number, number, number][] = [
  [0.5, 0.5, 0.5],  // 0  Never classified
  [0.5, 0.5, 0.5],  // 1  Unclassified
  [0.6, 0.4, 0.2],  // 2  Ground
  [0.3, 0.7, 0.3],  // 3  Low vegetation
  [0.1, 0.6, 0.1],  // 4  Medium vegetation
  [0.0, 0.4, 0.0],  // 5  High vegetation
  [0.8, 0.2, 0.2],  // 6  Building
  [1.0, 0.0, 0.0],  // 7  Low point (noise)
  [0.9, 0.9, 0.9],  // 8  Reserved
  [0.2, 0.8, 0.9],  // 9  Water
  [0.5, 0.5, 0.5],  // 10 Rail
  [0.9, 0.7, 0.3],  // 11 Road surface
];

// ─── CopcData cache (one entry per URL) ──────────────────────────────────────

const copcCache = new Map<string, Awaited<ReturnType<typeof Copc.create>>>();

async function getCopc(url: string) {
  let c = copcCache.get(url);
  if (!c) {
    c = await Copc.create(url);
    copcCache.set(url, c);
  }
  return c;
}

// ─── Main message handler ─────────────────────────────────────────────────────

self.onmessage = async (evt: MessageEvent<DecodeRequest>) => {
  const { id, url, pointDataOffset, pointDataLength, pointCount } = evt.data;

  try {
    const copcData = await getCopc(url);

    // Fetch and LAZ-decompress the node's point data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view: any = await Copc.loadPointDataView(url, copcData, {
      pointDataOffset,
      pointDataLength,
      pointCount,
    });

    const n: number = view.pointCount as number;
    const getX = view.getter('X') as (i: number) => number;
    const getY = view.getter('Y') as (i: number) => number;
    const getZ = view.getter('Z') as (i: number) => number;

    let getR: ((i: number) => number) | null = null;
    let getG: ((i: number) => number) | null = null;
    let getB: ((i: number) => number) | null = null;
    try { getR = view.getter('Red'); getG = view.getter('Green'); getB = view.getter('Blue'); }
    catch { /* PDRF without RGB */ }

    let getI: ((i: number) => number) | null = null;
    try { getI = view.getter('Intensity'); } catch { /* no intensity */ }

    let getCls: ((i: number) => number) | null = null;
    try { getCls = view.getter('Classification'); } catch { /* no classification */ }

    const positions       = new Float32Array(n * 3);
    const colors          = new Float32Array(n * 3);
    const colorsClass     = new Float32Array(n * 3);
    const colorsIntensity = new Float32Array(n * 3);

    for (let i = 0; i < n; i++) {
      const b = i * 3;

      // LAS Y↔Z swap: altitude (LAS Z) → Three.js Y (up), northing (LAS Y) → Three.js Z
      positions[b + 0] = getX(i);
      positions[b + 1] = getZ(i);  // altitude → Y
      positions[b + 2] = getY(i);  // northing → Z

      // RGB
      if (getR && getG && getB) {
        colors[b + 0] = getR(i) / 65535;
        colors[b + 1] = getG(i) / 65535;
        colors[b + 2] = getB(i) / 65535;
      } else {
        colors[b + 0] = colors[b + 1] = colors[b + 2] = 0.8;
      }

      // Classification
      const cls = getCls ? Math.min(Math.max(0, getCls(i)), CLASS_COLORS.length - 1) : 1;
      const cc = CLASS_COLORS[cls] ?? CLASS_COLORS[1]!;
      colorsClass[b + 0] = cc[0];
      colorsClass[b + 1] = cc[1];
      colorsClass[b + 2] = cc[2];

      // Intensity
      const intensity = getI ? getI(i) / 65535 : 0.5;
      colorsIntensity[b + 0] = colorsIntensity[b + 1] = colorsIntensity[b + 2] = intensity;
    }

    // Transfer the underlying ArrayBuffers — zero-copy hand-off to main thread
    const result: DecodeResult = { id, positions, colors, colorsClass, colorsIntensity };
    (self as unknown as Worker).postMessage(result, [
      positions.buffer,
      colors.buffer,
      colorsClass.buffer,
      colorsIntensity.buffer,
    ]);
  } catch (err) {
    const msg: DecodeError = { id, error: String(err) };
    (self as unknown as Worker).postMessage(msg);
  }
};
