import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  injectPerSymbolSupplyContext,
  type CandidateWithSupplyContext,
} from './injectPerSymbolSupplyContext.js';
import {
  clearSupplyBySymbolPayloadSnapshotsForTest,
  lookupSupplyBySymbolPayloadSnapshot,
} from '../../supply/investorFlowBySymbolPayloadSnapshot.js';

describe('injectPerSymbolSupplyContext', () => {
  it('injects verified per-symbol investor flow into candidates', async () => {
    const candidates: CandidateWithSupplyContext[] = [
      { code: '005930', preflight: {} },
      { code: '000660', preflight: {} },
    ];

    const investorFlowRouter = {
      fetchForSymbols: async () => [
        {
          symbol: '005930',
          status: 'VERIFIED',
          provider: 'KIS_API',
          foreignNetBuyAmount: 100000000,
          institutionNetBuyAmount: 50000000,
        },
        {
          symbol: '000660',
          status: 'VERIFIED',
          provider: 'KIS_API',
          foreignNetBuyAmount: -10000000,
          institutionNetBuyAmount: 30000000,
        },
      ],
    };

    const { candidates: result, stats } = await injectPerSymbolSupplyContext({
      candidates,
      investorFlowRouter,
      now: new Date('2026-05-15T00:00:00.000Z'),
    });

    expect(result[0]!.preflight?.supplyContext?.supplyProviderHealth).toBe('VERIFIED');
    expect(result[0]!.gateContext?.supplyContext?.supplyProviderHealth).toBe('VERIFIED');
    expect(result[0]!.scoringContext?.supplyContext?.supplyProviderHealth).toBe('VERIFIED');
    expect(result[0]!.preflight?.supplyContext?.providerIssue).toBe(false);
    expect(result[0]!.supplyProviderHealth?.status).toBe('VERIFIED');
    expect(stats.unknown).toBe(0);
    expect(stats.verified).toBe(2);
    expect(stats.gateContextConnected).toBe(true);
  });

  it('does not throw when investor flow router fails', async () => {
    const candidates: CandidateWithSupplyContext[] = [
      { code: '005930', preflight: {} },
    ];

    const investorFlowRouter = {
      fetchForSymbols: async () => {
        throw new Error('KIS_API_TIMEOUT');
      },
    };

    const { candidates: result, stats } = await injectPerSymbolSupplyContext({
      candidates,
      investorFlowRouter,
      now: new Date('2026-05-15T00:00:00.000Z'),
    });

    expect(result[0]!.preflight?.supplyContext?.supplyProviderHealth).toBe('MISSING');
    expect(result[0]!.gateContext?.supplyContext?.supplyProviderHealth).toBe('MISSING');
    expect(result[0]!.scoringContext?.supplyContext?.supplyProviderHealth).toBe('MISSING');
    expect(result[0]!.preflight?.supplyContext?.providerIssue).toBe(true);
    expect(result[0]!.preflight?.supplyContext?.marketSignal).toBe(false);
    expect(result[0]!.preflight?.supplyContext?.executionImpact).toBe('NONE');
    expect(stats.routerConnected).toBe(false);
    expect(stats.unknown).toBe(0);
  });

  it('marks only missing symbols as MISSING', async () => {
    const candidates: CandidateWithSupplyContext[] = [
      { code: '005930', preflight: {} },
      { code: '000660', preflight: {} },
    ];

    const investorFlowRouter = {
      fetchForSymbols: async () => [
        {
          symbol: '005930',
          status: 'VERIFIED',
          provider: 'KIS_API',
        },
      ],
    };

    const { candidates: result, stats } = await injectPerSymbolSupplyContext({
      candidates,
      investorFlowRouter,
      now: new Date('2026-05-15T00:00:00.000Z'),
    });

    expect(result[0]!.preflight?.supplyContext?.supplyProviderHealth).toBe('VERIFIED');
    expect(result[1]!.preflight?.supplyContext?.supplyProviderHealth).toBe('MISSING');
    expect(stats.verified).toBe(1);
    expect(stats.missing).toBe(1);
    expect(stats.unknown).toBe(0);
  });
});

