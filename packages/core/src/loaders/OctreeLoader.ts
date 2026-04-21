// packages/core/src/loaders/OctreeLoader.ts
// Loads Potree 2.0 format (metadata.json + binary node files).
// Based on the format produced by PotreeConverter 2.x.

import * as THREE from 'three';
import { OctreeGeometry } from '../geometry/OctreeGeometry.js';
import { OctreeGeometryNode, NodeState } from '../geometry/OctreeGeometryNode.js';
import type { PointCloudMetadata, NodeData, PointAttribute, PointAttributeType } from '../geometry/types.js';
import type { IPointCloudLoader, PointCloudLoaderOptions } from './IPointCloudLoader.js';

// ─── Attribute type table (matches PotreeConverter 2.x output) ───────────────

const ATTRIBUTE_TYPES: Record<string, PointAttributeType> = {
  int8:    { name: 'int8',    size: 1, elements: 1, elementSize: 1 },
  int16:   { name: 'int16',   size: 2, elements: 1, elementSize: 2 },
  int32:   { name: 'int32',   size: 4, elements: 1, elementSize: 4 },
  int64:   { name: 'int64',   size: 8, elements: 1, elementSize: 8 },
  uint8:   { name: 'uint8',   size: 1, elements: 1, elementSize: 1 },
  uint16:  { name: 'uint16',  size: 2, elements: 1, elementSize: 2 },
  uint32:  { name: 'uint32',  size: 4, elements: 1, elementSize: 4 },
  uint64:  { name: 'uint64',  size: 8, elements: 1, elementSize: 8 },
  float:   { name: 'float',   size: 4, elements: 1, elementSize: 4 },
  double:  { name: 'double',  size: 8, elements: 1, elementSize: 8 },
  float32: { name: 'float32', size: 4, elements: 1, elementSize: 4 },
  float64: { name: 'float64', size: 8, elements: 1, elementSize: 8 },
};

// ─── OctreeLoader ─────────────────────────────────────────────────────────────

