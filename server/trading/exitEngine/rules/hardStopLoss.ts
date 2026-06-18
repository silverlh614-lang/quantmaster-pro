// @responsibility 고정/레짐/Profit Protection 손절선 도달 전량 청산 규칙
/**
 * exitEngine/rules/hardStopLoss.ts — 하드 스톱 (고정 손절/레짐 손절) (ADR-0028).
 * ATR 트레일링이 손절을 초기/레짐 이상으로 끌어올린 경우 → PROFIT_PROTECTION.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { emitTelegramEvent } from '../../../alerts/telegramEventRouter.js';
import { channelSellSignal } from '../../../alerts/channelPipeline.js';
import { sendStopLossTransparencyReport } from '../../../alerts/stopLossTransparencyReport.js';
import { appendShadowLog, updateShadow } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { placeReservedSellOrder } from '../helpers/reserveSell.js';
import { captureFullCloseSnapshot, rollbackFullCloseOnFailure } from '../helpers/rollbackFullClose.js';
import { emitFullCloseAttributionForExit } from '../helpers/attribution.js';
import { applyTwoBarBepGate } from '../helpers/twoBarBepGate.js';
import { matchExitInvalidation, promoteInvalidationPatternIfRepeated } from '../../preMortemStructured.js';
import { promoteKellyDriftPattern } from '../../../learning/kellyDriftFailurePromotion.js';
import { classifyExitOutcome } from '../../exitOutcomeClassifier.js';

export async function hardStopLoss(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct, currentRegime, initialStopLoss, regimeStopLoss, hardStopLoss } = ctx;

  if (currentPrice > hardStopLoss) return NO_OP;

  // ATR 트레일링이 손절을 초기/레짐 이상으로 끌어올린 경우 → PROFIT_PROTECTION
  let stopLossExitType: 'INITIAL' | 'REGIME' | 'INITIAL_AND_REGIME' | 'PROFIT_PROTECTION';
  if (hardStopLoss > initialStopLoss && hardStopLoss > regimeStopLoss) {
    stopLossExitType = 'PROFIT_PROTECTION';
  } else {
    const stopGap = Math.abs(initialStopLoss - regimeStopLoss);
    stopLossExitType = stopGap < 0.5
      ? 'INITIAL_AND_REGIME'
      : (initialStopLoss > regimeStopLoss ? 'INITIAL' : 'REGIME');
  }

  // === ADR-0085 PR-B1-1 — Two-Bar Confirmation Gate (BEP_PROTECTION 단봉 노이즈 차단) ===
  // BEP 글라이드 영역 (PROFIT_PROTECTION) 손절선 도달 시 1차 터치는 영속만, 2개 봉 연속
  // 미달 후 청산 — 단봉 노이즈 (장중 일시 급락 후 회복) 에서 진짜 추세 반전이 아닌데
  // 청산하던 손실 차단. ENV 롤백:
  //   - BEP_PROTECTION_DISABLED=true → 즉시 legacy (게이트 비활성, 즉시 청산 진행)
  //   - BEP_TWO_BAR_LIVE_ENABLED 미설정 + LIVE 모드 → SKIP (회귀 격리, SHADOW 만 활성)
  const bepGate = applyTwoBarBepGate({
    shadow,
    currentPrice,
    hardStopLoss,
    isBepProtection: stopLossExitType === 'PROFIT_PROTECTION',
    // ADR-0626 — 손실초기 2-bar 확대 게이트 분류 인자 (SHADOW 한정·LIVE byte-equivalent).
    stopLossExitType,
    returnPct,
  });
  if (bepGate.action === 'WAIT') {
    if (bepGate.shadowUpdate) updateShadow(shadow, bepGate.shadowUpdate);
    console.log(`[hardStopLoss] BEP_PROTECTION WAIT — ${shadow.stockCode} ${bepGate.reason}`);
    return NO_OP;
  }
  if (bepGate.action === 'RESET') {
    if (bepGate.shadowUpdate) updateShadow(shadow, bepGate.shadowUpdate);
    console.log(`[hardStopLoss] BEP_PROTECTION RESET — ${shadow.stockCode} ${bepGate.reason}`);
    return NO_OP;
  }
  if (bepGate.action === 'CONTINUE_EXIT') {
    console.log(`[hardStopLoss] BEP_PROTECTION CONFIRM_EXIT — ${shadow.stockCode} ${bepGate.reason}`);
  }
  // SKIP → fallthrough (BEP_PROTECTION 영역 아님 또는 ENV 우회 — 기존 청산 진행)
  // =====================================================================================

  const soldQty = shadow.quantity;
  // BUG #7 fix — 전량 청산 전 스냅샷. 주문 실패 시 HIT_STOP → 이전 상태로 복귀.
  const hardStopSnapshot = captureFullCloseSnapshot(shadow);
  // ADR-0112: PROFIT_PROTECTION 본절 청산은 exitOutcome='BE' 로 분류 → 서킷 카운트 제외.
  // 1차 로그 09:10/09:15/09:45 의 -0.18~-0.45% 손절 3건이 LOSS 와 동일하게 카운트되어
  // 서킷 무한 루프를 트리거하던 결함 영구 차단. classifyExitOutcome SSOT 사용.
  const hardStopOutcome = classifyExitOutcome(returnPct, 'HARD_STOP', stopLossExitType);
  updateShadow(shadow, {
    status: 'HIT_STOP',
    exitPrice: currentPrice,
    exitTime: new Date().toISOString(),
    stopLossExitType,
    exitRuleTag: 'HARD_STOP',
    exitOutcome: hardStopOutcome,
    quantity: 0,
  });
  // PR-3 (ADR-0006) — FULL_CLOSE attribution 영속. baseline (entryConditionScores)
  // 부재 시 null 반환 — 학습 오염 차단. try/catch 격리로 매매 흐름 무중단.
  try {
    emitFullCloseAttributionForExit({
      shadow,
      exitPrice: currentPrice,
      returnPct,
      closedAt: shadow.exitTime ?? new Date().toISOString(),
      exitRuleTag: 'HARD_STOP',
    });
  } catch (e) {
    console.warn(`[hardStopLoss] attribution 영속 실패 ${shadow.stockCode}:`, e instanceof Error ? e.message : e);
  }
  console.log(`[Shadow Close] HARD_STOP — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
  appendShadowLog({ event: 'HIT_STOP', ...shadow, stopLossExitType, soldQty });
  // Phase 3-⑫: 구조화 Pre-Mortem 매칭 + 반복 패턴 자동 승급
  {
    const match = matchExitInvalidation(shadow, {
      currentPrice,
      currentRegime,
      mtas: undefined,
      ma60: undefined,
      volume: undefined,
      vkospiDayChange: undefined,
    });
    if (match) {
      shadow.exitInvalidationMatch = {
        id: match.id, matchedAt: new Date().toISOString(), observedValue: match.observedValue,
      };
      promoteInvalidationPatternIfRepeated(shadow);
      // Idea 10 — Kelly decay × invalidation 의 2차원 패턴도 병렬 승급 평가.
      // I/O 실패가 exit 경로를 막지 않도록 try/catch.
      try {
        promoteKellyDriftPattern(shadow);
      } catch (e) {
        console.warn('[KellyDrift] 승급 평가 실패:', e instanceof Error ? e.message : e);
      }
    }
  }
  console.log(`[AutoTrade] ❌ ${shadow.stockName} (${shadow.stockCode}) 하드 스톱(${stopLossExitType}) ${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
  const hardStopTs = new Date().toISOString();
  const hardStopReserve = await placeReservedSellOrder(shadow, soldQty, 'STOP_LOSS', {
    type: 'SELL', subType: 'STOP_LOSS',
    qty: soldQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * soldQty,
    pnlPct: returnPct, reason: `하드스톱 손절 (${stopLossExitType})`,
    exitRuleTag: 'HARD_STOP', timestamp: hardStopTs,
  }, 'HARD_STOP');
  if (hardStopReserve.kind === 'PENDING') {
    addSellOrder({
      ordNo: hardStopReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
      quantity: soldQty, originalReason: 'STOP_LOSS',
      placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
    });
  } else if (hardStopReserve.kind === 'FAILED') {
    // BUG #7 fix — 상태 롤백 + CRITICAL 알림. 다음 스캔에서 규칙 재평가.
    rollbackFullCloseOnFailure(shadow, hardStopSnapshot, 'HARD_STOP', hardStopReserve.reason);
    await emitTelegramEvent({
      type: 'STOP_LOSS_HIT',
      message:
      `🚨 <b>${hardStopReserve.statusPrefix} [하드 스톱] (상태 롤백)</b> ${shadow.stockName} (${shadow.stockCode})\n` +
      `${stopLossExitType} 손절 ${soldQty}주 @${currentPrice.toLocaleString()}원` +
      hardStopReserve.statusSuffix +
      `\n⚙ shadow 는 ACTIVE 로 복귀 — 다음 스캔 사이클에서 자동 재시도.`,
      severity: 'CRITICAL',
      metadata: { symbol: shadow.stockCode },
      dedupeKey: `hard_stop:${shadow.stockCode}`,
    }).catch(console.error);
  }
  await channelSellSignal({
    stockName:   shadow.stockName,
    stockCode:   shadow.stockCode,
    exitPrice:   currentPrice,
    entryPrice:  shadow.shadowEntryPrice,
    pnlPct:      returnPct,
    reason:      'STOP',
    holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
    remainingQtyAfter: hardStopReserve.remainingQty,
  }).catch(console.error);
  // IDEA 11 — 손절 투명성 리포트
  await sendStopLossTransparencyReport(shadow, {
    exitPrice: currentPrice,
    returnPct,
    soldQty,
  }).catch(console.error);
  return { skipRest: true };
}
