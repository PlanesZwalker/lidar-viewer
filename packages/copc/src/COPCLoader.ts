// packages/copc/src/COPCLoader.ts
// Loads COPC (.copc.laz) files via HTTP range requests using the `copc` library.
// The `copc` library handles COPC VLR parsing, hierarchy loading, and LAZ decompression.
// Implements IPointCloudLoader from @lidar-viewer/core.

import * as THREE from 'three';
import { Copc, Bounds, Key } from 'copc';
import type { Hierarchy } from 'copc';
import { OctreeGeometry, OctreeGeometryNode, NodeState } from '@lidar-viewer/core';
import type {
  IPointCloudLoader,
  PointCloudLoaderOptions,
  PointCloudMetadata,
  BoundingBox,
  PointAttribute,
} from '@lidar-viewer/core';

// ─── Types ────────────────────────────────────────────────────────────────────

type CopcData = Awaited<ReturnType<typeof Copc.create>>;

interface CopcState {
  copc: CopcData;
  url: string;
  /** Maps OctreeGeometryNode.name → COPC Hierarchy.Node (for loadNode) */
  nodeMap: Map<string, Hierarchy.Node>;
}

/**
 * Optional off-thread decode hook injected from the web package.
 * If provided, replaces main-thread Copc.loadPointDataView + viewToBufferGeometry.
 * Receives the minimal numeric parameters so they can be transferred to a Web Worker.
 */
export type DecodeHook = (
  url: string,
  pointDataOffset: number,
  pointDataLength: number,
  pointCount: number,
) => Promise<THREE.BufferGeometry>;


// ─── COPCLoader ────────────────────────────────────────────────────────────────

export class COPCLoader implements IPointCloudLoader {
  constructor(private readonly decodeHook?: DecodeHook) {}
  async loadMetadata(
    url: string,
    _options?: PointCloudLoaderOptions,
  ): Promise<OctreeGeometry> {
    // 1. Parse COPC header + VLRs + CoPC Info VLR
    const copc = await Copc.create(url);
    const { header, info } = copc;
    const [minx, miny, minz, maxx, maxy, maxz] = info.cube;

    // 2. Load root hierarchy page + eagerly prefetch all sub-pages in parallel.
    // This avoids on-demand sub-page fetches later when the traversal reaches deep nodes.
    const subtree = await Copc.loadHierarchyPage(url, info.rootHierarchyPage);
    const allNodes = { ...subtree.nodes };

    // Collect any sub-page references returned by the root page and fetch them now.
    if (subtree.pages && Object.keys(subtree.pages).length > 0) {
      const pageValues = Object.values(subtree.pages) as { pageOffset: number; pageLength: number }[];
      const subPages = await Promise.allSettled(
        pageValues.map(p => Copc.loadHierarchyPage(url, p)),
      );
      for (const result of subPages) {
        if (result.status === 'fulfilled') {
          Object.assign(allNodes, result.value.nodes);
        }
      }
    }

    // 3. Build PointCloudMetadata
    const attributes: PointAttribute[] = [
      {
        name: 'POSITION_CARTESIAN',
        type: { name: 'float32', size: 4, elements: 3, elementSize: 4 },
        byteSize: 12,
        byteOffset: 0,
      },
      {
        name: 'INTENSITY',
        type: { name: 'uint16', size: 2, elements: 1, elementSize: 2 },
        byteSize: 2,
        byteOffset: 12,
      },
    ];

    // LAS PDRFs that include RGB channels: 2, 3, 5, 7, 8, 10
    const RGB_PDRFS = new Set([2, 3, 5, 7, 8, 10]);
    const hasRGB = RGB_PDRFS.has(header.pointDataRecordFormat);

    const metadata: PointCloudMetadata = {
      version: '1.4',
      name:
        url.split('/').pop()?.replace(/\.copc\.laz$/i, '').replace(/\.laz$/i, '') ?? 'cloud',
      points: header.pointCount,
      hierarchy: { stepSize: 4, depth: 20 },
      // LAS convention: X=easting, Y=northing, Z=altitude.
      // Three.js convention: Y=up. Swap LAS Y↔Z so altitude becomes the vertical axis.
      offset: [header.offset[0], header.offset[2], header.offset[1]],
      scale: [header.scale[0], header.scale[1], header.scale[2]],
      spacing: info.spacing,
      boundingBox: { min: [minx, minz, miny], max: [maxx, maxz, maxy] },
      encoding: 'COPC',
      attributes,
      hasRGB,
    };

    // 4. Create OctreeGeometry (its constructor creates the root node)
    const octree = new OctreeGeometry(metadata, url);
    const nodeMap = new Map<string, Hierarchy.Node>();

    // 5. Build node tree from the COPC hierarchy
    this.buildNodeTree(octree, allNodes, info.cube, nodeMap);

    // 6. Attach COPC state to the octree for use in loadNode
    (octree as unknown as { _copc: CopcState })._copc = { copc, url, nodeMap };

    return octree;
  }

