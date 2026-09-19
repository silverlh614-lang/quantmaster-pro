// @responsibility Refresh limited financial facts without delaying the shared price snapshot.
import type { KisFinancials } from '../../clients/kisFinanceClient.js';
import { loadPaperFinancialCache, savePaperFinancialCache, type PaperFinancialCache } from '../../persistence/paperFinancialRepo.js';
import type { PaperFinancialFacts } from '../../../src/types/paperObservationFeatures.js';

const DAY = 86_400_000;
let refreshing: Promise<void> | undefined;
const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const validPeriod = (v: string | null | undefined) => Boolean(v && /^\d{4}(0[1-9]|1[0-2])$/.test(v));

/** Keep the two providers' periods separate; never divide amounts from different statements. */
export function normalizePaperFinancials(symbol: string, observedAt: string, kis: KisFinancials | null,
  dart: Record<string, unknown> | null, statement = 'UNKNOWN', issues: string[] = []): PaperFinancialFacts {
  const ratio = kis?.periods?.ratio ?? null;
  const income = kis?.periods?.income ?? null;
  const stability = kis?.periods?.stability ?? null;
  const equity = finite(dart?.totalEquity), assets = finite(dart?.totalAssets), cash = finite(dart?.operatingCashFlow);
  return { symbol, observedAt, issues, kis: kis?.symbol === symbol ? {
    period: ratio, incomePeriod: income, stabilityPeriod: stability, incomeField: 'bsop_prti',
    roe: validPeriod(ratio) && kis.periods?.roe === ratio && kis.fieldSources?.roe === 'KIS_L1' ? finite(kis.roe) : null,
    revenueGrowth: validPeriod(ratio) ? finite(kis.revenueYoYGrowth) : null,
    operatingMargin: validPeriod(income) ? finite(kis.opm) : null,
    netMargin: validPeriod(income) ? finite(kis.netMargin) : null,
    // The legacy client can take debt from either endpoint; require matching periods.
    debtRatio: validPeriod(ratio) && ratio === stability ? finite(kis.debtRatio) : null,
    currentRatio: validPeriod(stability) ? finite(kis.currentRatio) : null,
    bps: validPeriod(ratio) ? finite(kis.bps) : null,
  } : null,
  dart: dart?.symbol === symbol && dart.source === 'DART' && ['CFS', 'OFS'].includes(statement) ? {
    period: typeof dart.reportDate === 'string' ? dart.reportDate : null, statement,
    operatingCashFlowSign: cash === null ? null : Math.sign(cash),
    equityRatio: equity !== null && assets !== null && assets > 0 ? equity / assets * 100 : null,
  } : null };
}

export async function refreshPaperFinancialBatch(symbols: string[], cache: PaperFinancialCache): Promise<void> {
  const now = Date.now();
  const due = [...new Set(symbols)].filter(symbol => /^\d{6}$/.test(symbol)).filter(symbol => {
    const row = cache.records[symbol];
    const age = now - Date.parse(row?.attemptedAt ?? '');
    return !row || row.facts.kis && row.facts.kis.incomeField !== 'bsop_prti'
      || !Number.isFinite(age) || age < 0 || age >= (row.facts.kis || row.facts.dart ? DAY : 3_600_000);
  }).sort((a, b) => {
    const legacy = (symbol: string) => Boolean(cache.records[symbol]?.facts.kis && cache.records[symbol].facts.kis!.incomeField !== 'bsop_prti');
    return Number(legacy(b)) - Number(legacy(a))
      || (Date.parse(cache.records[a]?.attemptedAt ?? '') || 0) - (Date.parse(cache.records[b]?.attemptedAt ?? '') || 0);
  }).slice(0, 8);
  for (const symbol of due) {
    // Stop starting new work after one minute; a current provider call retains its own timeout.
    if (Date.now() - now > 60_000) break;
    const issues: string[] = [];
    let kis: KisFinancials | null = null;
    let dart: Record<string, unknown> | null = null;
    let statement = 'UNKNOWN';
    try {
      const { getKisFinancials } = await import('../../clients/kisFinanceClient.js');
      kis = await getKisFinancials(symbol);
    }
    catch (error) { issues.push('KIS 조회 실패'); console.warn('[PaperFinancials] KIS', symbol, error instanceof Error ? error.message : String(error)); }
    try {
      const { fetchDartFinancialsForGate2 } = await import('../gate2/gate2ExternalDataProvider.js');
      const result = await fetchDartFinancialsForGate2({ symbol });
      dart = result.dartFin as unknown as Record<string, unknown> | null;
      statement = result.trace.statementType ?? 'UNKNOWN';
      if (!dart) issues.push(result.trace.dartErrorCode ?? 'DART 재무 미확인');
    } catch (error) { issues.push('DART 조회 실패'); console.warn('[PaperFinancials] DART', symbol, error instanceof Error ? error.message : String(error)); }
    if (!kis) issues.push('KIS 재무 미확인');
    const observedAt = new Date().toISOString();
    cache.records[symbol] = { attemptedAt: observedAt, facts: normalizePaperFinancials(symbol, observedAt, kis, dart, statement, issues) };
    savePaperFinancialCache(cache);
  }
}

/** Freeze a read-only cache copy before refresh starts. New facts enter the NEXT source snapshot. */
export function capturePaperFinancials(symbols: string[], asOf = new Date().toISOString()): Map<string, PaperFinancialFacts> {
  try {
    const cache = loadPaperFinancialCache();
    const rows = new Map<string, PaperFinancialFacts>();
    for (const symbol of symbols) {
      const facts = cache.records[symbol]?.facts;
      const age = Date.parse(asOf) - Date.parse(facts?.observedAt ?? '');
      if (facts && age >= 0 && age <= 2 * DAY) {
        const copy = structuredClone(facts);
        if (copy.kis && copy.kis.incomeField !== 'bsop_prti') copy.kis.operatingMargin = null;
        rows.set(symbol, copy);
      }
    }
    if (!refreshing) refreshing = refreshPaperFinancialBatch(symbols, cache)
      .catch(error => console.warn('[PaperFinancials] refresh failed:', error instanceof Error ? error.message : String(error)))
      .finally(() => { refreshing = undefined; });
    return rows;
  } catch (error) {
    console.warn('[PaperFinancials] cache unavailable; baseline continues:', error instanceof Error ? error.message : String(error));
    return new Map();
  }
}
