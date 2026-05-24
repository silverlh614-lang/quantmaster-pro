// @responsibility ADR-0523 full forensic wrapper. Keeps raw detail out of compact messages.

import type { SnapshotBundle } from './snapshotBundle.js';
import { renderGateDetailSummary } from './gateDetailRenderer.js';

export function renderGateFullForensic(bundle: SnapshotBundle, fullText?: string): string {
  return [
    '[QMP Gate Full Forensic]',
    renderGateDetailSummary(bundle),
    '',
    fullText ?? bundle.fullForensicText ?? 'fullForensic: NOT_ATTACHED',
  ].join('\n');
}

export function renderDebugRaw(bundle: SnapshotBundle): string {
  return [
    '[QMP Gate Debug Raw]',
    JSON.stringify(bundle, null, 2),
  ].join('\n');
}
