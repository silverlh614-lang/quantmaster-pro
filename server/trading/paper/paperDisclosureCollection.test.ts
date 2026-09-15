// @responsibility Verify durable first-seen disclosure provenance through repeated scans.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperDisclosureLedger } from '../../persistence/paperDisclosureRepo.js';
import type { DartDisclosureRow } from '../../clients/dartDisclosureClient.js';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), load: vi.fn(), save: vi.fn(), resolve: vi.fn(), alerts: vi.fn() }));
vi.mock('../../persistence/dartRepo.js', () => ({ loadDartAlerts: mocks.alerts }));
vi.mock('../../clients/dartDisclosureClient.js', () => ({ fetchListedDartDisclosures: mocks.fetch }));
vi.mock('../../persistence/paperDisclosureRepo.js', () => ({ loadPaperDisclosures: mocks.load, savePaperDisclosures: mocks.save }));
vi.mock('../../persistence/dartCorpNameLookup.js', () => ({ resolveStockCodeFromDart: mocks.resolve }));
const at = '2026-09-15T23:00:00Z';
const input: DartDisclosureRow = { receiptNo: '20260915000001', corpCode: '00126380', corpName: '삼성전자', stockCode: '',
  market: 'Y', title: '단일판매ㆍ공급계약체결', filedDate: '2026-09-15', firstSeenAt: at };
let ledger: PaperDisclosureLedger;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(at));
  ledger = { schemaVersion: 1, records: [], status: null };
  mocks.load.mockImplementation(() => structuredClone(ledger));
  mocks.save.mockImplementation(value => { ledger = structuredClone(value); });
  mocks.resolve.mockReturnValue({ stockCode: '005930', source: 'NAME_KO_LOOKUP' });
  mocks.alerts.mockReturnValue([]);
  mocks.fetch.mockResolvedValue({ rows: [input], pages: 2, complete: true, issue: null });
});
afterEach(() => vi.useRealTimers());
describe('paper disclosure ingestion', () => {
  it('uses Korean dates, saves resolved codes and preserves first-seen values after refresh/restart', async () => {
    let api = await import('./paperDisclosureCollection.js');
    const first = await api.refreshPaperDisclosures();
    expect(mocks.fetch).toHaveBeenCalledWith('2026-09-13', '2026-09-16');
    expect(first.records[0]).toMatchObject({ symbol: '005930', firstSeenAt: at, linkedAt: '2026-09-15T23:00:00.000Z' });
    await api.refreshPaperDisclosures();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
    mocks.fetch.mockResolvedValue({ rows: [{ ...input, title: '나중에 변경된 제목', firstSeenAt: new Date().toISOString() }], pages: 2, complete: true, issue: null });
    vi.resetModules(); api = await import('./paperDisclosureCollection.js');
    const next = await api.refreshPaperDisclosures();
    expect(next.records[0]).toEqual(first.records[0]);
  });
  it('retains unresolved receipts and records the later time that a symbol becomes known', async () => {
    const api = await import('./paperDisclosureCollection.js');
    mocks.resolve.mockReturnValueOnce({ stockCode: null, source: 'AMBIGUOUS' });
    const first = await api.refreshPaperDisclosures();
    expect(first.status).toMatchObject({ unlinkedCount: 1, linkedCount: 0 });
    expect(first.records[0].symbol).toBeNull();
    vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
    const next = await api.refreshPaperDisclosures();
    expect(next.records[0]).toMatchObject({ firstSeenAt: at, linkedAt: '2026-09-16T00:00:00.000Z', symbol: '005930' });
  });
  it('preserves earlier durable observations only for the same receipt, issuer, title and filing date', async () => {
    mocks.alerts.mockReturnValue([{ rcept_no: input.receiptNo, stock_code: '005930', report_nm: input.title,
      rcept_dt: '20260915', alertedAt: '2026-09-15T07:00:00Z' }]);
    const api = await import('./paperDisclosureCollection.js');
    expect((await api.refreshPaperDisclosures()).records[0]).toMatchObject({ firstSeenAt: '2026-09-15T07:00:00Z',
      linkedAt: '2026-09-15T07:00:00Z', linkMethod: 'LEGACY_RECORDED_CODE' });
  });
  it('keeps unexpected failure status throughout the cache window with previous records', async () => {
    const api = await import('./paperDisclosureCollection.js');
    await api.refreshPaperDisclosures();
    vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
    mocks.fetch.mockRejectedValue(new Error('unexpected'));
    const failed = await api.refreshPaperDisclosures();
    expect(failed.records).toHaveLength(1);
    expect(failed.status?.state).toBe('UNAVAILABLE');
    expect(await api.refreshPaperDisclosures()).toEqual(failed);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps the last records when collection fails and exposes failure instead of no-news', async () => {
    const api = await import('./paperDisclosureCollection.js');
    await api.refreshPaperDisclosures();
    vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
    mocks.fetch.mockResolvedValue({ rows: [], pages: 0, complete: false, issue: 'DART 통신 실패' });
    const next = await api.refreshPaperDisclosures();
    expect(next.records).toHaveLength(1);
    expect(next.status).toMatchObject({ state: 'UNAVAILABLE', lastSuccessAt: '2026-09-15T23:00:00.000Z', issue: 'DART 통신 실패' });
  });
  it('does not overwrite a corrupt original or reject a price scan on unexpected errors', async () => {
    const api = await import('./paperDisclosureCollection.js');
    mocks.load.mockImplementationOnce(() => { throw new Error('corrupt'); });
    expect((await api.refreshPaperDisclosures()).status?.state).toBe('UNAVAILABLE');
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.fetch.mockRejectedValue(new Error('unexpected provider error'));
    expect((await api.refreshPaperDisclosures()).status?.state).toBe('UNAVAILABLE');
  });
});
