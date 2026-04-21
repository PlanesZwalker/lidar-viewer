// packages/measurements/src/computations.ts
// Pure math functions — no Three.js dependency so they can run in any context.

import type { MeasurementPoint } from './types.js';

/** Total polyline length between all consecutive points. */
export function computeDistance(points: MeasurementPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.sqrt(
      (b.x - a.x) ** 2 +
      (b.y - a.y) ** 2 +
      (b.z - a.z) ** 2,
    );
  }
  return total;
}

/**
 * Polygon area using the Shoelace (Gauss) formula projected onto the XZ plane.
 * Suitable for near-horizontal construction site surfaces.
 */
export function computeArea(points: MeasurementPoint[]): number {
  const n = points.length;
  if (n < 3) return 0;

  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

/**
 * Bounding-box volume between two diagonal corner points.
 * Volume = |dx| × |dy| × |dz|
 *
 * The user clicks one corner of a feature (e.g. base of a building) then the
 * opposite diagonal corner (e.g. top of the same building).  This gives the
 * axis-aligned bounding box volume, which is the most useful single-number
 * measure of object size in a LiDAR scene.
 */
export function computeVolume(points: MeasurementPoint[]): number {
  if (points.length < 2) return 0;
  const a = points[0]!;
  const b = points[1]!;
  return Math.abs(b.x - a.x) * Math.abs(b.y - a.y) * Math.abs(b.z - a.z);
}
