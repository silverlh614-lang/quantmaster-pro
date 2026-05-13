// @responsibility Patch-006 regression — KRX aggregate consumer + 3-tier CACHE TTL + intraday session + V2 router + static grep invariants.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  routeProgramMarketEmptyWithKrxAggregate,
  classifyCacheTtl,
  aggregateToMeta,
  formatProgramMarketRoutedV2,
  formatProgramMarketRoutedV2Compact,
  isPatch006Disabled,
  PATCH_006_IDENTIFIER,
  PATCH_006_CACHE_FRESH_MS,
  PATCH_006_CACHE_SHADOW_MS,
  PROGRAM_MARKET_CODE_MAPPING,
  PATCH_006_PROVIDER_COVERAGE,
} from './programMarketRouterPatch006.js';
import type { KrxMarketProgramAggregate, KrxMarketProgramRow } from './programTradeFetcher.js';
import {
  KRX_MARKET_PROGRAM_CODE_MAP,
  isKstIntradaySession,
} from './programTradeFetcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(__dirname, 'programMarketRouterPatch006.ts');
const FETCHER_PATH = resolve(__dirname, 'programTradeFetcher.ts');
const SUPPLY_HEALTH_PATH = resolve(__dirname, '..', '..', 'telegram', 'commands', 'system', 'supplyHealth.cmd.ts');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');
const FETCHER_SOURCE = readFileSync(FETCHER_PATH, 'utf8');
const SUPPLY_HEALTH_SOURCE = readFileSync(SUPPLY_HEALTH_PATH, 'utf8');

// 사용자 명시: 비-intraday + 비-주말 시각 (KST 토요일 새벽 03:00 = UTC 금요일 18:00)
const NON_INTRADAY_NOW_MS = Date.parse('2026-05-09T18:00:00Z'); // KST 토요일 03:00
// KST 평일 정오 (UTC 03:00) — intraday session
const INTRADAY_NOW_MS = Date.parse('2026-05-12T03:00:00Z'); // KST 화요일 12:00

function makeRow(market: 'KOSPI' | 'KOSDAQ', netBuy: number): KrxMarketProgramRow {
  return {
    market,
    programNetBuyAmount: netBuy,
    programBuyAmount: netBuy + 100,
    programSellAmount: 100,
    arbitrageNetBuy: netBuy * 0.2,
    nonArbitrageNetBuy: netBuy * 0.8,
  };
}

describe('Patch-006 ENV gate', () => {
  const orig = process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED;
  afterEach(() => {
    if (orig === undefined) delete process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED;
    else process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED = orig;
  });

  it('default OFF', () => {
    delete process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED;
    expect(isPatch006Disabled()).toBe(false);
  });
  it('=true → disabled', () => {
    process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED = 'true';
    expect(isPatch006Disabled()).toBe(true);
  });
  it('"1"/"TRUE"/"yes" 모두 거부 (ADR-0157 정확 비교)', () => {
    for (const v of ['1', 'TRUE', 'yes', 'on', '']) {
      process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED = v;
      expect(isPatch006Disabled()).toBe(false);
    }
  });
});

