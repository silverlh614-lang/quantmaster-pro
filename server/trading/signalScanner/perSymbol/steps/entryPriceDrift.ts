/**
 * @responsibility ADR-0019 entry price drift gate extracted from buyListLoop.
 */

import { applyEntryPriceDrift } from '../../../../screener/watchlistManager.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { resolveDataHoldAction } from '../../../../data/dataHoldRolePolicy.js';
import { isEntryPriceAutoCorrectDisabled } from '../../failureClassifier.js';
import type { BuyListLoopContext } from '../types.js';

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
    console.log(`[AutoTrade] ${stock.name}(${stock.code}) ??WAIT / DATA_HOLD / ${action.reason}`);
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
        `[AutoTrade] ?뵩 ${stock.name}(${stock.code}) Corporate Action ?섏떖 ` +
        `(drift ${driftPctText}%) ??entryPrice ${oldEntry.toLocaleString()} 蹂댁〈 (RAW immutable, ADR-0115). ` +
        `universe ?쒖쇅 + DART 議고쉶 沅뚭퀬.`,
      );
      try {
        const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
        await sendTelegramAlert(
          `?뵩 <b>[Corporate Action ?섏떖 ??universe ?쒖쇅]</b> ${stock.name} (${stock.code})\n` +
          `?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺\n` +
          `??drift: ${driftPctText}% (遺꾪븷/蹂묓빀/沅뚮━??異붿젙)\n` +
          `??entryPrice <b>${oldEntry.toLocaleString()}??蹂댁〈</b> (RAW immutable, ADR-0115)\n` +
          `??泥섎━: ?뚯튂由ъ뒪?몄뿉???쒖쇅 (?ㅼ쓬 ?곸뾽???댁쁺??寃?????섎룞 entryPrice 媛깆떊 ?먮뒗 ??吏꾩엯)\n` +
          `??沅뚭퀬: DART 怨듭떆 ?뺤씤 (遺꾪븷/蹂묓빀/沅뚮━??`,
          {
            priority: 'HIGH',
            dedupeKey: `corp_action_immutable:${stock.code}`,
            cooldownMs: 24 * 60 * 60 * 1000,
          },
        ).catch(() => undefined);
      } catch (e) {
        console.warn('[CorporateAction] ?붾젅洹몃옩 ?뚮┝ ?ㅽ뙣:', e instanceof Error ? e.message : e);
      }
      const idx = ctx.watchlist.findIndex(w => w.code === stock.code);
      if (idx >= 0) { ctx.watchlist.splice(idx, 1); ctx.mutables.watchlistMutated.value = true; }
      stageLog.drift = 'CORPORATE_ACTION_REMOVE';
    } else {
      stock.entryPrice = currentPrice;
      stock.corporateActionAdjusted = true;
      stock.corporateActionAdjustedAt = new Date().toISOString();
      ctx.mutables.watchlistMutated.value = true;
      console.warn(
        `[AutoTrade] ?뵩 ${stock.name}(${stock.code}) Corporate Action ?섏떖 ` +
        `(drift ${driftPctText}%) ??entryPrice ${oldEntry.toLocaleString()} ??` +
        `${currentPrice.toLocaleString()} ?먮룞 蹂댁젙 (ADR-0113 ?덇굅???숈옉, ENV ?고쉶).`,
      );
      try {
        const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
        await sendTelegramAlert(
          `?뵩 <b>[Corporate Action ?섏떖 ???먮룞 蹂댁젙]</b> ${stock.name} (${stock.code})\n` +
          `?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺\n` +
          `??drift: ${driftPctText}% (遺꾪븷/蹂묓빀/沅뚮━??異붿젙)\n` +
          `??entryPrice ?먮룞 蹂댁젙: ${oldEntry.toLocaleString()} ??${currentPrice.toLocaleString()}\n` +
          `??沅뚭퀬: DART 怨듭떆 ?뺤씤 (遺꾪븷/蹂묓빀/沅뚮━?? ???뚯튂由ъ뒪??寃??`,
          {
            priority: 'HIGH',
            dedupeKey: `corp_action:${stock.code}`,
            cooldownMs: 24 * 60 * 60 * 1000,
          },
        ).catch(() => undefined);
      } catch (e) {
        console.warn('[CorporateAction] ?붾젅洹몃옩 ?뚮┝ ?ㅽ뙣:', e instanceof Error ? e.message : e);
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
      `[AutoTrade] ${stock.name}(${stock.code}) entryPrice ?쒕━?꾪듃 ?쒓굅 ??` +
      `?꾩옱媛 ${currentPrice.toLocaleString()} vs entryPrice ${stock.entryPrice.toLocaleString()} (+${driftPct}%)`,
    );
    const idx = ctx.watchlist.findIndex(w => w.code === stock.code);
    if (idx >= 0) { ctx.watchlist.splice(idx, 1); ctx.mutables.watchlistMutated.value = true; }
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
      `[AutoTrade] ${stock.name}(${stock.code}) entryPrice ?몃젅??????` +
      `${oldEntry.toLocaleString()} ??${currentPrice.toLocaleString()} (+10% ?댁긽 ?쒕━?꾪듃)`,
    );
    stageLog.drift = 'UPDATE';
    pushTrace();
    return 'SKIP';
  }

  return 'CONTINUE';
}
