// @responsibility Refresh factual disclosure coverage independently of trading eligibility.
import { fetchListedDartDisclosures, type DartDisclosureRow } from '../../clients/dartDisclosureClient.js';
import { loadPaperDisclosures, savePaperDisclosures, type PaperDisclosureLedger } from '../../persistence/paperDisclosureRepo.js';
import { resolveStockCodeFromDart } from '../../persistence/dartCorpNameLookup.js';
import { loadDartAlerts, type DartAlert } from '../../persistence/dartRepo.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import type { PaperDisclosureStatus } from '../../../src/types/paperNewsFacts.js';
let lastAttempt = 0;
let pending: Promise<PaperDisclosureLedger> | null = null;
let lastResult: PaperDisclosureLedger | null = null;

export function mergePaperDisclosures(ledger: PaperDisclosureLedger, rows: DartDisclosureRow[], at: string, alerts: DartAlert[] = []): PaperDisclosureLedger {
  const records = new Map(ledger.records.map(item => [item.receiptNo, { ...item }]));
  for (const row of rows) {
    const previous = records.get(row.receiptNo);
    if (previous?.symbol || previous && previous.corpCode !== row.corpCode) continue;
    const resolved = resolveStockCodeFromDart({ dartStockCode: row.stockCode, corpName: row.corpName });
    const symbol = resolved.stockCode && resolved.stockCode !== '000000' ? resolved.stockCode : null;
    // Repeated receipts retain the first title/time; late symbol resolution becomes usable only now.
    const earlier = !previous && symbol ? alerts.filter(item => item.rcept_no === row.receiptNo && item.stock_code === symbol
      && item.report_nm === row.title && item.rcept_dt === row.filedDate.replace(/-/g, '')
      && Date.parse(item.alertedAt) >= Date.parse(`${row.filedDate}T00:00:00+09:00`)
      && Date.parse(item.alertedAt) <= Date.parse(row.firstSeenAt)).sort((a, b) => a.alertedAt.localeCompare(b.alertedAt))[0] : undefined;
    records.set(row.receiptNo, { ...(previous ?? row), ...(earlier ? { firstSeenAt: earlier.alertedAt } : {}), symbol,
      linkedAt: symbol ? earlier?.alertedAt ?? at : null, linkMethod: earlier ? 'LEGACY_RECORDED_CODE' : resolved.source });
  }
  const earliest = toKstDateKey(new Date(Date.parse(at) - 14 * 86_400_000));
  return { ...ledger, records: [...records.values()].filter(item => item.filedDate >= earliest) };
}

async function refresh(): Promise<PaperDisclosureLedger> {
  const now = new Date();
  const status: PaperDisclosureStatus = { state: 'UNAVAILABLE', checkedAt: now.toISOString(), lastSuccessAt: null,
    fromDate: toKstDateKey(new Date(now.getTime() - 72 * 3_600_000)), toDate: toKstDateKey(now),
    pages: 0, fetchedCount: 0, linkedCount: 0, unlinkedCount: 0, issue: null };
  let ledger: PaperDisclosureLedger;
  try { ledger = loadPaperDisclosures(); }
  catch {
    console.error('[PaperDisclosures] 공시 관측 원장 읽기 실패 · 원본 보존');
    return { schemaVersion: 1, records: [], status: { ...status, issue: '공시 관측 원장 읽기 실패' } };
  }
  if (now.getTime() >= lastAttempt && now.getTime() - lastAttempt < 300_000) return lastResult ?? ledger;
  lastAttempt = now.getTime();
  const response = await fetchListedDartDisclosures(status.fromDate, status.toDate);
  const checkedAt = new Date().toISOString();
  let alerts: DartAlert[] = [];
  try { alerts = loadDartAlerts(); } catch { /* New disclosure coverage remains independent of legacy alerts. */ }
  const next = mergePaperDisclosures(ledger, response.rows, checkedAt, alerts);
  const fetched = new Set(response.rows.map(row => row.receiptNo));
  const matching = next.records.filter(item => fetched.has(item.receiptNo));
  next.status = { ...status, checkedAt, lastSuccessAt: response.complete ? checkedAt : ledger.status?.lastSuccessAt ?? null,
    state: response.complete ? 'COMPLETE' : response.rows.length ? 'PARTIAL' : 'UNAVAILABLE', pages: response.pages,
    fetchedCount: response.rows.length, linkedCount: matching.filter(item => item.symbol).length,
    unlinkedCount: matching.filter(item => !item.symbol).length, issue: response.issue };
  try { savePaperDisclosures(next); }
  catch {
    console.error('[PaperDisclosures] 공시 관측 저장 실패 · 기존 기록 보존');
    return { ...ledger, status: { ...next.status, state: 'UNAVAILABLE', issue: '공시 관측 저장 실패', lastSuccessAt: ledger.status?.lastSuccessAt ?? null } };
  }
  if (!response.complete) console.warn(`[PaperDisclosures] ${response.issue}`);
  return next;
}
export function refreshPaperDisclosures(): Promise<PaperDisclosureLedger> {
  if (!pending) pending = refresh().catch(() => {
    console.error('[PaperDisclosures] 공시 갱신 실패 · 가격 관측 계속');
    const now = new Date();
    let previous: PaperDisclosureLedger = { schemaVersion: 1, records: [], status: null };
    try { previous = loadPaperDisclosures(); } catch { /* Preserve the unreadable original. */ }
    return { ...previous, status: { state: 'UNAVAILABLE' as const,
      checkedAt: now.toISOString(), lastSuccessAt: previous.status?.lastSuccessAt ?? null, fromDate: toKstDateKey(new Date(now.getTime() - 72 * 3_600_000)),
      toDate: toKstDateKey(now), pages: 0, fetchedCount: 0, linkedCount: 0, unlinkedCount: 0, issue: '공시 갱신 실패' } };
  }).then(result => { lastResult = result; return result; }).finally(() => { pending = null; });
  return pending;
}
