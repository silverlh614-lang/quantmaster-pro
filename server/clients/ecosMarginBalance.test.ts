/**
 * @responsibility ecosClient.fetchLatestMarginBalance5dChange 회귀 테스트 — ADR-0139.
 *
 * 검증:
 *   - ECOS_API_KEY 미설정 / ECOS_API_DISABLED 분기
 *   - 표본 < 6 (5일 변화율 산출 불가) null
 *   - 정상 응답 → MarginBalance5dResult 정확
 *   - safePctChange null → null (sanity 위반 흡수)
 *   - throw → null 안전
 *   - 캐시 동작 (TTL 내 fetch 재호출 안 함)
 *   - ECOS TIME 'YYYYMMDD' → 'YYYY-MM-DD' 변환
 *   - ENV STAT_CODE/ITEM_CODE override
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;
const originalKey = process.env.ECOS_API_KEY;
const originalDisabled = process.env.ECOS_API_DISABLED;
const originalStatCode = process.env.ECOS_MARGIN_LOAN_STAT_CODE;
const originalItemCode = process.env.ECOS_MARGIN_LOAN_ITEM_CODE;

beforeEach(async () => {
  process.env.ECOS_API_KEY = 'test-key';
  delete process.env.ECOS_API_DISABLED;
  delete process.env.ECOS_MARGIN_LOAN_STAT_CODE;
  delete process.env.ECOS_MARGIN_LOAN_ITEM_CODE;
  vi.resetModules();
  const mod = await import('./ecosClient.js');
  mod.resetEcosCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ECOS_API_KEY;
  else process.env.ECOS_API_KEY = originalKey;
  if (originalDisabled === undefined) delete process.env.ECOS_API_DISABLED;
  else process.env.ECOS_API_DISABLED = originalDisabled;
  if (originalStatCode === undefined) delete process.env.ECOS_MARGIN_LOAN_STAT_CODE;
  else process.env.ECOS_MARGIN_LOAN_STAT_CODE = originalStatCode;
  if (originalItemCode === undefined) delete process.env.ECOS_MARGIN_LOAN_ITEM_CODE;
  else process.env.ECOS_MARGIN_LOAN_ITEM_CODE = originalItemCode;
});

/** ECOS API 응답 mock 빌더. rows 는 { TIME, DATA_VALUE } 객체 배열. */
function ecosMockResponse(rows: Array<{ TIME: string; DATA_VALUE: string }>) {
  return {
    ok: true,
    json: async () => ({
      StatisticSearch: {
        list_total_count: rows.length,
        row: rows,
      },
    }),
  };
}

