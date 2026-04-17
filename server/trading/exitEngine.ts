/**
 * exitEngine.ts — 포지션 모니터링 및 청산 엔진
 *
 * signalScanner.ts 에서 분리된 진행 중 Shadow 거래 결과 업데이트 로직.
 * 청산 규칙 우선순위는 entryEngine.ts 의 EXIT_RULE_PRIORITY_TABLE 과 일치해야 한다.
 */

import {
  fetchCurrentPrice, placeKisSellOrder,
} from '../clients/kisClient.js';
import { getRealtimePrice } from '../clients/kisStreamClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { channelSellSignal } from '../alerts/channelPipeline.js';
import {
  type ServerShadowTrade,
  appendShadowLog,
} from '../persistence/shadowTradeRepo.js';
import { addToBlacklist } from '../persistence/blacklistRepo.js';
import { checkEuphoria } from './riskManager.js';
import { regimeToStopRegime } from './entryEngine.js';
import { evaluateDynamicStop } from '../../src/services/quant/dynamicStopEngine.js';
import { fetchCloses } from './marketDataRefresh.js';
import type { RegimeLevel } from '../../src/types/core.js';

/**
 * 하락 다이버전스 감지 — 주가 신고가 갱신 + RSI 고점 낮아짐.
 * 최근 5일/이전 5일 두 구간을 비교해 가짜 돌파·상투를 조기 포착.
 *
 * @param prices 최근 N(≥10)일 종가 배열
 * @param rsi    prices와 정렬된 N일 RSI 배열
 */
export function detectBearishDivergence(prices: number[], rsi: number[]): boolean {
  if (prices.length < 10 || rsi.length < 10) return false;
  const recentHigh = Math.max(...prices.slice(-5));
  const prevHigh   = Math.max(...prices.slice(-10, -5));
  const recentRSI  = Math.max(...rsi.slice(-5));
  const prevRSI    = Math.max(...rsi.slice(-10, -5));
  // 주가 신고가 갱신 + RSI 고점 낮아짐 → 하락 다이버전스
  return recentHigh > prevHigh && recentRSI < prevRSI;
}

/**
 * 60일선 "죽음" 판정 — 현재가 < MA20 < MA60 (역배열 완성).
 * "주도주 사이클 종료" 신호로, 좀비 포지션을 장기 보유하지 않기 위한 강제 청산 트리거.
 *
 * @returns 역배열 완성 시 true
 */
export function isMA60Death(ma20: number, ma60: number, currentPrice: number): boolean {
  return currentPrice < ma20 && ma20 < ma60;
}

/** 단순이동평균. closes.length < period 이면 null. */
function simpleMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

/** KST 기준 N영업일(토·일 제외) 이후의 날짜 YYYY-MM-DD 반환. */
export function kstBusinessDateStr(offsetBusinessDays: number): string {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  let daysLeft = offsetBusinessDays;
  let cursor = new Date(Date.now() + KST_OFFSET_MS);
  while (daysLeft > 0) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    const dow = cursor.getUTCDay(); // KST offset 이미 반영됨
    if (dow !== 0 && dow !== 6) daysLeft -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

/** stockCode → MA20·MA60 계산에 충분한 120일 종가 조회 후 (ma20, ma60) 반환. */
async function fetchMaFromCloses(stockCode: string): Promise<{ ma20: number; ma60: number } | null> {
  for (const sym of yahooSymbolCandidates(stockCode)) {
    const closes = await fetchCloses(sym, '120d').catch(() => null);
    if (!closes || closes.length < 60) continue;
    const ma20 = simpleMA(closes, 20);
    const ma60 = simpleMA(closes, 60);
    if (ma20 !== null && ma60 !== null) return { ma20, ma60 };
  }
  return null;
}

/** Wilder 평활화 RSI 시계열 반환. period+1 미만이면 빈 배열. */
function rsiSeries(closes: number[], period: number = 14): number[] {
  if (closes.length < period + 1) return [];
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);
  let avgGain = deltas.slice(0, period).filter(d => d > 0).reduce((s, d) => s + d, 0) / period;
  let avgLoss = deltas.slice(0, period).filter(d => d < 0).reduce((s, d) => s - d, 0) / period;
  const out: number[] = [];
  const rsiAt = (g: number, l: number) => l === 0 ? 100 : 100 - 100 / (1 + g / l);
  out.push(rsiAt(avgGain, avgLoss));
  for (let i = period; i < deltas.length; i++) {
    const gain = deltas[i] > 0 ? deltas[i] : 0;
    const loss = deltas[i] < 0 ? -deltas[i] : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(rsiAt(avgGain, avgLoss));
  }
  return out;
}

