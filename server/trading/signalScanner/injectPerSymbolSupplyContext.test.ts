import { describe, expect, it } from 'vitest';
import {
  injectPerSymbolSupplyContext,
  type CandidateWithSupplyContext,
} from './injectPerSymbolSupplyContext.js';

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
