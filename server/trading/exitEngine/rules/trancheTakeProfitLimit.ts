// @responsibility L3-b LIMIT 트랜치 분할 익절 + 전량소진시 트레일링 활성화 + 러너 승격(ADR-0606) 규칙
/**
 * exitEngine/rules/trancheTakeProfitLimit.ts — L3-b LIMIT 트랜치 분할 익절 (ADR-0028).
 * 모든 LIMIT 트랜치 소화 → 트레일링 활성화. 전량 소진 시 HIT_TARGET.
 *
 * ADR-0606 러너 모드 (ENV RUNNER_MODE_ENABLED, default OFF — flag OFF 시 byte-equivalent):
 *   · 승격 판정/트랜치 스킵/트레일링 폭은 전부 exit/policies/runnerPolicy.ts 순수 SSOT 호출.
 *   · 잔량 전량(ratio≥0.999) 트랜치는 러너(승격 확정/예정) 시 매도·taken 없이 스킵 — 잔량을
 *     넓은 트레일링이 추종. 초기 소량 LIMIT(ratio<1.0)은 기존대로 익절 실행.
 *   · 승격(FINAL_TRANCHE_REACHED OR RETURN_THRESHOLD) 확정 시 러너 필드 5종 stamp +
 *     trailingEnabled 전이. try/catch 격리 — 평가 실패가 청산 흐름을 차단하지 않는다(불변식 #1).
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { emitTelegramEvent } from '../../../alerts/telegramEventRouter.js';
import { channelSellSignal } from '../../../alerts/channelPipeline.js';
import { appendShadowLog, syncPositionCache, updateShadow } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { placeReservedSellOrder } from '../helpers/reserveSell.js';
import { emitFullCloseAttributionForExit } from '../helpers/attribution.js';
import {
  evaluateRunnerPromotion,
  isRunnerModeEnabled,
  resolveRunnerTrailPct,
  shouldSkipTrancheForRunner,
} from '../../exit/policies/runnerPolicy.js';

export async function trancheTakeProfitLimit(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct } = ctx;

  if (!shadow.profitTranches || shadow.profitTranches.length === 0 || shadow.trailingEnabled) {
    return NO_OP;
  }

  // ADR-0606: 러너 모드 ENV 게이트 — OFF(기본) 시 아래 러너 분기 전부 미진입 (byte-equivalent).
  const runnerModeOn = isRunnerModeEnabled();

  let trancheFired = false;
  for (const t of shadow.profitTranches) {
    if (!t.taken && currentPrice >= t.price) {
      // ADR-0606: 러너(승격 확정/예정) — 잔량 전량(ratio≥0.999) 트랜치는 매도 없이 스킵
      // (taken 처리도 보류 — 트레일링이 잔량을 추종). 초기 소량 LIMIT 은 기존대로 익절.
      // try/catch 격리 — 러너 평가 실패 시 기존 익절 경로 유지 (불변식 #1).
      if (runnerModeOn && shouldSkipTrancheForRunner(t.ratio)) {
        try {
          const runnerOrPending = shadow.isRunner === true ||
            evaluateRunnerPromotion({ returnPct, finalTrancheReached: false }).promote;
          if (runnerOrPending) {
            console.log(`[AutoTrade] 🏃 ${shadow.stockName} (${shadow.stockCode}) 러너 전량 트랜치 스킵 ${(t.ratio * 100).toFixed(0)}% @${currentPrice.toLocaleString()} (ADR-0606)`);
            continue;
          }
        } catch (e) {
          console.warn(`[trancheTakeProfitLimit] 러너 트랜치 스킵 평가 실패 ${shadow.stockCode} — 기존 익절 경로 유지:`, e instanceof Error ? e.message : e);
        }
      }
      const baseQty  = shadow.originalQuantity ?? shadow.quantity;
      const sellQty  = Math.min(Math.max(1, Math.round(baseQty * t.ratio)), shadow.quantity);
      t.taken = true;
      trancheFired = true;
      shadow.exitRuleTag = 'LIMIT_TRANCHE_TAKE_PROFIT';
      appendShadowLog({ event: 'PROFIT_TRANCHE', ...shadow, soldQty: sellQty, tranchePrice: t.price, returnPct });
      console.log(`[AutoTrade] 📈 ${shadow.stockName} L3 분할 익절 ${(t.ratio * 100).toFixed(0)}% (${sellQty}주) @${currentPrice.toLocaleString()}`);
      const trancheTs  = new Date().toISOString();
      const trancheIdx = shadow.profitTranches?.filter(x => x.taken && x !== t).length ?? 0;
      const trancheReserve = await placeReservedSellOrder(shadow, sellQty, 'TAKE_PROFIT', {
        type: 'SELL', subType: 'PARTIAL_TP',
        qty: sellQty, price: currentPrice,
        pnl: (currentPrice - shadow.shadowEntryPrice) * sellQty,
        pnlPct: returnPct, reason: `분할익절 트랜치 ${(t.ratio * 100).toFixed(0)}%`,
        exitRuleTag: 'LIMIT_TRANCHE_TAKE_PROFIT', timestamp: trancheTs,
      }, trancheIdx === 0 ? 'LIMIT_TP1' : 'LIMIT_TP2');

      if (trancheReserve.kind === 'FAILED') {
        // 트랜치 주문 실패 — taken 플래그 롤백 (다음 기회에 재시도 허용)
        t.taken = false;
        // trancheFired 는 유지: 다른 트랜치가 이미 fired 됐을 수 있음.
      } else {
        syncPositionCache(shadow);
        if (trancheReserve.kind === 'PENDING') {
          addSellOrder({
            ordNo: trancheReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
            quantity: sellQty, originalReason: 'TAKE_PROFIT',
            placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
          });
        }
      }
      await emitTelegramEvent({
        type: 'PARTIAL_EXIT',
        message:
        `📈 <b>${trancheReserve.statusPrefix} [L3 분할 익절]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `트랜치: ${(t.ratio * 100).toFixed(0)}% × ${sellQty}주 @${currentPrice.toLocaleString()}원\n` +
        `수익률: +${returnPct.toFixed(2)}% | 잔여: ${trancheReserve.remainingQty}주` +
        trancheReserve.statusSuffix,
        severity: trancheReserve.kind === 'FAILED' ? 'HIGH' : 'NORMAL',
        metadata: { symbol: shadow.stockCode },
      }).catch(console.error);
      await channelSellSignal({
        stockName:   shadow.stockName,
        stockCode:   shadow.stockCode,
        exitPrice:   currentPrice,
        entryPrice:  shadow.shadowEntryPrice,
        pnlPct:      returnPct,
        reason:      'TRANCHE',
        holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
        soldQty:     sellQty,
        originalQty: baseQty,
        remainingQtyAfter: trancheReserve.remainingQty,
      }).catch(console.error);
    }
  }
  // 모든 LIMIT 트랜치 소화 → 트레일링 활성화
  if (trancheFired && shadow.profitTranches.every((t) => t.taken)) {
    shadow.trailingEnabled = true;
    shadow.trailingHighWaterMark = currentPrice;
    appendShadowLog({ event: 'TRAILING_ACTIVATED', ...shadow });
    console.log(`[AutoTrade] 🔁 ${shadow.stockName} 트레일링 스톱 활성화 @${currentPrice.toLocaleString()}`);
  }
  // ADR-0606: 러너 승격 (ENV 게이트 — flag OFF 시 미진입, 기존 경로 byte-equivalent).
  // ① FINAL_TRANCHE_REACHED: 모든 LIMIT 트랜치 소화(기존 trailingEnabled 전이 시점과 동일) OR
  // ② RETURN_THRESHOLD: returnPct ≥ RUNNER_PROMOTE_RETURN_PCT (트랜치 미소진 조기 승격).
  // 잔량 0 이면 추종할 물량이 없으므로 미승격. try/catch 격리 — 평가 실패가 청산 흐름 차단 0.
  if (runnerModeOn && shadow.isRunner !== true && shadow.quantity > 0) {
    try {
      const finalTrancheReached = trancheFired && shadow.profitTranches.every((t) => t.taken);
      const decision = evaluateRunnerPromotion({ returnPct, finalTrancheReached });
      if (decision.promote) {
        shadow.isRunner = true;
        shadow.runnerActivatedAt = new Date().toISOString();
        shadow.runnerTrailPct = resolveRunnerTrailPct(shadow.trailPct);
        shadow.runnerPromotedReturnPct = returnPct;
        shadow.runnerPromotionReason = decision.reason;
        shadow.trailingEnabled = true;
        shadow.trailingHighWaterMark = currentPrice;
        appendShadowLog({ event: 'RUNNER_PROMOTED', ...shadow });
        console.log(`[AutoTrade] 🏃 ${shadow.stockName} 러너 승급 (${decision.reason}) +${returnPct.toFixed(2)}% — 트레일링 ${(shadow.runnerTrailPct * 100).toFixed(0)}% 추종, HWM @${currentPrice.toLocaleString()}`);
      }
    } catch (e) {
      console.warn(`[trancheTakeProfitLimit] 러너 승격 평가 실패 ${shadow.stockCode}:`, e instanceof Error ? e.message : e);
    }
  }
  // 전량 소진 시 종료
  if (shadow.quantity <= 0) {
    updateShadow(shadow, { status: 'HIT_TARGET', exitPrice: currentPrice, exitTime: new Date().toISOString() });
    appendShadowLog({ event: 'FULLY_CLOSED_TRANCHES', ...shadow });
    // PR-Fix-Attribution-FullClose (ADR-0006) — FULL_CLOSE attribution 영속.
    // 마지막 트랜치 fill 은 emitPartialAttributionForSell 의 remainingQty>0 가드로
    // null 반환 → 본 분기에서 FULL_CLOSE baseline 보장. baseline (entryConditionScores)
    // 부재 시 null 반환 — 학습 오염 차단. try/catch 격리로 매매 흐름 무중단.
    try {
      emitFullCloseAttributionForExit({
        shadow,
        exitPrice: currentPrice,
        returnPct,
        closedAt: shadow.exitTime ?? new Date().toISOString(),
        exitRuleTag: 'LIMIT_TRANCHE_TAKE_PROFIT',
      });
    } catch (e) {
      console.warn(`[trancheTakeProfitLimit] attribution 영속 실패 ${shadow.stockCode}:`, e instanceof Error ? e.message : e);
    }
    return { skipRest: true };
  }
  return NO_OP;
}
