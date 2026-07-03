// @responsibility ADR-0661 회귀: 평가 경로 DART fetch 통일 flag·단위 계약(ocfRatio % vs ocfToNi 배수)·DART 배치 스로틀 테스트.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 영속 캐시(DATA_DIR) 격리 — 다른 테스트 파일 fork 와 data/gate2-external-cache.json 동시 rename 경합 방지.
// vi.hoisted 는 import(paths.ts DATA_DIR 평가) 이전에 실행되고, vitest fork 격리로 본 파일 프로세스에만 적용된다.
vi.hoisted(() => {
  process.env.PERSIST_DATA_DIR = `/tmp/qmp-adr0661-gate2-cache-${process.pid}`;
});

// ── 모듈 mock (module B fetchDartJson + 레거시 dartFinancialClient 공용 HTTP seam) ──
const dartHttp = vi.hoisted(() => ({
  queue: [] as Array<{ status: number; body: unknown }>,
  calls: [] as Array<{ url: string; at: number }>,
  legacyJson: null as null | ((url: string) => Promise<unknown>),
  legacyCalls: [] as string[],
}));

vi.mock('../../utils/fetchWithRetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/fetchWithRetry.js')>();
  return {
    ...actual,
    // 모듈 B(fetchDartJson) 경로 — 응답 큐 소진 후에는 HTTP 500 (graceful null 경로).
    fetchWithRetry: vi.fn(async (url: string) => {
      dartHttp.calls.push({ url, at: Date.now() });
      const next = dartHttp.queue.shift() ?? { status: 500, body: {} };
      return { status: next.status, json: async () => next.body } as unknown as Response;
    }),
    // 레거시 dartFinancialClient(getDartFinancials) 경로.
    fetchJsonWithRetry: vi.fn(async (url: string) => {
      dartHttp.legacyCalls.push(url);
      if (!dartHttp.legacyJson) throw new Error('legacy fetch not stubbed');
      return dartHttp.legacyJson(url);
    }),
  };
});

vi.mock('./dartCorpCodeMasterCache.js', () => ({
  ensureDartCorpCodeMasterCache: vi.fn(async () => {}),
  getDartCorpCodeCacheStatus: vi.fn(() => ({
    corpCodeCacheLoaded: true,
    corpCodeCacheCount: 1,
    loadedAt: '2026-07-03T00:00:00.000Z',
    lastHttpStatus: 200,
    lastError: null,
  })),
  resolveDartCorpCodeFromCache: vi.fn(() => ({ status: 'FOUND' as const, corpCode: '00126380' })),
}));

import {
  buildGate2ExternalProjection,
  buildMissingGate2FinancialSnapshot,
  fetchDartFinancialsForGate2,
  getGate2DartFinancialsForEvaluation,
  paceDartBatchRequest,
  projectionToQmpDartFinancials,
  resolveDartBatchMinIntervalMs,
} from './gate2ExternalDataProvider.js';
import { isGate2DartEvalUnifiedFetchEnabled } from './gate2DartEvalUnifiedFetchFlag.js';
import { getGate2ExternalCacheRecord, upsertGate2ExternalCacheRecords } from './gate2ExternalCache.js';
import type { Gate2DartEvaluationFinancials } from './gate2ExternalDataProvider/types.js';
import type { QmpDartFinancials } from '../../clients/dartFinancialNormalizer.js';
import { setKisClientOverrides } from '../../clients/kisClient/overrides.js';

/** DART fnlttSinglAcntAll rows — revenue 1000 · opIncome 120 · NI 100 · OCF 140 · 이자비용 20 → icr 6 · OCF/NI 1.4 · OCF/매출% 14. */
function dartRows(overrides?: { omitRevenue?: boolean }): Array<Record<string, string>> {
  const rows = [
    { account_id: 'ifrs-full_Revenue', thstrm_amount: '1000' },
    { account_id: 'dart_OperatingIncomeLoss', thstrm_amount: '120' },
    { account_id: 'ifrs-full_ProfitLoss', thstrm_amount: '100' },
    { account_id: 'ifrs-full_CashFlowsFromOperatingActivities', thstrm_amount: '140' },
    { account_id: 'ifrs-full_FinanceCosts', thstrm_amount: '20' },
    { account_id: 'ifrs-full_Equity', thstrm_amount: '500' },
    { account_id: 'ifrs-full_Assets', thstrm_amount: '900' },
  ];
  return overrides?.omitRevenue ? rows.filter(row => row.account_id !== 'ifrs-full_Revenue') : rows;
}

