/**
 * @responsibility ADR-0448 Phase 0 — R3 Noise Governor wiring helper.
 *
 * scanDiagnostics.persistScanResults 시점에 isGate1Zero 분기에서 evaluateR3NoiseGovernor
 * 호출 + StreakSkipContext 합성 + try/catch 격리 + ScanSummary.r3NoiseDecision 영속을
 * 담당하는 헬퍼. scanDiagnostics.ts 본체에서 분리하여 SRP 보존 (1500줄 임계 보호).
 */

import {
  evaluateR3NoiseGovernor,
  isR3NoiseGovernorDisabled,
  type R3NoiseGovernorDecision,
} from './r3NoiseGovernor.js';
import type { StreakSkipContext } from './r3StreakSkipPolicy.js';
import type { PersistScanResultsOptions, ScanSummary } from './scanDiagnostics.js';

export interface R3NoiseWiringInput {
  summary: ScanSummary;
  options: PersistScanResultsOptions;
  kstNow: Date;
}

/**
 * R3 Noise Governor 결정 합성. ENV DISABLED 또는 throw 시 undefined 반환.
 *
 * 호출자가 결과를 받아:
 *   - undefined → 기존 동작 (ADR-0419 evaluateStreakIncrementAllowed 단독)
 *   - decision.streakImpact === 0 → R3 state machine 호출 자체 skip
 *   - decision.streakImpact === 1 → 정상 streak 누적
 *   - 모든 분기 → ScanSummary.r3NoiseDecision 영속 (compact line 자동 노출)
 */
export function buildR3NoiseDecision(
  input: R3NoiseWiringInput,
): R3NoiseGovernorDecision | undefined {
  if (isR3NoiseGovernorDisabled()) return undefined;
  try {
    const { summary, options, kstNow } = input;
    const sectorEnergyDiagnosticBlocked =
      options.sectorEnergyQualityDiagnostic?.shouldBlockLeadershipConfidence === true;
    const macro = options.macroGateState;
    const streakSkipContext: StreakSkipContext = {
      todayKstDate: kstNow.toISOString().slice(0, 10),
      isKrxTradingDay: true, // persistScanResults 도달 = preflight 통과 = KRX 거래일
      volumeClockAllowsEntry: options.volumeClockAllowsEntry ?? true,
      emergencyStop: macro?.emergencyStop ?? false,
      manualBlockNewBuy: false,
      manualManageOnly: false,
      sellOnlyMode: macro?.sellOnlyMode === true,
      regime: macro?.regime ?? 'UNKNOWN',
      bearDefenseMode: macro?.bearDefenseMode === true,
      vixGatingActive: macro?.vixGatingActive === true,
      fomcBlockActive:
        macro?.fomcPhase === 'DAY' || (macro?.fomcKellyMultiplier ?? 1) === 0,
      dataStarvedScan: false,
      frozenQuoteDataQuality: options.frozenQuote?.dataQuality ?? 'OK',
    };
    return evaluateR3NoiseGovernor({
      streakSkipContext,
      gate1Pass: summary.gatePassDistribution?.gate1Pass ?? 0,
      candidates: summary.candidates,
      sectorEnergyDiagnosticBlocked,
      shadowObservableExists: (summary.shadowObservableCount ?? 0) > 0,
      providerDegraded: false,
    });
  } catch (err) {
    console.warn('[ADR-0448] R3 Noise Governor 평가 실패:', err);
    return undefined;
  }
}
