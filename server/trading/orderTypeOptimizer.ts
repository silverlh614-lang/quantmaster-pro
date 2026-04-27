/**
 * @responsibility 주문 타입 의사결정 — IOC_MARKET / LIMIT / AGGRESSIVE_LIMIT 선택 SSOT
 *
 * ADR-0031 (PR-O): 강한 돌파에서 limit 미체결로 다음날 갭업당하던 알파 누수를
 * 종목별 슬리피지 학습 기반 동적 선택으로 차단. ADR-0014 idempotency='unsafe'
 * 호환 — IOC 사용 시 호출자가 5xx 재시도 차단.
 *
 * 본 모듈은 의사결정만 — 실제 주문은 entryEngine 이 호출 (wiring 후속 PR).
 */
import type { SlippageOrderType } from '../persistence/slippageHistoryRepo.js';
import { getSlippageStats } from '../persistence/slippageHistoryRepo.js';

// ─── 임계값 SSOT ────────────────────────────────────────────────────────────

/** 강한 돌파 — IOC_MARKET 즉시 체결 우선 */
export const STRONG_BREAKOUT_VOLUME_Z = 2.0;
export const STRONG_BREAKOUT_PRICE_MOMENTUM_PCT = 2.0;

/** 평균 슬리피지 ≥ 0.5% 면 AGGRESSIVE_LIMIT 으로 chase */
export const HIGH_SLIPPAGE_THRESHOLD = 0.005;
/** AGGRESSIVE_LIMIT 신뢰 표본 최소 수 */
export const SLIPPAGE_MIN_SAMPLE = 10;

/** AGGRESSIVE_LIMIT 의 best_bid + N tick (임시 단위 — entryEngine 이 종목별 tick 으로 변환) */
export const AGGRESSIVE_LIMIT_OFFSET_TICKS = 1;
/** AGGRESSIVE_LIMIT 미체결 후 chase 대기 시간 */
export const CHASE_WAIT_SECONDS = 60;
/** chase 가격 보정 (% — 원래 가격 + delta) */
export const CHASE_PRICE_DELTA_PCT = 0.3;

// ─── 입력/출력 타입 ─────────────────────────────────────────────────────────

export interface OrderDecisionInput {
  stockCode: string;
  /** 신호 시점 거래량 z-score */
  volumeZ?: number;
  /** 신호 시점 가격 모멘텀 (% 변화) */
  priceMomentumPct?: number;
  /** 호출자가 슬리피지 통계 사전 주입 가능 (옵션) — 미주입 시 repo 에서 조회 */
  slippageOverride?: { mean: number; sampleSize: number };
}

export interface ChasePolicy {
  waitSeconds: number;
  priceDeltaPct: number;
}

export interface OrderDecision {
  orderType: SlippageOrderType;
  /** AGGRESSIVE_LIMIT 의 best_bid + N tick */
  limitOffsetTicks?: number;
  /** 미체결 시 chase 정책 (orderType=AGGRESSIVE_LIMIT 일 때만) */
  chasePolicy?: ChasePolicy;
  /** 의사결정 근거 (감사/디버그) */
  reason: string;
}

// ─── 핵심 의사결정 ──────────────────────────────────────────────────────────

/**
 * 주문 타입 의사결정 — 우선순위:
 *  1. 강한 돌파 (volumeZ ≥ 2 + priceMomentum > 2%) → IOC_MARKET
 *  2. 평균 슬리피지 ≥ 0.5% (표본 ≥ 10) → AGGRESSIVE_LIMIT + chase
 *  3. 기본 → LIMIT (best_bid, chase 없음)
 *
 * NaN/Infinity 입력은 안전 fallback (LIMIT 기본).
 */
export function decideOrderType(input: OrderDecisionInput): OrderDecision {
  const volumeZ = Number.isFinite(input.volumeZ ?? NaN) ? input.volumeZ! : 0;
  const priceMomentum = Number.isFinite(input.priceMomentumPct ?? NaN)
    ? input.priceMomentumPct!
    : 0;

  // 1. 강한 돌파 — IOC_MARKET
  if (volumeZ >= STRONG_BREAKOUT_VOLUME_Z && priceMomentum > STRONG_BREAKOUT_PRICE_MOMENTUM_PCT) {
    return {
      orderType: 'IOC_MARKET',
      reason: `강한 돌파 (volumeZ=${volumeZ.toFixed(2)} ≥ ${STRONG_BREAKOUT_VOLUME_Z}, priceMomentum=${priceMomentum.toFixed(2)}% > ${STRONG_BREAKOUT_PRICE_MOMENTUM_PCT}%)`,
    };
  }

  // 2. 평균 슬리피지 학습
  const stats = input.slippageOverride ?? getSlippageStats(input.stockCode);
  if (stats.sampleSize >= SLIPPAGE_MIN_SAMPLE && stats.mean >= HIGH_SLIPPAGE_THRESHOLD) {
    return {
      orderType: 'AGGRESSIVE_LIMIT',
      limitOffsetTicks: AGGRESSIVE_LIMIT_OFFSET_TICKS,
      chasePolicy: {
        waitSeconds: CHASE_WAIT_SECONDS,
        priceDeltaPct: CHASE_PRICE_DELTA_PCT,
      },
      reason: `평균 슬리피지 ${(stats.mean * 100).toFixed(2)}% ≥ ${(HIGH_SLIPPAGE_THRESHOLD * 100).toFixed(1)}% (표본 ${stats.sampleSize}건)`,
    };
  }

  // 3. 기본
  const sampleNote = stats.sampleSize < SLIPPAGE_MIN_SAMPLE
    ? `슬리피지 표본 부족 ${stats.sampleSize}/${SLIPPAGE_MIN_SAMPLE}`
    : `평균 슬리피지 ${(stats.mean * 100).toFixed(2)}% (정상 범위)`;
  return {
    orderType: 'LIMIT',
    reason: `기본 LIMIT — ${sampleNote}`,
  };
}

/**
 * ADR-0014 호환성 가드 — IOC_MARKET 사용 시 호출자가 idempotency='unsafe'
 * 명시했는지 검증하기 위한 헬퍼. entryEngine wiring 시 호출.
 */
export function requiresUnsafeIdempotency(decision: OrderDecision): boolean {
  return decision.orderType === 'IOC_MARKET';
}
