/**
 * entryEngine.ts — 진입 검증 유틸리티
 *
 * signalScanner.ts 에서 분리된 진입 조건 평가 및 포지션 사이징 로직.
 *   EXIT_RULE_PRIORITY_TABLE  — 청산/감축 규칙 우선순위 정책표
 *   buildStopLossPlan()       — 고정/레짐 손절 분리 계획 생성
 *   formatStopLossBreakdown() — 손절 계획 텔레그램 포맷
 *   calculateOrderQuantity()  — 주문 수량 및 실투자금 계산
 *   evaluateEntryRevalidation() — 진입 직전 재검증
 *   isOpenShadowStatus()      — 진행 중 Shadow 상태 판별
 */

import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import type { ExitRuleTag } from '../persistence/shadowTradeRepo.js';
import type { DynamicStopRegime } from '../../src/types/sell.js';
import { evaluateDynamicStop } from '../../src/services/quant/dynamicStopEngine.js';

const ENTRY_MIN_GATE_SCORE = 5;

/** 아이디어 #7: 레짐별 Gate 임계값 — 약세장일수록 기준 강화 */
export const REGIME_GATE_MIN: Record<string, number> = {
  R1_TURBO:   4,
  R2_BULL:    5,
  R3_EARLY:   5,
  R4_NEUTRAL: 5,
  R5_CAUTION: 6,
  R6_DEFENSE: 999, // R6는 entryEngine 진입 전 차단되지만 안전망으로 999
};

/** 레짐 문자열로부터 Gate 최솟값을 반환. 미전달·미지원 레짐 → 기본값 5 */
export function getMinGateScore(regime?: string): number {
  return REGIME_GATE_MIN[regime ?? 'R4_NEUTRAL'] ?? 5;
}
const ENTRY_MAX_BREAKOUT_EXTENSION_PCT = 3;
const ENTRY_MAX_BEARISH_DROP_FROM_OPEN_PCT = -2;
const ENTRY_MAX_OPEN_GAP_OVERHEAT_PCT = 4;
const ENTRY_MIN_VOLUME_RATIO = 0.6;

/**
 * 오전 시간대(09:00~12:00 KST) 거래량 기준 할인 계수.
 * 오전 중에는 거래량이 풀장 대비 낮으므로 volumeRatio 기준을 추가 하향한다.
 * adjustedMinRatio × 0.7 적용 → 실질 기준이 ~30% 완화.
 */
export const MORNING_VOLUME_DISCOUNT = 0.7;
/** 오전 구간 종료 시각: 장 시작(09:00) 이후 180분 = 12:00 KST */
export const MORNING_END_MINUTES = 180;

/** 현재 KST 시각의 장 시작(09:00) 이후 경과 분. 장 시작 전이면 0. */
export function getKstMarketElapsedMinutes(): number {
  const now = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  const kstMinute = now.getUTCMinutes();
  return Math.max(0, (kstHour - 9) * 60 + kstMinute);
}

/**
 * 청산/감축 규칙 우선순위 정책표.
 * ExitRuleTag 타입으로 규칙명이 고정되므로, 새 규칙을 추가할 때는
 * ExitRuleTag(shadowTradeRepo.ts)와 이 테이블을 함께 갱신하면 된다.
 * updateShadowResults(exitEngine.ts)는 이 테이블의 priority 순서로 규칙을 평가한다.
 */
export const EXIT_RULE_PRIORITY_TABLE: ReadonlyArray<{
  priority: number;
  rule: ExitRuleTag;
  description: string;
}> = [
  { priority: 1, rule: 'R6_EMERGENCY_EXIT', description: 'R6_DEFENSE 긴급 부분 청산(30%)' },
  { priority: 2, rule: 'HARD_STOP', description: '하드 스톱(고정 손절/레짐 손절) 전량 청산' },
  { priority: 3, rule: 'CASCADE_FINAL', description: 'Cascade -25%/-30% 최종 청산' },
  { priority: 4, rule: 'LIMIT_TRANCHE_TAKE_PROFIT', description: 'LIMIT 분할 익절' },
  { priority: 5, rule: 'TRAILING_PROTECTIVE_STOP', description: '트레일링 기반 이익보호 손절' },
  { priority: 6, rule: 'TARGET_EXIT', description: '목표가 전량 청산(레거시 fallback)' },
  { priority: 7, rule: 'CASCADE_HALF_SELL', description: 'Cascade -15% 반매도' },
  { priority: 8, rule: 'CASCADE_WARN_BLOCK', description: 'Cascade -7% 경고/추가매수 차단' },
  { priority: 9, rule: 'RRR_COLLAPSE_PARTIAL', description: 'RRR 붕괴(<1.0) 50% 익절' },
  { priority: 10, rule: 'STOP_APPROACH_ALERT', description: '손절 접근 경고(알림)' },
  { priority: 11, rule: 'EUPHORIA_PARTIAL', description: '과열 탐지 부분 매도' },
] as const;

