// @responsibility ADR-0659 per-symbol 펀더멘털 deep-junk floor 진입 제외 게이트 (entry chokepoint).

/**
 * fundamentalFloorGate.ts — 형식적 지정 없는 deep-junk(ROE 깊은 음수) 진입 제외 (ADR-0659).
 *
 * ADR-0658 designation gate 직후, 동일 entry chokepoint(buyListLoop Gate1 candidacy 직전)
 * 에서 동작한다. ROE 는 Gate2 external 캐시(getGate2ExternalCacheRecord)에서 reuse-only 로
 * 차용한다 — projection.profitability.roe(없으면 metrics.roe). 이는 /scan_blockers 가
 * 서산 ROE=-55.60 을 표시한 그 캐시와 동일 소스이며 동기 read 라 신규 KIS/DART fetch 0.
 *
 * 제외 시 silently drop 하지 않고 RISK_FUNDAMENTAL_FLOOR_EXCLUDED 진단(perStageDropoff
 * LIVE_ORDER_BLOCKED BLOCKED)을 남겨 /scan_blockers 에 노출한다. shadow/learning 관측 row
 * 는 상위 흐름이 유지(불변식 #2). flag OFF(`=false`) → 항상 PROCEED (byte-identical).
 * ROE 결손/캐시 부재 → PROCEED (graceful; 결손 ≠ junk, 불변식 #6).
 */

import { isFundamentalJunkBelowFloor } from '../../../riskDesignationClassifier.js';
import {
  isRiskFundamentalFloorExclusionEnabled,
  getRiskFundamentalRoeFloorPct,
} from '../../../gateConfig.js';
import { getGate2ExternalCacheRecord } from '../../../gate2/gate2ExternalCache.js';
import { recordPipelineStage } from '../../scanDiagnostics.js';
import type { ScanCounters } from '../../scanDiagnostics.js';

export interface FundamentalFloorGateInput {
  stockCode: string;
  stockName: string;
  scanCounters: ScanCounters;
  /**
   * 테스트/호출자 주입용 ROE override(%) — 미지정 시 Gate2 external 캐시에서 reuse-only read.
   * 프로덕션 호출은 생략하여 캐시 read 단일 경로를 사용한다(신규 fetch 0).
   */
  roePctOverride?: number | null;
}

export interface FundamentalFloorGateResult {
  decision: 'PROCEED' | 'EXCLUDE';
  blockReason?: string;
  logMessage?: string;
}

/**
 * Gate2 external 캐시에서 종목 ROE(%) reuse-only read. 캐시 부재/필드 결손 → null(graceful).
 * 네트워크 호출 0 — gate2ExternalCache 는 디스크 캐시 동기 read(ADR-0529/0532 canonical merge).
 */
function readCandidateRoePct(stockCode: string): number | null {
  try {
    const record = getGate2ExternalCacheRecord(stockCode);
    const projection = record?.projection;
    if (!projection) return null;
    const roe = projection.profitability?.roe ?? projection.metrics?.roe;
    return roe ?? null;
  } catch {
    // 캐시 read 실패는 데이터 결손과 동치 — 진입 차단으로 격상 금지(불변식 #6).
    /* SDS-ignore: 캐시 부재/parse 실패 → ROE 결손과 동일하게 graceful PROCEED. */
    return null;
  }
}

/**
 * 펀더멘털 deep-junk floor 진입 제외 판정. flag OFF / ROE 결손 / floor 초과 → PROCEED.
 * EXCLUDE 시 LIVE_ORDER_BLOCKED stage 를 BLOCKED 로 마킹하고 reason 을 노출한다.
 */
export function evaluateFundamentalFloorGate(
  input: FundamentalFloorGateInput,
): FundamentalFloorGateResult {
  if (!isRiskFundamentalFloorExclusionEnabled()) return { decision: 'PROCEED' };

  const roePct =
    input.roePctOverride !== undefined
      ? input.roePctOverride
      : readCandidateRoePct(input.stockCode);
  const floorPct = getRiskFundamentalRoeFloorPct();
  const decision = isFundamentalJunkBelowFloor({ roePct }, floorPct);
  if (!decision.excluded) return { decision: 'PROCEED' };

  const blockReason = `RISK_FUNDAMENTAL_FLOOR_EXCLUDED(${decision.reason ?? 'FUNDAMENTAL_JUNK_FLOOR'})`;
  // 진단 가시화 — silently drop 금지. /scan_blockers perStageDropoff 에 노출.
  recordPipelineStage(input.scanCounters, 'LIVE_ORDER_BLOCKED', 'BLOCKED');
  return {
    decision: 'EXCLUDE',
    blockReason,
    logMessage:
      `[AutoTrade] 🚫 ${input.stockName}(${input.stockCode}) ` +
      `펀더멘털 deep-junk(ROE floor) — 진입 후보 제외 (${decision.reason ?? 'FUNDAMENTAL_JUNK_FLOOR'}) ` +
      `executionImpact=CANDIDATE_EXCLUSION shadowLearning=관측유지`,
  };
}
