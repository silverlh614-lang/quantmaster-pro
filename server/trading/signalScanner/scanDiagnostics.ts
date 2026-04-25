/**
 * @responsibility 스캔 진단 — ScanSummary·연속 제로 카운트·scan traces 영속화
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 중 진단 단계. 기존 signalScanner.ts 의
 * 모듈 전역 상태를 본 파일 내부로 캡슐화한다:
 *   - _lastBuySignalAt / _lastScanSummary / _consecutiveZeroScans
 *   - _scanYahooFails / _scanGateMisses / _scanRrrMisses / _scanEntries 카운터
 *   - _pendingTraces (ScanTrace 버퍼) → appendScanTraces 영속화
 *   - 3회 연속 entries=0 시 텔레그램 침묵 실패 알림
 *
 * 외부 노출 API (barrel re-export 대상):
 *   - ScanSummary 타입
 *   - getLastBuySignalAt() / getLastScanSummary() / getConsecutiveZeroScans()
 */

export interface ScanSummary {
  time: string;
  candidates: number;
  /** @deprecated trackB → swing + catalyst 합산. 하위 호환용. */
  trackB: number;
  swing: number;
  catalyst: number;
  momentum: number;
  yahooFails: number;
  gateMisses: number;
  rrrMisses: number;
  entries: number;
}

export function getLastBuySignalAt(): number {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — scanDiagnostics)',
  );
}

export function getLastScanSummary(): ScanSummary | null {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — scanDiagnostics)',
  );
}

export function getConsecutiveZeroScans(): number {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — scanDiagnostics)',
  );
}

/** 스캔 종료 시점에 호출되어 ScanSummary 를 갱신하고 영속화 트리거. */
export async function recordScanSummary(_summary: Omit<ScanSummary, 'time'>): Promise<void> {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — scanDiagnostics)',
  );
}