export const OPEN_SHADOW_STATUSES = new Set<ServerShadowTrade['status']>([
  'PENDING',
  'ORDER_SUBMITTED',
  'PARTIALLY_FILLED',
  'ACTIVE',
  'EUPHORIA_PARTIAL',
]);

export function isOpenShadowStatus(status: ServerShadowTrade['status']): boolean {
  return OPEN_SHADOW_STATUSES.has(status);
}

// ── RegimeLevel → DynamicStopRegime 매핑 ──────────────────────────────────────

/**
 * 6단계 시장 레짐을 동적 손절 3단계로 매핑.
 *   R1_TURBO / R2_BULL     → RISK_ON  (여유 있는 손절, ATR × 2.0)
 *   R3_EARLY / R4_NEUTRAL  → RISK_OFF (타이트한 손절, ATR × 1.5)
 *   R5_CAUTION / R6_DEFENSE → CRISIS  (초타이트 손절, ATR × 1.0)
 */
export function regimeToStopRegime(regime?: string): DynamicStopRegime {
  switch (regime) {
    case 'R1_TURBO':
    case 'R2_BULL':
      return 'RISK_ON';
    case 'R3_EARLY':
    case 'R4_NEUTRAL':
      return 'RISK_OFF';
    case 'R5_CAUTION':
    case 'R6_DEFENSE':
      return 'CRISIS';
    default:
      return 'RISK_OFF';
  }
}

// ── Stop Loss Plan ─────────────────────────────────────────────────────────────

interface StopLossPlanInput {
  entryPrice: number;
  fixedStopLoss: number;
  regimeStopRate: number;
  /** 14일 ATR — 동적 손절 계산용 (없으면 고정 손절만 사용) */
  atr14?: number;
  /** 시장 레짐 (ATR 배수 결정용) */
  regime?: string;
}

export interface StopLossPlan {
  /** 진입 구조 훼손 기준의 고정 손절 */
  initialStopLoss: number;
  /** 시장 레짐 악화 기준의 레짐 손절 */
  regimeStopLoss: number;
  /** ATR 기반 동적 손절 (없으면 undefined) */
  dynamicStopLoss?: number;
  /** 실제 강제 청산 기준(가장 촘촘한 손절 = max(initialStopLoss, regimeStopLoss, dynamicStopLoss)) */
  hardStopLoss: number;
}

export function buildStopLossPlan(input: StopLossPlanInput): StopLossPlan {
  const regimeStopLoss = input.entryPrice * (1 + input.regimeStopRate);
  const initialStopLoss = input.fixedStopLoss;

  // ATR 기반 동적 손절 — 종목 변동성 반영
  let dynamicStopLoss: number | undefined;
  if (input.atr14 && input.atr14 > 0) {
    const stopRegime = regimeToStopRegime(input.regime);
    const dynResult = evaluateDynamicStop({
      entryPrice: input.entryPrice,
      atr14: input.atr14,
      regime: stopRegime,
      currentPrice: input.entryPrice, // 진입 시점이므로 현재가 = 진입가
    });
    dynamicStopLoss = dynResult.stopPrice;
  }

  // 3중 손절 비교 — 가장 높은 가격(가장 촘촘한 손절)을 hardStopLoss로 채택
  const candidates = [initialStopLoss, regimeStopLoss];
  if (dynamicStopLoss !== undefined) candidates.push(dynamicStopLoss);
  const hardStopLoss = Math.max(...candidates);

  return {
    initialStopLoss,
    regimeStopLoss,
    dynamicStopLoss,
    hardStopLoss,
  };
}

export function formatStopLossBreakdown(plan: StopLossPlan): string {
  const dynPart = plan.dynamicStopLoss != null
    ? ` / ATR ${plan.dynamicStopLoss.toLocaleString()}`
    : '';
  return `${plan.hardStopLoss.toLocaleString()}원 (고정 ${plan.initialStopLoss.toLocaleString()} / 레짐 ${plan.regimeStopLoss.toLocaleString()}${dynPart})`;
}

// ── Position Sizing ────────────────────────────────────────────────────────────

export interface PositionSizingInput {
  totalAssets: number;
  orderableCash: number;
  positionPct: number;
  price: number;
  remainingSlots: number;
}

