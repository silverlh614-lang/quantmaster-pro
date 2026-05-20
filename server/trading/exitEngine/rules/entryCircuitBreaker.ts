// @responsibility ENTRY_CIRCUIT_BREAKER 매수 직후 1시간 이내 -5% 급락 시 50% 즉시 청산
/**
 * exitEngine/rules/entryCircuitBreaker.ts — Entry Circuit Breaker (ADR-0072).
 *
 * 사용자 운영 보고 (2026-04-27): 현대제철·리노공업 매수 후 급락 사례 — 종합지수 양호
 * 임에도 단일 종목이 매수 직후 급락. 일반 손절선(-7%) 도달 전에 50% 청산할 보호 부재.
 *
 * 트리거 (모두 AND):
 *   1. holdingMinutes ≤ ENTRY_CIRCUIT_HOLDING_MINUTES_MAX (60분)
 *   2. returnPct ≤ ENTRY_CIRCUIT_RETURN_PCT_THRESHOLD (-5%)
 *   3. shadow.entryCircuitTriggered !== true (1회성)
 *
 * 액션:
 *   - 50% 즉시 청산 (reserveSell SSOT 경유)
 *   - entryCircuitTriggered=true (재발동 차단)
 *   - addBuyBlocked=true (추가 매수 차단)
 *   - exitRuleTag='ENTRY_CIRCUIT_BREAKER' 학습 격리
 *   - CRITICAL 텔레그램 알림
 *
 * 우선순위: cascadeWarn(-7%) 다음 — -7% 경보 1회 + -5% 진입 직후 청산이 다층 방어.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { emitTelegramEvent } from '../../../alerts/telegramEventRouter.js';
import { appendShadowLog, syncPositionCache } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { placeReservedSellOrder } from '../helpers/reserveSell.js';

/** 진입 후 본 규칙이 활성화되는 최대 시간 (분). 이 시간 지나면 일반 손절/Cascade 가 담당. */
export const ENTRY_CIRCUIT_HOLDING_MINUTES_MAX = 60;

/** 청산 트리거 손실률 임계 (%). 이보다 *낮은* (더 큰 손실) 값에서 발동. */
export const ENTRY_CIRCUIT_RETURN_PCT_THRESHOLD = -5;

/** 청산 비율. 50% — 자본 보호 + 잔여 회복 여지 균형. */
export const ENTRY_CIRCUIT_SELL_RATIO = 0.5;

/**
 * 진입 시각으로부터 현재까지 경과 분 (소수점 1자리).
 * 잘못된 timestamp 입력 시 Infinity 반환 (트리거 미발동).
 */
export function computeHoldingMinutes(signalTime: string, now: Date = new Date()): number {
  const entry = Date.parse(signalTime);
  if (!Number.isFinite(entry)) return Infinity;
  const diffMs = now.getTime() - entry;
  if (!Number.isFinite(diffMs) || diffMs < 0) return Infinity;
  return diffMs / 60_000;
}

export async function entryCircuitBreaker(ctx: ExitContext): Promise<ExitRuleResult> {
  // ENV 롤백 스위치 — 일시 무력화 시 즉시 NO_OP.
  if (process.env.ENTRY_CIRCUIT_BREAKER_DISABLED === 'true') return NO_OP;

  const { shadow, currentPrice, returnPct } = ctx;

  // 1회성 가드 — 이미 발동된 종목은 재발동 안 함.
  if (shadow.entryCircuitTriggered === true) return NO_OP;

  // 트리거 조건 1: 진입 후 1시간 이내
  const holdingMinutes = computeHoldingMinutes(shadow.signalTime);
  if (holdingMinutes > ENTRY_CIRCUIT_HOLDING_MINUTES_MAX) return NO_OP;

  // 트리거 조건 2: -5% 이상 하락
  if (returnPct > ENTRY_CIRCUIT_RETURN_PCT_THRESHOLD) return NO_OP;

  // 청산 수량 산출 — 50% 청산, 최소 1주 보장.
  const sellQty = Math.max(1, Math.floor(shadow.quantity * ENTRY_CIRCUIT_SELL_RATIO));

  // 롤백용 이전 상태 캡처
  const prevEntryCircuitTriggered = shadow.entryCircuitTriggered;
  const prevAddBuyBlocked = shadow.addBuyBlocked;
  const prevExitRuleTag = shadow.exitRuleTag;

  shadow.entryCircuitTriggered = true;
  shadow.addBuyBlocked = true;
  shadow.exitRuleTag = 'ENTRY_CIRCUIT_BREAKER';

  appendShadowLog({
    event: 'ENTRY_CIRCUIT_BREAKER',
    ...shadow,
    soldQty: sellQty,
    returnPct,
    holdingMinutes,
  });

  console.log(
    `[AutoTrade] 🚨 ${shadow.stockName} (${shadow.stockCode}) ` +
    `Entry Circuit Breaker — 진입 ${holdingMinutes.toFixed(0)}분 만에 ${returnPct.toFixed(2)}% 급락 ` +
    `→ ${sellQty}주 즉시 청산 (잔여 ${shadow.quantity - sellQty}주)`,
  );

  const ts = new Date().toISOString();
  const reserve = await placeReservedSellOrder(shadow, sellQty, 'STOP_LOSS', {
    type: 'SELL', subType: 'STOP_LOSS',
    qty: sellQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * sellQty,
    pnlPct: returnPct,
    reason: `Entry Circuit Breaker (진입 ${holdingMinutes.toFixed(0)}분, ${returnPct.toFixed(2)}%)`,
    exitRuleTag: 'ENTRY_CIRCUIT_BREAKER', timestamp: ts,
  }, 'ENTRY_CIRCUIT_BREAKER');

  if (reserve.kind === 'FAILED') {
    // 실주문 접수 실패 — 플래그 롤백 (다음 기회 재시도)
    shadow.entryCircuitTriggered = prevEntryCircuitTriggered;
    shadow.addBuyBlocked = prevAddBuyBlocked;
    shadow.exitRuleTag = prevExitRuleTag;
  } else {
    syncPositionCache(shadow);
    if (reserve.kind === 'PENDING') {
      addSellOrder({
        ordNo: reserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
        quantity: sellQty, originalReason: 'STOP_LOSS',
        placedAt: ts, relatedTradeId: shadow.id,
      });
    }
  }

  await emitTelegramEvent({
    type: 'PARTIAL_EXIT',
    message:
    `🚨 <b>${reserve.statusPrefix} [Entry Circuit Breaker]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
    `진입 ${holdingMinutes.toFixed(0)}분 만에 ${returnPct.toFixed(2)}% 급락 — 50% 즉시 청산\n` +
    `${sellQty}주 @ ${currentPrice.toLocaleString()}원 (잔여 ${reserve.remainingQty}주)\n` +
    `⚙ 추가 매수 차단 + 학습 격리 (ENTRY_CIRCUIT_BREAKER)` +
    reserve.statusSuffix,
    severity: 'CRITICAL',
    metadata: { symbol: shadow.stockCode },
    dedupeKey: `ecb:${shadow.stockCode}`,
  }).catch(console.error);

  return { skipRest: true };
}