  async loadNode(
    node: OctreeGeometryNode,
    geometry: OctreeGeometry,
  ): Promise<void> {
    // State is managed by the caller (Potree) — it sets LOADING before queuing.
    // We only need to guard against double-loading (LOADED or FAILED).
    if (node.state === NodeState.LOADED || node.state === NodeState.FAILED) return;
    node.state = NodeState.LOADING;

    const state = (geometry as unknown as { _copc: CopcState })._copc;
    if (!state) {
      node.state = NodeState.FAILED;
      node.failed = true;
      throw new Error('COPCLoader: missing _copc state on OctreeGeometry');
    }

    const hNode = state.nodeMap.get(node.name);
    if (!hNode) {
      // Node may be from a sub-hierarchy page not yet loaded — skip silently
      node.state = NodeState.FAILED;
      node.failed = true;
      return;
    }

    try {
      let usedHook = false;
      if (this.decodeHook) {
        try {
          // Off-thread path: delegate decode+convert to the injected worker pool
          node.geometry = await this.decodeHook(
            state.url,
            hNode.pointDataOffset,
            hNode.pointDataLength,
            hNode.pointCount,
          );
          usedHook = true;
        } catch {
          // Worker decode failed — fall back to main-thread path below
        }
      }
      if (!usedHook) {
        // Main-thread path: copc library does HTTP range + LAZ decompress inline
        const view = await Copc.loadPointDataView(state.url, state.copc, hNode);
        node.geometry = this.viewToBufferGeometry(view);
      }
      node.state = NodeState.LOADED;
      node.loaded = true;
    } catch (err) {
      node.state = NodeState.FAILED;
      node.failed = true;
      throw err;
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Builds the octree node tree from the COPC hierarchy map.
   * COPC keys are "d-x-y-z". We map them to OctreeGeometryNode names like
   * 'r', 'r0', 'r1', ..., 'r07', etc. using the octant index at each depth.
   */
  private buildNodeTree(
    octree: OctreeGeometry,
    nodes: Hierarchy.Node.Map,
    cube: Bounds,
    nodeMap: Map<string, Hierarchy.Node>,
  ): void {
    const geomNodeMap = new Map<string, OctreeGeometryNode>();

    // First pass: create all OctreeGeometryNode instances
    for (const [keyStr, hNode] of Object.entries(nodes)) {
      if (!hNode) continue;

      const key = Key.parse(keyStr);
      const [d] = key;
      const nb = Bounds.stepTo(cube, key); // [minx,miny,minz,maxx,maxy,maxz] in LAS coords
      const spacing = octree.spacing / Math.pow(2, d);
      // Swap Y↔Z: LAS Y=northing → Three.js Z, LAS Z=altitude → Three.js Y (up)
      const bb: BoundingBox = {
        min: [nb[0], nb[2], nb[1]],
        max: [nb[3], nb[5], nb[4]],
      };

      let geomNode: OctreeGeometryNode;

      if (d === 0) {
        // Reuse the root node created by OctreeGeometry constructor
        geomNode = octree.root;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = geomNode as any;
        m.numPoints = hNode.pointCount;
        m.spacing = spacing;
        m.byteOffset = hNode.pointDataOffset;
        m.byteSize = hNode.pointDataLength;
      } else {
        const name = this.copcKeyToName(key);
        geomNode = new OctreeGeometryNode(
          name,
          bb,
          {
            name,
            numPoints: hNode.pointCount,
            children: [],
            spacing,
            byteOffset: hNode.pointDataOffset,
            byteSize: hNode.pointDataLength,
          },
          octree.attributes,
        );
      }

      geomNodeMap.set(keyStr, geomNode);
      nodeMap.set(geomNode.name, hNode);
    }

    // Second pass: link parent → child relationships
    for (const [keyStr, geomNode] of geomNodeMap.entries()) {
      const key = Key.parse(keyStr);
      const [d, x, y, z] = key;
      if (d === 0) continue; // root has no parent

      const parentKeyStr = Key.toString(Key.up(key));
      const parent = geomNodeMap.get(parentKeyStr);
      if (!parent) continue;

      // Octant index: bit0=x%2, bit1=y%2, bit2=z%2
      const childIndex = (x % 2) | ((y % 2) << 1) | ((z % 2) << 2);
      parent.children[childIndex] = geomNode;
      (geomNode as { parent: OctreeGeometryNode | null }).parent = parent;
    }
  }

  /**
   * Converts a COPC key [d, x, y, z] to an OctreeGeometryNode name.
   * Root = 'r', children = 'r0'–'r7', grandchildren = 'r00'–'r77', etc.
   */
  private copcKeyToName(key: [number, number, number, number]): string {
    const [d, x, y, z] = key;
    if (d === 0) return 'r';

    let name = 'r';
    for (let depth = 1; depth <= d; depth++) {
      const shift = d - depth;
      const nx = (x >> shift) & 1;
      const ny = (y >> shift) & 1;
      const nz = (z >> shift) & 1;
      name += (nx | (ny << 1) | (nz << 2)).toString();
    }
    return name;
  }

  /**
   * Converts a decoded COPC point data View to a Three.js BufferGeometry.
   * X/Y/Z from the view are already in real-world coordinates (scale+offset applied).
   */
  private viewToBufferGeometry(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view: any,
  ): THREE.BufferGeometry {
    const n: number = view.pointCount;
    const getX = view.getter('X') as (i: number) => number;
    const getY = view.getter('Y') as (i: number) => number;
    const getZ = view.getter('Z') as (i: number) => number;

    let getR: ((i: number) => number) | null = null;
    let getG: ((i: number) => number) | null = null;
    let getB: ((i: number) => number) | null = null;
    try {
      getR = view.getter('Red') as (i: number) => number;
      getG = view.getter('Green') as (i: number) => number;
      getB = view.getter('Blue') as (i: number) => number;
    } catch {
      /* PDRF without RGB */
    }

    let getI: ((i: number) => number) | null = null;
    try {
      getI = view.getter('Intensity') as (i: number) => number;
    } catch {
      /* no intensity */
    }

    let getClass: ((i: number) => number) | null = null;
    try {
      getClass = view.getter('Classification') as (i: number) => number;
    } catch {
      /* no classification */
    }

    const positions      = new Float32Array(n * 3);
    const colorsRGB      = new Float32Array(n * 3); // true RGB (or white if unavailable)
    const colorsClass    = new Float32Array(n * 3); // classification palette
    const colorsIntensity = new Float32Array(n * 3); // normalised intensity greyscale

    // Detect whether RGB values are stored as true 16-bit (0–65535) or 8-bit in a
    // 16-bit field (0–255, common in photogrammetry exports). Sample first 500 pts.
    let rgbScale = 65535;
    if (getR && getG && getB) {
      let sampleMax = 0;
      const sampleN = Math.min(n, 500);
      for (let i = 0; i < sampleN; i++) {
        const maxCh = Math.max(getR(i), getG(i), getB(i));
        if (maxCh > sampleMax) sampleMax = maxCh;
      }
      // Values capped at 255 → 8-bit stored in 16-bit field
      if (sampleMax > 0 && sampleMax <= 255) rgbScale = 255;
    }

    // sRGB → linear conversion (IEC 61966-2-1); needed because ACES tonemapping
    // and outputColorSpace=SRGBColorSpace both operate in linear space.
    const srgbToLinear = (c: number): number =>
      c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

    // Detect intensity range: sample first 500 pts to find the peak value.
    // IGN LiDAR HD records intensity as 12-bit (0–4095) in a 16-bit field.
    // Dividing by 65535 would give values ≤ 0.06 → near-black greyscale.
    // Normalise to the observed max so the full 0–1 range is always used.
    let intensityMax = 65535;
    if (getI) {
      let sampleMax = 0;
      const sampleN = Math.min(n, 500);
      for (let j = 0; j < sampleN; j++) {
        const v = getI(j);
        if (v > sampleMax) sampleMax = v;
      }
      if (sampleMax > 0) intensityMax = sampleMax;
    }

    // Classification color palette (IGN LiDAR HD classes, ASPRS ext.)
    const classColors: [number, number, number][] = [
      [0.5, 0.5, 0.5],   // 0: Never classified
      [0.5, 0.5, 0.5],   // 1: Unclassified
      [0.6, 0.4, 0.2],   // 2: Ground
      [0.3, 0.7, 0.3],   // 3: Low vegetation
      [0.1, 0.6, 0.1],   // 4: Medium vegetation
      [0.0, 0.4, 0.0],   // 5: High vegetation
      [0.8, 0.2, 0.2],   // 6: Building
      [1.0, 0.0, 0.0],   // 7: Low point (noise)
      [0.9, 0.9, 0.9],   // 8: Reserved
      [0.2, 0.8, 0.9],   // 9: Water
      [0.5, 0.5, 0.5],   // 10: Rail
      [0.9, 0.7, 0.3],   // 11: Road surface
    ];

    for (let i = 0; i < n; i++) {
      const b3 = i * 3;
      // Swap LAS Y↔Z: altitude (LAS Z) → Three.js Y (up), northing (LAS Y) → Three.js Z
      positions[b3 + 0] = getX(i);  // easting  → X
      positions[b3 + 1] = getZ(i);  // altitude → Y (up)
      positions[b3 + 2] = getY(i);  // northing → Z (depth)

      // RGB channel
      if (getR && getG && getB) {
        colorsRGB[b3 + 0] = srgbToLinear(getR(i) / rgbScale);
        colorsRGB[b3 + 1] = srgbToLinear(getG(i) / rgbScale);
        colorsRGB[b3 + 2] = srgbToLinear(getB(i) / rgbScale);
      } else {
        colorsRGB[b3 + 0] = colorsRGB[b3 + 1] = colorsRGB[b3 + 2] = 0.8;
      }

      // Classification channel (always written)
      const cls = getClass ? Math.min(Math.max(0, getClass(i)), classColors.length - 1) : 1;
      const cc = classColors[cls] ?? classColors[1]!;
      colorsClass[b3 + 0] = cc[0];
      colorsClass[b3 + 1] = cc[1];
      colorsClass[b3 + 2] = cc[2];

      // Intensity channel (always written)
      const rawI = getI ? getI(i) : intensityMax * 0.5;
      // sqrt gives perceptual gamma so mid-range values appear mid-grey
      const intensity = Math.sqrt(rawI / intensityMax);
      colorsIntensity[b3 + 0] = colorsIntensity[b3 + 1] = colorsIntensity[b3 + 2] = intensity;
    }

    const bufGeom = new THREE.BufferGeometry();
    bufGeom.setAttribute('position',       new THREE.BufferAttribute(positions, 3));
    bufGeom.setAttribute('color',          new THREE.BufferAttribute(colorsRGB, 3));
    bufGeom.setAttribute('colorClass',     new THREE.BufferAttribute(colorsClass, 3));
    bufGeom.setAttribute('colorIntensity', new THREE.BufferAttribute(colorsIntensity, 3));
    return bufGeom;
  }
}
