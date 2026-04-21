import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import * as THREE from 'three';
import { Potree } from '@lidar-viewer/core';
import { OctreeLoader } from '@lidar-viewer/core';
import { COPCLoader } from '@lidar-viewer/copc';
import { detectTier, createFpsWatchdog, EDLPass, COLOR_MODE_INDEX } from '@lidar-viewer/core';
import { MeasurementTool } from '@lidar-viewer/measurements';
import type { MeasurementStore, MeasurementType } from '@lidar-viewer/measurements';
import type { PointCloudOctree } from '@lidar-viewer/core';
import type { ViewerSettings } from '../viewerTypes.js';
import styles from './ViewerCanvas.module.css';

interface Props {
  cloudUrl: string;
  measurementStore: MeasurementStore;
  activeTool: MeasurementType | null;
  onToolFinished: () => void;
  settings: ViewerSettings;
  onSettingsChange: (patch: Partial<ViewerSettings>) => void;
  onCloudLoaded?: (hasRGB: boolean) => void;
  resetTrigger: number;
}

export function ViewerCanvas({ cloudUrl, measurementStore, activeTool, onToolFinished, settings, onSettingsChange, onCloudLoaded, resetTrigger }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const potreeRef = useRef<Potree | null>(null);
  const edlRef = useRef<EDLPass | null>(null);
  const toolRef = useRef<MeasurementTool | null>(null);
  const pcoRef = useRef<PointCloudOctree | null>(null);
  const animFrameRef = useRef<number>(0);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const [pcoLoaded, setPcoLoaded] = useState(false);
  const [cloudInfo, setCloudInfo] = useState<string | null>(null);

  // Gizmo axis label refs (updated each frame via direct DOM manipulation)
  const xLabelRef = useRef<HTMLSpanElement>(null);
  const yLabelRef = useRef<HTMLSpanElement>(null);
  const zLabelRef = useRef<HTMLSpanElement>(null);
  // Scale bar refs
  const scaleBarRef = useRef<HTMLDivElement>(null);
  const scaleBarLabelRef = useRef<HTMLSpanElement>(null);

  // Bootstrap Three.js + load point cloud
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    // ── Renderer ──────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES filmic tone mapping gives richer, more cinematic RGB colours
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ── Scene & camera ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.01,
      10000,
    );
    camera.position.set(0, 50, 100);

    // Basic orbit controls (inline — avoids adding three/examples dependency)
    let mouseMode: 'none' | 'orbit' | 'pan' = 'none';
    let lastMouse = { x: 0, y: 0 };
    const spherical = new THREE.Spherical(200, Math.PI / 4, 0);
    const target = new THREE.Vector3();

    const updateCamera = () => {
      camera.position.setFromSpherical(spherical).add(target);
      camera.lookAt(target);
    };
    updateCamera();

    // ── Right vector for panning
    const _panRight = new THREE.Vector3();
    const _panUp    = new THREE.Vector3();

    renderer.domElement.addEventListener('mousedown', (e) => {
      if (e.button === 0) mouseMode = 'orbit';
      if (e.button === 1) { mouseMode = 'pan'; e.preventDefault(); }
      lastMouse = { x: e.clientX, y: e.clientY };
      renderer.domElement.style.cursor = e.button === 1 ? 'grabbing' : '';
    });
    renderer.domElement.addEventListener('mouseup', () => {
      mouseMode = 'none';
      renderer.domElement.style.cursor = '';
    });
    renderer.domElement.addEventListener('mousemove', (e) => {
      if (mouseMode === 'none') return;
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;

      if (mouseMode === 'orbit') {
        spherical.theta -= dx * 0.005;
        spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi + dy * 0.005));
        updateCamera();
      } else if (mouseMode === 'pan') {
        // Move target in camera right + up plane; multiply by 2 for comfortable speed
        const mpp = (2 * spherical.radius * Math.tan((camera.fov * Math.PI) / 360)) / container.clientHeight * 2;
        _panRight.setFromMatrixColumn(camera.matrix, 0);
        _panUp.setFromMatrixColumn(camera.matrix, 1);
        target.addScaledVector(_panRight, -dx * mpp);
        target.addScaledVector(_panUp,     dy * mpp);
        updateCamera();
      }

      lastMouse = { x: e.clientX, y: e.clientY };
    });
    // Show grab cursor on middle mouse hover
    renderer.domElement.addEventListener('mousemove', (e) => {
      if (mouseMode === 'none' && e.buttons === 0) {
        renderer.domElement.style.cursor = '';
      }
    });
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    renderer.domElement.addEventListener('wheel', (e) => {
      const newRadius = spherical.radius * (1 + e.deltaY * 0.003);
      if (newRadius < 0.01) {
        // Radius is at its floor — instead of stopping, dolly the target forward
        // so the orbit centre keeps advancing into the scene.
        const overshoot = spherical.radius - 0.01; // how much we would have shrunk
        const dolly = overshoot + (0.01 - newRadius); // total forward movement
        const forward = new THREE.Vector3()
          .subVectors(target, camera.position)
          .normalize();
        target.addScaledVector(forward, dolly);
        spherical.radius = 0.01;
      } else {
        spherical.radius = newRadius;
      }
      updateCamera();
    }, { passive: true });

    // ── EDL pass ──────────────────────────────────────────────────────────────
    const edl = new EDLPass(renderer);
    edlRef.current = edl;

    // ── Axes gizmo ────────────────────────────────────────────────────────────
    const gizmoScene = new THREE.Scene();
    const gizmoAxes = new THREE.AxesHelper(1.4);
    gizmoScene.add(gizmoAxes);
    // Small sphere at origin for reference
    const gizmoOriginMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x888888 }),
    );
    gizmoScene.add(gizmoOriginMesh);
    const gizmoCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 10);
    const _gDir = new THREE.Vector3();
    const _gNdc = new THREE.Vector3();

    // ── Tier detection → loader choice ───────────────────────────────────────
    let potree: Potree;

    void detectTier().then((tier) => {
      const loader = cloudUrl.endsWith('.copc.laz') || cloudUrl.endsWith('.copc')
        ? new COPCLoader()
        : new OctreeLoader();

      potree = new Potree(loader);
      potree.pointBudget = tier.pointBudget;
      potree.minNodeSize = tier.minNodeSize;
      potreeRef.current = potree;

      return potree.loadPointCloud(cloudUrl);
    }).then((pco) => {
      pcoRef.current = pco;
      scene.add(pco);

      // Frame camera on the loaded cloud
      const bb = pco.getWorldBoundingBox();
      const center = bb.getCenter(new THREE.Vector3());
      const size = bb.getSize(new THREE.Vector3());
      target.copy(center);
      spherical.radius = size.length() * 0.8;
      // No artificial minimum zoom — clamped to 0.1 world units in the wheel handler.
      updateCamera();

      // Set elevation range from actual bounding box Y (altitude after LAS Y↔Z swap)
      pco.material.updateElevationRange(bb.min.y, bb.max.y);
      pco.gaussianMaterial.setElevationRange(bb.min.y, bb.max.y);

      // Store reset callback so external resetTrigger can restore initial view
      const initialTarget = center.clone();
      const initialRadius = spherical.radius;
      resetCameraRef.current = () => {
        target.copy(initialTarget);
        spherical.radius = initialRadius;
        spherical.phi = Math.PI / 4;
        spherical.theta = 0;
        updateCamera();
      };

      setPcoLoaded(true);
      onCloudLoaded?.(pco.geometry.metadata.hasRGB ?? false);

      // Cloud info badge
      const pts = pco.geometry.metadata.points;
      const name = cloudUrl.split('/').pop()?.replace(/\.copc\.laz$/i, '') ?? cloudUrl;
      setCloudInfo(`${name} · ${pts >= 1e6 ? `${(pts / 1e6).toFixed(1)}M` : `${(pts / 1e3).toFixed(0)}K`} pts`);

      // ── Measurement tool ────────────────────────────────────────────────
      const tool = new MeasurementTool(measurementStore, {
        camera,
        scene,
        domElement: renderer.domElement,
        targets: [pco],
      });
      toolRef.current = tool;

      // ── FPS watchdog ────────────────────────────────────────────────────
      createFpsWatchdog({
        threshold: 25,
        durationMs: 3000,
        onStepDown: (fps) => {
          console.info(`FPS watchdog: ${fps.toFixed(1)} fps — stepping down point budget`);
          if (potreeRef.current) {
            potreeRef.current.pointBudget = Math.floor(potreeRef.current.pointBudget * 0.5);
          }
        },
      });
    }).catch((err: unknown) => {
      console.error('Failed to load point cloud:', err);
    });

    // ── Render loop ───────────────────────────────────────────────────────────
    const GS = 90, GP = 12; // gizmo size and padding (px)
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);

      if (potreeRef.current) {
        void potreeRef.current.updatePointClouds(camera, renderer);
      }

      edl.render(scene, camera, camera.near, camera.far);

      // Keep Gaussian material screen-height uniform in sync (changes on resize).
      if (pcoRef.current) {
        const ch2 = container.clientHeight;
        pcoRef.current.material.uniforms['uScreenHeight']!.value = ch2;
        pcoRef.current.gaussianMaterial.uniforms['uScreenHeight']!.value = ch2;
      }

      // ── Axes gizmo (rendered into bottom-left corner viewport) ────────────
      const cw = container.clientWidth;
      const ch = container.clientHeight;

      // Gizmo camera mirrors main camera rotation, fixed distance
      _gDir.copy(camera.position).sub(target).normalize().multiplyScalar(3);
      gizmoCamera.position.copy(_gDir);
      gizmoCamera.up.copy(camera.up);
      gizmoCamera.lookAt(0, 0, 0);

      renderer.setScissorTest(true);
      renderer.setViewport(GP, GP, GS, GS);
      renderer.setScissor(GP, GP, GS, GS);
      renderer.clearDepth();
      renderer.render(gizmoScene, gizmoCamera);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, cw, ch);

      // Update axis label positions by projecting axis tips
      const updateLabel = (ref: React.RefObject<HTMLSpanElement | null>, x: number, y: number, z: number) => {
        if (!ref.current) return;
        _gNdc.set(x, y, z).project(gizmoCamera);
        ref.current.style.left = `${GP + ((_gNdc.x + 1) / 2) * GS - 5}px`;
        ref.current.style.top  = `${ch - GP - GS + ((1 - _gNdc.y) / 2) * GS - 7}px`;
      };
      updateLabel(xLabelRef, 1.75, 0, 0);
      updateLabel(yLabelRef, 0, 1.75, 0);
      updateLabel(zLabelRef, 0, 0, 1.75);

      // ── Scale bar ──────────────────────────────────────────────────────────
      if (scaleBarRef.current && scaleBarLabelRef.current) {
        const dist = camera.position.distanceTo(target);
        const mpp = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / cw;
        const candidates = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
        const targetM = mpp * 100;
        const scaleM = candidates.reduce((p, c) => Math.abs(c - targetM) < Math.abs(p - targetM) ? c : p);
        const scalePx = Math.min(Math.round(scaleM / mpp), Math.floor(cw * 0.25));
        scaleBarRef.current.style.width = `${scalePx}px`;
        scaleBarLabelRef.current.textContent = scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`;
      }
    };
    animFrameRef.current = requestAnimationFrame(animate);

    // ── Resize handler ────────────────────────────────────────────────────────
    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      edl.resize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      ro.disconnect();
      potreeRef.current?.dispose();
      edl.dispose();
      toolRef.current?.dispose();
      gizmoAxes.geometry.dispose();
      (gizmoAxes.material as THREE.Material).dispose();
      gizmoOriginMesh.geometry.dispose();
      (gizmoOriginMesh.material as THREE.Material).dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  // cloudUrl intentionally excluded — re-mounting the whole canvas on URL change
  // is handled by a key prop at the call site if needed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync active measurement tool
  useEffect(() => {
    const tool = toolRef.current;
    if (!tool) return;
    if (activeTool) {
      tool.startMeasurement(activeTool);
    } else {
      tool.finishMeasurement();
    }
  }, [activeTool]);

  // Apply viewer settings whenever they change (or pco loads)
  useEffect(() => {
    if (!pcoLoaded || !pcoRef.current) return;
    const pco = pcoRef.current;
    const mat = pco.material;
    // If the file has no RGB data, silently fall back to intensity rather than showing flat grey
    const hasRGB = pco.geometry.metadata.hasRGB ?? true;
    const effectiveMode = (!hasRGB && settings.colorMode === 'rgb') ? 'intensity' : settings.colorMode;
    mat.uniforms['uColorMode']!.value = COLOR_MODE_INDEX[effectiveMode];
    mat.uniforms['uPointSize']!.value = settings.pointSize;
    // Mirror settings to Gaussian material so switching modes is seamless.
    const gmat = pco.gaussianMaterial;
    gmat.uniforms['uColorMode']!.value = COLOR_MODE_INDEX[effectiveMode];
    gmat.uniforms['uPointSize']!.value = settings.pointSize;
    edlRef.current?.setEnabled(settings.edlEnabled);
    pco.setSplatMode(settings.splatMode);
  }, [settings, pcoLoaded]);

  // Reset camera on demand
  useEffect(() => {
    if (resetTrigger > 0) resetCameraRef.current?.();
  }, [resetTrigger]);

  return (
    <div ref={canvasRef} className={styles.canvas}>
      {/* Loading overlay */}
      {!pcoLoaded && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span className={styles.loadingText}>Loading point cloud…</span>
        </div>
      )}

      {/* Cloud info badge (top-right) */}
      {cloudInfo && <div className={styles.cloudInfo}>{cloudInfo}</div>}

      {/* Axes gizmo labels (bottom-left corner, updated each frame) */}
      <span ref={xLabelRef} className={styles.axisLabel} style={{ color: '#ff4444' }}>X</span>
      <span ref={yLabelRef} className={styles.axisLabel} style={{ color: '#44ff88' }}>Y</span>
      <span ref={zLabelRef} className={styles.axisLabel} style={{ color: '#4499ff' }}>Z</span>

      {/* Scale bar (bottom-centre) */}
      <div className={styles.scalebar}>
        <div ref={scaleBarRef} className={styles.scalebarInner} />
        <span ref={scaleBarLabelRef} className={styles.scalebarLabel} />
      </div>
    </div>
  );
}