function okBody(list: unknown): { status: number; body: unknown } {
  return { status: 200, body: { status: '000', list } };
}

/** 영속 캐시 오염(직전 실행 잔존 VERIFIED 레코드) 차단 — 심볼을 MISSING 으로 리셋해 cache-miss 를 보장. */
function seedMissingCache(symbol: string): void {
  const projection = buildGate2ExternalProjection({
    symbol,
    financialSnapshot: buildMissingGate2FinancialSnapshot(symbol, 'DART_FINANCIALS_MISSING'),
  });
  upsertGate2ExternalCacheRecords([{ symbol, projection, updatedAt: projection.asOf }]);
}

beforeEach(() => {
  dartHttp.queue.length = 0;
  dartHttp.calls.length = 0;
  dartHttp.legacyCalls.length = 0;
  dartHttp.legacyJson = null;
  process.env.KIS_FINANCE_PRIMARY_ENABLED = 'false'; // default ON 승격(ADR-0532 Phase 4) — DART leg 격리
  process.env.DART_BATCH_MIN_INTERVAL_MS = '0'; // 테스트 기본: 페이싱 대기 0 (페이싱 테스트에서만 개별 설정)
  delete process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED;
  delete process.env.DART_API_KEY;
  delete process.env.OPENDART_API_KEY;
});

afterEach(() => {
  setKisClientOverrides({});
  delete process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED;
  delete process.env.KIS_FINANCE_PRIMARY_ENABLED;
  delete process.env.DART_BATCH_MIN_INTERVAL_MS;
  delete process.env.DART_API_KEY;
  delete process.env.OPENDART_API_KEY;
  delete process.env.KIS_APP_KEY;
  delete process.env.KIS_APP_SECRET;
});

describe('ADR-0661 flag SSOT (default OFF opt-in)', () => {
  it("미설정/false/임의값 → OFF, 정확히 'true' 만 ON (kisFinancePrimaryFlag !== 'false' 와 부호 방향 다름)", () => {
    delete process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED;
    expect(isGate2DartEvalUnifiedFetchEnabled()).toBe(false);
    process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED = 'false';
    expect(isGate2DartEvalUnifiedFetchEnabled()).toBe(false);
    process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED = '1';
    expect(isGate2DartEvalUnifiedFetchEnabled()).toBe(false);
    process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED = 'true';
    expect(isGate2DartEvalUnifiedFetchEnabled()).toBe(true);
  });
});

