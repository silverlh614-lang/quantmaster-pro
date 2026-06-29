// @responsibility ADR-0658 per-symbol 위험·경고 지정 진입 제외 게이트 (entry chokepoint).

/**
 * riskDesignationGate.ts — 위험·경고 지정 종목 진입 후보 제외 (ADR-0658).
 *
 * signalScanner per-symbol 평가에서 hydrated quote(reCheckQuote.kisOfficialQuote.designation)
 * 가 가용한 단일 chokepoint — 모든 candidate 소스(INTRADAY_MOVER/WATCHLIST/universeScanner/
 * prior-carry)가 통과한다. Gate1 entry candidacy 직전에 위치한다.
 *
 * 제외 시 silently drop 하지 않고 RISK_DESIGNATION_EXCLUDED 진단(perStageDropoff BLOCKED)
 * 을 남겨 /scan_blockers 에 노출한다. shadow/learning 관측 row 는 상위 흐름이 유지(불변식 #2).
 * flag OFF(`=false`) → 항상 PROCEED (byte-identical). designation 결손 → PROCEED (graceful).
 */

import type { NormalizedKisOfficialQuote } from '../../../../clients/kisClient/kisOfficialQuoteMapper.js';
import { isRiskDesignatedStock } from '../../../riskDesignationClassifier.js';
import { isRiskDesignationExclusionEnabled } from '../../../gateConfig.js';
import { recordPipelineStage } from '../../scanDiagnostics.js';
import type { ScanCounters } from '../../scanDiagnostics.js';

export interface RiskDesignationGateInput {
  stockCode: string;
  stockName: string;
  /** kisIntradayCorrectionStep 산출 reCheckQuote (kisOfficialQuote.designation carry). */
  reCheckQuote: { kisOfficialQuote?: NormalizedKisOfficialQuote } | null | undefined;
  scanCounters: ScanCounters;
}

export interface RiskDesignationGateResult {
  decision: 'PROCEED' | 'EXCLUDE';
  blockReason?: string;
  logMessage?: string;
}

/**
 * 위험·경고 지정 진입 제외 판정. flag OFF / 결손 designation / 정상 종목 → PROCEED.
 * EXCLUDE 시 LIVE_ORDER_BLOCKED stage 를 BLOCKED 로 마킹하고 reason 을 노출한다.
 */
export function evaluateRiskDesignationGate(
  input: RiskDesignationGateInput,
): RiskDesignationGateResult {
  if (!isRiskDesignationExclusionEnabled()) return { decision: 'PROCEED' };

  const designation = input.reCheckQuote?.kisOfficialQuote?.designation;
  const decision = isRiskDesignatedStock(designation);
  if (!decision.excluded) return { decision: 'PROCEED' };

  const blockReason = `RISK_DESIGNATION_EXCLUDED(${decision.reason ?? 'RISK_DESIGNATED'})`;
  // 진단 가시화 — silently drop 금지. /scan_blockers perStageDropoff 에 노출.
  recordPipelineStage(input.scanCounters, 'LIVE_ORDER_BLOCKED', 'BLOCKED');
  return {
    decision: 'EXCLUDE',
    blockReason,
    logMessage:
      `[AutoTrade] 🚫 ${input.stockName}(${input.stockCode}) ` +
      `위험·경고 지정 — 진입 후보 제외 (${decision.reason ?? 'RISK_DESIGNATED'}) ` +
      `executionImpact=CANDIDATE_EXCLUSION shadowLearning=관측유지`,
  };
}
