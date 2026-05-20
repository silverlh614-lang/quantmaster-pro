/**
 * @responsibility ADR-0019 Phase B EntryGate Chain runner extracted from buyListLoop.
 */

import { sendTelegramAlert } from '../../../../alerts/telegramClient.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { ENTRY_GATES_PHASE_B } from '../../entryGates/index.js';
import type { BuyListLoopContext } from '../types.js';

export async function phaseEntryGate(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  currentPrice: number,
  stageLog: Record<string, string>,
  pushTrace: () => void,
): Promise<'SKIP' | 'CONTINUE'> {
  for (const gate of ENTRY_GATES_PHASE_B) {
    const result = await gate({
      stock, shadows: ctx.shadows, scanCounters: ctx.scanCounters,
      watchlist: ctx.watchlist, mutables: ctx.mutables,
      currentPrice, totalAssets: ctx.totalAssets, kellyMultiplier: ctx.kellyMultiplier,
    });
    if (result.pass) {
      if (result.passLogMessage) console.log(result.passLogMessage);
      if (result.passWarnMessage) console.warn(result.passWarnMessage);
      continue;
    }
    console.log(result.logMessage);
    if (result.counter) ctx.scanCounters[result.counter] += 1;
    if (result.stageLog) stageLog[result.stageLog.key] = result.stageLog.value;
    if (result.pushTrace) pushTrace();
    if (result.telegramMessage) {
      await sendTelegramAlert(result.telegramMessage).catch(console.error);
    }
    return 'SKIP';
  }
  stageLog.rrr = 'PASS';
  return 'CONTINUE';
}
