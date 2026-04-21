import { useCallback, useRef, useState } from 'react';
import styles from './FileDropZone.module.css';

interface Props {
  onFileAccepted: (url: string) => void;
}

const ACCEPTED_EXTENSIONS = ['.laz', '.las', '.copc.laz'];

// ── Preset datasets ────────────────────────────────────────────────────────
// All are COPC .laz tiles from the IGN LiDAR HD national programme (France).
// Coordinates in tile names = Lambert 93 km grid (easting_northing).
interface Preset {
  label: string;
  region: string;
  description: string;
  url: string;
  color: string; // accent for the card thumbnail
}

const PRESETS: Preset[] = [
  {
    label: 'Biarritz',
    region: 'Côte Basque',
    description: 'Urban coast with beach and harbour',
    url: 'https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/NUALHD_1-0__LAZ_LAMB93_KH_2024-12-20/LHD_FXX_0664_6715_PTS_LAMB93_IGN69.copc.laz',
    color: '#2b6cb0',
  },
  {
    label: 'Paris – Centre',
    region: 'Île-de-France',
    description: 'Dense urban fabric, Haussmann buildings',
    url: 'https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/NUALHD_1-0__LAZ_LAMB93_KE_2025-06-06/LHD_FXX_0650_6862_PTS_LAMB93_IGN69.copc.laz',
    color: '#744210',
  },
  {
    label: 'Lyon – Presqu\'île',
    region: 'Auvergne-Rhône-Alpes',
    description: 'City centre between two rivers',
    url: 'https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/NUALHD_1-0__LAZ_LAMB93_OL_2025-02-20/LHD_FXX_0842_6520_PTS_LAMB93_IGN69.copc.laz',
    color: '#276749',
  },
  {
    label: 'Bordeaux',
    region: 'Nouvelle-Aquitaine',
    description: 'Historic waterfront and port',
    url: 'https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/NUALHD_1-0__LAZ_LAMB93_FN_2025-07-29/LHD_FXX_0412_6425_PTS_LAMB93_IGN69.copc.laz',
    color: '#702459',
  },
  {
    label: 'Toulouse',
    region: 'Occitanie',
    description: 'La Ville Rose – Garonne river & urban centre',
    url: 'https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/NUALHD_1-0__LAZ_LAMB93_IQ_2024-12-20/LHD_FXX_0574_6278_PTS_LAMB93_IGN69.copc.laz',
    color: '#c05621',
  },
  {
    label: 'Marseille',
    region: 'Provence',
    description: 'Mediterranean coast and Calanques relief',
    url: 'https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/NUALHD_1-0__LAZ_LAMB93_PQ_2025-03-14/LHD_FXX_0893_6244_PTS_LAMB93_IGN69.copc.laz',
    color: '#744210',
  },
];

export function FileDropZone({ onFileAccepted }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [urlValue, setUrlValue] = useState('');

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0]!;
      const name = file.name.toLowerCase();
      const accepted = ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
      if (!accepted) {
        alert('Please drop a .laz, .las, or .copc.laz file.');
        return;
      }
      const url = URL.createObjectURL(file);
      onFileAccepted(url);
    },
    [onFileAccepted],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleUrlLoad = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const trimmed = urlValue.trim();
      if (!trimmed) return;
      onFileAccepted(trimmed);
    },
    [urlValue, onFileAccepted],
  );

  return (
    <div
      className={styles.zone}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className={styles.inner}>
        <div className={styles.iconWrap}>
          <svg width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <path d="M24 6L6 18v24h36V18L24 6z" stroke="#4299e1" strokeWidth="2" strokeLinejoin="round"/>
            <path d="M24 6v36M6 18h36" stroke="#4299e1" strokeWidth="1.5" strokeDasharray="3 3"/>
          </svg>
        </div>
        <h1 className={styles.title}>LiDAR Viewer</h1>

        {/* ── Preset dataset gallery ──────────────────────────────── */}
        <p className={styles.sectionLabel}>Open a sample dataset</p>
        <div className={styles.presetGrid}>
          {PRESETS.map((p) => (
            <button
              key={p.url}
              className={styles.presetCard}
              style={{ '--accent': p.color } as React.CSSProperties}
              onClick={() => onFileAccepted(p.url)}
              title={p.description}
            >
              <div className={styles.presetThumb} />
              <div className={styles.presetInfo}>
                <span className={styles.presetLabel}>{p.label}</span>
                <span className={styles.presetRegion}>{p.region}</span>
              </div>
            </button>
          ))}
        </div>

        <p className={styles.sectionLabel}>Or open your own file</p>

        {/* ── Drop / browse ─────────────────────────────────────── */}
        <div
          className={styles.dropArea}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.click(); }}
          role="button"
          tabIndex={0}
          aria-label="Click to browse a .laz or .copc.laz file"
        >
          <span className={styles.hint}>Drop <code>.laz</code>, <code>.las</code>, <code>.copc.laz</code> here</span>
          <button className={styles.browseBtn} tabIndex={-1} onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
            Browse file
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".laz,.las"
          className={styles.hidden}
          onChange={(e) => handleFiles(e.target.files)}
        />

        {/* ── Remote URL ────────────────────────────────────────── */}
        <p className={styles.or}>or load a remote COPC URL</p>
        <form
          className={styles.urlRow}
          onSubmit={handleUrlLoad}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            className={styles.urlInput}
            type="url"
            placeholder="https://…/file.copc.laz"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <button type="submit" className={styles.browseBtn}>Load</button>
        </form>
      </div>
    </div>
  );
}

