/**
 * exitEngine.ts — 포지션 모니터링 및 청산 엔진
 *
 * signalScanner.ts 에서 분리된 진행 중 Shadow 거래 결과 업데이트 로직.
 * 청산 규칙 우선순위는 entryEngine.ts 의 EXIT_RULE_PRIORITY_TABLE 과 일치해야 한다.
 */

import {
  fetchCurrentPrice, placeKisSellOrder,
} from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { channelSellSignal } from '../alerts/channelPipeline.js';
import {
  type ServerShadowTrade,
  appendShadowLog,
} from '../persistence/shadowTradeRepo.js';
import { addToBlacklist } from '../persistence/blacklistRepo.js';
import { checkEuphoria } from './riskManager.js';
import type { RegimeLevel } from '../../src/types/core.js';

/** Shadow 진행 중 거래 결과 업데이트 — Macro/포지션 제한 시에도 재사용 */
export async function updateShadowResults(shadows: ServerShadowTrade[], currentRegime: RegimeLevel): Promise<void> {
  // 청산 실행 우선순위는 EXIT_RULE_PRIORITY_TABLE(entryEngine.ts)과 동일한 순서로 평가된다.
  // ExitRuleTag 타입이 규칙명을 강제하므로, 규칙 추가 시 shadowTradeRepo.ts의 ExitRuleTag와
  // entryEngine.ts의 EXIT_RULE_PRIORITY_TABLE을 함께 갱신하면 된다.
  for (const shadow of shadows) {
    // PENDING: Shadow 모드에서만 4분 경과 후 ACTIVE 전환.
    // LIVE 모드에서는 fillMonitor가 ORDER_SUBMITTED → ACTIVE 전환을 책임지므로
    // 여기서 자동 승격하지 않는다 (체결 확인 없이 ACTIVE처럼 보이는 것을 방지).
    if (shadow.status === 'PENDING') {
      if (shadow.mode === 'LIVE') continue;
      const ageMs = Date.now() - new Date(shadow.signalTime).getTime();
      if (ageMs < 4 * 60 * 1000) continue;
      shadow.status = 'ACTIVE';
      continue;
    }

    if (shadow.status !== 'ACTIVE' && shadow.status !== 'PARTIALLY_FILLED' && shadow.status !== 'EUPHORIA_PARTIAL') continue;

    const currentPrice = await fetchCurrentPrice(shadow.stockCode).catch(() => null);
    if (!currentPrice) continue;

    const returnPct = ((currentPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
    const initialStopLoss = shadow.initialStopLoss ?? shadow.stopLoss;
    const regimeStopLoss = shadow.regimeStopLoss ?? shadow.stopLoss;
    const hardStopLoss = shadow.hardStopLoss ?? shadow.stopLoss;

    // ─── R6 긴급 청산 30% (블랙스완 — 1회만) ────────────────────────────────
    if (currentRegime === 'R6_DEFENSE' && !shadow.r6EmergencySold && shadow.quantity > 0) {
      const emergencyQty = Math.max(1, Math.floor(shadow.quantity * 0.30));
      shadow.exitRuleTag = 'R6_EMERGENCY_EXIT';
      shadow.r6EmergencySold = true;
      shadow.quantity -= emergencyQty;
      shadow.originalQuantity ??= shadow.quantity + emergencyQty;
      appendShadowLog({ event: 'R6_EMERGENCY_EXIT', ...shadow, soldQty: emergencyQty, returnPct });
      console.log(`[AutoTrade] 🔴 ${shadow.stockName} R6 긴급 청산 30% (${emergencyQty}주) @${currentPrice.toLocaleString()}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, emergencyQty, 'STOP_LOSS');
      await sendTelegramAlert(
        `🔴 <b>[R6 긴급 청산]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `블랙스완 감지 — 30% 즉시 청산 ${emergencyQty}주 @${currentPrice.toLocaleString()}원\n` +
        `수익률: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}% | 잔여: ${shadow.quantity}주`
      ).catch(console.error);
      if (shadow.quantity <= 0) continue; // 잔여 없으면 종료 처리 생략
    }

    // ─── 하드 스톱 (고정 손절/레짐 손절) ───────────────────────────────────────
    if (currentPrice <= hardStopLoss) {
      const stopGap = Math.abs(initialStopLoss - regimeStopLoss);
      const stopLossExitType = stopGap < 0.5
        ? 'INITIAL_AND_REGIME'
        : (initialStopLoss > regimeStopLoss ? 'INITIAL' : 'REGIME');
      Object.assign(shadow, {
        status: 'HIT_STOP',
        exitPrice: currentPrice,
        exitTime: new Date().toISOString(),
        returnPct,
        stopLossExitType,
        exitRuleTag: 'HARD_STOP',
      });
      appendShadowLog({ event: 'HIT_STOP', ...shadow, stopLossExitType });
      console.log(`[AutoTrade] ❌ ${shadow.stockName} 하드 스톱(${stopLossExitType}) ${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, shadow.quantity, 'STOP_LOSS');
      await channelSellSignal({
        stockName:   shadow.stockName,
        stockCode:   shadow.stockCode,
        exitPrice:   currentPrice,
        entryPrice:  shadow.shadowEntryPrice,
        pnlPct:      returnPct,
        reason:      'STOP',
        holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
      }).catch(console.error);
      continue;
    }

    // ② -30% 블랙리스트 편입 / -25% 전량 청산 (Final Exit)
    if (returnPct <= -25) {
      const isBlacklistStep = returnPct <= -30;
      Object.assign(shadow, { status: 'HIT_STOP', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct, exitRuleTag: 'CASCADE_FINAL' });
      appendShadowLog({ event: isBlacklistStep ? 'CASCADE_STOP_BLACKLIST' : 'CASCADE_STOP_FINAL', ...shadow });
      console.log(`[AutoTrade] ❌ ${shadow.stockName} Cascade ${returnPct.toFixed(2)}% — 전량 청산${isBlacklistStep ? ' + 블랙리스트 180일' : ''}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, shadow.quantity, 'STOP_LOSS');
      await channelSellSignal({
        stockName:   shadow.stockName,
        stockCode:   shadow.stockCode,
        exitPrice:   currentPrice,
        entryPrice:  shadow.shadowEntryPrice,
        pnlPct:      returnPct,
        reason:      'CASCADE',
        holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
      }).catch(console.error);
      if (isBlacklistStep) {
        addToBlacklist(shadow.stockCode, shadow.stockName, `Cascade ${returnPct.toFixed(1)}%`);
        await sendTelegramAlert(
          `🚫 <b>[블랙리스트] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `손실 ${returnPct.toFixed(1)}% → 180일 재진입 금지`
        ).catch(console.error);
      }
      continue;
    }

    // ─── L3-a: 트레일링 고점 갱신 ────────────────────────────────────────────
    if (shadow.trailingEnabled && currentPrice > (shadow.trailingHighWaterMark ?? 0)) {
      shadow.trailingHighWaterMark = currentPrice;
    }

    // ─── L3-b: LIMIT 트랜치 분할 익절 ────────────────────────────────────────
    if (shadow.profitTranches && shadow.profitTranches.length > 0 && !shadow.trailingEnabled) {
      let trancheFired = false;
      for (const t of shadow.profitTranches) {
        if (!t.taken && currentPrice >= t.price) {
          const baseQty  = shadow.originalQuantity ?? shadow.quantity;
          const sellQty  = Math.min(Math.max(1, Math.round(baseQty * t.ratio)), shadow.quantity);
          shadow.quantity -= sellQty;
          t.taken = true;
          trancheFired = true;
          shadow.exitRuleTag = 'LIMIT_TRANCHE_TAKE_PROFIT';
          appendShadowLog({ event: 'PROFIT_TRANCHE', ...shadow, soldQty: sellQty, tranchePrice: t.price, returnPct });
          console.log(`[AutoTrade] 📈 ${shadow.stockName} L3 분할 익절 ${(t.ratio * 100).toFixed(0)}% (${sellQty}주) @${currentPrice.toLocaleString()}`);
          await placeKisSellOrder(shadow.stockCode, shadow.stockName, sellQty, 'TAKE_PROFIT');
          await sendTelegramAlert(
            `📈 <b>[L3 분할 익절]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `트랜치: ${(t.ratio * 100).toFixed(0)}% × ${sellQty}주 @${currentPrice.toLocaleString()}원\n` +
            `수익률: +${returnPct.toFixed(2)}% | 잔여: ${shadow.quantity}주`
          ).catch(console.error);
        }
      }
      // 모든 LIMIT 트랜치 소화 → 트레일링 활성화
      if (trancheFired && shadow.profitTranches.every((t) => t.taken)) {
        shadow.trailingEnabled = true;
        shadow.trailingHighWaterMark = currentPrice;
        appendShadowLog({ event: 'TRAILING_ACTIVATED', ...shadow });
        console.log(`[AutoTrade] 🔁 ${shadow.stockName} 트레일링 스톱 활성화 @${currentPrice.toLocaleString()}`);
      }
      // 전량 소진 시 종료
      if (shadow.quantity <= 0) {
        Object.assign(shadow, { status: 'HIT_TARGET', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct });
        appendShadowLog({ event: 'FULLY_CLOSED_TRANCHES', ...shadow });
        continue;
      }
    }

    // ─── L3-c: 트레일링 스톱 (이익보호 손절) ──────────────────────────────────
    if (shadow.trailingEnabled && shadow.trailingHighWaterMark !== undefined && shadow.quantity > 0) {
      const trailFloor = shadow.trailingHighWaterMark * (1 - (shadow.trailPct ?? 0.10));
      if (currentPrice <= trailFloor) {
        Object.assign(shadow, {
          status: 'HIT_TARGET',
          exitPrice: currentPrice,
          exitTime: new Date().toISOString(),
          returnPct,
          stopLossExitType: 'PROFIT_PROTECTION',
          exitRuleTag: 'TRAILING_PROTECTIVE_STOP',
        });
        appendShadowLog({ event: 'TRAILING_STOP', ...shadow });
        console.log(`[AutoTrade] 📉 ${shadow.stockName} L3 트레일링 스톱 (HWM×${(1 - (shadow.trailPct ?? 0.10)).toFixed(2)}) @${currentPrice.toLocaleString()}`);
        await placeKisSellOrder(shadow.stockCode, shadow.stockName, shadow.quantity, 'TAKE_PROFIT');
        await sendTelegramAlert(
          `📉 <b>[L3 트레일링 스톱]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
          `고점: ${shadow.trailingHighWaterMark.toLocaleString()}원 → 청산: ${currentPrice.toLocaleString()}원\n` +
          `최종 수익률: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%`
        ).catch(console.error);
        await channelSellSignal({
          stockName:   shadow.stockName,
          stockCode:   shadow.stockCode,
          exitPrice:   currentPrice,
          entryPrice:  shadow.shadowEntryPrice,
          pnlPct:      returnPct,
          reason:      'TRAILING',
          holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
        }).catch(console.error);
        continue;
      }
    }

    // ① 목표가 달성 → 익절 전량 매도 (트랜치 미설정 구형 포지션 fallback)
    if (currentPrice >= shadow.targetPrice) {
      Object.assign(shadow, { status: 'HIT_TARGET', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct, exitRuleTag: 'TARGET_EXIT' });
      appendShadowLog({ event: 'HIT_TARGET', ...shadow });
      console.log(`[AutoTrade] ✅ ${shadow.stockName} 목표가 달성 +${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, shadow.quantity, 'TAKE_PROFIT');
      await sendTelegramAlert(
        `✅ <b>[목표가 달성]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `청산가: ${currentPrice.toLocaleString()}원\n` +
        `수익률: +${returnPct.toFixed(2)}%`
      ).catch(console.error);
      await channelSellSignal({
        stockName:   shadow.stockName,
        stockCode:   shadow.stockCode,
        exitPrice:   currentPrice,
        entryPrice:  shadow.shadowEntryPrice,
        pnlPct:      returnPct,
        reason:      'TARGET',
        holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
      }).catch(console.error);
      continue;
    }

    // ③ -15% 반매도 (cascadeStep 2, 1회만)
    if (returnPct <= -15 && (shadow.cascadeStep ?? 0) < 2) {
      const halfQty = Math.max(1, Math.floor(shadow.quantity / 2));
      shadow.cascadeStep = 2;
      shadow.halfSoldAt  = new Date().toISOString();
      shadow.originalQuantity ??= shadow.quantity;
      shadow.quantity -= halfQty;
      shadow.exitRuleTag = 'CASCADE_HALF_SELL';
      appendShadowLog({ event: 'CASCADE_HALF_SELL', ...shadow, soldQty: halfQty, returnPct });
      console.log(`[AutoTrade] 🔶 ${shadow.stockName} Cascade -15% — 반매도 ${halfQty}주 (잔여 ${shadow.quantity}주)`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, halfQty, 'STOP_LOSS');
      await sendTelegramAlert(
        `🔶 <b>[Cascade -15%] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
        `손실 ${returnPct.toFixed(1)}% — 반매도 ${halfQty}주 (잔여 ${shadow.quantity}주)`
      ).catch(console.error);
      continue;
    }

    // ④ -7% 추가 매수 차단 + 경고 (cascadeStep 1, 1회만)
    if (returnPct <= -7 && (shadow.cascadeStep ?? 0) < 1) {
      shadow.cascadeStep    = 1;
      shadow.addBuyBlocked  = true;
      shadow.exitRuleTag = 'CASCADE_WARN_BLOCK';
      appendShadowLog({ event: 'CASCADE_WARN', ...shadow, returnPct });
      console.warn(`[AutoTrade] ⚠️  ${shadow.stockName} Cascade -7% — 추가 매수 차단`);
      await sendTelegramAlert(
        `⚠️ <b>[Cascade -7%] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
        `손실 ${returnPct.toFixed(1)}% — 추가 매수 차단 (모니터링 강화)`
      ).catch(console.error);
      continue;
    }

    // ⑥ 손절가 접근 3단계 경보 (아이디어 5: 단계별 dedupeKey로 중복 방지)
    //   Stage 1: 손절까지 -5% 이내 → 🟡 접근 경고
    //   Stage 2: 손절까지 -3% 이내 → 🟠 임박 경고
    //   Stage 3: 손절까지 -1% 이내 → 🔴 집행 임박 (exitEngine 하드스톱이 곧 발동)
    {
      const distToStop = ((currentPrice - hardStopLoss) / hardStopLoss) * 100;
      const stage = shadow.stopApproachStage ?? 0;

      if (distToStop > 0 && distToStop < 5 && stage < 1) {
        shadow.stopApproachStage = 1;
        shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
        await sendTelegramAlert(
          `🟡 <b>[손절 접근] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `현재가: ${currentPrice.toLocaleString()}원\n` +
          `손절까지: -${distToStop.toFixed(1)}%\n` +
          `손절가: ${hardStopLoss.toLocaleString()}원`,
          {
            priority: 'HIGH',
            dedupeKey: `stop_approach_1:${shadow.stockCode}`,
          },
        ).catch(console.error);
      }

      if (distToStop > 0 && distToStop < 3 && stage < 2) {
        shadow.stopApproachStage = 2;
        shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
        await sendTelegramAlert(
          `🟠 <b>[손절 임박] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `현재가: ${currentPrice.toLocaleString()}원\n` +
          `손절까지: -${distToStop.toFixed(1)}% — 확인 필요\n` +
          `손절가: ${hardStopLoss.toLocaleString()}원`,
          {
            priority: 'CRITICAL',
            dedupeKey: `stop_approach_2:${shadow.stockCode}`,
          },
        ).catch(console.error);
      }

      if (distToStop > 0 && distToStop < 1 && stage < 3) {
        shadow.stopApproachStage = 3;
        shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
        await sendTelegramAlert(
          `🔴 <b>[손절 집행 임박] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `현재가: ${currentPrice.toLocaleString()}원\n` +
          `손절까지: -${distToStop.toFixed(1)}% — 곧 청산 실행\n` +
          `손절가: ${hardStopLoss.toLocaleString()}원`,
          {
            priority: 'CRITICAL',
            dedupeKey: `stop_approach_3:${shadow.stockCode}`,
          },
        ).catch(console.error);
      }
    }

    // ⑦ 과열 탐지 — ACTIVE 상태에서만 첫 번째 부분 매도 발동
    if (shadow.status === 'ACTIVE' || shadow.status === 'PARTIALLY_FILLED') {
      const euphoria = checkEuphoria(shadow, currentPrice);
      if (euphoria.triggered) {
        const halfQty = Math.max(1, Math.floor(shadow.quantity / 2));
        console.log(
          `[AutoTrade] 🌡️ ${shadow.stockName} 과열 감지 (${euphoria.count}개 신호) — 절반 매도 ${halfQty}주\n  신호: ${euphoria.signals.join(', ')}`
        );
        shadow.originalQuantity ??= shadow.quantity;
        shadow.quantity -= halfQty;
        shadow.status = 'EUPHORIA_PARTIAL';
        shadow.exitRuleTag = 'EUPHORIA_PARTIAL';
        appendShadowLog({
          event: 'EUPHORIA_PARTIAL',
          ...shadow,
          exitPrice: currentPrice,
          euphoriaSoldQty: halfQty,
          originalQuantity: shadow.originalQuantity,
        });
        await placeKisSellOrder(shadow.stockCode, shadow.stockName, halfQty, 'EUPHORIA');
      }
    }
  }
}
