// @responsibility Verify complete listed-company disclosure pagination with explicit failures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchListedDartDisclosures } from './dartDisclosureClient.js';
const fetcher = vi.fn();
const row = (receipt: string, market = 'Y') => ({ rcept_no: receipt, corp_code: '00126380', corp_name: '삼성전자',
  stock_code: '005930', corp_cls: market, report_nm: '단일판매ㆍ공급계약체결', rcept_dt: '20260915' });
const ok = (list: unknown[], total_page = 1) => ({ ok: true, json: async () => ({ status: '000', total_page, list }) });
beforeEach(() => { vi.stubGlobal('fetch', fetcher); vi.stubEnv('DART_API_KEY', 'test-secret'); fetcher.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('OpenDART listed disclosure collection', () => {
  it('reads all pages for both markets with documented sorting and receipt deduplication', async () => {
    fetcher.mockResolvedValueOnce(ok([row('20260915000001')], 2))
      .mockResolvedValueOnce(ok([row('20260915000001'), row('20260915000002')], 2))
      .mockResolvedValueOnce(ok([row('20260915000003', 'K')]));
    const result = await fetchListedDartDisclosures('2026-09-13', '2026-09-16');
    expect(result).toMatchObject({ complete: true, pages: 3, issue: null });
    expect(result.rows).toHaveLength(3);
    const requests = fetcher.mock.calls.map(([url]) => new URL(url));
    expect(requests.map(url => [url.searchParams.get('corp_cls'), url.searchParams.get('page_no')])).toEqual([['Y', '1'], ['Y', '2'], ['K', '1']]);
    expect(requests.every(url => url.searchParams.get('sort') === 'date' && url.searchParams.get('page_count') === '100'
      && url.searchParams.get('last_reprt_at') === 'N' && url.searchParams.get('bgn_de') === '20260913')).toBe(true);
    expect(result.rows[0]).toMatchObject({ filedDate: '2026-09-15', stockCode: '005930' });
    expect(Number.isFinite(Date.parse(result.rows[0].firstSeenAt))).toBe(true);
  });
  it('preserves completed pages but reports a later provider failure', async () => {
    fetcher.mockResolvedValueOnce(ok([row('20260915000001')], 2))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: '100', message: 'secret test-secret' }) });
    expect(await fetchListedDartDisclosures('2026-09-13', '2026-09-16')).toMatchObject({ complete: false, pages: 2, rows: [expect.any(Object)], issue: 'DART 응답 오류 100' });
  });
  it('distinguishes no filings from bad credentials, malformed pages, or network failure', async () => {
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ status: '013' }) });
    expect(await fetchListedDartDisclosures('2026-09-15', '2026-09-16')).toMatchObject({ complete: true, rows: [], pages: 2 });
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ status: '000', list: [row('20260915000001')] }) });
    expect((await fetchListedDartDisclosures('2026-09-15', '2026-09-16')).issue).toBe('DART 페이지 정보 미확인');
    fetcher.mockRejectedValue(new Error('https://provider?crtfc_key=test-secret'));
    const result = await fetchListedDartDisclosures('2026-09-15', '2026-09-16');
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });
  it('excludes future, unlisted or malformed rows without claiming full coverage', async () => {
    fetcher.mockResolvedValueOnce(ok([row('20260915000001'), { ...row('20260915000002'), corp_cls: 'E' },
      { ...row('20260915000003'), rcept_dt: '20260917' }, { ...row('bad'), corp_code: '' }]))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: '013' }) });
    const result = await fetchListedDartDisclosures('2026-09-15', '2026-09-16');
    expect(result).toMatchObject({ complete: false, issue: '공시 필수 정보 미확인 3건' });
    expect(result.rows).toHaveLength(1);
  });
  it('bounds collection time and does not query invalid dates or an absent key', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
    fetcher.mockImplementation(async () => { vi.setSystemTime(new Date('2026-09-16T00:00:21Z')); return ok([row('20260915000001')], 2); });
    expect((await fetchListedDartDisclosures('2026-09-15', '2026-09-16')).issue).toContain('일부 페이지 미확인');
    fetcher.mockClear();
    await fetchListedDartDisclosures('2026-02-30', '2026-09-16');
    vi.stubEnv('DART_API_KEY', '');
    await fetchListedDartDisclosures('2026-09-15', '2026-09-16');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
