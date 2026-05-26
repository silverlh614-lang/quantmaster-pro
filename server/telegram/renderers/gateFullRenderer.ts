// @responsibility ADR-0523 full forensic wrapper. Keeps raw detail out of compact messages.

import type { SnapshotBundle } from './snapshotBundle.js';
import type { CanonicalDebugRawView } from './canonicalDebugRawView.js';
import { renderGateDetailSummary } from './gateDetailRenderer.js';

export function renderGateFullForensic(bundle: SnapshotBundle, fullText?: string): string {
  return [
    '[QMP Gate Full Forensic]',
    renderGateDetailSummary(bundle),
    '',
    fullText ?? bundle.fullForensicText ?? 'fullForensic: NOT_ATTACHED',
  ].join('\n');
}

// ADR-0525: debug_raw 는 재계산 번들이 아니라 persisted 정본 슬라이스(CanonicalDebugRawView)를 직렬화한다.
// scan_blockers 와 동일 source(gateLayerAudit.gate3Consolidated 등)에서 추출하므로 gate3 충돌이 불가능하다.
export function renderDebugRaw(view: CanonicalDebugRawView): string {
  return [
    '[QMP Gate Debug Raw]',
    JSON.stringify(view, null, 2),
  ].join('\n');
}
