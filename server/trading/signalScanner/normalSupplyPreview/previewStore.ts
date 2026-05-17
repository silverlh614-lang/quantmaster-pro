// @responsibility Latest normal supply preview in-memory cache store.
import type { NormalSupplyPreview } from './types.js';

let latestNormalSupplyPreview: NormalSupplyPreview | null = null;

export function setLatestNormalSupplyPreview(preview: NormalSupplyPreview): NormalSupplyPreview {
  latestNormalSupplyPreview = preview;
  return latestNormalSupplyPreview;
}

export function getLastNormalSupplyPreview(): NormalSupplyPreview | null {
  return latestNormalSupplyPreview;
}

export function clearLatestNormalSupplyPreview(): void {
  latestNormalSupplyPreview = null;
}

export function __resetNormalSupplyPreviewForTests(): void {
  clearLatestNormalSupplyPreview();
}
