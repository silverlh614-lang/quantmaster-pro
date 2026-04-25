/**
 * @responsibility 스캔 직전 매크로·시스템 게이트 — KIS·manual·regime·VIX·R6·FOMC·sellOnly 판정
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 중 preflight 단계. 종목별 평가 루프가
 * 시작되기 전에 실행되는 모든 매크로 가드를 한 곳에 모은다:
 *   - KIS_APP_KEY 미설정 단락
 *   - UI 수동 가드 (getManualBlockNewBuy / getManualManageOnly) → sellOnly 승격
 *   - regime/VIX/FOMC/R6_DEFENSE 게이팅
 *   - SELL_ONLY 예외 채널 (evaluateSellOnlyException)
 *   - data-starvation 게이팅 (isDataStarvedScan)
 *   - IPS Kelly 댐퍼 / accountScale Kelly 배수
 */

import type { FullRegimeConfig } from '../../../src/types/core.js';
import type { MacroState } from '../../persistence/macroStateRepo.js';

export interface SellOnlyExceptionDecision {
  allow: boolean;
  maxSlots: number;
  kellyFactor: number;
  minLiveGate: number;
  minMtas: number;
  reason: string;
}

export interface PreflightInput {
  options?: { sellOnly?: boolean; forceBuyCodes?: string[] };
}

export interface PreflightDecision {
  shouldAbort: boolean;
  abortReason?: string;
  sellOnly: boolean;
  sellOnlyException: SellOnlyExceptionDecision;
}

/**
 * SELL_ONLY 예외 채널 판정. 기존 signalScanner.ts L84~110 의 동일 함수 이전 위치.
 */
export function evaluateSellOnlyException(
  _cfg: FullRegimeConfig,
  _macro: MacroState | null,
): SellOnlyExceptionDecision {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — preflight)',
  );
}

/**
 * 계좌 규모별 Kelly 배수. 기존 signalScanner.ts L198~203 이전 위치.
 */
export function getAccountScaleKellyMultiplier(_totalAssets: number): number {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — preflight)',
  );
}

/**
 * 스캔 진입 전 매크로·시스템 게이트 통합 평가.
 */
export async function evaluatePreflight(_input: PreflightInput): Promise<PreflightDecision> {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — preflight)',
  );
}
