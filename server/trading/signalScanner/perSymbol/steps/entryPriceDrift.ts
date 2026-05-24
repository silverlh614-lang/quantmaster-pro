/**
 * @responsibility ADR-0019 entry price drift gate extracted from buyListLoop.
 */

import { applyEntryPriceDrift } from '../../../../screener/watchlistManager.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { resolveDataHoldAction } from '../../../../data/dataHoldRolePolicy.js';
import { isEntryPriceAutoCorrectDisabled } from '../../failureClassifier.js';
import type { BuyListLoopContext } from '../types.js';

export type CorporateActionDriftMode = 'IMMUTABLE_REMOVE' | 'AUTO_CORRECT';

export interface CorporateActionDriftMessageInput {
  name: string;
  code: string;
  driftPctText: string;
  oldEntry: number;
  currentPrice: number;
  mode: CorporateActionDriftMode;
}

function formatKrw(value: number): string {
  return value.toLocaleString('ko-KR');
}

export function buildCorporateActionDriftMessage(input: CorporateActionDriftMessageInput): string {
  const header = input.mode === 'IMMUTABLE_REMOVE'
    ? '[Corporate Action Guard - universe excluded]'
    : '[Corporate Action Guard - entryPrice adjusted]';
  const entryLine = input.mode === 'IMMUTABLE_REMOVE'
    ? `entryPrice kept: <b>${formatKrw(input.oldEntry)}</b> (RAW immutable, ADR-0115)`
    : `entryPrice adjusted: <b>${formatKrw(input.oldEntry)} -> ${formatKrw(input.currentPrice)}</b>`;
  const actionLine = input.mode === 'IMMUTABLE_REMOVE'
    ? 'action: watchlist excluded; review DART disclosure before re-entry.'
    : 'action: auto-correction applied; review DART disclosure for split/merge/rights issue.';

  return [
    `<b>${header}</b> ${input.name} (${input.code})`,
    '--------------------',
    `drift: ${input.driftPctText}% (split/merge/rights issue suspected)`,
    entryLine,
    actionLine,
  ].join('\n');
}

