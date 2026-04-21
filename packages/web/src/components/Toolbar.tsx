import type { MeasurementType } from '@lidar-viewer/measurements';
import type { ViewerSettings, ColorMode } from '../viewerTypes.js';
import styles from './Toolbar.module.css';

interface Props {
  activeTool: MeasurementType | null;
  onSelectTool: (type: MeasurementType | null) => void;
  onToggleSidebar: () => void;
  settings: ViewerSettings;
  onSettingsChange: (s: ViewerSettings) => void;
  onResetView: () => void;
  /** Whether the loaded file contains actual RGB camera colour. Defaults to true (unknown). */
  hasRGB?: boolean;
}

// ── Inline SVG icon helpers ────────────────────────────────────────────────

type SvgProps = { children: React.ReactNode };
const Ic = ({ children }: SvgProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
    {children}
  </svg>
);

const icons: Record<string, React.ReactNode> = {
  distance: <Ic><line x1="3" y1="12" x2="21" y2="12"/><circle cx="3" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="21" cy="12" r="2" fill="currentColor" stroke="none"/><line x1="3" y1="9" x2="3" y2="15"/><line x1="21" y1="9" x2="21" y2="15"/></Ic>,
  area:     <Ic><polygon points="12,3 21,9 17,21 7,21 3,9"/></Ic>,
  volume:   <Ic><polyline points="21,16 21,8 12,3 3,8 3,16 12,21 21,16"/><line x1="3" y1="8" x2="12" y2="13"/><line x1="21" y1="8" x2="12" y2="13"/><line x1="12" y1="13" x2="12" y2="21"/></Ic>,
  height:   <Ic><line x1="12" y1="20" x2="12" y2="4"/><polyline points="8,8 12,4 16,8"/><line x1="5" y1="20" x2="19" y2="20"/></Ic>,
  angle:    <Ic><line x1="12" y1="20" x2="3" y2="5"/><line x1="12" y1="20" x2="21" y2="5"/><path d="M6.5,13 Q12,10.5 17.5,13" fill="none"/></Ic>,
  edl:      <Ic><path d="M1,12 Q12,4 23,12 Q12,20 1,12z"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></Ic>,
  reset:    <Ic><circle cx="12" cy="12" r="7"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></Ic>,
  panel:    <Ic><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></Ic>,
  // Gaussian splat icon: overlapping soft circles
  splat:    <Ic><circle cx="8" cy="14" r="4" strokeDasharray="0"/><circle cx="16" cy="14" r="4"/><circle cx="12" cy="9" r="4"/></Ic>,
  // Photo / camera icon
  photo:    <Ic><rect x="2" y="7" width="20" height="14" rx="2"/><circle cx="12" cy="14" r="4"/><path d="M15 7l-1.5-3h-3L9 7"/></Ic>,
};

const MEASURE_TOOLS: { type: MeasurementType; label: string }[] = [
  { type: 'distance', label: 'Distance' },
  { type: 'area',     label: 'Area' },
  { type: 'volume',   label: 'Volume' },
  { type: 'height',   label: 'Height' },
  { type: 'angle',    label: 'Angle' },
];

const COLOR_MODES: { mode: ColorMode; abbr: string; title: string }[] = [
  { mode: 'rgb',            abbr: 'RGB', title: 'True colour (RGB)' },
  { mode: 'classification', abbr: 'CLS', title: 'Classification' },
  { mode: 'elevation',      abbr: 'ELV', title: 'Elevation ramp' },
  { mode: 'intensity',      abbr: 'INT', title: 'Return intensity' },
];

// ── Component ─────────────────────────────────────────────────────────────

export function Toolbar({ activeTool, onSelectTool, onToggleSidebar, settings, onSettingsChange, onResetView, hasRGB = true }: Props) {
  const upd = (patch: Partial<ViewerSettings>) => onSettingsChange({ ...settings, ...patch });

  const stepSize = (dir: 1 | -1) => {
    const next = Math.round((settings.pointSize + dir * 0.5) * 10) / 10;
    upd({ pointSize: Math.max(0.5, Math.min(10, next)) });
  };

  return (
    <nav className={styles.toolbar} aria-label="Viewer tools">

      {/* ── Measurement tools ──────────────────────────────────── */}
      <span className={styles.groupLabel}>Measure</span>

      {MEASURE_TOOLS.map((t) => (
        <button
          key={t.type}
          className={`${styles.btn} ${activeTool === t.type ? styles.active : ''}`}
          onClick={() => onSelectTool(activeTool === t.type ? null : t.type)}
          title={t.label}
          aria-pressed={activeTool === t.type}
        >
          {icons[t.type]}
          <span className={styles.label}>{t.label}</span>
        </button>
      ))}

      <hr className={styles.divider} />

      {/* ── Display settings ───────────────────────────────────── */}
      <span className={styles.groupLabel}>Display</span>

      {/* Color mode 2×2 grid */}
      <div className={styles.colorGrid} role="group" aria-label="Color mode">
        {COLOR_MODES.map(({ mode, abbr, title }) => {
          const isRGBDisabled = mode === 'rgb' && !hasRGB;
          return (
          <button
            key={mode}
            className={`${styles.modeBtn} ${settings.colorMode === mode ? styles.active : ''} ${isRGBDisabled ? styles.modeDisabled : ''}`}
            onClick={() => upd({ colorMode: mode })}
            title={isRGBDisabled ? 'No RGB data in this file — only intensity and classification are available' : title}
            aria-pressed={settings.colorMode === mode}
          >
            {abbr}
          </button>
          );
        })}
      </div>

      {/* Point size ±  */}
      <div className={styles.sizeRow} title="Point size">
        <button className={styles.sizeStep} onClick={() => stepSize(-1)} aria-label="Decrease point size">−</button>
        <span className={styles.sizeVal}>{settings.pointSize.toFixed(1)}</span>
        <button className={styles.sizeStep} onClick={() => stepSize(1)} aria-label="Increase point size">+</button>
      </div>

      {/* EDL toggle */}
      <button
        className={`${styles.btn} ${settings.edlEnabled ? styles.active : ''}`}
        onClick={() => upd({ edlEnabled: !settings.edlEnabled })}
        title="Eye-Dome Lighting"
        aria-pressed={settings.edlEnabled}
      >
        {icons['edl']}
        <span className={styles.label}>EDL</span>
      </button>

      {/* Photo mode: RGB colours + Gaussian splat = photorealistic textured surface */}
      <button
        className={`${styles.btn} ${settings.splatMode ? styles.active : ''}`}
        onClick={() => {
          if (settings.splatMode) {
            upd({ splatMode: false });
          } else {
            upd({ splatMode: true, colorMode: 'rgb' });
          }
        }}
        title="Photo — true-colour surface (Gaussian splat + RGB)"
        aria-pressed={settings.splatMode}
      >
        {icons['photo']}
        <span className={styles.label}>Photo</span>
      </button>

      <hr className={styles.divider} />

      {/* ── Navigation / UI ────────────────────────────────────── */}
      <button className={styles.btn} onClick={onResetView} title="Reset camera to initial view">
        {icons['reset']}
        <span className={styles.label}>Reset</span>
      </button>

      <button className={styles.btn} onClick={onToggleSidebar} title="Toggle measurements panel">
        {icons['panel']}
        <span className={styles.label}>Panel</span>
      </button>

    </nav>
  );
}
