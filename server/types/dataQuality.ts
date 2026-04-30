// @responsibility ADR-0117 DataQuality 격리 + WaitReason union SSOT — 거래 차단 게이트 타입
/**
 * dataQuality.ts (ADR-0117) — 거래 차단 게이트 타입 SSOT.
 *
 * 사용자 18단계 설계안 §6 "Drift Sanity Hard Filter" + §15 "DATA_HOLD 상태"
 * 직접 반영. ADR-0028/0113 의 sanity 검증을 *경고* 에서 *거래 차단* 의미론으로
 * 승격하기 위한 공용 타입.
 *
 * 사용 패턴:
 *   1. safePctChangeStrict 가 SafePctStrictResult 반환
 *   2. 호출자가 DataQualityInfo 로 변환 + recommendation/trade 에 영속
 *   3. shouldBlockTradingByDataQuality 가 entryEngine / sizingTier / orchestrator
 *      최종 결정 직전 의무 호출 → 거래 차단 결정
 */

/**
 * sanity 검증 결과 분류. SafePctStrictStatus 와 동일 union.
 */
export type DataQualityStatus =
  | 'OK'
  | 'STALE_BASE_OR_SPLIT_ADJUSTMENT'
  | 'ZERO_OR_INVALID_PRICE'
  | 'SOURCE_UNTRUSTED';

/**
 * recommendation/trade record 에 영속될 격리 메타.
 *
 * status='OK' 가 아닐 때 호출자(entryEngine/sizingTier 등)가 거래 차단 결정.
 * shouldBlockTradingByDataQuality 가 단일 SSOT — 분기 로직 중복 금지.
 */
export interface DataQualityInfo {
  status: DataQualityStatus;
  reason: string;
  current?: number;
  base?: number;
  source?: string;
  context?: string;
  /** 격리 마커가 부착된 시각 (ISO). */
  updatedAt: string;
}

/**
 * 진입 결정에서 WAIT 분기 사유 분류.
 *
 * - PRE_BREAKOUT: 진입가 미도달 (ADR-0115 P1 #4 — failCount 미증가)
 * - GATE_FAIL: Gate 재검증 미달 (NON_CRITICAL — failCount 미증가)
 * - DATA_HOLD: ADR-0117 신규 — sanity 위반 거래 차단 (NON_CRITICAL — 재검증 가능)
 * - RISK_OFF: R6_DEFENSE / VIX 게이팅 / 비상정지
 * - NO_LAST_TRIGGER: 라스트 트리거 미충족
 * - SIZING_BLOCKED: ADR-0117 신규 — sizingTier BLOCKED (DATA_QUARANTINE)
 */
export type WaitReason =
  | 'PRE_BREAKOUT'
  | 'GATE_FAIL'
  | 'DATA_HOLD'
  | 'RISK_OFF'
  | 'NO_LAST_TRIGGER'
  | 'SIZING_BLOCKED';

/**
 * 거래 차단 게이트 단일 SSOT.
 * dataQuality 가 OK 가 아닌 모든 분류 → 거래 차단.
 *
 * 호출자:
 *   - entryEngine.evaluateEntryRevalidation 최종 분기
 *   - sizingTierDecider 진입부
 *   - orchestrator / autoTradeEngine 최종 결정 직전 (후속 PR wiring)
 */
const TRADE_BLOCKING_STATUSES: ReadonlySet<DataQualityStatus> = new Set<DataQualityStatus>([
  'STALE_BASE_OR_SPLIT_ADJUSTMENT',
  'SOURCE_UNTRUSTED',
  'ZERO_OR_INVALID_PRICE',
]);

export function shouldBlockTradingByDataQuality(dq?: DataQualityInfo): boolean {
  if (!dq) return false;
  return TRADE_BLOCKING_STATUSES.has(dq.status);
}

/** ENV 우회 — true 시 strict 모드 비활성 (위반 시 ok=true + warn 만). */
export function isDataQualityStrictDisabled(): boolean {
  return process.env.DATA_QUALITY_STRICT_DISABLED === 'true';
}