describe('Patch-006 SSOT 정합', () => {
  it('PATCH_006_IDENTIFIER 정확 명시', () => {
    expect(PATCH_006_IDENTIFIER).toBe('Patch-MARKET-PROGRAM-TRADING-FALLBACK-RECOVERY-006');
  });
  it('PATCH_006_CACHE_FRESH_MS = 5min (절대 변경 금지)', () => {
    expect(PATCH_006_CACHE_FRESH_MS).toBe(5 * 60 * 1000);
  });
  it('PATCH_006_CACHE_SHADOW_MS = 30min (절대 변경 금지)', () => {
    expect(PATCH_006_CACHE_SHADOW_MS).toBe(30 * 60 * 1000);
  });
  it('PROGRAM_MARKET_CODE_MAPPING — 사용자 §5: KOSPI/KOSDAQ/ALL 3 entry', () => {
    expect(PROGRAM_MARKET_CODE_MAPPING).toHaveLength(3);
    const kospi = PROGRAM_MARKET_CODE_MAPPING.find((m) => m.market === 'KOSPI');
    expect(kospi?.kisCode).toBe('0001');
    expect(kospi?.krxCode).toBe('STK');
    const kosdaq = PROGRAM_MARKET_CODE_MAPPING.find((m) => m.market === 'KOSDAQ');
    expect(kosdaq?.kisCode).toBe('1001');
    expect(kosdaq?.krxCode).toBe('KSQ');
  });
  it('KRX_MARKET_PROGRAM_CODE_MAP frozen + 정확 매핑', () => {
    expect(KRX_MARKET_PROGRAM_CODE_MAP.KOSPI).toBe('STK');
    expect(KRX_MARKET_PROGRAM_CODE_MAP.KOSDAQ).toBe('KSQ');
    expect(KRX_MARKET_PROGRAM_CODE_MAP.ALL).toBe('ALL');
    expect(Object.isFrozen(KRX_MARKET_PROGRAM_CODE_MAP)).toBe(true);
  });
  it('PATCH_006_PROVIDER_COVERAGE = Patch-004 PROVIDER_COVERAGE re-export', () => {
    expect(PATCH_006_PROVIDER_COVERAGE.KIS_API.supportsProgramTrading).toBe(true);
    expect(PATCH_006_PROVIDER_COVERAGE.KRX_API.supportsProgramTrading).toBe(true);
    expect(PATCH_006_PROVIDER_COVERAGE.CACHE.supportsLastGoodValue).toBe(true);
  });
});

describe('Patch-006 isKstIntradaySession', () => {
  it('KST 평일 12:00 → intraday=true', () => {
    expect(isKstIntradaySession(INTRADAY_NOW_MS)).toBe(true);
  });
  it('KST 토요일 03:00 → intraday=false (주말)', () => {
    expect(isKstIntradaySession(NON_INTRADAY_NOW_MS)).toBe(false);
  });
  it('KST 평일 08:00 → intraday=false (장전)', () => {
    const t = Date.parse('2026-05-12T23:00:00Z'); // KST 수요일 08:00
    expect(isKstIntradaySession(t)).toBe(false);
  });
  it('KST 평일 16:00 → intraday=false (장후)', () => {
    const t = Date.parse('2026-05-12T07:00:00Z'); // KST 화요일 16:00
    expect(isKstIntradaySession(t)).toBe(false);
  });
});

describe('Patch-006 classifyCacheTtl (3-tier)', () => {
  it('cache 부재 → null', () => {
    expect(classifyCacheTtl(undefined)).toBeNull();
    expect(classifyCacheTtl({ available: false })).toBeNull();
  });
  it('age ≤ 5min → FRESH (STALE_CACHE_BUT_USABLE_FOR_DIAG)', () => {
    const r = classifyCacheTtl({ available: true, programNetBuyAmount: 100, ageMs: 4 * 60 * 1000 });
    expect(r?.tier).toBe('FRESH');
    expect(r?.routedStatus).toBe('STALE_CACHE_BUT_USABLE_FOR_DIAG');
    expect(r?.scoring).toBe('shadow_only_or_excluded');
  });
  it('age 5min boundary → FRESH', () => {
    const r = classifyCacheTtl({ available: true, programNetBuyAmount: 100, ageMs: 5 * 60 * 1000 });
    expect(r?.tier).toBe('FRESH');
  });
  it('age 5~30min → SHADOW_ONLY', () => {
    const r = classifyCacheTtl({ available: true, programNetBuyAmount: 100, ageMs: 15 * 60 * 1000 });
    expect(r?.tier).toBe('SHADOW_ONLY');
    expect(r?.routedStatus).toBe('STALE_CACHE_SHADOW_ONLY');
  });
  it('age 30min boundary → SHADOW_ONLY', () => {
    const r = classifyCacheTtl({ available: true, programNetBuyAmount: 100, ageMs: 30 * 60 * 1000 });
    expect(r?.tier).toBe('SHADOW_ONLY');
  });
  it('age > 30min → EXPIRED', () => {
    const r = classifyCacheTtl({ available: true, programNetBuyAmount: 100, ageMs: 45 * 60 * 1000 });
    expect(r?.tier).toBe('EXPIRED');
    expect(r?.routedStatus).toBe('CACHE_EXPIRED');
    expect(r?.scoring).toBe('excluded');
  });
  it('NaN ageMs → null', () => {
    expect(classifyCacheTtl({ available: true, programNetBuyAmount: 100, ageMs: NaN })).toBeNull();
  });
  it('음수 ageMs → 0 floor', () => {
    const r = classifyCacheTtl({ available: true, programNetBuyAmount: 100, ageMs: -1000 });
    expect(r?.ageMs).toBe(0);
    expect(r?.tier).toBe('FRESH');
  });
});