describe('ADR-0661 §1 flag OFF — 레거시 경로 byte-equivalent', () => {
  it('OFF + DART_API_KEY 부재 → null (모듈 B fetch 0회 · 레거시 fetch 0회)', async () => {
    seedMissingCache('066101');
    const fin = await getGate2DartFinancialsForEvaluation('066101');
    expect(fin).toBeNull();
    expect(dartHttp.calls.length).toBe(0); // 모듈 B(fetchDartFinancialsForGate2) 미사용
    expect(dartHttp.legacyCalls.length).toBe(0); // 레거시는 API 키 부재 시 fetch 전 null
  });

  it('OFF + DART_API_KEY 존재 → 레거시 4필드(%) 형상 그대로 반환 (icr/ocfToNi 미탑재 — 기존 결손 보존)', async () => {
    process.env.DART_API_KEY = 'legacy-key';
    seedMissingCache('066102');
    dartHttp.legacyJson = async (url: string) => {
      if (url.includes('company.json')) return { status: '000', corp_code: '00777777' };
      return {
        status: '000',
        list: [
          { account_id: 'ifrs-full_Revenue', thstrm_amount: '1,000' },
          { account_id: 'dart_OperatingIncomeLoss', thstrm_amount: '120' },
          { account_id: 'ifrs-full_ProfitLoss', thstrm_amount: '100' },
          { account_id: 'ifrs-full_Equity', thstrm_amount: '500' },
          { account_id: 'ifrs-full_Liabilities', thstrm_amount: '300' },
          { account_id: 'ifrs-full_CashFlowsFromOperatingActivities', thstrm_amount: '140' },
        ],
      };
    };

    const fin = await getGate2DartFinancialsForEvaluation('066102');
    expect(fin).toMatchObject({ source: 'DART_API' });
    const rec = fin as unknown as Record<string, unknown>;
    expect(rec.ocfRatio).toBeCloseTo(14); // 레거시 의미: OCF/매출 × 100 (%)
    expect(rec.interestCoverageRatio).toBeUndefined(); // 레거시 결손 그대로 (ICR 구조적 null 재현)
    expect(rec.ocfToNi).toBeUndefined();
    expect(dartHttp.calls.length).toBe(0); // 모듈 B 미사용 = byte-equivalent
    expect(dartHttp.legacyCalls.length).toBeGreaterThan(0);
  });

  it('OFF: projectionToQmpDartFinancials 는 현행 라인 byte-무변경 (ocfRatio=earningsQualityScore 배수 · ocfToNi 미탑재)', () => {
    const projection = buildGate2ExternalProjection({
      symbol: '066109',
      dartFin: {
        symbol: '066109', revenue: 1000, netIncome: 100, operatingCashFlow: 140, operatingIncome: 120,
        interestExpense: 20, ocfRatio: 1.4, interestCoverageRatio: 6,
        dataConfidence: 'VERIFIED', source: 'DART',
      } as unknown as Gate2DartEvaluationFinancials,
    });
    const reconstructed = projectionToQmpDartFinancials(projection);
    expect(reconstructed.ocfRatio).toBe(projection.metrics.earningsQualityScore); // 잠복 결함 포함 현행 그대로
    expect(Object.prototype.hasOwnProperty.call(reconstructed, 'ocfToNi')).toBe(false);
  });
});

