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

const ENTRY_MIN_GATE_SCORE = 5;
const ENTRY_MAX_BREAKOUT_EXTENSION_PCT = 3;
const ENTRY_MAX_BEARISH_DROP_FROM_OPEN_PCT = -2;
const ENTRY_MAX_OPEN_GAP_OVERHEAT_PCT = 4;
const ENTRY_MIN_VOLUME_RATIO = 0.6;

/**
 * 청산/감축 규칙 우선순위 정책표.
 * updateShadowResults에서 아래 순서를 수동으로 동일하게 유지해 실행한다.
 * (정책표와 실제 if-branch 순서가 어긋나면 실전/백테스트 결과 차이가 커질 수 있음)
 */
export const EXIT_RULE_PRIORITY_TABLE = [
  { priority: 1, rule: 'R6_EMERGENCY_EXIT', description: 'R6_DEFENSE 긴급 부분 청산(30%)' },
  { priority: 2, rule: 'HARD_STOP', description: '하드 스톱(고정 손절/레짐 손절) 전량 청산' },
  { priority: 3, rule: 'CASCADE_FINAL', description: 'Cascade -25%/-30% 최종 청산' },
  { priority: 4, rule: 'LIMIT_TRANCHE_TAKE_PROFIT', description: 'LIMIT 분할 익절' },
  { priority: 5, rule: 'TRAILING_PROTECTIVE_STOP', description: '트레일링 기반 이익보호 손절' },
  { priority: 6, rule: 'TARGET_EXIT', description: '목표가 전량 청산(레거시 fallback)' },
  { priority: 7, rule: 'CASCADE_HALF_SELL', description: 'Cascade -15% 반매도' },
  { priority: 8, rule: 'CASCADE_WARN_BLOCK', description: 'Cascade -7% 경고/추가매수 차단' },
  { priority: 9, rule: 'STOP_APPROACH_ALERT', description: '손절 접근 경고(알림)' },
  { priority: 10, rule: 'EUPHORIA_PARTIAL', description: '과열 탐지 부분 매도' },
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

// ── Stop Loss Plan ─────────────────────────────────────────────────────────────

interface StopLossPlanInput {
  entryPrice: number;
  fixedStopLoss: number;
  regimeStopRate: number;
}

export interface StopLossPlan {
  /** 진입 구조 훼손 기준의 고정 손절 */
  initialStopLoss: number;
  /** 시장 레짐 악화 기준의 레짐 손절 */
  regimeStopLoss: number;
  /** 실제 강제 청산 기준(더 높은 가격의 촘촘한 손절 = max(initialStopLoss, regimeStopLoss)) */
  hardStopLoss: number;
}

export function buildStopLossPlan(input: StopLossPlanInput): StopLossPlan {
  const regimeStopLoss = input.entryPrice * (1 + input.regimeStopRate);
  const initialStopLoss = input.fixedStopLoss;
  const hardStopLoss = Math.max(initialStopLoss, regimeStopLoss);
  return {
    initialStopLoss,
    regimeStopLoss,
    hardStopLoss,
  };
}

export function formatStopLossBreakdown(plan: StopLossPlan): string {
  return `${plan.hardStopLoss.toLocaleString()}원 (고정 ${plan.initialStopLoss.toLocaleString()} / 레짐 ${plan.regimeStopLoss.toLocaleString()})`;
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
}

export function evaluateEntryRevalidation(input: EntryRevalidationInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (input.quoteSignalType === 'SKIP' || (input.quoteGateScore ?? ENTRY_MIN_GATE_SCORE) < ENTRY_MIN_GATE_SCORE) {
    reasons.push(`Gate 재검증 미달 (${(input.quoteGateScore ?? 0).toFixed(1)}/${ENTRY_MIN_GATE_SCORE})`);
  }

  const extensionPct = ((input.currentPrice - input.entryPrice) / input.entryPrice) * 100;
  if (input.currentPrice >= input.entryPrice && extensionPct > ENTRY_MAX_BREAKOUT_EXTENSION_PCT) {
    reasons.push(`돌파 이탈 과열 (+${extensionPct.toFixed(1)}%)`);
  }

  if (input.dayOpen && input.dayOpen > 0) {
    const dropFromOpenPct = ((input.currentPrice - input.dayOpen) / input.dayOpen) * 100;
    if (input.currentPrice < input.dayOpen && dropFromOpenPct <= ENTRY_MAX_BEARISH_DROP_FROM_OPEN_PCT) {
      reasons.push(`시가 대비 급락 (${dropFromOpenPct.toFixed(1)}%)`);
    }
  }

  if (input.prevClose && input.prevClose > 0 && input.dayOpen && input.dayOpen > 0) {
    const openGapPct = ((input.dayOpen - input.prevClose) / input.prevClose) * 100;
    if (openGapPct >= ENTRY_MAX_OPEN_GAP_OVERHEAT_PCT) {
      reasons.push(`장초반 갭 과열 (+${openGapPct.toFixed(1)}%)`);
    }
  }

  if (input.avgVolume && input.avgVolume > 0 && input.volume !== undefined) {
    const volumeRatio = input.volume / input.avgVolume;
    if (volumeRatio < ENTRY_MIN_VOLUME_RATIO) {
      reasons.push(`거래량 급감 (${volumeRatio.toFixed(2)}x)`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}