describe('Patch-006 aggregateToMeta', () => {
  it('null → null', () => {
    expect(aggregateToMeta(null)).toBeNull();
  });
  it('VERIFIED aggregate → meta 정확 변환', () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: makeRow('KOSPI', 500),
      kosdaq: makeRow('KOSDAQ', 200),
      totalProgramNet: 700,
      arbitrageNet: 140,
      nonArbitrageNet: 560,
      timestamp: '2026-05-09T03:00:00Z',
      confidence: 'VERIFIED',
      fetchedAt: '2026-05-09T03:00:00Z',
      endpoint: 'dbms/MDC/STAT/standard/MDCSTAT01701',
      bld: 'dbms/MDC/STAT/standard/MDCSTAT01701',
      marketsAttempted: ['KOSPI', 'KOSDAQ'],
      marketsSucceeded: ['KOSPI', 'KOSDAQ'],
    };
    const meta = aggregateToMeta(agg);
    expect(meta?.kospiProgramNet).toBe(500);
    expect(meta?.kosdaqProgramNet).toBe(200);
    expect(meta?.totalProgramNet).toBe(700);
    expect(meta?.arbitrageNet).toBe(140);
    expect(meta?.confidence).toBe('VERIFIED');
    expect(meta?.marketsSucceeded).toEqual(['KOSPI', 'KOSDAQ']);
  });
  it('PARTIAL aggregate → meta 정확 변환', () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: makeRow('KOSPI', 500),
      kosdaq: null,
      totalProgramNet: 500,
      arbitrageNet: 100,
      nonArbitrageNet: 400,
      timestamp: '2026-05-09T03:00:00Z',
      confidence: 'PARTIAL',
      fetchedAt: '2026-05-09T03:00:00Z',
      endpoint: 'dbms/MDC/STAT/standard/MDCSTAT01701',
      bld: 'dbms/MDC/STAT/standard/MDCSTAT01701',
      marketsAttempted: ['KOSPI', 'KOSDAQ'],
      marketsSucceeded: ['KOSPI'],
    };
    const meta = aggregateToMeta(agg);
    expect(meta?.confidence).toBe('PARTIAL');
    expect(meta?.kosdaqProgramNet).toBeNull();
    expect(meta?.marketsSucceeded).toEqual(['KOSPI']);
  });
});

