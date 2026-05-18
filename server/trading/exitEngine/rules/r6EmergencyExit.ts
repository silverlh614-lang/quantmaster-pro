// @responsibility R6_DEFENSE emergency forced exit for LIVE positions only
import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { appendShadowLog, syncPositionCache, buildExitAttribution } from '../../../persistence/shadowTradeRepo.js';
import { appendPendingEmergencyExit } from '../../../persistence/pendingEmergencyExitQueueRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { reserveSell } from '../helpers/reserveSell.js';
import {
  formatR6ShadowHoldMessage,
  resolveR6LiveForcedExitSession,
  shouldSkipR6ForcedExitForShadow,
} from '../r6ForcedExitPolicy.js';

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

  const shadowSkip = shouldSkipR6ForcedExitForShadow(shadow);
  if (shadowSkip.skip) {
    const message = formatR6ShadowHoldMessage(shadow);
    appendShadowLog({
      event: 'R6_EMERGENCY_EXIT_SKIPPED_SHADOW',
      ...shadow,
      reason: shadowSkip.reason,
      detail: shadowSkip.detail,
      executionImpact: 'NONE',
      liveOrderSent: false,
      message,
    });
    console.info(
      `[R6_EMERGENCY_EXIT_SKIPPED_SHADOW] symbol=${shadow.stockCode} ` +
      `reason=${shadowSkip.reason} detail=${shadowSkip.detail ?? 'n/a'} ` +
      'executionImpact=NONE liveOrderSent=false',
    );
    return NO_OP;
  }

  const emergencyQty = Math.max(1, Math.floor(shadow.quantity * 0.30));
  const session = resolveR6LiveForcedExitSession({
    marketSessionState: ctx.marketSessionState,
    isKrxTradingOpen: ctx.isKrxTradingOpen,
    kisOrderAllowed: ctx.kisOrderAllowed,
    liveOrderAllowed: ctx.liveOrderAllowed,
    now: ctx.now,
  });

  if (!session.allowed) {
    const createdAt = (ctx.now ?? new Date()).toISOString();
    appendPendingEmergencyExit({
      tradeId: shadow.id,
      stockCode: shadow.stockCode,
      stockName: shadow.stockName,
      qty: emergencyQty,
      currentPrice,
      returnPct,
      regime: currentRegime,
      reason: 'SESSION_GUARDED_R6_EMERGENCY_EXIT',
      guardReason: session.reason ?? 'UNKNOWN',
      marketSessionState: session.marketSessionState,
      isKrxTradingOpen: session.isKrxTradingOpen,
      kisOrderAllowed: session.kisOrderAllowed,
      liveOrderAllowed: session.liveOrderAllowed,
      createdAt,
    });
    appendShadowLog({
      event: 'R6_EMERGENCY_EXIT_PENDING_NEXT_OPEN',
      ...shadow,
      pendingQty: emergencyQty,
      guardReason: session.reason,
      marketSessionState: session.marketSessionState,
      executionImpact: 'NONE',
      liveOrderSent: false,
      scheduledForNextOpen: true,
    });
    console.warn(
      `[R6_EMERGENCY_EXIT_PENDING_NEXT_OPEN] symbol=${shadow.stockCode} ` +
      `reason=${session.reason ?? 'UNKNOWN'} marketSessionState=${session.marketSessionState} ` +
      'executionImpact=NONE liveOrderSent=false',
    );
    await sendTelegramAlert(
      `[R6 emergency liquidation candidate] ${shadow.stockName} (${shadow.stockCode})\n` +
      'Off-regular-session guard is active: no live order, no fill, no status mutation.\n' +
      'Scheduled for next regular open re-check.\n' +
      `marketSessionState=${session.marketSessionState} / executionImpact=NONE`,
      { priority: 'HIGH' },
    ).catch(console.error);
    return NO_OP;
  }

  shadow.exitRuleTag = 'R6_EMERGENCY_EXIT';
  shadow.r6EmergencySold = true;
  appendShadowLog({ event: 'R6_EMERGENCY_EXIT', ...shadow, soldQty: emergencyQty, returnPct });
  console.log(`[AutoTrade] ${shadow.stockName} (${shadow.stockCode}) R6 emergency liquidation 30% (${emergencyQty} @${currentPrice.toLocaleString()})`);

  const r6Res = await placeKisSellOrder(shadow.stockCode, shadow.stockName, emergencyQty, 'STOP_LOSS');
  const r6Ts = new Date().toISOString();
  const r6Reserve = reserveSell(shadow, r6Res, {
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