describe('ADR-0661 §1 flag ON — 모듈 B 통일 + evaluator 경계 단위 어댑터', () => {
  it('ON: icr(배수)·ocfToNi(배수) 산출 + ocfRatio 는 OCF/매출(%) 동결 계약, 캐시 projection 반영 + 불변식 유지', async () => {
    process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED = 'true';
    process.env.DART_API_KEY = 'unified-key';
    seedMissingCache('066103');
    dartHttp.queue.push(okBody(dartRows()));

    const fin = await getGate2DartFinancialsForEvaluation('066103') as QmpDartFinancials | null;
    expect(fin).not.toBeNull();
    expect(fin?.interestCoverageRatio).toBe(6); // 영업이익 120 / 이자비용 20 (모듈 B normalizer 산출값)
    expect(fin?.ocfToNi).toBeCloseTo(1.4); // OCF 140 / NI 100 (배수 — 신규 분리 필드)
    expect(fin?.ocfRatio).toBeCloseTo(14); // OCF 140 / 매출 1000 × 100 (%) — evaluator 임계(>=5/>=1 %) 계약 동결
    expect(dartHttp.calls.length).toBe(1); // 첫 보고서 후보 성공 → 조기 중단 (기존 early-return)
    expect(dartHttp.legacyCalls.length).toBe(0); // 레거시 fetcher 미사용

    const record = getGate2ExternalCacheRecord('066103');
    expect(record?.projection?.metrics?.icr).toBe(6);
    expect(record?.projection?.metrics?.earningsQualityScore).toBeCloseTo(1.4); // ocfToNi-first (배수 스케일 유지)
    expect(record?.projection?.conditionResults?.icr?.status).toBe('PASS');
    expect(record?.projection?.conditionResults?.earnings_quality?.status).toBe('PASS');
    // 불변식: entry 하드차단 없음 · 상향 차단 상한 BLOCK_STRONG_BUY_UPGRADE · 실행영향 없음.
    expect(record?.projection?.entryHardBlockImpact).toBe('NO');
    expect(['NONE', 'BLOCK_STRONG_BUY_UPGRADE']).toContain(record?.projection?.highConvictionImpact);
    expect(record?.projection?.executionImpact).toBe('NONE');
    expect(record?.projection?.financialSnapshot?.marketSignal).toBe(false);
  });

  it('ON 단위 분리 회귀: 매출 결손 → ocfRatio=null (OCF/NI 배수 fallback 금지 — 스케일 붕괴 방지), ocfToNi 는 산출', async () => {
    process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED = 'true';
    process.env.DART_API_KEY = 'unified-key';
    seedMissingCache('066104');
    dartHttp.queue.push(okBody(dartRows({ omitRevenue: true })));

    const fin = await getGate2DartFinancialsForEvaluation('066104') as QmpDartFinancials | null;
    expect(fin).not.toBeNull();
    expect(fin?.ocfRatio).toBeNull(); // % 계약 결손 시 null — 배수 값으로 채우지 않는다
    expect(fin?.ocfToNi).toBeCloseTo(1.4);
    expect(fin?.interestCoverageRatio).toBe(6);
  });

  it('ON: DART 전면 실패 → graceful null (providerIssue=true · marketSignal=false — 불변식 6)', async () => {
    process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED = 'true';
    process.env.DART_API_KEY = 'unified-key';
    seedMissingCache('066105');
    // 큐 비움 → 모든 후보 HTTP 500 → dartFin null.

    const fin = await getGate2DartFinancialsForEvaluation('066105');
    expect(fin).toBeNull();
    expect(dartHttp.calls.length).toBeGreaterThan(0); // 모듈 B 시도는 했다 (unified 경로)

    // provider 장애의 snapshot 계약: providerIssue=true 이되 market signal 로 변환 금지.
    const missingProjection = buildGate2ExternalProjection({
      symbol: '066105',
      financialSnapshot: buildMissingGate2FinancialSnapshot('066105', 'DART_FINANCIALS_MISSING'),
    });
    expect(missingProjection.financialSnapshot.providerIssue).toBe(true);
    expect(missingProjection.financialSnapshot.marketSignal).toBe(false);
    expect(missingProjection.executionImpact).toBe('NONE');
    expect(missingProjection.entryHardBlockImpact).toBe('NO');
  });

  it('ON cache-hit 재구성 단위 정합: ocfRatio=OCF/매출% 재산출 · ocfToNi=배수 분리 (배수→% 오독 잠복 결함 봉인)', () => {
    process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED = 'true';
    const projection = buildGate2ExternalProjection({
      symbol: '066106',
      dartFin: {
        symbol: '066106', revenue: 1000, netIncome: 100, operatingCashFlow: 140, operatingIncome: 120,
        interestExpense: 20, ocfRatio: 1.4, ocfToNi: 1.4, interestCoverageRatio: 6,
        dataConfidence: 'VERIFIED', source: 'DART',
      } as unknown as Gate2DartEvaluationFinancials,
    });
    expect(projection.metrics.earningsQualityScore).toBeCloseTo(1.4); // 배수 (모듈 B 의미)

    const reconstructed = projectionToQmpDartFinancials(projection);
    expect(reconstructed.ocfRatio).toBeCloseTo(14); // % 로 재산출 — evaluator 가 배수를 % 임계로 오독하지 않는다
    expect(reconstructed.ocfToNi).toBeCloseTo(1.4); // 배수는 명시 필드로 분리 운반
    expect(reconstructed.interestCoverageRatio).toBe(6);
    expect(reconstructed.marketSignal).toBe(false);
  });

  it('ON + KIS primary: 레거시 캐시(statementType UNKNOWN) self-heal 재산출 + merge 에 icr/ocfToNi carry', async () => {
    process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED = 'true';
    process.env.KIS_FINANCE_PRIMARY_ENABLED = 'true';
    process.env.DART_API_KEY = 'unified-key';
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    // 레거시(DartFinancials 4필드) 로 빌드된 캐시 — statementType UNKNOWN + PER/kisFinance 보유(구 조건으로는 cache-hit).
    const legacyProjection = buildGate2ExternalProjection({
      symbol: '066107',
      dartFin: {
        roe: 9, opm: 8, debtRatio: 60, ocfRatio: 14, year: '2025', source: 'DART_API',
      } as unknown as Gate2DartEvaluationFinancials,
      per: 10,
      perSource: 'KIS',
      perReason: 'PER_ACCEPTABLE',
    });
    expect(legacyProjection.financialSnapshot.statementType).toBe('UNKNOWN');
    expect(legacyProjection.valuation.per.per).toBe(10);
    expect(legacyProjection.dartLineHealth.kisFinance).toBeTruthy();
    upsertGate2ExternalCacheRecords([{ symbol: '066107', projection: legacyProjection, updatedAt: legacyProjection.asOf }]);

    dartHttp.queue.push(okBody(dartRows()));
    setKisClientOverrides({
      realDataKisGet: async (trId: string) => {
        if (trId === 'FHKST66430300') return { output: [{ stac_yymm: '202412', roe_val: '18.0', lblt_rate: '40' }] };
        if (trId === 'FHKST66430200') return { output: [{ sale_account: '1000', op_prfi: '200', thtr_ntin: '150' }] };
        if (trId === 'FHKST01010100') return { output: { per: '12.0', stck_prpr: '60000', eps: '5000' } };
        return {};
      },
    });

    const fin = await getGate2DartFinancialsForEvaluation('066107') as QmpDartFinancials | null;
    expect(dartHttp.calls.length).toBeGreaterThan(0); // UNKNOWN 캐시 불신 → 모듈 B 재산출 (self-heal)
    expect(fin?.roe).toBeCloseTo(18); // KIS primary 축 무변경
    expect(fin?.interestCoverageRatio).toBe(6); // DART 잔여 축 머지 (기존 4줄 byte-무변경 경로)
    expect(fin?.ocfToNi).toBeCloseTo(1.4); // additive carry 1줄
    expect(fin?.ocfRatio).toBeCloseTo(14); // 어댑터 통과 % — merge :777 그대로 정합

    const record = getGate2ExternalCacheRecord('066107');
    expect(record?.projection?.financialSnapshot?.statementType).not.toBe('UNKNOWN'); // re-cache 후 재발 없음
    expect(record?.projection?.metrics?.icr).toBe(6);
    expect(record?.projection?.entryHardBlockImpact).toBe('NO');
  });

  it('OFF + KIS primary: 동일 레거시 캐시(statementType UNKNOWN)는 기존처럼 cache-hit (self-heal 단락 = byte-equivalent)', async () => {
    process.env.KIS_FINANCE_PRIMARY_ENABLED = 'true'; // unified 는 OFF (미설정)
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    const legacyProjection = buildGate2ExternalProjection({
      symbol: '066108',
      dartFin: {
        roe: 9, opm: 8, debtRatio: 60, ocfRatio: 14, year: '2025', source: 'DART_API',
      } as unknown as Gate2DartEvaluationFinancials,
      per: 10,
      perSource: 'KIS',
      perReason: 'PER_ACCEPTABLE',
    });
    expect(legacyProjection.financialSnapshot.statementType).toBe('UNKNOWN');
    upsertGate2ExternalCacheRecords([{ symbol: '066108', projection: legacyProjection, updatedAt: legacyProjection.asOf }]);

    let kisCalled = false;
    setKisClientOverrides({ realDataKisGet: async () => { kisCalled = true; return { output: {} }; } });

    const fin = await getGate2DartFinancialsForEvaluation('066108');
    expect(fin?.roe).toBeCloseTo(9); // 캐시 서빙 그대로
    expect(kisCalled).toBe(false); // 재산출 없음
    expect(dartHttp.calls.length).toBe(0); // 모듈 B 미사용
  });
});