export async function checkEntryPriceDrift(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  currentPrice: number,
  stageLog: Record<string, string>,
  pushTrace: () => void,
): Promise<'SKIP' | 'CONTINUE'> {
  const driftAction = applyEntryPriceDrift(stock, currentPrice);
  if (driftAction === 'DATA_HOLD') {
    const action = resolveDataHoldAction('BUY_CANDIDATE');
    const absDriftPct = Math.abs(((currentPrice - stock.entryPrice) / stock.entryPrice) * 100);
    const reason = `[watchlistManager.drift:${stock.code}] sanity violation absPct=${absDriftPct.toFixed(2)}% > 90% current=${currentPrice}, base=${stock.entryPrice}`;
    if (action.blockBuy) {
      stock.isDataQuarantined = true;
      stock.dataQuality = {
        status: 'STALE_BASE_OR_SPLIT_ADJUSTMENT',
        reason,
        current: currentPrice,
        base: stock.entryPrice,
        source: 'KIS_REALTIME',
        context: `watchlistManager.drift:${stock.code}`,
        updatedAt: new Date().toISOString(),
      };
    }
    ctx.mutables.watchlistMutated.value = true;
    console.warn(`[WatchlistManager] drift update skipped: ${reason}`);
    console.log(`[AutoTrade] ${stock.name}(${stock.code}) WAIT / DATA_HOLD / ${action.reason}`);
    stageLog.drift = 'DATA_HOLD';
    ctx.scanCounters.waitDataHold++;
    pushTrace();
    return 'SKIP';
  }

  if (driftAction === 'CORPORATE_ACTION') {
    const oldEntry = stock.entryPrice;
    const driftPctText = (((currentPrice - oldEntry) / oldEntry) * 100).toFixed(1);
    if (isEntryPriceAutoCorrectDisabled()) {
      console.warn(
        `[AutoTrade] ${stock.name}(${stock.code}) Corporate Action guard ` +
        `(drift ${driftPctText}%) entryPrice ${formatKrw(oldEntry)} kept ` +
        '(RAW immutable, ADR-0115); universe excluded and DART review requested.',
      );
      try {
        const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
        await sendTelegramAlert(
          buildCorporateActionDriftMessage({
            name: stock.name,
            code: stock.code,
            driftPctText,
            oldEntry,
            currentPrice,
            mode: 'IMMUTABLE_REMOVE',
          }),
          {
            priority: 'HIGH',
            dedupeKey: `corp_action_immutable:${stock.code}`,
            cooldownMs: 24 * 60 * 60 * 1000,
          },
        ).catch(() => undefined);
      } catch (e) {
        console.warn('[CorporateAction] telegram alert failed:', e instanceof Error ? e.message : e);
      }
      const idx = ctx.watchlist.findIndex(w => w.code === stock.code);
      if (idx >= 0) {
        ctx.watchlist.splice(idx, 1);
        ctx.mutables.watchlistMutated.value = true;
      }
      stageLog.drift = 'CORPORATE_ACTION_REMOVE';
    } else {
      stock.entryPrice = currentPrice;
      stock.corporateActionAdjusted = true;
      stock.corporateActionAdjustedAt = new Date().toISOString();
      ctx.mutables.watchlistMutated.value = true;
      console.warn(
        `[AutoTrade] ${stock.name}(${stock.code}) Corporate Action guard ` +
        `(drift ${driftPctText}%) entryPrice ${formatKrw(oldEntry)} -> ${formatKrw(currentPrice)} ` +
        'auto-corrected (ADR-0113 enabled by ENV).',
      );
      try {
        const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
        await sendTelegramAlert(
          buildCorporateActionDriftMessage({
            name: stock.name,
            code: stock.code,
            driftPctText,
            oldEntry,
            currentPrice,
            mode: 'AUTO_CORRECT',
          }),
          {
            priority: 'HIGH',
            dedupeKey: `corp_action:${stock.code}`,
            cooldownMs: 24 * 60 * 60 * 1000,
          },
        ).catch(() => undefined);
      } catch (e) {
        console.warn('[CorporateAction] telegram alert failed:', e instanceof Error ? e.message : e);
      }
      stageLog.drift = 'CORPORATE_ACTION';
    }
    ctx.scanCounters.waitDriftCorpAction++;
    pushTrace();
    return 'SKIP';
  }

  if (driftAction === 'REMOVE') {
    const driftPct = ((currentPrice - stock.entryPrice) / stock.entryPrice * 100).toFixed(1);
    console.log(
      `[AutoTrade] ${stock.name}(${stock.code}) entryPrice drift removal: ` +
      `current ${formatKrw(currentPrice)} vs entryPrice ${formatKrw(stock.entryPrice)} (+${driftPct}%)`,
    );
    const idx = ctx.watchlist.findIndex(w => w.code === stock.code);
    if (idx >= 0) {
      ctx.watchlist.splice(idx, 1);
      ctx.mutables.watchlistMutated.value = true;
    }
    stageLog.drift = 'REMOVE';
    ctx.scanCounters.waitDriftRemove++;
    pushTrace();
    return 'SKIP';
  }

  if (driftAction === 'UPDATE') {
    const oldEntry = stock.entryPrice;
    stock.entryPrice = currentPrice;
    ctx.mutables.watchlistMutated.value = true;
    console.log(
      `[AutoTrade] ${stock.name}(${stock.code}) entryPrice drift update: ` +
      `${formatKrw(oldEntry)} -> ${formatKrw(currentPrice)} (+10% tracking refresh)`,
    );
    stageLog.drift = 'UPDATE';
    pushTrace();
    return 'SKIP';
  }

  return 'CONTINUE';
}
