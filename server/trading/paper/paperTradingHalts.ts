// @responsibility Remember the latest KIS halt status of each Shadow symbol in this process.
/**
 * Multi-stock quotes (FHKST11300006) carry no halt flag. Only full current-price responses
 * (FHKST01010100 `tradingHalted`) update this memory, so a symbol stays unknown until one arrives.
 */
const statuses = new Map<string, { halted: boolean; checkedAt: number }>();

/** A missing flag never changes the status, and an older check never overwrites a newer one. */
export function recordPaperTradingHalt(symbol: string, halted: boolean | undefined, checkedAt: string): void {
  const at = Date.parse(checkedAt);
  if (typeof halted !== 'boolean' || !Number.isFinite(at) || (statuses.get(symbol)?.checkedAt ?? -Infinity) > at) return;
  statuses.set(symbol, { halted, checkedAt: at });
}

/** true: halted at the latest check, false: confirmed tradable, undefined: not checked since startup. */
export function paperTradingHaltStatus(symbol: string): boolean | undefined {
  return statuses.get(symbol)?.halted;
}

/** A halt reconfirmed at or after `since` (epoch ms); an older confirmation no longer explains a missing price. */
export function isPaperHaltConfirmedSince(symbol: string, since: number): boolean {
  const status = statuses.get(symbol);
  return status?.halted === true && status.checkedAt >= since;
}

export function paperHaltedSymbols(): Set<string> {
  return new Set([...statuses].flatMap(([symbol, status]) => status.halted ? [symbol] : []));
}

/** Test isolation only. */
export function __resetPaperTradingHaltsForTest(): void {
  statuses.clear();
}