describe('fetchLatestMarginBalance5dChange (ADR-0139)', () => {
  it('ECOS_API_KEY 미설정 시 null', async () => {
    delete process.env.ECOS_API_KEY;
    vi.resetModules();
    const { fetchLatestMarginBalance5dChange } = await import('./ecosClient.js');
    const result = await fetchLatestMarginBalance5dChange();
    expect(result).toBeNull();
  });

  it('ECOS_API_DISABLED=true 시 null', async () => {
    process.env.ECOS_API_DISABLED = 'true';
    vi.resetModules();
    const { fetchLatestMarginBalance5dChange } = await import('./ecosClient.js');
    const result = await fetchLatestMarginBalance5dChange();
    expect(result).toBeNull();
  });

  it('표본 < 6 시 null (5일 변화율 산출 불가)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(ecosMockResponse([
      { TIME: '20260420', DATA_VALUE: '1000000' },
      { TIME: '20260421', DATA_VALUE: '1010000' },
      { TIME: '20260422', DATA_VALUE: '1020000' },
    ])) as unknown as typeof fetch;
    const { fetchLatestMarginBalance5dChange } = await import('./ecosClient.js');
    const result = await fetchLatestMarginBalance5dChange();
    expect(result).toBeNull();
  });

  it('정상 응답 — 6개 표본 + 5일 변화율 정확', async () => {
    // 인덱스 [0]=과거 → [5]=최신. 5일 전(인덱스 0) 1,000,000 → 최신(인덱스 5) 1,050,000 = +5%.
    globalThis.fetch = vi.fn().mockResolvedValue(ecosMockResponse([
      { TIME: '20260420', DATA_VALUE: '1000000' },
      { TIME: '20260421', DATA_VALUE: '1010000' },
      { TIME: '20260422', DATA_VALUE: '1020000' },
      { TIME: '20260425', DATA_VALUE: '1030000' },
      { TIME: '20260426', DATA_VALUE: '1040000' },
      { TIME: '20260429', DATA_VALUE: '1050000' },
    ])) as unknown as typeof fetch;
    const { fetchLatestMarginBalance5dChange } = await import('./ecosClient.js');
    const result = await fetchLatestMarginBalance5dChange();
    expect(result).not.toBeNull();
    expect(result?.changePct).toBe(5);  // (1050000-1000000)/1000000*100
    expect(result?.latestDate).toBe('2026-04-29');
    expect(result?.source).toBe('ECOS_API');
    expect(result?.fetchedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('음수 변화율 보존 (신용잔고 감소)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(ecosMockResponse([
      { TIME: '20260420', DATA_VALUE: '1000000' },
      { TIME: '20260421', DATA_VALUE: '990000' },
      { TIME: '20260422', DATA_VALUE: '980000' },
      { TIME: '20260425', DATA_VALUE: '970000' },
      { TIME: '20260426', DATA_VALUE: '960000' },
      { TIME: '20260429', DATA_VALUE: '950000' },
    ])) as unknown as typeof fetch;
    const { fetchLatestMarginBalance5dChange } = await import('./ecosClient.js');
    const result = await fetchLatestMarginBalance5dChange();
    expect(result?.changePct).toBe(-5);
  });

  it('cur=0 또는 prev=0 시 null (sanity 보호)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(ecosMockResponse([
      { TIME: '20260420', DATA_VALUE: '0' },
      { TIME: '20260421', DATA_VALUE: '1000' },
      { TIME: '20260422', DATA_VALUE: '1000' },
      { TIME: '20260425', DATA_VALUE: '1000' },
      { TIME: '20260426', DATA_VALUE: '1000' },
      { TIME: '20260429', DATA_VALUE: '1000' },
    ])) as unknown as typeof fetch;
    const { fetchLatestMarginBalance5dChange } = await import('./ecosClient.js');
    const result = await fetchLatestMarginBalance5dChange();
    expect(result).toBeNull();  // prev=0 → null
  });

  it('잘못된 DATA_VALUE (NaN) 시 null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(ecosMockResponse([
      { TIME: '20260420', DATA_VALUE: 'invalid' },
      { TIME: '20260421', DATA_VALUE: '1000' },
      { TIME: '20260422', DATA_VALUE: '1000' },
      { TIME: '20260425', DATA_VALUE: '1000' },
      { TIME: '20260426', DATA_VALUE: '1000' },
      { TIME: '20260429', DATA_VALUE: '1000' },
    ])) as unknown as typeof fetch;
    const { fetchLatestMarginBalance5dChange } = await import('./ecosClient.js');
    const result = await fetchLatestMarginBalance5dChange();
    expect(result).toBeNull();
  });

  it('fetch throw → null 안전 흡수', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    const { fetchLatestMarginBalance5dChange } = await import('./ecosClient.js');
    const result = await fetchLatestMarginBalance5dChange();
    expect(result).toBeNull();
  });

  it('캐시 — 두 번째 호출 시 fetch 재호출 안 함 (TTL 10분)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(ecosMockResponse([
      { TIME: '20260420', DATA_VALUE: '1000000' },
      { TIME: '20260421', DATA_VALUE: '1010000' },
      { TIME: '20260422', DATA_VALUE: '1020000' },
      { TIME: '20260425', DATA_VALUE: '1030000' },
      { TIME: '20260426', DATA_VALUE: '1040000' },
      { TIME: '20260429', DATA_VALUE: '1050000' },
    ]));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { fetchLatestMarginBalance5dChange } = await import('./ecosClient.js');
    const r1 = await fetchLatestMarginBalance5dChange();
    const r2 = await fetchLatestMarginBalance5dChange();
    expect(r1).toEqual(r2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('ECOS TIME 8자리 미만 → 원본 그대로 (방어)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(ecosMockResponse([
      { TIME: '202604', DATA_VALUE: '1000000' },
      { TIME: '202605-01', DATA_VALUE: '1010000' },
      { TIME: '20260422', DATA_VALUE: '1020000' },
      { TIME: '20260425', DATA_VALUE: '1030000' },
      { TIME: '20260426', DATA_VALUE: '1040000' },
      { TIME: '202607', DATA_VALUE: '1050000' },
    ])) as unknown as typeof fetch;
    const { fetchLatestMarginBalance5dChange } = await import('./ecosClient.js');
    const result = await fetchLatestMarginBalance5dChange();
    // sort 결과 latest = '20260426' (8자리만 정렬 후 비교)
    // latestDate 변환은 8자리 일 때만 적용 — 비8자리는 원본 그대로
    expect(result).not.toBeNull();
  });

  it('ENV ECOS_MARGIN_LOAN_STAT_CODE override 적용', async () => {
    process.env.ECOS_MARGIN_LOAN_STAT_CODE = 'CUSTOM_CODE';
    process.env.ECOS_MARGIN_LOAN_ITEM_CODE = 'CUSTOM_ITEM';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue(ecosMockResponse([
      { TIME: '20260420', DATA_VALUE: '1000000' },
      { TIME: '20260421', DATA_VALUE: '1010000' },
      { TIME: '20260422', DATA_VALUE: '1020000' },
      { TIME: '20260425', DATA_VALUE: '1030000' },
      { TIME: '20260426', DATA_VALUE: '1040000' },
      { TIME: '20260429', DATA_VALUE: '1050000' },
    ]));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const mod = await import('./ecosClient.js');
    mod.resetEcosCache();
    await mod.fetchLatestMarginBalance5dChange();
    // URL 에 CUSTOM_CODE / CUSTOM_ITEM 포함 여부 확인
    const callArgs = fetchSpy.mock.calls[0]?.[0] as string;
    expect(callArgs).toContain('CUSTOM_CODE');
    expect(callArgs).toContain('CUSTOM_ITEM');
  });

  it('ECOS_STAT.MARGIN_LOAN default = 901Y014/A01', async () => {
    vi.resetModules();
    const { ECOS_STAT } = await import('./ecosClient.js');
    expect(ECOS_STAT.MARGIN_LOAN.code).toBe('901Y014');
    expect(ECOS_STAT.MARGIN_LOAN.item1).toBe('A01');
  });
});
