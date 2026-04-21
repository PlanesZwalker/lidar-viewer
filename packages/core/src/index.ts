// packages/core/src/index.ts
// Public API surface for @lidar-viewer/core

export { Potree } from './Potree.js';
export { PointCloudOctree } from './PointCloudOctree.js';
export { PointCloudOctreeNode } from './PointCloudOctreeNode.js';
export { PointCloudMaterial } from './materials/PointCloudMaterial.js';
export { GaussianSplatMaterial } from './materials/GaussianSplatMaterial.js';
export { OctreeLoader } from './loaders/OctreeLoader.js';
export { OctreeGeometry } from './geometry/OctreeGeometry.js';
export { OctreeGeometryNode, NodeState } from './geometry/OctreeGeometryNode.js';
export { OctreeTraversalWorkerHost } from './workers/OctreeTraversalWorkerHost.js';
export { TransformFeedbackSorter } from './renderer/TransformFeedbackSorter.js';
export { BatchedDrawCall } from './renderer/BatchedDrawCall.js';
export { UniformBufferPool } from './renderer/UniformBufferPool.js';
export { EDLPass } from './renderer/EDLPass.js';
export { detectTier, createFpsWatchdog, type RenderTier, type TierConfig } from './renderer/TierDetector.js';

export type {
  IPointCloudLoader,
  PointCloudLoaderOptions,
} from './loaders/IPointCloudLoader.js';
export type { NodeData, OctreeHierarchy, PointCloudMetadata, BoundingBox, PointAttribute } from './geometry/types.js';
export type { ColorMode } from './materials/PointCloudMaterial.js';
export { COLOR_MODE_INDEX } from './materials/PointCloudMaterial.js';
