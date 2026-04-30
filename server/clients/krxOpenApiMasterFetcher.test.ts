/**
 * @responsibility krxOpenApiMasterFetcher 회귀 테스트 — KRX OpenAPI 응답 매핑 + 5 분기 결과
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./krxOpenApi.js', () => ({
  fetchKospiBaseInfo: vi.fn(),
  fetchKosdaqBaseInfo: vi.fn(),
  isKrxOpenApiHealthy: vi.fn(),
}));

import {
  mapBaseInfoToMaster,
  fetchMasterFromOpenApi,
} from './krxOpenApiMasterFetcher.js';
import {
  fetchKospiBaseInfo,
  fetchKosdaqBaseInfo,
  isKrxOpenApiHealthy,
  type KrxIsuBaseInfoRow,
} from './krxOpenApi.js';

const mFetchKospi = fetchKospiBaseInfo as unknown as ReturnType<typeof vi.fn>;
const mFetchKosdaq = fetchKosdaqBaseInfo as unknown as ReturnType<typeof vi.fn>;
const mHealthy = isKrxOpenApiHealthy as unknown as ReturnType<typeof vi.fn>;

function row(code: string, name: string, overrides: Partial<KrxIsuBaseInfoRow> = {}): KrxIsuBaseInfoRow {
  return {
    code,
    name,
    isin: `KR7${code}0009`,
    nameEng: '',
    listDate: '20100101',
    market: 'KOSPI',
    securityType: '주권',
    parValue: 5000,
    listedShares: 100_000_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mHealthy.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('mapBaseInfoToMaster', () => {
  it('정상 KrxIsuBaseInfoRow → StockMasterEntry 매핑 + market 라벨 부착', () => {
    const rows = [row('005930', '삼성전자'), row('000660', 'SK하이닉스')];
    const out = mapBaseInfoToMaster(rows, 'KOSPI');
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ code: '005930', name: '삼성전자', market: 'KOSPI' });
    expect(out[1]).toEqual({ code: '000660', name: 'SK하이닉스', market: 'KOSPI' });
  });

  it('6자리 코드 검증 — 5자리/7자리/문자 코드는 자동 제외', () => {
    const rows = [row('00593', 'X1'), row('0059300', 'X2'), row('A05930', 'X3'), row('005930', '삼성전자')];
    const out = mapBaseInfoToMaster(rows, 'KOSPI');
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('005930');
  });

  it('빈 name 또는 빈 code 자동 제외', () => {
    const rows = [row('005930', ''), row('', '삼성전자'), row('000660', 'SK하이닉스')];
    const out = mapBaseInfoToMaster(rows, 'KOSPI');
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('000660');
  });

  it('KOSDAQ market 라벨 정확 부착 (호출자가 결정)', () => {
    const out = mapBaseInfoToMaster([row('068270', '셀트리온')], 'KOSDAQ');
    expect(out[0].market).toBe('KOSDAQ');
  });

  it('중복 코드 dedup — 첫 entry 보존', () => {
    const rows = [row('005930', '삼성전자'), row('005930', '중복')];
    const out = mapBaseInfoToMaster(rows, 'KOSPI');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('삼성전자');
  });

  it('null/undefined row 안전 fallback', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = [null, undefined, row('005930', '삼성전자')];
    const out = mapBaseInfoToMaster(rows as KrxIsuBaseInfoRow[], 'KOSPI');
    expect(out).toHaveLength(1);
  });
});

describe('fetchMasterFromOpenApi — 5 분기', () => {
  it('AUTH_KEY 미설정/서킷 OPEN → ok=false reason=DISABLED + 호출 없음', async () => {
    mHealthy.mockReturnValue(false);
    const r = await fetchMasterFromOpenApi();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('DISABLED');
    expect(r.entries).toEqual([]);
    expect(mFetchKospi).not.toHaveBeenCalled();
    expect(mFetchKosdaq).not.toHaveBeenCalled();
  });

  it('KOSPI + KOSDAQ 정상 → ok=true + 합산 entries', async () => {
    mFetchKospi.mockResolvedValue([row('005930', '삼성전자'), row('000660', 'SK하이닉스')]);
    mFetchKosdaq.mockResolvedValue([row('068270', '셀트리온')]);
    const r = await fetchMasterFromOpenApi();
    expect(r.ok).toBe(true);
    expect(r.entries).toHaveLength(3);
    expect(r.kospiCount).toBe(2);
    expect(r.kosdaqCount).toBe(1);
    expect(r.entries.find((e) => e.code === '068270')?.market).toBe('KOSDAQ');
  });

  it('양쪽 모두 빈 응답 → ok=false reason=EMPTY_PARSE', async () => {
    mFetchKospi.mockResolvedValue([]);
    mFetchKosdaq.mockResolvedValue([]);
    const r = await fetchMasterFromOpenApi();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('EMPTY_PARSE');
    expect(r.entries).toEqual([]);
  });

  it('KOSPI 만 0건 → ok=false reason=KOSPI_EMPTY + KOSDAQ entries 보존', async () => {
    mFetchKospi.mockResolvedValue([]);
    mFetchKosdaq.mockResolvedValue([row('068270', '셀트리온')]);
    const r = await fetchMasterFromOpenApi();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('KOSPI_EMPTY');
    expect(r.entries).toHaveLength(1);
    expect(r.kosdaqCount).toBe(1);
    expect(r.kospiCount).toBe(0);
  });

  it('KOSDAQ 만 0건 → ok=false reason=KOSDAQ_EMPTY + KOSPI entries 보존', async () => {
    mFetchKospi.mockResolvedValue([row('005930', '삼성전자')]);
    mFetchKosdaq.mockResolvedValue([]);
    const r = await fetchMasterFromOpenApi();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('KOSDAQ_EMPTY');
    expect(r.entries).toHaveLength(1);
    expect(r.kospiCount).toBe(1);
    expect(r.kosdaqCount).toBe(0);
  });

  it('Promise.all 예외 → ok=false reason=EXCEPTION + detail 보존', async () => {
    mFetchKospi.mockRejectedValue(new Error('NETWORK_FAIL'));
    mFetchKosdaq.mockResolvedValue([]);
    const r = await fetchMasterFromOpenApi();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('EXCEPTION');
    expect(r.detail).toBe('NETWORK_FAIL');
  });

  it('KOSPI 와 KOSDAQ 동시 호출 (Promise.all) — 직렬화 안 함', async () => {
    let kospiResolved = false;
    let kosdaqResolved = false;
    mFetchKospi.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      kospiResolved = true;
      // KOSDAQ 가 시작은 됐어야 함 (병렬). resolve 순서는 보장되지 않으니 시작 여부만 확인.
      return [row('005930', '삼성전자')];
    });
    mFetchKosdaq.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      kosdaqResolved = true;
      return [row('068270', '셀트리온')];
    });
    const r = await fetchMasterFromOpenApi();
    expect(r.ok).toBe(true);
    expect(kospiResolved).toBe(true);
    expect(kosdaqResolved).toBe(true);
  });
});
