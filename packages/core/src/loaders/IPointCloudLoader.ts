// packages/core/src/loaders/IPointCloudLoader.ts
import type { OctreeGeometry } from '../geometry/OctreeGeometry.js';
import type { OctreeGeometryNode } from '../geometry/OctreeGeometryNode.js';

export interface PointCloudLoaderOptions {
  /** Callback to resolve a relative path to a full URL (e.g. for signed URLs). */
  getUrl?: (relativeUrl: string) => string | Promise<string>;
}

export interface IPointCloudLoader {
  /**
   * Load the cloud metadata and return a populated OctreeGeometry.
   * @param url  Full URL to the entry point (metadata.json for Potree 2.0, or .copc.laz for COPC).
   */
  loadMetadata(url: string, options?: PointCloudLoaderOptions): Promise<OctreeGeometry>;

  /**
   * Load the point data for a single node into its BufferGeometry.
   */
  loadNode(node: OctreeGeometryNode, geometry: OctreeGeometry): Promise<void>;
}