export function calculateOrderQuantity(input: PositionSizingInput): { quantity: number; effectiveBudget: number } {
  if (input.price <= 0 || input.remainingSlots <= 0 || input.orderableCash <= 0) {
    return { quantity: 0, effectiveBudget: 0 };
  }
  const targetBudget = Math.max(0, input.totalAssets * input.positionPct);
  const slotBudget = input.orderableCash / input.remainingSlots;
  const effectiveBudget = Math.max(0, Math.min(input.orderableCash, targetBudget, slotBudget));
  return {
    quantity: Math.floor(effectiveBudget / input.price),
    effectiveBudget,
  };
}

// ── Entry Revalidation ─────────────────────────────────────────────────────────

interface EntryRevalidationInput {
  currentPrice: number;
  entryPrice: number;
  quoteGateScore?: number;
  quoteSignalType?: 'STRONG' | 'NORMAL' | 'SKIP';
  dayOpen?: number;
  prevClose?: number;
  volume?: number;
  avgVolume?: number;
  /** 아이디어 #7: 레짐 연동 Gate 최솟값 — getMinGateScore(regime)으로 계산 후 전달 */
  minGateScore?: number;
  /** 장 시작(09:00 KST) 이후 경과 분 — 거래량 비율을 시간대 비례로 보정 */
  marketElapsedMinutes?: number;
}

export function evaluateEntryRevalidation(input: EntryRevalidationInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];

  const minGate = input.minGateScore ?? ENTRY_MIN_GATE_SCORE;
  if (input.quoteSignalType === 'SKIP' || (input.quoteGateScore ?? minGate) < minGate) {
    reasons.push(`Gate 재검증 미달 (${(input.quoteGateScore ?? 0).toFixed(1)}/${minGate})`);
  }

  const extensionPct = ((input.currentPrice - input.entryPrice) / input.entryPrice) * 100;
  if (input.currentPrice >= input.entryPrice && extensionPct > ENTRY_MAX_BREAKOUT_EXTENSION_PCT) {
    reasons.push(`돌파 이탈 과열 (+${extensionPct.toFixed(1)}%)`);
  }

  if (input.dayOpen && input.dayOpen > 0) {
    const dropFromOpenPct = ((input.currentPrice - input.dayOpen) / input.dayOpen) * 100;
    // 시가와 현재가 차이가 ±30% 초과이면 데이터 오류로 간주하여 스킵
    const openSane = Math.abs(dropFromOpenPct) <= 30;
    if (openSane && input.currentPrice < input.dayOpen && dropFromOpenPct <= ENTRY_MAX_BEARISH_DROP_FROM_OPEN_PCT) {
      reasons.push(`시가 대비 급락 (${dropFromOpenPct.toFixed(1)}%)`);
    }
  }

  if (input.prevClose && input.prevClose > 0 && input.dayOpen && input.dayOpen > 0) {
    const openGapPct = ((input.dayOpen - input.prevClose) / input.prevClose) * 100;
    // 30% 초과 갭은 Yahoo Finance 데이터 오류로 간주하여 체크 스킵
    if (openGapPct < 30 && openGapPct >= ENTRY_MAX_OPEN_GAP_OVERHEAT_PCT) {
      reasons.push(`장초반 갭 과열 (+${openGapPct.toFixed(1)}%)`);
    }
  }

  if (input.avgVolume && input.avgVolume > 0 && input.volume !== undefined) {
    const volumeRatio = input.volume / input.avgVolume;
    // 시간대 비례 보정: avgVolume은 하루 전체 평균이므로 장중 경과 비율로 기준 하향
    const TOTAL_MARKET_MINUTES = 390; // 09:00 ~ 15:30
    const elapsed = input.marketElapsedMinutes;
    const elapsedRatio = elapsed != null
      ? Math.min(1, Math.max(0.1, elapsed / TOTAL_MARKET_MINUTES))
      : 1; // 미전달 시 보정 없이 원본 기준 사용
    let adjustedMinRatio = ENTRY_MIN_VOLUME_RATIO * elapsedRatio;
    // 오전 시간대 추가 보정: 12:00 KST 이전이면 기준을 MORNING_VOLUME_DISCOUNT(0.7)만큼 추가 하향
    if (elapsed != null && elapsed < MORNING_END_MINUTES) {
      adjustedMinRatio *= MORNING_VOLUME_DISCOUNT;
    }
    if (volumeRatio < adjustedMinRatio) {
      reasons.push(`거래량 급감 (${volumeRatio.toFixed(2)}x, 기준 ${adjustedMinRatio.toFixed(2)}x)`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}
