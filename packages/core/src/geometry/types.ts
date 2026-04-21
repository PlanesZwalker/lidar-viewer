// packages/core/src/geometry/types.ts

export interface NodeData {
  name: string;
  numPoints: number;
  children: (NodeData | null)[];
  spacing: number;
  byteOffset?: number;
  byteSize?: number;
}

export interface OctreeHierarchy {
  root: NodeData;
  nodes: Map<string, NodeData>;
}

export interface PointAttributeType {
  name: string;
  size: number;
  elements: number;
  elementSize: number;
}

export type PointAttributeName =
  | 'POSITION_CARTESIAN'
  | 'COLOR_PACKED'
  | 'RGBA'
  | 'INTENSITY'
  | 'CLASSIFICATION'
  | 'NORMAL_FLOATS'
  | 'RETURN_NUMBER'
  | 'NUMBER_OF_RETURNS'
  | 'SOURCE_ID'
  | 'GPS_TIME'
  | 'NORMAL_SPHEREMAPPED'
  | 'NORMAL_OCT16'
  | 'NORMAL';

export interface PointAttribute {
  name: PointAttributeName | string;
  type: PointAttributeType;
  byteSize: number;
  byteOffset: number;
  description?: string;
}

export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface PointCloudMetadata {
  version: string;
  name: string;
  description?: string;
  points: number;
  projection?: string;
  hierarchy: { firstChunkSize?: number; stepSize: number; depth: number };
  offset: [number, number, number];
  scale: [number, number, number];
  spacing: number;
  boundingBox: BoundingBox;
  encoding?: string;
  attributes: PointAttribute[];
  /** True when the file contains actual RGB camera colours (LAS PDRF 2/3/5/7/8/10). */
  hasRGB?: boolean;
  /**
   * Real altitude range from the LAS header (not the padded COPC cube).
   * [altitudeMin, altitudeMax] in the same units as position.y after Y↔Z swap.
   */
  elevationRange?: [number, number];
}