describe('ADR-0661 §2 PR-B — DART 배치 스로틀 (판정 0줄)', () => {
  it('ENV DART_BATCH_MIN_INTERVAL_MS 클램프: 기본 300 · 0~2000 · 비수치 → 기본', () => {
    delete process.env.DART_BATCH_MIN_INTERVAL_MS; // 명시 인자 undefined 는 ENV default 로 폴백하므로 먼저 제거
    expect(resolveDartBatchMinIntervalMs(undefined)).toBe(300);
    expect(resolveDartBatchMinIntervalMs('')).toBe(300);
    expect(resolveDartBatchMinIntervalMs('abc')).toBe(300);
    expect(resolveDartBatchMinIntervalMs('120')).toBe(120);
    expect(resolveDartBatchMinIntervalMs('5000')).toBe(2000); // 상한 클램프
    expect(resolveDartBatchMinIntervalMs('-10')).toBe(0); // 하한 클램프 (0 = 페이싱 비활성)
  });

  it('페이서: 최소 간격 미경과 시 잔여분만 대기, 경과 시 대기 0 (주입 시계 결정적 검증)', async () => {
    const sleeps: number[] = [];
    let clock = Date.now() + 60_000; // 모듈 전역 lastRequestAt(과거 실측치)보다 항상 미래 → 첫 호출 대기 0
    const deps = {
      now: () => clock,
      sleep: async (ms: number) => { sleeps.push(ms); clock += ms; },
      minIntervalMs: 100,
    };
    const wait1 = await paceDartBatchRequest(deps);
    expect(wait1).toBe(0);
    const wait2 = await paceDartBatchRequest(deps); // 동일 시각 재요청 → 100ms 대기
    expect(wait2).toBe(100);
    clock += 250; // 간격 초과 경과 → 대기 0
    const wait3 = await paceDartBatchRequest(deps);
    expect(wait3).toBe(0);
    expect(sleeps).toEqual([100]);
    // 모듈 전역 lastRequestAt 이 주입 시계(미래 60s)로 오염되지 않도록 실측 now 로 리셋 (후속 테스트 hang 방지).
    await paceDartBatchRequest({ minIntervalMs: 0 });
  });

  it('fetchDartFinancialsForGate2 요청 간 최소 간격 준수 (실측 타임스탬프)', async () => {
    process.env.DART_BATCH_MIN_INTERVAL_MS = '60';
    // 1번째 응답: DART '013'(조회 데이터 없음) → 다음 후보 계속, 2번째 응답: 성공.
    dartHttp.queue.push({ status: 200, body: { status: '013', list: [] } });
    dartHttp.queue.push(okBody(dartRows()));

    const { dartFin } = await fetchDartFinancialsForGate2({ symbol: '066110', apiKey: 'k', skipCorpCodeMasterEnsure: true });
    expect(dartFin).not.toBeNull();
    expect((dartFin as QmpDartFinancials).interestCoverageRatio).toBe(6);
    expect(dartHttp.calls.length).toBe(2);
    expect(dartHttp.calls[1].at - dartHttp.calls[0].at).toBeGreaterThanOrEqual(55); // ~60ms 페이싱 (타이머 오차 여유)
  });

  it('429 재차 제한 → 백오프 1회 후 잔여 보고서 후보 조기 중단 (trace RATE_LIMITED 기록)', async () => {
    process.env.DART_BATCH_MIN_INTERVAL_MS = '10'; // 백오프 = 간격×4 = 40ms (테스트 신속)
    dartHttp.queue.push({ status: 429, body: {} });
    dartHttp.queue.push({ status: 429, body: {} });

    const { dartFin, trace } = await fetchDartFinancialsForGate2({ symbol: '066111', apiKey: 'k', skipCorpCodeMasterEnsure: true });
    expect(dartFin).toBeNull();
    expect(dartHttp.calls.length).toBe(2); // 최초 + 백오프 재시도 1회 — 잔여 후보(최대 6요청) 미시도
    expect(trace.dartErrorCode).toBe('RATE_LIMITED');
    expect(trace.dartHttpStatus).toBe(429);
  });

  it('429 → 백오프 1회 후 재시도 성공하면 정상 진행 (조기 중단 아님)', async () => {
    process.env.DART_BATCH_MIN_INTERVAL_MS = '10';
    dartHttp.queue.push({ status: 429, body: {} });
    dartHttp.queue.push(okBody(dartRows()));

    const { dartFin } = await fetchDartFinancialsForGate2({ symbol: '066112', apiKey: 'k', skipCorpCodeMasterEnsure: true });
    expect(dartFin).not.toBeNull();
    expect((dartFin as QmpDartFinancials).ocfToNi).toBeCloseTo(1.4); // normalizer additive 필드 (배치 경로 탑재)
    expect(dartHttp.calls.length).toBe(2);
  });

  it('DART status 020(사용한도 초과) 도 rate-limit 으로 감지·조기 중단', async () => {
    process.env.DART_BATCH_MIN_INTERVAL_MS = '10';
    dartHttp.queue.push({ status: 200, body: { status: '020', message: '사용한도를 초과하였습니다' } });
    dartHttp.queue.push({ status: 200, body: { status: '020', message: '사용한도를 초과하였습니다' } });

    const { dartFin, trace } = await fetchDartFinancialsForGate2({ symbol: '066113', apiKey: 'k', skipCorpCodeMasterEnsure: true });
    expect(dartFin).toBeNull();
    expect(dartHttp.calls.length).toBe(2);
    expect(trace.dartErrorCode).toBe('RATE_LIMITED');
  });
});
