// packages/core/src/renderer/TierDetector.ts
// Runtime device capability detection → render tier assignment.
// Drives the Potree-Next (WebGPU) vs WebGL2 enhanced fork decision.

export type RenderTier = 'A' | 'B' | 'C' | 'D';

export interface TierConfig {
  tier: RenderTier;
  renderer: 'potree-next' | 'webgl2';
  pointBudget: number;
  quality: 'high' | 'standard';
  edlEnabled: boolean;
  minNodeSize: number;
  description: string;
}

const TIER_CONFIGS: Record<RenderTier, Omit<TierConfig, 'tier'>> = {
  A: {
    renderer: 'potree-next',
    pointBudget: 8_000_000,
    quality: 'high',
    edlEnabled: true,
    minNodeSize: 30,
    description: 'Desktop WebGPU — maximum quality',
  },
  B: {
    renderer: 'potree-next',
    pointBudget: 3_000_000,
    quality: 'standard',
    edlEnabled: true,
    minNodeSize: 60,
    description: 'Mobile WebGPU — conservative settings',
  },
  C: {
    renderer: 'webgl2',
    pointBudget: 6_000_000,
    quality: 'high',
    edlEnabled: true,
    minNodeSize: 50,
    description: 'Desktop WebGL2 — enhanced pipeline',
  },
  D: {
    renderer: 'webgl2',
    pointBudget: 1_500_000,
    quality: 'standard',
    edlEnabled: true,
    minNodeSize: 100,
    description: 'Mobile WebGL2 — minimal settings',
  },
};

/**
 * Detects the device render tier.
 * Must be called from the browser (not SSR).
 */
export async function detectTier(): Promise<TierConfig> {
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4; // Chrome only; Firefox returns undefined
  const cores = navigator.hardwareConcurrency ?? 4;

  let hasWebGPU = false;
  if ('gpu' in navigator) {
    try {
      const adapter = await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter();
      hasWebGPU = adapter !== null;
    } catch {
      hasWebGPU = false;
    }
  }

  let tier: RenderTier;
  if (hasWebGPU && !isMobile && mem >= 4) {
    tier = 'A';
  } else if (hasWebGPU && (isMobile || mem < 4)) {
    tier = 'B';
  } else if (!hasWebGPU && !isMobile && (mem >= 4 || cores >= 4)) {
    tier = 'C';
  } else {
    tier = 'D';
  }

  return { tier, ...TIER_CONFIGS[tier] };
}

/**
 * FPS watchdog — monitors actual render performance for the first `durationMs`
 * milliseconds, then calls `onStepDown` if average FPS is below `threshold`.
 * Attach to requestAnimationFrame loop after viewer is initialized.
 */
export function createFpsWatchdog(options: {
  threshold?: number;
  durationMs?: number;
  onStepDown: (measuredFps: number) => void;
}): () => void {
  const { threshold = 25, durationMs = 3000, onStepDown } = options;
  let frames = 0;
  const start = performance.now();
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    frames++;
    const elapsed = performance.now() - start;
    if (elapsed >= durationMs) {
      stopped = true;
      const fps = frames / (elapsed / 1000);
      if (fps < threshold) onStepDown(fps);
      return;
    }
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);

  // Return a stop function
  return () => { stopped = true; };
}