export class OctreeLoader implements IPointCloudLoader {
  async loadMetadata(url: string, options?: PointCloudLoaderOptions): Promise<OctreeGeometry> {
    const resolvedUrl = options?.getUrl ? await options.getUrl(url) : url;
    const response = await fetch(resolvedUrl);

    if (!response.ok) {
      throw new Error(`OctreeLoader: failed to fetch metadata from ${resolvedUrl} (${response.status})`);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const metadata = this.parseMetadata(json);
    const baseUrl = resolvedUrl.substring(0, resolvedUrl.lastIndexOf('/') + 1);
    const octree = new OctreeGeometry(metadata, baseUrl);

    // Load the root hierarchy page
    await this.loadHierarchy(octree, octree.root, options);

    return octree;
  }

  async loadNode(node: OctreeGeometryNode, geometry: OctreeGeometry): Promise<void> {
    if (node.state !== NodeState.UNLOADED) return;
    node.state = NodeState.LOADING;

    const url = `${geometry.baseUrl}octree.bin`;

    try {
      const response = await fetch(url, {
        headers: { Range: `bytes=${node.byteOffset}-${node.byteOffset + node.byteSize - 1}` },
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`OctreeLoader: node fetch failed: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      node.geometry = this.decodeNodeBuffer(buffer, node, geometry);
      node.state = NodeState.LOADED;
      node.loaded = true;
    } catch (err) {
      node.state = NodeState.FAILED;
      node.failed = true;
      throw err;
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private parseMetadata(json: Record<string, unknown>): PointCloudMetadata {
    const attrs = (json['attributes'] as Array<Record<string, unknown>>).map(
      (a, i, arr): PointAttribute => {
        const typeName = (a['type'] as string).toLowerCase();
        const type = ATTRIBUTE_TYPES[typeName] ?? ATTRIBUTE_TYPES['float32']!;
        const byteOffset = arr
          .slice(0, i)
          .reduce((sum, prev) => sum + (ATTRIBUTE_TYPES[(prev['type'] as string).toLowerCase()]?.size ?? 4), 0);

        const attr: PointAttribute = {
          name: a['name'] as string,
          type,
          byteSize: type.size * ((a['numElements'] as number | undefined) ?? 1),
          byteOffset,
        };
        const desc = a['description'] as string | undefined;
        if (desc !== undefined) attr.description = desc;
        return attr;
      },
    );

    const bb = json['boundingBox'] as Record<string, [number, number, number]>;
    const hierarchy = json['hierarchy'] as Record<string, number>;
    const scale = json['scale'] as [number, number, number] | number;
    const offset = json['offset'] as [number, number, number];

    const meta: PointCloudMetadata = {
      version: (json['version'] as string | undefined) ?? '2.0',
      name: (json['name'] as string | undefined) ?? 'unnamed',
      points: json['points'] as number,
      hierarchy: {
        ...(hierarchy['firstChunkSize'] != null ? { firstChunkSize: hierarchy['firstChunkSize'] as number } : {}),
        stepSize: (hierarchy['stepSize'] as number | undefined) ?? 4,
        depth: (hierarchy['depth'] as number | undefined) ?? 20,
      },
      offset: offset ?? [0, 0, 0],
      scale: Array.isArray(scale) ? scale : ([scale, scale, scale] as [number, number, number]),
      spacing: json['spacing'] as number,
      boundingBox: {
        min: (bb['min'] ?? [0, 0, 0]) as [number, number, number],
        max: (bb['max'] ?? [1, 1, 1]) as [number, number, number],
      },
      attributes: attrs,
    };
    const desc = json['description'] as string | undefined;
    if (desc !== undefined) meta.description = desc;
    const proj = json['projection'] as string | undefined;
    if (proj !== undefined) meta.projection = proj;
    const enc = json['encoding'] as string | undefined;
    if (enc !== undefined) meta.encoding = enc;
    return meta;
  }

  private async loadHierarchy(
    octree: OctreeGeometry,
    root: OctreeGeometryNode,
    options?: PointCloudLoaderOptions,
  ): Promise<void> {
    const hierarchyUrl = `${octree.baseUrl}hierarchy.bin`;
    const resolvedUrl = options?.getUrl ? await options.getUrl(hierarchyUrl) : hierarchyUrl;

    const response = await fetch(resolvedUrl);
    if (!response.ok) {
      throw new Error(`OctreeLoader: failed to fetch hierarchy from ${resolvedUrl}`);
    }

    const buffer = await response.arrayBuffer();
    this.parseHierarchy(buffer, octree, root);
  }

  private parseHierarchy(
    buffer: ArrayBuffer,
    octree: OctreeGeometry,
    root: OctreeGeometryNode,
  ): void {
    const view = new DataView(buffer);
    const nodesByName = new Map<string, OctreeGeometryNode>();
    nodesByName.set('r', root);

    const bytesPerNode = 22;
    const nodeCount = buffer.byteLength / bytesPerNode;

    for (let i = 0; i < nodeCount; i++) {
      const base = i * bytesPerNode;
      const typeMask = view.getUint8(base);
      const childMask = view.getUint8(base + 1);
      const numPoints = view.getUint32(base + 2, true);
      const byteOffset = Number(view.getBigInt64(base + 6, true));
      const byteSize = Number(view.getBigInt64(base + 14, true));

      if (typeMask === 0) {
        // This node is at octree index i — reconstruct name from hierarchy order
        const node = this.getNodeByIndex(nodesByName, i);
        if (!node) continue;

        const nodeData: NodeData = {
          name: node.name,
          numPoints,
          children: new Array(8).fill(null),
          spacing: node.spacing / 2,
          byteOffset,
          byteSize,
        };

        // Update existing node with loaded data
        (node as { byteOffset: number }).byteOffset = byteOffset;
        (node as { byteSize: number }).byteSize = byteSize;
        (node as { numPoints: number }).numPoints = numPoints;

        // Spawn child nodes
        for (let c = 0; c < 8; c++) {
          if ((childMask >> c) & 1) {
            const childName = node.name + c.toString();
            const childBb = OctreeGeometry.childBoundingBox(
              {
                min: [node.boundingBox.min.x, node.boundingBox.min.y, node.boundingBox.min.z],
                max: [node.boundingBox.max.x, node.boundingBox.max.y, node.boundingBox.max.z],
              },
              c,
            );
            const childNode = new OctreeGeometryNode(
              childName,
              childBb,
              { name: childName, numPoints: 0, children: [], spacing: nodeData.spacing / 2, byteOffset: 0, byteSize: 0 },
              octree.attributes,
            );
            childNode.parent = node;
            node.children[c] = childNode;
            nodesByName.set(childName, childNode);
          }
        }
      }
    }
  }

  private getNodeByIndex(
    nodesByName: Map<string, OctreeGeometryNode>,
    _index: number,
  ): OctreeGeometryNode | null {
    // In Potree 2.0, hierarchy file stores nodes in BFS order.
    // The simplest approach: iterate the map in insertion order.
    const entries = [...nodesByName.values()];
    return entries[_index] ?? null;
  }

  private decodeNodeBuffer(
    buffer: ArrayBuffer,
    node: OctreeGeometryNode,
    geometry: OctreeGeometry,
  ): THREE.BufferGeometry {
    const bufGeom = new THREE.BufferGeometry();
    const numPoints = node.numPoints;
    const attributes = geometry.attributes;

    // Compute record stride
    const stride = attributes.reduce((sum, a) => sum + a.byteSize, 0);
    const view = new DataView(buffer);

    // Extract positions (always first, always float32 × 3 in Potree 2.0 output)
    const posAttr = attributes.find((a) => a.name === 'position' || a.name === 'POSITION_CARTESIAN');
    const positions = new Float32Array(numPoints * 3);

    for (let i = 0; i < numPoints; i++) {
      const base = i * stride + (posAttr?.byteOffset ?? 0);
      positions[i * 3 + 0] = view.getFloat32(base + 0, true);
      positions[i * 3 + 1] = view.getFloat32(base + 4, true);
      positions[i * 3 + 2] = view.getFloat32(base + 8, true);
    }
    bufGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Extract colors if present (uint8 × 4 → normalize to float)
    const colorAttr = attributes.find((a) => a.name === 'rgba' || a.name === 'COLOR_PACKED' || a.name === 'rgb');
    if (colorAttr) {
      const colors = new Float32Array(numPoints * 3);
      for (let i = 0; i < numPoints; i++) {
        const base = i * stride + colorAttr.byteOffset;
        colors[i * 3 + 0] = view.getUint8(base + 0) / 255;
        colors[i * 3 + 1] = view.getUint8(base + 1) / 255;
        colors[i * 3 + 2] = view.getUint8(base + 2) / 255;
      }
      bufGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    // Extract intensity if present (uint16 → normalize)
    const intensityAttr = attributes.find((a) => a.name === 'intensity' || a.name === 'INTENSITY');
    if (intensityAttr) {
      const intensities = new Float32Array(numPoints);
      for (let i = 0; i < numPoints; i++) {
        const base = i * stride + intensityAttr.byteOffset;
        intensities[i] = view.getUint16(base, true) / 65535;
      }
      bufGeom.setAttribute('intensity', new THREE.BufferAttribute(intensities, 1));
    }

    return bufGeom;
  }
}
