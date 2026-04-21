// Worker pool for off-thread COPC node decoding.
//
// Creates WORKER_COUNT Web Workers running COPCDecode.worker.ts.
// Each `decode()` call round-robins to the next free worker and resolves
// when the worker posts back the decoded Float32Arrays.
//
// The pool is a long-lived singleton — create once, reuse for all loads.

import * as THREE from 'three';
import type { DecodeRequest, DecodeResult, DecodeError } from './COPCDecode.worker.js';

const WORKER_COUNT = 4; // 4 parallel decode workers

interface PendingDecode {
  resolve: (result: DecodeResult) => void;
  reject:  (reason: unknown) => void;
}

export class COPCDecodeWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<number, PendingDecode>();
  private nextId = 0;
  private nextWorker = 0;

  constructor() {
    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(
        new URL('./COPCDecode.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (e: MessageEvent<DecodeResult | DecodeError>) => {
        const { id } = e.data;
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if ('error' in e.data) {
          p.reject(new Error(e.data.error));
        } else {
          p.resolve(e.data as DecodeResult);
        }
      };
      this.workers.push(worker);
    }
  }

  decode(req: Omit<DecodeRequest, 'id'>): Promise<DecodeResult> {
    const id = this.nextId++;
    const worker = this.workers[this.nextWorker % WORKER_COUNT]!;
    this.nextWorker++;

    return new Promise<DecodeResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: DecodeRequest = { id, ...req };
      worker.postMessage(msg);
    });
  }

  /** Convert a DecodeResult into a THREE.BufferGeometry (no alloc — reuses transferred buffers). */
  static toBufferGeometry(result: DecodeResult): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',       new THREE.BufferAttribute(result.positions,       3));
    geo.setAttribute('color',          new THREE.BufferAttribute(result.colors,          3));
    geo.setAttribute('colorClass',     new THREE.BufferAttribute(result.colorsClass,     3));
    geo.setAttribute('colorIntensity', new THREE.BufferAttribute(result.colorsIntensity, 3));
    return geo;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.pending.clear();
  }
}
