// @responsibility ADR-0543 shortSelling KIS L1 프록시 fallback 회귀 — 폴백 우선순위·byte-equivalent·069500→005930 재시도.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fetchKrxShortSelling } from './marketDataRefresh.js';
import { setKisClientOverrides } from '../clients/kisClient.js';
import type { KisDailyShortSale } from '../clients/kisClient/types.js';

const SOURCE_PATH = path.join(process.cwd(), 'server/trading/marketDataRefresh.ts');
// ADR-0595 분해: 공매도 폴백 체인은 marketDataRefresh/supplyCreditSections.ts 로 이동 —
// 본문 + 서브모듈을 함께 grep (ADR-0444 static-grep-guard 패턴).
const SUPPLY_PATH = path.join(process.cwd(), 'server/trading/marketDataRefresh/supplyCreditSections.ts');
const PROXY_PATH = path.join(process.cwd(), 'server/trading/shortSellingKisProxy.ts');

/** KRX 두 경로(fetch)를 강제 실패시켜 KIS 폴백 분기로 진입하게 한다. */
function stubKrxFetchFailing(): void {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('network blocked in test');
  }));
}

function makeDailyShort(code: string, ratio: number | undefined): KisDailyShortSale {
  return {
    stockCode: code,
    tradingDate: '2026-05-28',
    ...(ratio !== undefined ? { shortSaleRatio: ratio } : {}),
    source: 'KIS_API',
    fetchedAt: new Date().toISOString(),
  } as KisDailyShortSale;
}

describe('ADR-0543 — fetchKrxShortSelling KIS L1 프록시 fallback', () => {
  const ENV_KEY = 'SHORT_SELLING_KIS_PROXY_FALLBACK';
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env[ENV_KEY];
    stubKrxFetchFailing();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setKisClientOverrides({});
    if (prevEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prevEnv;
  });

  it('폴백 우선순위: KRX 둘 다 실패 + ENV ON → KIS_PROXY 호출, source=KIS_PROXY', async () => {
    process.env[ENV_KEY] = 'true';
    const calls: string[] = [];
    setKisClientOverrides({
      fetchKisDailyShortSale: async (code: string) => {
        calls.push(code);
        return makeDailyShort(code, 4.2);
      },
    });

    const result = await fetchKrxShortSelling();
    expect(result).not.toBeNull();
    expect(result?.source).toBe('KIS_PROXY');
    expect(result?.ratio).toBe(4.2);
    // 069500 가 정상 반환하면 005930 재시도는 일어나지 않는다.
    expect(calls).toEqual(['069500']);
  });

  it('069500 null/미반환 → 005930 재시도 검증', async () => {
    process.env[ENV_KEY] = 'true';
    const calls: string[] = [];
    setKisClientOverrides({
      fetchKisDailyShortSale: async (code: string) => {
        calls.push(code);
        if (code === '069500') return makeDailyShort(code, undefined); // ratio 미반환
        return makeDailyShort(code, 6.7); // 005930 성공
      },
    });

    const result = await fetchKrxShortSelling();
    expect(result?.source).toBe('KIS_PROXY');
    expect(result?.ratio).toBe(6.7);
    expect(calls).toEqual(['069500', '005930']);
  });

  it('byte-equivalent: ENV OFF → fetchKisDailyShortSale 미호출, KIS_PROXY 미반환', async () => {
    process.env[ENV_KEY] = 'false';
    const calls: string[] = [];
    setKisClientOverrides({
      fetchKisDailyShortSale: async (code: string) => {
        calls.push(code);
        return makeDailyShort(code, 4.2);
      },
    });

    const result = await fetchKrxShortSelling();
    // KIS_PROXY 미실행 → KIS_ESTIMATE(ranking) 도 테스트 환경에서 null → 전체 null (carryForward)
    expect(result?.source).not.toBe('KIS_PROXY');
    expect(calls).toEqual([]);
  });

  it('069500·005930 모두 비반환 → KIS_PROXY null (다음 폴백으로 진행)', async () => {
    process.env[ENV_KEY] = 'true';
    setKisClientOverrides({
      fetchKisDailyShortSale: async (code: string) => makeDailyShort(code, undefined),
    });
    const result = await fetchKrxShortSelling();
    // KIS_PROXY null → KIS_ESTIMATE(ranking) 도 미설정 → 전체 null
    expect(result?.source).not.toBe('KIS_PROXY');
  });
});

describe('ADR-0543 — 정적 가드 (소비측 L4 격리 + 폴백 배선)', () => {
  let source: string;
  let proxy: string;
  beforeEach(() => {
    source = fs.readFileSync(SUPPLY_PATH, 'utf-8') + fs.readFileSync(SOURCE_PATH, 'utf-8');
    proxy = fs.readFileSync(PROXY_PATH, 'utf-8');
  });

  it('KIS_PROXY 폴백이 ENV gate 뒤에 배선됨', () => {
    expect(source).toMatch(/SHORT_SELLING_KIS_PROXY_FALLBACK\s*===\s*'true'/);
    expect(source).toMatch(/tryKrxShortViaKisProxy/);
    expect(source).toMatch(/source:\s*'KIS_PROXY'/);
  });

  it('069500 → 005930 재시도 코드 배선 (shortSellingKisProxy)', () => {
    expect(proxy).toMatch(/069500/);
    expect(proxy).toMatch(/005930/);
  });

  it('KIS 호출은 kisClient 단일통로(fetchKisDailyShortSale) 경유 — raw KIS 직접 호출 0건', () => {
    expect(proxy).toMatch(/import\(['"]\.\.\/clients\/kisClient\.js['"]\)/);
    expect(proxy).toMatch(/fetchKisDailyShortSale/);
  });

  it('소비측 L4 가드: KIS_ESTIMATE/CACHE 는 R5 8% 임계 평가 제외 (불변식 #7)', () => {
    expect(source).toMatch(/L4_SOURCES/);
    expect(source).toMatch(/Math\.min\(shortResult\.ratio,\s*8\)/);
  });

  it('regimeBridge ?? 5 무변경 단서 — regime 산출 자체 무변경 주석', () => {
    expect(source).toMatch(/regime 산출 자체.*무변경|엔진 생존/);
  });
});
