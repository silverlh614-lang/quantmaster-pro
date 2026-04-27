// @responsibility 매도 Fill 을 outcome 별 안전 상태로 기록하는 SSOT 헬퍼
/**
 * exitEngine/helpers/reserveSell.ts — "주문 접수 ≠ 체결" 원칙 강제 (ADR-0028).
 *
 * 과거 recordSell 은 KIS 주문 접수 직후(체결 확인 前) 의도 수량 그대로 Fill 을
 * 선반영했다. 이 방식은 세 가지 실패 경로를 구분하지 못했다:
 *   1) SHADOW 모드 — 실주문 없음인데 "체결"로 기록되어 KIS 잔고와 Shadow DB 괴리.
 *   2) LIVE 주문 접수 실패 — ODNO 미발급인데 Fill 이 남아 수량·손익 왜곡.
 *   3) LIVE 접수 성공 후 미체결/재발행 실패 — PROVISIONAL 상태 표기 없이 확정.
 *
 * reserveSell 은 SellOrderResult.outcome 으로 세 경로를 명시적으로 분기한다:
 *   · SHADOW_ONLY  → Fill 즉시 CONFIRMED (가상 체결)
 *   · LIVE_ORDERED → Fill PROVISIONAL + ordNo 보존 (pollSellFills 가 CONFIRM 또는 REVERT)
 *   · LIVE_FAILED  → Fill 기록 스킵 + 호출측이 중복 방지 플래그를 롤백
 *
 * Telegram 메시지는 3-상태 접두어를 붙여 운영자가 실주문 여부를 즉시 구분하도록 한다.
 */

import type { SellOrderResult } from '../../../clients/kisClient.js';
import {
  type ServerShadowTrade,
  type PositionFill,
  appendFill,
  syncPositionCache,
  getRemainingQty,
  getTotalRealizedPnl,
} from '../../../persistence/shadowTradeRepo.js';
import { appendTradeEvent, type TradeEvent } from '../../tradeEventLog.js';
import { emitPartialAttributionForSell } from './attribution.js';

export type ReserveSellResult =
  | { kind: 'SHADOW';  recorded: true;  remainingQty: number; statusPrefix: string; statusSuffix: string }
  | { kind: 'PENDING'; recorded: true;  remainingQty: number; statusPrefix: string; statusSuffix: string; ordNo: string }
  | { kind: 'FAILED';  recorded: false; remainingQty: number; statusPrefix: string; statusSuffix: string; reason: string };

/** PositionFill 중에서 reserveSell 이 내부적으로 채우는 필드는 입력에서 제외한다. */
export type SellFillInput = Omit<PositionFill, 'id' | 'ordNo' | 'status' | 'confirmedAt' | 'revertedAt' | 'revertReason' | 'flagToClearOnRevert'>;

/**
 * 매도 Fill 을 세 가지 상태 중 하나로 안전하게 기록한다.
 * Fill SSOT (fills 배열) 에 PROVISIONAL/CONFIRMED/REVERTED 라벨을 부여하여
 * "주문 접수 ≠ 체결" 원칙을 회계 레벨에서 강제한다.
 *
 * @param flagToClearOnRevert  fill 이 REVERTED 로 전환될 때 초기화할 중복 방지 플래그.
 *                              DIVERGENCE/RRR/R6 같은 1회성 경로에서 설정.
 */
export function reserveSell(
  shadow: ServerShadowTrade,
  orderRes: SellOrderResult,
  fill: SellFillInput,
  evtSubType: TradeEvent['subType'],
  flagToClearOnRevert?: PositionFill['flagToClearOnRevert'],
): ReserveSellResult {
  if (orderRes.outcome === 'LIVE_FAILED') {
    // 실주문 접수 실패 — Fill 기록 스킵. 호출측이 중복 방지 플래그/상태를 롤백한다.
    return {
      kind: 'FAILED',
      recorded: false,
      remainingQty: getRemainingQty(shadow),
      statusPrefix: '❌ [주문 실패]',
      statusSuffix: `\n🚨 실주문 접수 실패 — ${orderRes.failureReason ?? 'unknown'}. 수동 매도/재시도 필요.`,
      reason: orderRes.failureReason ?? 'unknown',
    };
  }

  const isShadow = orderRes.outcome === 'SHADOW_ONLY';
  const nowIso = new Date().toISOString();

  const fullFill: Omit<PositionFill, 'id'> = {
    ...fill,
    ordNo: isShadow ? undefined : orderRes.ordNo ?? undefined,
    status: isShadow ? 'CONFIRMED' : 'PROVISIONAL',
    confirmedAt: isShadow ? nowIso : undefined,
    flagToClearOnRevert,
  };
  appendFill(shadow, fullFill);
  // ⚡ Fill 추가 직후 캐시 동기화 — SSOT(fills) 와 파생 필드(quantity) 불일치 방지.
  // 호출측에서 syncPositionCache 를 잊는 경로가 있었고(RRR/Tranche 등 일부),
  // 그 결과 fills 엔 SELL 이 들어갔는데 trade.quantity 는 그대로 유지되어
  // /pos · /pnl · 후속 exitEngine 루프가 잔량을 과대 평가하는 버그를 유발했다.
  // 이 위치에서 보장하면 모든 매도 경로(SHADOW·LIVE_ORDERED·향후 신규)가
  // fills 추가와 동시에 quantity·originalQuantity 캐시도 정합 상태가 된다.
  syncPositionCache(shadow);
  const remainingQty    = getRemainingQty(shadow);
  const cumRealizedPnL  = getTotalRealizedPnl(shadow);
  appendTradeEvent({
    positionId:    shadow.id ?? shadow.stockCode,
    ts:            fill.timestamp,
    type:          remainingQty === 0 ? 'FULL_SELL' : 'PARTIAL_SELL',
    subType:       evtSubType,
    quantity:      fill.qty,
    price:         fill.price,
    realizedPnL:   fill.pnl ?? 0,
    cumRealizedPnL,
    remainingQty,
  });
  // PR-42 M1 — 부분매도 시 PR-19(ADR-0006) attribution 자동 기록.
  // 조건: SHADOW(CONFIRMED 즉시) + 잔량 > 0 + originalQuantity 확정.
  // baseline conditionScores 가 없으면 emitPartialAttribution 가 null 을 반환해
  // 학습 오염을 차단한다. LIVE PROVISIONAL fill 은 reserveSell 에서 emit 하지
  // 않고 fillMonitor 의 confirm 시점 wiring 을 후속 PR 로 분리한다.
  if (isShadow) {
    const lastFill = shadow.fills?.[shadow.fills.length - 1];
    emitPartialAttributionForSell({
      shadow,
      fill,
      remainingQty,
      newFillId: lastFill?.id,
      now: nowIso,
    });
  }

  if (isShadow) {
    return {
      kind: 'SHADOW',
      recorded: true,
      remainingQty,
      statusPrefix: '🎭 [SHADOW 가상 체결]',
      statusSuffix: '\n⚠️ 실주문 없음 · KIS 잔고 불변 (Shadow 모드)',
    };
  }
  return {
    kind: 'PENDING',
    recorded: true,
    remainingQty,
    statusPrefix: '⏳ [체결 대기]',
    statusSuffix: `\n⏳ 주문 접수됨 (ODNO ${orderRes.ordNo}) — CCLD 확인 후 최종 확정`,
    ordNo: orderRes.ordNo as string,
  };
}
