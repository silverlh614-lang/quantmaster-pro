// @responsibility Monitor held Shadow prices independently from broad research collection.
import type { PaperPriceMonitorStatus } from '../../../src/types/paperExperiment.js';
import { getAutoTradePaused } from '../../state.js';
import { isPaperMarketOpen } from './paperExperimentCollector.js';
import { collectPaperPriceSnapshot } from './paperPriceCollector.js';
import { advancePaperStrategy, loadPaperStrategyState } from './paperStrategyRuntime.js';

const attempts = new Map<string, number>();
const quotes = new Map<string, string>();
let running: Promise<void> | null = null;
const status: PaperPriceMonitorStatus = { intervalSeconds: 60, running: false, marketOpen: false,
  startedAt: null, completedAt: null, durationMs: null, checkedCount: 0, validCount: 0, closedCount: 0,
  heldCount: 0, staleCount: 0, oldestQuoteAt: null };

export function readPaperPriceMonitor(state = loadPaperStrategyState()): PaperPriceMonitorStatus {
  const held = state.ledger?.trades.filter(item => item.status === 'OPEN') ?? [];
  const times = held.map(item => [quotes.get(item.symbol), item.measurement?.latest?.observedAt]
    .filter((at): at is string => !!at).sort().at(-1) ?? null);
  const now = Date.now();
  return { ...status, running: running !== null, marketOpen: isPaperMarketOpen(new Date(now)), heldCount: held.length,
    staleCount: times.filter(at => !at || now - Date.parse(at) > status.intervalSeconds * 2 * 1000).length,
    oldestQuoteAt: times.length && times.every(Boolean) ? times.sort()[0] : null,
    ...(state.error ? { error: state.error } : {}) };
}

async function monitor(): Promise<void> {
  if (getAutoTradePaused() || !isPaperMarketOpen(new Date())) return;
  const started = Date.now();
  Object.assign(status, { startedAt: new Date(started).toISOString(), checkedCount: 0, validCount: 0, closedCount: 0 });
  delete status.error;
  try {
    const state = loadPaperStrategyState();
    if (!state.ledger) throw new Error(state.error ?? '전략 원장 없음');
    const eligible = state.ledger.trades.filter(item => item.status === 'OPEN'
      || item.exitResearch && !item.exitResearch.completedAt && Date.parse(item.exitResearch.watchUntilAt) > started);
    const active = new Set(eligible.map(item => item.symbol));
    for (const symbol of attempts.keys()) if (!active.has(symbol)) { attempts.delete(symbol); quotes.delete(symbol); }
    // Held observed-exit positions first: their sell checks never wait behind D5-only research symbols.
    const held = new Set(eligible.filter(item => item.status === 'OPEN' && item.policy.exitModel === 'ADAPTIVE_OBSERVED')
      .map(item => item.symbol));
    // Within each group, oldest attempted symbols first prevents failed quotes or large portfolios starving other holdings.
    const symbols = [...new Map(eligible.map(item => [item.symbol, item])).values()]
      .sort((a, b) => Number(held.has(b.symbol)) - Number(held.has(a.symbol))
        || (attempts.get(a.symbol) ?? 0) - (attempts.get(b.symbol) ?? 0) || a.symbol.localeCompare(b.symbol));
    for (let offset = 0; offset < symbols.length && Date.now() - started < 20_000; offset += 25) {
      if (getAutoTradePaused() || !isPaperMarketOpen(new Date())) break;
      const batch = symbols.slice(offset, offset + 25);
      for (const item of batch) attempts.set(item.symbol, Date.now());
      const snapshot = await collectPaperPriceSnapshot(batch);
      status.checkedCount += batch.length;
      // Re-read after network I/O; the synchronous evaluate/save phase never overwrites a newer trade state.
      if (getAutoTradePaused() || !snapshot.marketOpen) break;
      const result = advancePaperStrategy(loadPaperStrategyState(), [], snapshot);
      if (result.error) throw new Error(result.error);
      for (const item of snapshot.observations) if (item.price !== null && !item.issue) {
        quotes.set(item.symbol, item.observedAt); status.validCount++;
      }
      status.closedCount += result.closedCount;
    }
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
    console.error('[PaperPriceMonitor]', status.error);
    throw error;
  } finally {
    status.completedAt = new Date().toISOString(); status.durationMs = Date.now() - started;
  }
}

export function runPaperPriceMonitor(): Promise<void> {
  if (!running) running = monitor().finally(() => { running = null; });
  return running;
}
