import type { ColorMode } from '@lidar-viewer/core';

export type { ColorMode };

export interface ViewerSettings {
  colorMode: ColorMode;
  pointSize: number;
  edlEnabled: boolean;
  splatMode: boolean;
}

export const DEFAULT_SETTINGS: ViewerSettings = {
  colorMode: 'rgb',
  pointSize: 2.0,
  edlEnabled: true,
  splatMode: false,
};