/** stockCode → Yahoo Finance 심볼 후보 배열. */
function yahooSymbolCandidates(stockCode: string): string[] {
  const c = stockCode.padStart(6, '0');
  return [`${c}.KS`, `${c}.KQ`];
}

/** 최근 N일 종가와 그에 정렬된 RSI 시계열을 반환. 실패 시 null. */
async function fetchPriceAndRsiHistory(
  stockCode: string,
  bars: number = 10,
): Promise<{ prices: number[]; rsi: number[] } | null> {
  // RSI 14 Wilder 평활화를 안정화하려면 최소 14 + bars 관측이 필요.
  const minNeeded = 14 + bars;
  for (const sym of yahooSymbolCandidates(stockCode)) {
    const closes = await fetchCloses(sym, '60d').catch(() => null);
    if (!closes || closes.length < minNeeded) continue;
    const fullRsi = rsiSeries(closes, 14);
    if (fullRsi.length < bars) continue;
    const prices = closes.slice(-bars);
    const rsi    = fullRsi.slice(-bars);
    return { prices, rsi };
  }
  return null;
}

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
      // Shadow 체결 알림 — LIVE의 fillMonitor "✅ 체결 확인"과 동일한 경험 제공
      await sendTelegramAlert(
        `🎭 <b>[Shadow 체결]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `진입가: ${shadow.shadowEntryPrice.toLocaleString()}원 × ${shadow.quantity}주\n` +
        `손절: ${shadow.stopLoss.toLocaleString()}원 | 목표: ${shadow.targetPrice.toLocaleString()}원`
      ).catch(console.error);
      appendShadowLog({ event: 'SHADOW_ACTIVATED', ...shadow });
      continue;
    }

    // REJECTED·ORDER_SUBMITTED 모두 이 조건으로 스킵됨.
    // REJECTED는 buyApproval 거부/KIS 주문 실패 시 shadows에 남는 종료 상태이므로 안전.
    // ORDER_SUBMITTED는 fillMonitor가 체결 확인 후 ACTIVE로 전환할 때까지 exitEngine이 관여하지 않음.
    if (shadow.status !== 'ACTIVE' && shadow.status !== 'PARTIALLY_FILLED' && shadow.status !== 'EUPHORIA_PARTIAL') continue;

    const currentPrice = getRealtimePrice(shadow.stockCode)
      ?? await fetchCurrentPrice(shadow.stockCode).catch(() => null);
    if (!currentPrice) continue;

    const returnPct = ((currentPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
    const initialStopLoss = shadow.initialStopLoss ?? shadow.stopLoss;
    const regimeStopLoss = shadow.regimeStopLoss ?? shadow.stopLoss;
    let hardStopLoss = shadow.hardStopLoss ?? shadow.stopLoss;

    // ─── ATR 동적 손절 갱신 (BEP 보호 / 수익 Lock-in) ──────────────────────
    if (shadow.entryATR14 && shadow.entryATR14 > 0) {
      const stopRegime = regimeToStopRegime(currentRegime);
      const dynResult = evaluateDynamicStop({
        entryPrice: shadow.shadowEntryPrice,
        atr14: shadow.entryATR14,
        regime: stopRegime,
        currentPrice,
      });

      // 트레일링 활성 시 trailingStopPrice, 아니면 기본 stopPrice
      const effectiveDynamicStop = dynResult.trailingActive
        ? dynResult.trailingStopPrice
        : dynResult.stopPrice;

      // hardStopLoss는 오직 상향만 허용 (래칫 — 한번 올라간 손절은 내려가지 않음)
      if (effectiveDynamicStop > hardStopLoss) {
        const prevHardStop = hardStopLoss;
        hardStopLoss = effectiveDynamicStop;
        shadow.hardStopLoss = effectiveDynamicStop;
        shadow.dynamicStopPrice = effectiveDynamicStop;

        if (dynResult.profitLockIn) {
          appendShadowLog({ event: 'ATR_PROFIT_LOCKIN', ...shadow, prevHardStop, newHardStop: effectiveDynamicStop });
          console.log(`[AutoTrade] 🔒 ${shadow.stockName} ATR 수익 Lock-in: 손절 ${prevHardStop.toLocaleString()} → ${effectiveDynamicStop.toLocaleString()} (+3%)`);
          await sendTelegramAlert(
            `🔒 <b>[수익 Lock-in]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `ATR 동적 손절 상향: ${prevHardStop.toLocaleString()}원 → ${effectiveDynamicStop.toLocaleString()}원 (+3%)\n` +
            `현재가: ${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(1)}%`
          ).catch(console.error);
        } else if (dynResult.bepProtection) {
          appendShadowLog({ event: 'ATR_BEP_PROTECTION', ...shadow, prevHardStop, newHardStop: effectiveDynamicStop });
          console.log(`[AutoTrade] 🛡️ ${shadow.stockName} ATR BEP 보호: 손절 ${prevHardStop.toLocaleString()} → ${effectiveDynamicStop.toLocaleString()} (원금)`);
          await sendTelegramAlert(
            `🛡️ <b>[원금 보호]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `ATR 동적 손절 상향: ${prevHardStop.toLocaleString()}원 → ${effectiveDynamicStop.toLocaleString()}원 (BEP)\n` +
            `현재가: ${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(1)}%`
          ).catch(console.error);
        }
      }
    }

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

    // ─── MA60_DEATH_FORCE_EXIT: 유예 만료 + 여전히 역배열 → 전량 강제 청산 ───
    // 60일선 역배열이 감지된 후 5영업일 유예. 유예 만료일 이후에도 여전히 역배열이면
    // "주도주 사이클 종료"로 판정하고 좀비 포지션을 강제로 청산한다.
    if (!shadow.ma60DeathForced && shadow.ma60ForceExitDate) {
      const todayKst = kstBusinessDateStr(0);
      if (todayKst >= shadow.ma60ForceExitDate) {
        const mas = await fetchMaFromCloses(shadow.stockCode).catch(() => null);
        const stillDead = mas ? isMA60Death(mas.ma20, mas.ma60, currentPrice) : true;
        if (stillDead) {
          const soldQty = shadow.quantity;
          Object.assign(shadow, {
            status: 'HIT_STOP',
            exitPrice: currentPrice,
            exitTime: new Date().toISOString(),
            returnPct,
            exitRuleTag: 'MA60_DEATH_FORCE_EXIT',
            ma60DeathForced: true,
            originalQuantity: shadow.originalQuantity ?? soldQty,
            quantity: 0,
          });
          console.log(`[Shadow Close] MA60_DEATH_FORCE_EXIT — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
          appendShadowLog({ event: 'MA60_DEATH_FORCE_EXIT', ...shadow, soldQty });
          console.log(`[AutoTrade] ⚰️ ${shadow.stockName} MA60 죽음 강제 청산 ${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
          await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'STOP_LOSS');
          await sendTelegramAlert(
            `⚰️ <b>[MA60 강제 청산]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `60일선 역배열 5영업일 유예 만료 — 전량 강제 청산\n` +
            `${soldQty}주 @${currentPrice.toLocaleString()}원 | 수익률: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%`,
            { priority: 'CRITICAL', dedupeKey: `ma60_force:${shadow.stockCode}` },
          ).catch(console.error);
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
        } else {
          // 역배열 해소 → 스케줄 초기화
          shadow.ma60DeathDetectedAt = undefined;
          shadow.ma60ForceExitDate = undefined;
          appendShadowLog({ event: 'MA60_DEATH_RECOVERED', ...shadow });
        }
      }
    }

    // ─── 하드 스톱 (고정 손절/레짐 손절) ───────────────────────────────────────
    if (currentPrice <= hardStopLoss) {
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
      const soldQty = shadow.quantity;
      Object.assign(shadow, {
        status: 'HIT_STOP',
        exitPrice: currentPrice,
        exitTime: new Date().toISOString(),
        returnPct,
        stopLossExitType,
        exitRuleTag: 'HARD_STOP',
        originalQuantity: shadow.originalQuantity ?? soldQty,
        quantity: 0,
      });
      console.log(`[Shadow Close] HARD_STOP — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
      appendShadowLog({ event: 'HIT_STOP', ...shadow, stopLossExitType, soldQty });
      console.log(`[AutoTrade] ❌ ${shadow.stockName} 하드 스톱(${stopLossExitType}) ${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'STOP_LOSS');
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
      const soldQty = shadow.quantity;
      Object.assign(shadow, {
        status: 'HIT_STOP',
        exitPrice: currentPrice,
        exitTime: new Date().toISOString(),
        returnPct,
        exitRuleTag: 'CASCADE_FINAL',
        originalQuantity: shadow.originalQuantity ?? soldQty,
        quantity: 0,
      });
      console.log(`[Shadow Close] CASCADE_FINAL — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
      appendShadowLog({ event: isBlacklistStep ? 'CASCADE_STOP_BLACKLIST' : 'CASCADE_STOP_FINAL', ...shadow, soldQty });
      console.log(`[AutoTrade] ❌ ${shadow.stockName} Cascade ${returnPct.toFixed(2)}% — 전량 청산${isBlacklistStep ? ' + 블랙리스트 180일' : ''}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'STOP_LOSS');
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
          await channelSellSignal({
            stockName:   shadow.stockName,
            stockCode:   shadow.stockCode,
            exitPrice:   currentPrice,
            entryPrice:  shadow.shadowEntryPrice,
            pnlPct:      returnPct,
            reason:      'TRANCHE',
            holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
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
        const soldQty = shadow.quantity;
        Object.assign(shadow, {
          status: 'HIT_TARGET',
          exitPrice: currentPrice,
          exitTime: new Date().toISOString(),
          returnPct,
          stopLossExitType: 'PROFIT_PROTECTION',
          exitRuleTag: 'TRAILING_PROTECTIVE_STOP',
          originalQuantity: shadow.originalQuantity ?? soldQty,
          quantity: 0,
        });
        console.log(`[Shadow Close] TRAILING_PROTECTIVE_STOP — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
        appendShadowLog({ event: 'TRAILING_STOP', ...shadow, soldQty });
        console.log(`[AutoTrade] 📉 ${shadow.stockName} L3 트레일링 스톱 (HWM×${(1 - (shadow.trailPct ?? 0.10)).toFixed(2)}) @${currentPrice.toLocaleString()}`);
        await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'TAKE_PROFIT');
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
      const soldQty = shadow.quantity;
      Object.assign(shadow, {
        status: 'HIT_TARGET',
        exitPrice: currentPrice,
        exitTime: new Date().toISOString(),
        returnPct,
        exitRuleTag: 'TARGET_EXIT',
        originalQuantity: shadow.originalQuantity ?? soldQty,
        quantity: 0,
      });
      console.log(`[Shadow Close] TARGET_EXIT — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
      appendShadowLog({ event: 'HIT_TARGET', ...shadow, soldQty });
      console.log(`[AutoTrade] ✅ ${shadow.stockName} 목표가 달성 +${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'TAKE_PROFIT');
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

    // ─── RRR 붕괴 감지 — 잔여 기대값 < 1.0이면 50% 자동 익절 (1회만) ────────
    // 진입 시 한 번만 계산된 RRR은 주가 상승 시 잔여 upside가 줄면서 실질 RRR이
    // 1.0 이하로 붕괴할 수 있다. 수익 중인 포지션이라도 잔여 기대값이 마이너스이면
    // 보유 정당성이 없으므로 50%를 자동 익절하여 "좀비 포지션"을 제거한다.
    if (!shadow.rrrCollapsePartialSold && shadow.quantity > 0 && currentPrice > shadow.shadowEntryPrice) {
      const remainingReward = shadow.targetPrice - currentPrice;
      const remainingRisk   = currentPrice - hardStopLoss;
      if (remainingRisk > 0) {
        const liveRRR = remainingReward / remainingRisk;
        if (liveRRR < 1.0) {
          const sellQty = Math.max(1, Math.floor(shadow.quantity * 0.5));
          shadow.rrrCollapsePartialSold = true;
          shadow.originalQuantity ??= shadow.quantity;
          shadow.quantity -= sellQty;
          shadow.exitRuleTag = 'RRR_COLLAPSE_PARTIAL';
          appendShadowLog({ event: 'RRR_COLLAPSE_PARTIAL', ...shadow, soldQty: sellQty, liveRRR, returnPct });
          console.log(`[AutoTrade] 📊 ${shadow.stockName} RRR 붕괴 (${liveRRR.toFixed(2)}) — 50% 익절 ${sellQty}주 @${currentPrice.toLocaleString()}`);
          await placeKisSellOrder(shadow.stockCode, shadow.stockName, sellQty, 'TAKE_PROFIT');
          await sendTelegramAlert(
            `📊 <b>[RRR 붕괴 경보]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `잔여 RRR: ${liveRRR.toFixed(2)} (< 1.0) — 좀비 포지션 50% 익절\n` +
            `${sellQty}주 @${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(2)}%\n` +
            `목표: ${shadow.targetPrice.toLocaleString()}원 | 손절: ${hardStopLoss.toLocaleString()}원 | 잔여: ${shadow.quantity}주`,
            { priority: 'HIGH', dedupeKey: `rrr_collapse:${shadow.stockCode}` },
          ).catch(console.error);
          await channelSellSignal({
            stockName:   shadow.stockName,
            stockCode:   shadow.stockCode,
            exitPrice:   currentPrice,
            entryPrice:  shadow.shadowEntryPrice,
            pnlPct:      returnPct,
            reason:      'RRR_COLLAPSE',
            holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
          }).catch(console.error);
          if (shadow.quantity <= 0) continue;
        }
      }
    }

    // ─── 하락 다이버전스 — 주가 신고가 + RSI 고점 낮아짐 → 30% 부분 익절 (1회만) ─
    // 수익 구간에서 "가짜 돌파·상투" 조기 경보. 매매 중 포지션만 대상.
    if (
      !shadow.divergencePartialSold &&
      shadow.quantity > 0 &&
      currentPrice > shadow.shadowEntryPrice
    ) {
      const hist = await fetchPriceAndRsiHistory(shadow.stockCode, 10).catch(() => null);
      if (hist && detectBearishDivergence(hist.prices, hist.rsi)) {
        const sellQty = Math.max(1, Math.floor(shadow.quantity * 0.30));
        shadow.divergencePartialSold = true;
        shadow.originalQuantity ??= shadow.quantity;
        shadow.quantity -= sellQty;
        shadow.exitRuleTag = 'DIVERGENCE_PARTIAL';
        appendShadowLog({ event: 'DIVERGENCE_PARTIAL', ...shadow, soldQty: sellQty, returnPct });
        console.log(`[AutoTrade] 📉 ${shadow.stockName} 하락 다이버전스 — 30% 익절 ${sellQty}주 @${currentPrice.toLocaleString()}`);
        await placeKisSellOrder(shadow.stockCode, shadow.stockName, sellQty, 'TAKE_PROFIT');
        await sendTelegramAlert(
          `📉 <b>[하락 다이버전스]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
          `주가 신고가·RSI 고점 낮아짐 — 30% 부분 익절\n` +
          `${sellQty}주 @${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(2)}% | 잔여: ${shadow.quantity}주`,
          { priority: 'HIGH', dedupeKey: `divergence:${shadow.stockCode}` },
        ).catch(console.error);
        await channelSellSignal({
          stockName:   shadow.stockName,
          stockCode:   shadow.stockCode,
          exitPrice:   currentPrice,
          entryPrice:  shadow.shadowEntryPrice,
          pnlPct:      returnPct,
          reason:      'DIVERGENCE',
          holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
        }).catch(console.error);
        if (shadow.quantity <= 0) continue;
      }
    }

    // ─── MA60_DEATH_WATCH: 60일선 역배열 최초 감지 → 5영업일 강제 청산 스케줄 ─
    // 이미 스케줄된 포지션은 스킵. 역배열이 아니면 스킵. 신규 감지 시 ma60ForceExitDate 설정.
    if (!shadow.ma60DeathDetectedAt && !shadow.ma60DeathForced) {
      const mas = await fetchMaFromCloses(shadow.stockCode).catch(() => null);
      if (mas && isMA60Death(mas.ma20, mas.ma60, currentPrice)) {
        const nowIso = new Date().toISOString();
        const forceDate = kstBusinessDateStr(5);
        shadow.ma60DeathDetectedAt = nowIso;
        shadow.ma60ForceExitDate = forceDate;
        shadow.exitRuleTag = 'MA60_DEATH_WATCH';
        appendShadowLog({ event: 'MA60_DEATH_WATCH', ...shadow, ma20: mas.ma20, ma60: mas.ma60 });
        console.log(`[AutoTrade] ⚠️ ${shadow.stockName} MA60 역배열 감지 — 강제 청산일 ${forceDate}`);
        await sendTelegramAlert(
          `⚠️ <b>[MA60 역배열 감지]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
          `60일선 역배열 진입 — 주도주 사이클 종료 신호\n` +
          `MA20: ${Math.round(mas.ma20).toLocaleString()} · MA60: ${Math.round(mas.ma60).toLocaleString()} · 현재가: ${currentPrice.toLocaleString()}원\n` +
          `📅 ${forceDate}까지 회복하지 못하면 강제 청산됩니다.`,
          { priority: 'HIGH', dedupeKey: `ma60_watch:${shadow.stockCode}` },
        ).catch(console.error);
      }
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
        await channelSellSignal({
          stockName:   shadow.stockName,
          stockCode:   shadow.stockCode,
          exitPrice:   currentPrice,
          entryPrice:  shadow.shadowEntryPrice,
          pnlPct:      returnPct,
          reason:      'EUPHORIA',
          holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
        }).catch(console.error);
      }
    }
  }
}
