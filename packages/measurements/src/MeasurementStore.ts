// packages/measurements/src/MeasurementStore.ts
// Lightweight observable store for measurements — no external state library needed.

import type { Measurement, MeasurementType, MeasurementPoint } from './types.js';
import { computeDistance, computeArea, computeVolume } from './computations.js';

type Listener = (measurements: Measurement[]) => void;

export class MeasurementStore {
  private measurements: Measurement[] = [];
  private listeners: Set<Listener> = new Set();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn([...this.measurements]); // immediate call with current state
    return () => this.listeners.delete(fn);
  }

  getAll(): Measurement[] {
    return [...this.measurements];
  }

  getById(id: string): Measurement | undefined {
    return this.measurements.find((m) => m.id === id);
  }

  add(type: MeasurementType, label?: string): string {
    const id = crypto.randomUUID();
    const measurement: Measurement = {
      id,
      type,
      label: label ?? `${type} ${this.measurements.length + 1}`,
      points: [],
      result: null,
      unit: unitFor(type),
      createdAt: Date.now(),
      color: randomColor(),
    };
    this.measurements.push(measurement);
    this.notify();
    return id;
  }

  addPoint(id: string, point: MeasurementPoint): void {
    const m = this.measurements.find((x) => x.id === id);
    if (!m) return;
    m.points.push(point);
    this.recompute(m);
    this.notify();
  }

  updatePoint(id: string, index: number, point: MeasurementPoint): void {
    const m = this.measurements.find((x) => x.id === id);
    if (!m || index < 0 || index >= m.points.length) return;
    m.points[index] = point;
    this.recompute(m);
    this.notify();
  }

  remove(id: string): void {
    this.measurements = this.measurements.filter((m) => m.id !== id);
    this.notify();
  }

  clear(): void {
    this.measurements = [];
    this.notify();
  }

  private recompute(m: Measurement): void {
    switch (m.type) {
      case 'distance':
        m.result = m.points.length >= 2 ? computeDistance(m.points) : null;
        break;
      case 'area':
        m.result = m.points.length >= 3 ? computeArea(m.points) : null;
        break;
      case 'volume':
        m.result = m.points.length >= 2 ? computeVolume(m.points) : null;
        break;
      case 'height':
        m.result = m.points.length === 2 ? Math.abs(m.points[1]!.y - m.points[0]!.y) : null;
        break;
      case 'angle':
        m.result = m.points.length === 3 ? computeAngle(m.points) : null;
        break;
    }
  }

  private notify(): void {
    const snapshot = [...this.measurements];
    for (const fn of this.listeners) fn(snapshot);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function unitFor(type: MeasurementType): Measurement['unit'] {
  switch (type) {
    case 'distance': case 'height': return 'm';
    case 'area': return 'm²';
    case 'volume': return 'm³';
    case 'angle': return '°';
  }
}

function randomColor(): string {
  const palette = ['#ff4444', '#44ff44', '#4488ff', '#ffaa00', '#ff44ff', '#00ffff'];
  return palette[Math.floor(Math.random() * palette.length)] ?? '#ffffff';
}

function computeAngle(pts: MeasurementPoint[]): number {
  const [a, b, c] = pts as [MeasurementPoint, MeasurementPoint, MeasurementPoint];
  const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
  const lenBa = Math.sqrt(ba.x ** 2 + ba.y ** 2 + ba.z ** 2);
  const lenBc = Math.sqrt(bc.x ** 2 + bc.y ** 2 + bc.z ** 2);
  if (lenBa === 0 || lenBc === 0) return 0;
  return (Math.acos(dot / (lenBa * lenBc)) * 180) / Math.PI;
}
