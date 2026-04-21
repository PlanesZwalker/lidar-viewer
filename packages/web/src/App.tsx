import { useState, useCallback } from 'react';
import { ViewerCanvas } from './components/ViewerCanvas.js';
import { MeasurementPanel } from './components/MeasurementPanel.js';
import { FileDropZone } from './components/FileDropZone.js';
import { Toolbar } from './components/Toolbar.js';
import { MeasurementStore } from '@lidar-viewer/measurements';
import type { MeasurementType } from '@lidar-viewer/measurements';
import type { ViewerSettings } from './viewerTypes.js';
import { DEFAULT_SETTINGS } from './viewerTypes.js';
import styles from './App.module.css';

const store = new MeasurementStore();

export function App() {
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<MeasurementType | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settings, setSettings] = useState<ViewerSettings>(DEFAULT_SETTINGS);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [hasRGB, setHasRGB] = useState(true);

  const handleFileAccepted = useCallback((url: string) => {
    setCloudUrl(url);
    setHasRGB(true); // reset until new cloud confirms its capabilities
  }, []);

  return (
    <div className={styles.app}>
      {!cloudUrl && (
        <FileDropZone onFileAccepted={handleFileAccepted} />
      )}

      {cloudUrl && (
        <>
          <ViewerCanvas
            cloudUrl={cloudUrl}
            measurementStore={store}
            activeTool={activeTool}
            onToolFinished={() => setActiveTool(null)}
            settings={settings}
            onSettingsChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            onCloudLoaded={setHasRGB}
            resetTrigger={resetTrigger}
          />

          <Toolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            settings={settings}
            onSettingsChange={setSettings}
            onResetView={() => setResetTrigger((t) => t + 1)}
            hasRGB={hasRGB}
          />

          {sidebarOpen && (
            <MeasurementPanel store={store} />
          )}
        </>
      )}
    </div>
  );
}
