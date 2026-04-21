// packages/measurements/src/types.ts

export type MeasurementType = 'distance' | 'area' | 'volume' | 'height' | 'angle';

export interface MeasurementPoint {
  x: number;
  y: number;
  z: number;
}

export interface Measurement {
  id: string;
  type: MeasurementType;
  label: string;
  points: MeasurementPoint[];
  result: number | null; // metres / metres² / metres³
  unit: 'm' | 'm²' | 'm³' | '°';
  createdAt: number;
  color: string;
}
