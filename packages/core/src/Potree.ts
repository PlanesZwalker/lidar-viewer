// packages/core/src/Potree.ts
// Central manager — orchestrates loading, octree traversal, and frame updates.

import * as THREE from 'three';
import { OctreeLoader } from './loaders/OctreeLoader.js';
import { PointCloudOctree } from './PointCloudOctree.js';
import { OctreeGeometryNode, NodeState } from './geometry/OctreeGeometryNode.js';
import { OctreeTraversalWorkerHost } from './workers/OctreeTraversalWorkerHost.js';
import type { IPointCloudLoader, PointCloudLoaderOptions } from './loaders/IPointCloudLoader.js';

export class Potree {
  pointBudget = 4_000_000;
  minNodeSize = 50;

  private readonly loader: IPointCloudLoader;
  private readonly traversalWorker = new OctreeTraversalWorkerHost();
  private readonly pointClouds: PointCloudOctree[] = [];
  private readonly loadQueue: OctreeGeometryNode[] = [];
  /** Number of nodes currently being loaded (HTTP+decode in flight). */
  private concurrentLoads = 0;
  /** Maximum simultaneous node loads. HTTP/2 multiplexing handles this well at 6–8. */
  private readonly MAX_CONCURRENT = 6;

  constructor(loader?: IPointCloudLoader) {
    this.loader = loader ?? new OctreeLoader();
  }

  /**
   * Load a point cloud from a URL.
   * Accepts Potree 2.0 metadata.json — for COPC use the COPCLoader from @lidar-viewer/copc.
   */
  async loadPointCloud(
    url: string,
    options?: PointCloudLoaderOptions,
  ): Promise<PointCloudOctree> {
    const geometry = await this.loader.loadMetadata(url, options);
    const pco = new PointCloudOctree(geometry);
    this.pointClouds.push(pco);
    return pco;
  }

  /**
   * Call once per frame in your render loop.
   * Runs octree traversal in the worker and dispatches node loads.
   */
  async updatePointClouds(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
  ): Promise<void> {
    const size = renderer.getSize(new THREE.Vector2());
    for (const pco of this.pointClouds) {
      // Keep screenHeight uniform in sync so point size attenuation is correct
      const mat = pco.material;
      if (mat.uniforms['uScreenHeight']) {
        mat.uniforms['uScreenHeight'].value = size.height;
      }
      const result = await this.traversalWorker.traverse(
        pco.allNodes,
        camera,
        renderer,
        this.pointBudget,
        this.minNodeSize,
        pco.position,
      );

      pco.applyVisibility(new Set(result.visibleNames));

      // Queue loads
      for (const name of result.loadNames) {
        const node = pco.allNodes.get(name);
        if (node && node.state === NodeState.UNLOADED) {
          this.loadQueue.push(node);
          node.state = NodeState.LOADING;
        }
      }

      // Drain load queue (non-blocking: one node per tick max to avoid main-thread jank)
      this.drainLoadQueue(pco);
    }
  }

  private drainLoadQueue(pco: PointCloudOctree): void {
    // Fill all available concurrency slots in one pass
    while (this.concurrentLoads < this.MAX_CONCURRENT && this.loadQueue.length > 0) {
      const node = this.loadQueue.shift()!;
      this.concurrentLoads++;

      this.loader
        .loadNode(node, pco.geometry)
        .catch((err: unknown) => {
          console.warn('Potree: node load failed', node.name, err);
        })
        .finally(() => {
          this.concurrentLoads--;
          // Refill any freed slot immediately
          this.drainLoadQueue(pco);
        });
    }
  }

  dispose(): void {
    this.traversalWorker.dispose();
    for (const pco of this.pointClouds) pco.dispose();
    this.pointClouds.length = 0;
  }
}