describe('Patch-006 routeProgramMarketEmptyWithKrxAggregate', () => {
  const orig006 = process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED;
  const origKrx = process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED;
  beforeEach(() => {
    delete process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED;
    delete process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED;
  });
  afterEach(() => {
    if (orig006 === undefined) delete process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED;
    else process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED = orig006;
    if (origKrx === undefined) delete process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED;
    else process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED = origKrx;
  });

  it('사용자 §J #1: KIS ACCEPTED_EMPTY + KRX VERIFIED → routedStatus=VERIFIED + source=KRX_API + scoring=allowed_when_non_empty', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: makeRow('KOSPI', 500), kosdaq: makeRow('KOSDAQ', 200),
      totalProgramNet: 700, arbitrageNet: 140, nonArbitrageNet: 560,
      timestamp: 'x', confidence: 'VERIFIED', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: ['KOSPI', 'KOSDAQ'],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0, marketCode: '0001' } },
      { fetchKrx: async () => agg, nowMs: NON_INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('VERIFIED');
    expect(decision.source).toBe('KRX_API');
    expect(decision.scoring).toBe('allowed_when_non_empty');
    expect(decision.fallbackResult).toBe('KRX_OK');
    expect(decision.displayCase).toBe('A_KRX_RECOVERED');
    expect(decision.krxAttempted).toBe(true);
    expect(decision.krxAggregate?.confidence).toBe('VERIFIED');
    expect(decision.krxAggregate?.totalProgramNet).toBe(700);
    expect(decision.providerIssue).toBe(false);
    expect(decision.marketSignal).toBe(false);
    expect(decision.executionImpact).toBe('NONE');
    expect(decision.liveExecutionAllowed).toBe(false);
    expect(decision.patch006Activated).toBe(true);
  });

  it('사용자 §J #2: KIS ACCEPTED_EMPTY + KRX PARTIAL (KOSPI 만) → routedStatus=PARTIAL_VERIFIED + scoring=shadow_only_or_excluded', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: makeRow('KOSPI', 500), kosdaq: null,
      totalProgramNet: 500, arbitrageNet: 100, nonArbitrageNet: 400,
      timestamp: 'x', confidence: 'PARTIAL', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: ['KOSPI'],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0, marketCode: '0001' } },
      { fetchKrx: async () => agg, nowMs: NON_INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('PARTIAL_VERIFIED');
    expect(decision.source).toBe('KRX_API');
    expect(decision.scoring).toBe('shadow_only_or_excluded');
    expect(decision.displayCase).toBe('G_PARTIAL_VERIFIED');
    expect(decision.krxAggregate?.confidence).toBe('PARTIAL');
    expect(decision.krxAggregate?.marketsSucceeded).toEqual(['KOSPI']);
  });

  it('사용자 §J #3: KIS ACCEPTED_EMPTY + KRX EMPTY + intraday session → routedStatus=UNSUPPORTED_INTRADAY', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: null, kosdaq: null,
      totalProgramNet: null, arbitrageNet: null, nonArbitrageNet: null,
      timestamp: 'x', confidence: 'EMPTY', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: [],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0, marketCode: '0001' } },
      { fetchKrx: async () => agg, nowMs: INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('UNSUPPORTED_INTRADAY');
    expect(decision.source).toBe('NONE');
    expect(decision.scoring).toBe('excluded');
    expect(decision.displayCase).toBe('C_UNSUPPORTED_INTRADAY');
    expect(decision.isIntradaySession).toBe(true);
    expect(decision.fallbackResult).toBe('KRX_EMPTY');
  });

  it('사용자 §J #4: KIS ACCEPTED_EMPTY + KRX EMPTY + 비-intraday + CACHE FRESH (3min) → STALE_CACHE_BUT_USABLE_FOR_DIAG', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: null, kosdaq: null,
      totalProgramNet: null, arbitrageNet: null, nonArbitrageNet: null,
      timestamp: 'x', confidence: 'EMPTY', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: [],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      {
        rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0, marketCode: '0001' },
        cacheFallback: { available: true, programNetBuyAmount: 600, ageMs: 3 * 60 * 1000 },
      },
      { fetchKrx: async () => agg, nowMs: NON_INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('STALE_CACHE_BUT_USABLE_FOR_DIAG');
    expect(decision.source).toBe('CACHE');
    expect(decision.scoring).toBe('shadow_only_or_excluded');
    expect(decision.displayCase).toBe('E_CACHE_USABLE');
    expect(decision.cacheTtl?.tier).toBe('FRESH');
    expect(decision.cacheTtl?.ageMs).toBe(3 * 60 * 1000);
  });

  it('사용자 §J #5: CACHE 15min → STALE_CACHE_SHADOW_ONLY', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: null, kosdaq: null, totalProgramNet: null, arbitrageNet: null, nonArbitrageNet: null,
      timestamp: 'x', confidence: 'EMPTY', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: [],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      {
        rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 },
        cacheFallback: { available: true, programNetBuyAmount: 600, ageMs: 15 * 60 * 1000 },
      },
      { fetchKrx: async () => agg, nowMs: NON_INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('STALE_CACHE_SHADOW_ONLY');
    expect(decision.source).toBe('CACHE');
    expect(decision.cacheTtl?.tier).toBe('SHADOW_ONLY');
    expect(decision.displayCase).toBe('F_CACHE_SHADOW_ONLY');
  });

  it('사용자 §J #6: CACHE 45min → CACHE_EXPIRED + scoring=excluded', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: null, kosdaq: null, totalProgramNet: null, arbitrageNet: null, nonArbitrageNet: null,
      timestamp: 'x', confidence: 'EMPTY', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: [],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      {
        rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 },
        cacheFallback: { available: true, programNetBuyAmount: 600, ageMs: 45 * 60 * 1000 },
      },
      { fetchKrx: async () => agg, nowMs: NON_INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('CACHE_EXPIRED');
    expect(decision.source).toBe('NONE');
    expect(decision.scoring).toBe('excluded');
    expect(decision.cacheTtl?.tier).toBe('EXPIRED');
  });

  it('사용자 §J #7: 모든 fallback 실패 (KRX EMPTY + CACHE 부재) + 비-intraday → MISSING', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: null, kosdaq: null, totalProgramNet: null, arbitrageNet: null, nonArbitrageNet: null,
      timestamp: 'x', confidence: 'EMPTY', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: [],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: async () => agg, nowMs: NON_INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('MISSING');
    expect(decision.source).toBe('NONE');
    expect(decision.scoring).toBe('excluded');
    expect(decision.fallbackResult).toBe('ALL_FAILED');
    expect(decision.displayCase).toBe('B_ALL_FAILED');
  });

  it('사용자 §J #8: PARAM_ERROR → KRX 호출 안 함 (Patch-004 PARAM_MISMATCH)', async () => {
    let krxCalled = false;
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'PARAM_ERROR', marketCode: 'XXXX' } },
      {
        fetchKrx: async () => {
          krxCalled = true;
          return null;
        },
        nowMs: NON_INTRADAY_NOW_MS,
      },
    );
    expect(decision.routedStatus).toBe('PARAM_MISMATCH');
    expect(decision.displayCase).toBe('D_PARAM_MISMATCH');
    expect(decision.scoring).toBe('excluded');
    expect(decision.krxAttempted).toBe(false);
    expect(krxCalled).toBe(false);
  });

  it('사용자 §J #9: KIS 정상 응답 (zeroReason=null) → KRX 호출 안 함 + VERIFIED + KIS_API', async () => {
    let krxCalled = false;
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: null, outputLength: 1 } },
      {
        fetchKrx: async () => {
          krxCalled = true;
          return null;
        },
        nowMs: NON_INTRADAY_NOW_MS,
      },
    );
    expect(decision.routedStatus).toBe('VERIFIED');
    expect(decision.source).toBe('KIS_API');
    expect(decision.krxAttempted).toBe(false);
    expect(krxCalled).toBe(false);
  });

  it('사용자 §J #10: ENV PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED=true → Patch-004 직접 위임 (KRX 호출 안 함)', async () => {
    process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED = 'true';
    let krxCalled = false;
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      {
        fetchKrx: async () => {
          krxCalled = true;
          return null;
        },
        nowMs: NON_INTRADAY_NOW_MS,
      },
    );
    expect(decision.patch006Activated).toBe(false);
    expect(decision.krxAttempted).toBe(false);
    expect(krxCalled).toBe(false);
  });

  it('사용자 §J #11: KRX_MARKET_PROGRAM_FALLBACK_DISABLED=true → KRX skip but Patch-006 active', async () => {
    process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED = 'true';
    let krxCalled = false;
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      {
        fetchKrx: async () => {
          krxCalled = true;
          return null;
        },
        nowMs: NON_INTRADAY_NOW_MS,
      },
    );
    expect(decision.patch006Activated).toBe(true);
    expect(decision.krxAttempted).toBe(false); // ENV 우회로 KRX skip
    expect(krxCalled).toBe(false);
    expect(decision.routedStatus).toBe('MISSING'); // KRX 안 시도 + cache 없음 → MISSING
  });

  it('KRX fetch throw → graceful (confidence=ERROR 처리)', async () => {
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: async () => { throw new Error('KRX 500'); }, nowMs: NON_INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('MISSING');
    expect(decision.krxAttempted).toBe(true);
    expect(decision.krxAggregate).toBeNull();
    expect(decision.executionImpact).toBe('NONE');
    expect(decision.providerIssue).toBe(false);
  });

  it('KRX VERIFIED + intraday session → 여전히 VERIFIED (intraday 분기는 KRX EMPTY 시점만)', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: makeRow('KOSPI', 500), kosdaq: makeRow('KOSDAQ', 200),
      totalProgramNet: 700, arbitrageNet: 140, nonArbitrageNet: 560,
      timestamp: 'x', confidence: 'VERIFIED', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: ['KOSPI', 'KOSDAQ'],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: async () => agg, nowMs: INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('VERIFIED');
    expect(decision.isIntradaySession).toBe(true);
  });

  it('OUTPUT_EMPTY zeroReason → KRX fetch trigger', async () => {
    let krxCalled = false;
    const agg: KrxMarketProgramAggregate = {
      kospi: makeRow('KOSPI', 500), kosdaq: makeRow('KOSDAQ', 200),
      totalProgramNet: 700, arbitrageNet: 140, nonArbitrageNet: 560,
      timestamp: 'x', confidence: 'VERIFIED', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: ['KOSPI', 'KOSDAQ'],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'OUTPUT_EMPTY', outputLength: 0 } },
      {
        fetchKrx: async () => {
          krxCalled = true;
          return agg;
        },
        nowMs: NON_INTRADAY_NOW_MS,
      },
    );
    expect(krxCalled).toBe(true);
    expect(decision.routedStatus).toBe('VERIFIED');
  });
});

