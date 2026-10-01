// @responsibility Collect completed KOSPI/KOSDAQ daily index closes from KIS for research benchmarks.
import type { ResearchInventory, ResearchSeries } from '../../../src/types/paperResearch.js';
import { fetchKisSectorIndexDaily } from '../../clients/kisClient.js';
import { isKrxTradingDay, previousKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';

// KIS 업종 상세코드: 0001 KOSPI 종합, 1001 KOSDAQ 종합. Symbols match the archived chart benchmarks.
const INDICES = [
  { iscd: '0001', symbol: '^KS11', market: 'KOSPI' },
  { iscd: '1001', symbol: '^KQ11', market: 'KOSDAQ' },
] as const;
const LOOKBACK_DAYS = 300;
// One request returns a bounded number of rows, so request short calendar windows.
const WINDOW_DAYS = 60;
const DAY_MS = 86_400_000;

let collected: { closedDate: string; series: ResearchSeries[]; inventory: ResearchInventory } | null = null;
let running: Promise<void> | null = null;

const yyyymmdd = (ms: number) => toKstDateKey(new Date(ms)).replace(/-/g, '');

function closedDateAt(now: Date): string {
  const date = toKstDateKey(now);
  return isKrxTradingDay(date) && now.getTime() >= Date.parse(`${date}T15:30:00+09:00`) ? date : previousKrxTradingDay(now);
}

type Fetch = typeof fetchKisSectorIndexDaily;

export async function collectPaperIndexSeries(now = new Date(), fetch: Fetch = fetchKisSectorIndexDaily) {
  const closedDate = closedDateAt(now);
  const asOf = now.toISOString();
  const series: ResearchSeries[] = [];
  const issues: string[] = [];
  for (const index of INDICES) {
    const bars = new Map<string, { date: string; close: number; open?: number; high?: number; low?: number }>();
    let unavailable = false;
    for (let end = now.getTime(); end > now.getTime() - LOOKBACK_DAYS * DAY_MS; end -= WINDOW_DAYS * DAY_MS) {
      const result = await fetch(index.iscd, yyyymmdd(end - (WINDOW_DAYS - 1) * DAY_MS), yyyymmdd(end), 'LOW');
      if (!result) { unavailable = true; break; }
      for (const row of result.series) {
        const date = row.baseDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
        // Only completed sessions; an intraday row is a moving value, not a close.
        if (date > closedDate || !isKrxTradingDay(date) || !Number.isFinite(row.close) || row.close <= 0) continue;
        const valid = (value: number) => Number.isFinite(value) && value > 0 ? value : undefined;
        bars.set(date, { date, close: row.close, open: valid(row.open), high: valid(row.high), low: valid(row.low) });
      }
    }
    if (unavailable) issues.push(`${index.symbol} 조회 불가`);
    if (!bars.size) continue;
    const closes = [...bars.values()].sort((a, b) => a.date.localeCompare(b.date))
      .map(bar => Object.fromEntries(Object.entries(bar).filter(([, value]) => value !== undefined)) as typeof bar);
    series.push({ id: `kis-index:${index.symbol}`, symbol: index.symbol, market: index.market,
      source: 'KIS_SNAPSHOT', retrievedAt: asOf, closes });
  }
  const records = series.reduce((sum, item) => sum + item.closes.length, 0);
  const inventory: ResearchInventory = { file: 'KIS 지수 일봉(KOSPI·KOSDAQ)', records,
    status: series.length === INDICES.length && !issues.length ? 'FOUND' : series.length ? 'ERROR' : 'MISSING',
    ...(issues.length ? { issue: `${issues.join(', ')} · KIS_SECTOR_INDEX_DAILY_ENABLED·KIS 인증 확인` } : {}) };
  return { closedDate, series, inventory };
}

/** Refreshes at most once per completed session; failures are retried on the next call. */
export function refreshPaperIndexSeries(now = new Date()): Promise<void> {
  if (collected?.closedDate === closedDateAt(now) && collected.inventory.status === 'FOUND') return Promise.resolve();
  if (!running) {
    running = collectPaperIndexSeries(now).then(result => { collected = result; })
      .catch(error => { console.error('[PaperIndex] 지수 일봉 수집 실패:', error instanceof Error ? error.message : String(error)); })
      .finally(() => { running = null; });
  }
  return running;
}

export function getPaperIndexSeries(): { series: ResearchSeries[]; inventory: ResearchInventory | null } {
  return { series: collected?.series ?? [], inventory: collected?.inventory ?? null };
}
