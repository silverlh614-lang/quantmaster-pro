// @responsibility PR-42 M1 부분매도 SELL fill attribution 자동 emit 헬퍼
/**
 * exitEngine/helpers/attribution.ts — emitPartialAttributionForSell (ADR-0028, PR-42 M1).
 *
 * 부분매도 SELL fill 1건이 reserveSell 에서 CONFIRMED 로 기록될 때 PR-19
 * attribution(qtyRatio 가중) 을 자동 emit 한다. 학습 baseline 이 없으면
 * emitPartialAttribution 자체가 null 반환 → 학습 오염 차단.
 *
 * 호출 조건(reserveSell 가 enforce):
 *   - isShadow=true (SHADOW 즉시 CONFIRMED 만, LIVE PROVISIONAL 은 후속 PR)
 *   - remainingQty > 0 (전량 청산은 FULL_CLOSE 경로에서 별도 처리)
 *   - fill.qty > 0
 */

import type { ServerShadowTrade, PositionFill } from '../../../persistence/shadowTradeRepo.js';
import {
  emitPartialAttribution,
  emitFullCloseAttribution,
  type ServerAttributionRecord,
} from '../../../persistence/attributionRepo.js';

type SellFillBase = Omit<PositionFill, 'id' | 'ordNo' | 'status' | 'confirmedAt' | 'revertedAt' | 'revertReason' | 'flagToClearOnRevert'>;

export interface EmitPartialAttributionInputForSell {
  shadow: ServerShadowTrade;
  fill: SellFillBase;
  remainingQty: number;
  newFillId: string | undefined;
  now: string;
}

export function emitPartialAttributionForSell(
  input: EmitPartialAttributionInputForSell,
): ReturnType<typeof emitPartialAttribution> {
  const { shadow, fill, remainingQty, newFillId, now } = input;
  if (remainingQty <= 0 || fill.qty <= 0 || !newFillId) return null;

  const baseQty = shadow.originalQuantity && shadow.originalQuantity > 0
    ? shadow.originalQuantity
    : fill.qty + remainingQty;
  if (baseQty <= 0) return null;

  const closedAt = fill.timestamp ?? now;
  const signalMs = new Date(shadow.signalTime).getTime();
  const closedMs = new Date(closedAt).getTime();
  const holdingDays = Number.isFinite(signalMs) && Number.isFinite(closedMs)
    ? Math.max(0, Math.floor((closedMs - signalMs) / 86_400_000))
    : 0;

  return emitPartialAttribution({
    tradeId:     shadow.id ?? shadow.stockCode,
    fillId:      newFillId,
    stockCode:   shadow.stockCode,
    stockName:   shadow.stockName,
    closedAt,
    returnPct:   fill.pnlPct ?? 0,
    qtyRatio:    fill.qty / baseQty,
    holdingDays,
    entryRegime: shadow.entryRegime,
    sellReason:  fill.reason ?? undefined,
    conditionScoresOverride: shadow.entryConditionScores,
  });
}

// ── 전량 청산 attribution emitter wrapper (PR-2, ADR-0006) ──────────────────
//
// exitEngine 청산 규칙 (hardStopLoss/legacyTakeProfit/cascadeFinal/
// ma60DeathForceExit/r6EmergencyExit) 의 *전량 청산* 분기 (remainingQty=0,
// quantity=0) 직후 호출. shadow.entryConditionScores (PR-1 baseline) 를
// emitFullCloseAttribution 에 전달.
//
// baseline 부재 시 emitFullCloseAttribution 가 null 반환 → 학습 오염 차단.
// 호출자는 try/catch 격리 의무 — attribution 영속 실패가 매매 흐름 차단 안 함.

export interface EmitFullCloseAttributionForExitInput {
  shadow: ServerShadowTrade;
  /** 청산 가격 */
  exitPrice: number;
  /** 청산 시점 returnPct (%) */
  returnPct: number;
  /** 청산 시각 (ISO) — 일반적으로 shadow.exitTime 또는 new Date().toISOString() */
  closedAt: string;
  /** 청산 규칙 식별자 (HARD_STOP / TARGET_EXIT / CASCADE_FINAL / 등) */
  exitRuleTag?: string;
}

export function emitFullCloseAttributionForExit(
  input: EmitFullCloseAttributionForExitInput,
): ServerAttributionRecord | null {
  const { shadow, returnPct, closedAt, exitRuleTag } = input;

  // baseline 부재 — 학습 오염 차단 (PR-1 entryConditionScores 영속 안 된 레거시 trade).
  if (!shadow.entryConditionScores || Object.keys(shadow.entryConditionScores).length === 0) {
    return null;
  }

  const signalMs = new Date(shadow.signalTime).getTime();
  const closedMs = new Date(closedAt).getTime();
  const holdingDays = Number.isFinite(signalMs) && Number.isFinite(closedMs)
    ? Math.max(0, Math.floor((closedMs - signalMs) / 86_400_000))
    : 0;

  return emitFullCloseAttribution({
    tradeId:         shadow.id ?? shadow.stockCode,
    stockCode:       shadow.stockCode,
    stockName:       shadow.stockName,
    closedAt,
    returnPct,
    holdingDays,
    entryRegime:     shadow.entryRegime,
    sellReason:      exitRuleTag,
    exitRuleTag,
    conditionScores: shadow.entryConditionScores,
  });
}