describe('Patch-006 formatProgramMarketRoutedV2', () => {
  it('VERIFIED + KRX_API → KRX recovered + krx 라인 노출', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: makeRow('KOSPI', 500), kosdaq: makeRow('KOSDAQ', 200),
      totalProgramNet: 700, arbitrageNet: 140, nonArbitrageNet: 560,
      timestamp: 'x', confidence: 'VERIFIED', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: ['KOSPI', 'KOSDAQ'],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: async () => agg, nowMs: NON_INTRADAY_NOW_MS },
    );
    const lines = formatProgramMarketRoutedV2(decision);
    const text = lines.join('\n');
    expect(text).toContain('routedStatusV2: VERIFIED');
    expect(text).toContain('displayCase: A_KRX_RECOVERED');
    expect(text).toContain('krx: confidence=VERIFIED');
    expect(text).toContain('kospi=500억원');
    expect(text).toContain('kosdaq=200억원');
    expect(text).toContain('total=700억원');
    expect(text).toContain('krxMarkets: attempted=KOSPI,KOSDAQ succeeded=KOSPI,KOSDAQ');
    expect(text).toContain('patch006: activated=true');
    expect(text).toContain('executionImpact=NONE');
    expect(text).toContain('providerIssue=false');
  });

  it('UNSUPPORTED_INTRADAY → intradaySession=true 노출', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: null, kosdaq: null, totalProgramNet: null, arbitrageNet: null, nonArbitrageNet: null,
      timestamp: 'x', confidence: 'EMPTY', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: [],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: async () => agg, nowMs: INTRADAY_NOW_MS },
    );
    const text = formatProgramMarketRoutedV2(decision).join('\n');
    expect(text).toContain('routedStatusV2: UNSUPPORTED_INTRADAY');
    expect(text).toContain('displayCase: C_UNSUPPORTED_INTRADAY');
    expect(text).toContain('intradaySession: true');
    expect(text).toContain('krx: confidence=EMPTY');
  });

  it('CACHE_EXPIRED → cacheTtl 라인 노출', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: null, kosdaq: null, totalProgramNet: null, arbitrageNet: null, nonArbitrageNet: null,
      timestamp: 'x', confidence: 'EMPTY', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: [],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      {
        rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 },
        cacheFallback: { available: true, programNetBuyAmount: 600, ageMs: 60 * 60 * 1000 },
      },
      { fetchKrx: async () => agg, nowMs: NON_INTRADAY_NOW_MS },
    );
    const text = formatProgramMarketRoutedV2(decision).join('\n');
    expect(text).toContain('routedStatusV2: CACHE_EXPIRED');
    expect(text).toContain('cacheTtl: tier=EXPIRED');
  });
});

