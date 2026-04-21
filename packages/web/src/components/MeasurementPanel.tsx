import { useEffect, useState } from 'react';
import type { MeasurementStore, Measurement } from '@lidar-viewer/measurements';
import styles from './MeasurementPanel.module.css';

interface Props {
  store: MeasurementStore;
}

export function MeasurementPanel({ store }: Props) {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  useEffect(() => store.subscribe(setMeasurements), [store]);

  const handleExportCSV = () => {
    const rows = [
      ['ID', 'Type', 'Label', 'Result', 'Unit', 'Points'],
      ...measurements.map((m) => [
        m.id,
        m.type,
        m.label,
        m.result?.toFixed(3) ?? '',
        m.unit,
        m.points.map((p) => `(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)})`).join(' '),
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'measurements.csv';
    a.click();
  };

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <h2>Measurements</h2>
        {measurements.length > 0 && (
          <div className={styles.headerActions}>
            <button className={styles.clearBtn} onClick={() => store.clear()} title="Remove all measurements">Clear all</button>
            <button className={styles.exportBtn} onClick={handleExportCSV} title="Export as CSV">Export CSV</button>
          </div>
        )}
      </div>

      {measurements.length === 0 && (
        <p className={styles.empty}>No measurements yet.<br />Use the toolbar to start.</p>
      )}

      <ul className={styles.list}>
        {measurements.map((m) => (
          <li key={m.id} className={styles.item}>
            <span className={styles.dot} style={{ background: m.color }} />
            <div className={styles.info}>
              <span className={styles.label}>{m.label}</span>
              <span className={styles.result}>
                {m.result !== null
                  ? `${m.result.toFixed(3)} ${m.unit}`
                  : m.points.length > 0 ? `${m.points.length} pt${m.points.length > 1 ? 's' : ''}` : '—'}
              </span>
            </div>
            <button
              className={styles.removeBtn}
              onClick={() => store.remove(m.id)}
              aria-label="Remove measurement"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
