// @responsibility TAKE_PROFIT_REENTRY_GUARD_ENABLED 플래그 + 익절 전량청산 후 조건부 재진입 판정 SSOT.
/**
 * takeProfitReentryGuard.ts (ADR-0569)
 *
 * 불합리점: 익절(TAKE_PROFIT/EUPHORIA)로 전량 청산한 직후 동일 종목을 다시 매수하면
 * 매도 이유(차익실현/과열/RRR소진)를 무효화한다. 기존 재진입 가드는 수동 청산 72h
 * (manualExitsRepo)와 손실 cascade 180일뿐이라 "자동 익절 전량청산"은 무방비였다.
 *
 * 본 가드는 익절 전량청산 시 barrier(청산가·진입 게이트점수)를 남기고(takeProfitExitsRepo),
 * 재매수 시 아래 중 하나 충족 시에만 허용한다(시간 무관 — 진짜 새 셋업만 통과):
 *   · 가격: currentPrice ≥ exitPrice × (1 + PRICE_MARGIN)   [청산가 +5% 재돌파]
 *   · 게이트: currentGateScore ≥ exitGateScore + GATE_DELTA   [청산 진입보다 +1 상향]
 *
 * default OFF — 하나의 플래그가 stamp(maybeStampTakeProfitReentryBarrier)와
 * check(checkTakeProfitReentryGuard)를 동시에 gate 하므로 OFF 면 byte-identical.
 * 부분 익절 트림(잔량 보유)은 대상 아님 — 전량 청산(remainingQty===0)만.
 * 활성화: ENV `TAKE_PROFIT_REENTRY_GUARD_ENABLED=true`.
 */

import {
  appendTakeProfitExit,
  lastTakeProfitExitForCode,
  type TakeProfitExitRecord,
} from '../persistence/takeProfitExitsRepo.js';

/** 청산가 대비 재돌파 마진 — currentPrice ≥ exitPrice × (1 + margin). */
export const TAKE_PROFIT_REENTRY_PRICE_MARGIN = 0.05; // +5%
/** 청산 진입 게이트점수 대비 상향 폭 — currentGateScore ≥ exitGateScore + delta. */
export const TAKE_PROFIT_REENTRY_GATE_DELTA = 1;
/** barrier 조회 lookback(일) — 실무적 backstop. 그 이전은 만료 간주. */
export const TAKE_PROFIT_REENTRY_LOOKBACK_DAYS = 90;

export function isTakeProfitReentryGuardEnabled(): boolean {
  // default OFF — 명시적으로 'true' 일 때만 활성(ADR-0157 정확 비교).
  return process.env.TAKE_PROFIT_REENTRY_GUARD_ENABLED === 'true';
}

/** 익절(차익실현) 계열 매도 사유만 barrier 대상. 손실(STOP_LOSS)은 제외. */
export function isProfitExitReason(reason: string): boolean {
  return reason === 'TAKE_PROFIT' || reason === 'EUPHORIA';
}

export interface TakeProfitReentryDecision {
  blocked: boolean;
  reason?: string;
  exit?: TakeProfitExitRecord;
  priceConditionMet?: boolean;
  gateConditionMet?: boolean;
}

/**
 * 재매수 직전 호출. flag OFF 또는 최근 익절 barrier 없으면 blocked=false(허용).
 * barrier 있으면 가격 OR 게이트 조건 충족 시에만 허용, 아니면 차단.
 */
export function checkTakeProfitReentryGuard(
  stockCode: string,
  currentPrice: number,
  currentGateScore: number,
  now = new Date(),
): TakeProfitReentryDecision {
  if (!isTakeProfitReentryGuardEnabled()) return { blocked: false };

  const exit = lastTakeProfitExitForCode(stockCode, TAKE_PROFIT_REENTRY_LOOKBACK_DAYS, now);
  if (!exit) return { blocked: false };

  const priceConditionMet =
    Number.isFinite(currentPrice) &&
    Number.isFinite(exit.exitPrice) &&
    exit.exitPrice > 0 &&
    currentPrice >= exit.exitPrice * (1 + TAKE_PROFIT_REENTRY_PRICE_MARGIN);

  // exitGateScore 가 null(레거시 포지션)이면 게이트 조건은 평가 불가 → false(가격 조건만).
  const gateConditionMet =
    exit.exitGateScore != null &&
    Number.isFinite(currentGateScore) &&
    currentGateScore >= exit.exitGateScore + TAKE_PROFIT_REENTRY_GATE_DELTA;

  if (priceConditionMet || gateConditionMet) {
    return { blocked: false, exit, priceConditionMet, gateConditionMet };
  }
  return {
    blocked: true,
    reason:
      `TAKE_PROFIT_REENTRY_BLOCKED price=${currentPrice} exitPrice=${exit.exitPrice} ` +
      `(+${(TAKE_PROFIT_REENTRY_PRICE_MARGIN * 100).toFixed(0)}% 미달) ` +
      `gate=${currentGateScore} exitGate=${exit.exitGateScore ?? 'n/a'}`,
    exit,
    priceConditionMet,
    gateConditionMet,
  };
}

/**
 * 익절 전량청산 시 재진입 barrier 를 남긴다. reserveSell 의 매도 완료 직후 호출.
 * flag OFF / 익절 사유 아님 / 미체결 / 전량청산 아님(잔량>0) 이면 no-op.
 * reserveSell 과의 순환참조 회피를 위해 primitive 입력만 받는다. try/catch 격리.
 */
export function maybeStampTakeProfitReentryBarrier(
  input: {
    stockCode: string;
    stockName: string;
    orderReason: string;
    recorded: boolean;
    remainingQty: number;
    exitPrice: number;
    exitGateScore: number | null;
    exitReturnPct: number | null;
  },
  now = new Date(),
): void {
  if (!isTakeProfitReentryGuardEnabled()) return;
  if (!isProfitExitReason(input.orderReason)) return;
  if (!input.recorded || input.remainingQty !== 0) return; // 전량 청산만
  if (!Number.isFinite(input.exitPrice) || input.exitPrice <= 0) return;
  try {
    appendTakeProfitExit(
      {
        stockCode: input.stockCode,
        stockName: input.stockName,
        exitPrice: input.exitPrice,
        exitGateScore: input.exitGateScore,
        exitReturnPct: input.exitReturnPct,
        exitReason: input.orderReason,
        exitAt: now.toISOString(),
      },
      now,
    );
  } catch (e) {
    console.error('[TakeProfitReentry] barrier stamp 실패:', e instanceof Error ? e.message : e);
  }
}