describe('Patch-006 formatProgramMarketRoutedV2Compact', () => {
  it('PATCH-RUNTIME 태그 + Patch-006 마커', async () => {
    const agg: KrxMarketProgramAggregate = {
      kospi: makeRow('KOSPI', 500), kosdaq: makeRow('KOSDAQ', 200),
      totalProgramNet: 700, arbitrageNet: 140, nonArbitrageNet: 560,
      timestamp: 'x', confidence: 'VERIFIED', fetchedAt: 'x', endpoint: 'x', bld: 'x',
      marketsAttempted: ['KOSPI', 'KOSDAQ'], marketsSucceeded: ['KOSPI', 'KOSDAQ'],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: async () => agg, nowMs: NON_INTRADAY_NOW_MS },
    );
    const compact = formatProgramMarketRoutedV2Compact(decision);
    expect(compact).toContain('[PATCH-RUNTIME] (Patch-006)');
    expect(compact).toContain('status=VERIFIED');
    expect(compact).toContain('source=KRX_API');
    expect(compact).toContain('display=A_KRX_RECOVERED');
    expect(compact).toContain('intraday=false');
    expect(compact).toContain('executionImpact=NONE');
  });
});

describe('Patch-006 정적 grep 안전 invariants', () => {
  it('KIS 주문 함수 5종 import 0건 (절대 규칙 #2)', () => {
    const forbidden = [
      'placeKisMarketOrder', 'placeKisSellOrder',
      'placeKisStopLossOrder', 'placeKisTakeProfitOrder', 'cancelKisOrder',
    ];
    for (const fn of forbidden) {
      const importRe = new RegExp(`import[^\\n]*\\b${fn}\\b`, 'i');
      expect(importRe.test(SOURCE)).toBe(false);
      expect(importRe.test(FETCHER_SOURCE)).toBe(false);
    }
  });
  it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(/from\s+['"][^'"]*autoTradeEngine[^'"]*['"]/i.test(SOURCE)).toBe(false);
    expect(/from\s+['"][^'"]*orderExecutor[^'"]*['"]/i.test(SOURCE)).toBe(false);
    expect(/from\s+['"][^'"]*trancheExecutor[^'"]*['"]/i.test(SOURCE)).toBe(false);
  });
  it('외부 fetch / axios / node-fetch import 0건 (krxPost SSOT 만 사용)', () => {
    expect(/import[^\n]*\bfetch\b/i.test(SOURCE)).toBe(false);
    expect(/from\s+['"]axios['"]/i.test(SOURCE)).toBe(false);
    expect(/from\s+['"]node-fetch['"]/i.test(SOURCE)).toBe(false);
    // fetcher 는 krxPost 만 사용
    expect(/from\s+['"]axios['"]/i.test(FETCHER_SOURCE)).toBe(false);
    expect(/from\s+['"]node-fetch['"]/i.test(FETCHER_SOURCE)).toBe(false);
    expect(/import[^\n]*\{[^}]*\bkrxPost\b/.test(FETCHER_SOURCE)).toBe(true);
  });
  it('Gate threshold / GATE_RELAX / STRONG_BUY_OVERRIDE 변경 0', () => {
    expect(/setGateThreshold|GATE_RELAX|STRONG_BUY_OVERRIDE/.test(SOURCE)).toBe(false);
    expect(/setGateThreshold|GATE_RELAX|STRONG_BUY_OVERRIDE/.test(FETCHER_SOURCE)).toBe(false);
  });
  it('emergencyStop / SELL_ONLY / SHADOW_ONLY 자동 전환 0', () => {
    expect(/setEmergencyStop|setSellOnlyMode|setShadowOnlyMode|forceSellOnly/.test(SOURCE)).toBe(false);
    expect(/setEmergencyStop|setSellOnlyMode|setShadowOnlyMode|forceSellOnly/.test(FETCHER_SOURCE)).toBe(false);
  });
  it('ADR-0157 정확 비교 (=== \'true\') 의무', () => {
    expect(SOURCE).toMatch(/=== 'true'/);
    expect(FETCHER_SOURCE).toMatch(/=== 'true'/);
  });
  it('literal type 강제 — providerIssue: false / marketSignal: false / executionImpact: \'NONE\'', () => {
    expect(SOURCE).toMatch(/providerIssue:\s*false/);
    expect(SOURCE).toMatch(/marketSignal:\s*false/);
    expect(SOURCE).toMatch(/executionImpact:\s*'NONE'/);
    expect(SOURCE).toMatch(/liveExecutionAllowed:\s*false/);
  });
  it('Patch-006 추적 주석 명시', () => {
    expect(SOURCE).toContain('Patch-MARKET-PROGRAM-TRADING-FALLBACK-RECOVERY-006');
    expect(FETCHER_SOURCE).toContain('Patch-MARKET-PROGRAM-TRADING-FALLBACK-RECOVERY-006');
  });
  it('supplyHealth.cmd.ts 가 Patch-006 router 사용 (wiring 정합)', () => {
    expect(SUPPLY_HEALTH_SOURCE).toContain('routeProgramMarketEmptyWithKrxAggregate');
    expect(SUPPLY_HEALTH_SOURCE).toContain('formatProgramMarketRoutedV2');
    expect(SUPPLY_HEALTH_SOURCE).toContain('isPatch006Disabled');
    expect(SUPPLY_HEALTH_SOURCE).toContain('programMarketRouterPatch006');
  });
  it('supplyHealth.cmd.ts 가 ENV disabled 분기에서만 Patch-004 직접 위임', () => {
    expect(SUPPLY_HEALTH_SOURCE).toMatch(/isPatch006Disabled\(\)/);
    expect(SUPPLY_HEALTH_SOURCE).toContain('await routeProgramMarketEmptyWithKrxAggregate');
  });
  it('LIVE 매매 본체 import 0건 (signalScanner / entryEngine / exitEngine / kisClient/orders)', () => {
    expect(/from\s+['"][^'"]*signalScanner[^'"]*['"]/i.test(SOURCE)).toBe(false);
    expect(/from\s+['"][^'"]*entryEngine[^'"]*['"]/i.test(SOURCE)).toBe(false);
    expect(/from\s+['"][^'"]*exitEngine[^'"]*['"]/i.test(SOURCE)).toBe(false);
    expect(/from\s+['"][^'"]*kisClient\/orders[^'"]*['"]/i.test(SOURCE)).toBe(false);
  });
});
