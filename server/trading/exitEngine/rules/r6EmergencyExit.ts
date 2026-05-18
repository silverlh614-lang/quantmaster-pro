// @responsibility R6_DEFENSE emergency forced exit for LIVE positions only
import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { appendShadowLog, syncPositionCache, buildExitAttribution } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { placeReservedSellOrder } from '../helpers/reserveSell.js';
import {
  formatR6ShadowHoldMessage,
} from '../r6ForcedExitPolicy.js';
import { resolveR6ShadowHoldPolicy } from '../../exit/policies/r6ShadowHoldPolicy.js';
import { resolveR6LiveEmergencyExitPolicy } from '../../exit/policies/r6LiveEmergencyExitPolicy.js';
import { emitExitOperationalWarn } from '../../exit/exitOperationalWarn.js';

/**
 * @rule R6_EMERGENCY_EXIT
 * @priority 1
 * @action PARTIAL_SELL
 * @ratio 0.30
 * @trigger currentRegime === 'R6_DEFENSE' && !shadow.r6EmergencySold && shadow.quantity > 0
 * @regime R6_DEFENSE
 */
export async function r6EmergencyExit(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct, currentRegime } = ctx;

  if (currentRegime !== 'R6_DEFENSE' || shadow.r6EmergencySold || shadow.quantity <= 0) {
    return NO_OP;
  }

  const shadowHold = resolveR6ShadowHoldPolicy({
    trade: shadow,
    currentRegime,
  });
  if (shadowHold.kind === 'SHADOW_HOLD_R6_DEFENSE') {
    const message = formatR6ShadowHoldMessage(shadow);
    appendShadowLog({
      event: 'R6_EMERGENCY_EXIT_SKIPPED_SHADOW',
      ...shadow,
      reason: shadowHold.reason,
      detail: 'shadow_hold_policy',
      executionImpact: 'NONE',
      liveOrderSent: false,
      message,
    });
    console.info(
      `[R6_EMERGENCY_EXIT_SKIPPED_SHADOW] symbol=${shadow.stockCode} ` +
      `reason=${shadowHold.reason} detail=shadow_hold_policy ` +
      'executionImpact=NONE liveOrderSent=false',
    );
    return NO_OP;
  }

  const liveDecision = resolveR6LiveEmergencyExitPolicy({
    trade: shadow,
    currentRegime,
    currentPrice,
    returnPct,
    marketSessionState: ctx.marketSessionState,
    isKrxTradingOpen: ctx.isKrxTradingOpen,
    kisOrderAllowed: ctx.kisOrderAllowed,
    liveOrderAllowed: ctx.liveOrderAllowed,
    now: ctx.now,
  });

  if (liveDecision.kind === 'LIVE_SELL_DEFERRED') {
    appendShadowLog({
      event: 'R6_EMERGENCY_EXIT_PENDING_NEXT_OPEN',
      ...shadow,
      pendingQty: Math.max(1, Math.floor(shadow.quantity * 0.30)),
      pendingIntentId: liveDecision.pendingIntentId,
      guardReason: liveDecision.reason,
      marketSessionState: ctx.marketSessionState ?? 'UNKNOWN',
      executionImpact: 'NONE',
      liveOrderSent: false,
      scheduledForNextOpen: true,
    });
    emitExitOperationalWarn({
      code: 'P0_LIVE_EXIT_DEFERRED_NON_TRADING',
      message: 'R6 live exit intent deferred because session guard blocked real order',
      context: {
        stockCode: shadow.stockCode,
        stockName: shadow.stockName,
        mode: shadow.mode ?? 'LIVE',
        reason: liveDecision.reason,
        pendingIntentId: liveDecision.pendingIntentId,
        executionImpact: 'NONE',
      },
    });
    await sendTelegramAlert(
      `[R6 emergency liquidation candidate - exit intent pending] ${shadow.stockName} (${shadow.stockCode})\n` +
      'Off-regular-session guard is active: sell intent only, no live order, no fill, no status mutation.\n' +
      'Scheduled for next regular open re-check.\n' +
      `pendingIntentId=${liveDecision.pendingIntentId} / executionImpact=NONE`,
      { priority: 'HIGH' },
    ).catch(console.error);
    return NO_OP;
  }

  if (liveDecision.kind !== 'LIVE_SELL_INTENT') {
    return NO_OP;
  }

  const emergencyQty = liveDecision.qty;

  shadow.exitRuleTag = 'R6_EMERGENCY_EXIT';
  shadow.r6EmergencySold = true;
  appendShadowLog({ event: 'R6_EMERGENCY_EXIT', ...shadow, soldQty: emergencyQty, returnPct });
  console.log(`[AutoTrade] ${shadow.stockName} (${shadow.stockCode}) R6 emergency liquidation 30% (${emergencyQty} @${currentPrice.toLocaleString()})`);

  const r6Ts = new Date().toISOString();
  const r6Reserve = await placeReservedSellOrder(shadow, emergencyQty, 'STOP_LOSS', {
    type: 'SELL',
    subType: 'EMERGENCY',
    qty: emergencyQty,
    price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * emergencyQty,
    pnlPct: returnPct,
    reason: 'R6 emergency liquidation 30%',
    exitRuleTag: 'R6_EMERGENCY_EXIT',
    timestamp: r6Ts,
    attribution: buildExitAttribution('R6_EMERGENCY_EXIT', ['regime_r6_defense'], currentRegime),
  }, 'R6_EMERGENCY', 'r6EmergencySold');

  if (r6Reserve.kind === 'FAILED') {
    shadow.r6EmergencySold = false;
  } else {
    syncPositionCache(shadow);
    if (r6Reserve.kind === 'PENDING') {
      addSellOrder({
        ordNo: r6Reserve.ordNo,
        stockCode: shadow.stockCode,
        stockName: shadow.stockName,
        quantity: emergencyQty,
        originalReason: 'STOP_LOSS',
        placedAt: new Date().toISOString(),
        relatedTradeId: shadow.id,
      });
    }
  }

  await sendTelegramAlert(
    `${r6Reserve.statusPrefix} [R6 emergency liquidation] ${shadow.stockName} (${shadow.stockCode})\n` +
    `Black-swan detected: 30% live liquidation ${emergencyQty} @${currentPrice.toLocaleString()}\n` +
    `returnPct=${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}% | remaining=${r6Reserve.remainingQty}\n` +
    r6Reserve.statusSuffix,
    { priority: r6Reserve.kind === 'FAILED' ? 'CRITICAL' : 'HIGH' },
  ).catch(console.error);

  if (shadow.quantity <= 0) return { skipRest: true };
  return NO_OP;
}