// WIRE_SELECTED_CANDIDATE_ACTUAL_ROW — per-scan symbol-keyed carry map + aggregate snapshot.
describe('injectPerSymbolSupplyContext — WIRE_SELECTED_CANDIDATE_ACTUAL_ROW carry map', () => {
  beforeEach(() => clearSupplyBySymbolPayloadSnapshotsForTest());
  afterEach(() => clearSupplyBySymbolPayloadSnapshotsForTest());

  // Case A — 후보 다수(>20)의 actual row 가 단일 aggregate snapshot 으로 보존되어 forensic
  // by-symbol 조회가 21개 cap 을 넘어 전부 resolve 되어야 한다.
  it('Case A — carries every candidate row into one aggregate snapshot (no 20-snapshot cap)', async () => {
    const codes = Array.from({ length: 25 }, (_, i) => String(100000 + i).padStart(6, '0'));
    const candidates: CandidateWithSupplyContext[] = codes.map((code) => ({ code, preflight: {} }));
    const investorFlowRouter = {
      fetchForSymbols: async () => codes.map((symbol, i) => ({
        symbol,
        status: 'VERIFIED' as const,
        provider: 'KIS_API' as const,
        foreignNetBuyAmount: 1_000_000 * (i + 1),
        institutionNetBuyAmount: 500_000 * (i + 1),
      })),
    };

    const { stats, investorFlowBySymbol } = await injectPerSymbolSupplyContext({
      candidates,
      investorFlowRouter,
      now: new Date('2026-05-15T01:00:00.000Z'),
    });

    expect(stats.investorFlowBySymbolCount).toBe(25);
    expect(Object.keys(investorFlowBySymbol)).toHaveLength(25);
    // 가장 먼저 fetch 된 종목(기존 cap 이라면 evict 됐을)도 조회되어야 한다.
    const first = lookupSupplyBySymbolPayloadSnapshot({ symbol: codes[0]!, now: '2026-05-15T01:01:00.000Z' });
    expect(first.reason).toBe('FOUND');
    expect(first.payload?.gateSemanticFlatRow?.foreignNetBuy).toBe(1_000_000);
    const last = lookupSupplyBySymbolPayloadSnapshot({ symbol: codes[24]!, now: '2026-05-15T01:01:00.000Z' });
    expect(last.reason).toBe('FOUND');
  });

  // Case B — programNetBuy placeholder(미수신)여도 외인/기관 숫자가 있으면 row 를 carry 한다.
  it('Case B — program placeholder does not drop the row (partial eligibility preserved)', async () => {
    const investorFlowRouter = {
      fetchForSymbols: async () => [
        {
          symbol: '005930',
          status: 'VERIFIED' as const,
          provider: 'KIS_API' as const,
          foreignNetBuyAmount: 120_000_000,
          institutionNetBuyAmount: 80_000_000,
          // programNetBuyAmount 의도적 미수신(placeholder)
        },
      ],
    };

    const { investorFlowBySymbol } = await injectPerSymbolSupplyContext({
      candidates: [{ code: '005930', preflight: {} }],
      investorFlowRouter,
      now: new Date('2026-05-15T01:00:00.000Z'),
    });

    const entry = investorFlowBySymbol['005930'];
    expect(entry).toBeDefined();
    expect((entry!.gateSemanticFlatRow as Record<string, unknown>).foreignNetBuy).toBe(120_000_000);
    expect((entry!.gateSemanticFlatRow as Record<string, unknown>).institutionNetBuy).toBe(80_000_000);
    expect((entry!.gateSemanticFlatRow as Record<string, unknown>).programNetBuy).toBeNull();
  });

  // Case C — 외인/기관 숫자가 전혀 없는 종목은 억지 attach 하지 않고 map 에서 제외(diagnosticOnly).
  it('Case C — symbol without core numeric fields is not force-attached', async () => {
    const investorFlowRouter = {
      fetchForSymbols: async () => [
        { symbol: '005930', status: 'VERIFIED' as const, provider: 'KIS_API' as const, foreignNetBuyAmount: 1, institutionNetBuyAmount: 2 },
        { symbol: '000660', status: 'MISSING' as const, provider: 'NONE' as const },
      ],
    };

    const { investorFlowBySymbol, stats } = await injectPerSymbolSupplyContext({
      candidates: [{ code: '005930', preflight: {} }, { code: '000660', preflight: {} }],
      investorFlowRouter,
      now: new Date('2026-05-15T01:00:00.000Z'),
    });

    expect(investorFlowBySymbol['005930']).toBeDefined();
    expect(investorFlowBySymbol['000660']).toBeUndefined();
    expect(stats.investorFlowBySymbolCount).toBe(1);
  });

  // Case D — provider row 부재 시 map 미수록 + marketSignal=false, executionImpact=NONE 유지(bearish 변환 금지).
  it('Case D — provider row absent stays neutral/diagnostic (no bearish conversion)', async () => {
    const investorFlowRouter = {
      fetchForSymbols: async () => [
        { symbol: '000660', status: 'MISSING' as const, provider: 'NONE' as const },
      ],
    };

    const caseDCandidates: CandidateWithSupplyContext[] = [{ code: '000660', preflight: {} }];
    const { candidates, investorFlowBySymbol } = await injectPerSymbolSupplyContext({
      candidates: caseDCandidates,
      investorFlowRouter,
      now: new Date('2026-05-15T01:00:00.000Z'),
    });

    expect(investorFlowBySymbol['000660']).toBeUndefined();
    const ctx = candidates[0]!.preflight?.supplyContext;
    expect(ctx?.supplyProviderHealth).toBe('MISSING');
    expect(ctx?.marketSignal).toBe(false);
    expect(ctx?.executionImpact).toBe('NONE');
  });
});
