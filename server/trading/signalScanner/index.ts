/**
 * @responsibility 자동 신호 스캔 오케스트레이터 — preflight→후보→평가→주문→승인→진단 6단계 조율
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 구조 진입점. 본 파일은 기존
 * `server/trading/signalScanner.ts` 의 `runAutoSignalScan` 본체를 6단계 조율
 * 코드(200줄 이내 목표) 로 축약하여 받아들이는 위치다.
 *
 * Phase 2 (스캐폴딩) 단계에서는 시그니처만 정의하고 구현은 후속 Phase 3 에서
 * 단계별로 채워진다. 외부 importer 9개의 import 경로(`server/trading/signalScanner.js`)
 * 는 barrel 로 유지되며 본 파일은 그 barrel 의 단일 진입 export 만 담당한다.
 */

export interface RunAutoSignalScanOptions {
  sellOnly?: boolean;
  forceBuyCodes?: string[];
}

export interface RunAutoSignalScanResult {
  positionFull?: boolean;
}

/**
 * 자동 신호 스캔 진입점. Phase 3 마이그레이션 전에는 호출 시 throw 하며,
 * 기존 `server/trading/signalScanner.ts` 의 동일 export 가 활성 경로다.
 */
export async function runAutoSignalScan(
  _options?: RunAutoSignalScanOptions,
): Promise<RunAutoSignalScanResult> {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — index orchestrator)',
  );
}
