// @responsibility KIS finance client (ADR-0532 Phase 1) extraction + QmpDartFinancials mapping tests.

import { afterEach, describe, expect, it } from 'vitest';
import {
  getKisFinancials,
  kisFinancialsToQmpDartFinancials,
  __resetKisFinanceCacheForTests,
} from './kisFinanceClient.js';
import { setKisClientOverrides } from './kisClient/overrides.js';

describe('kisFinanceClient (ADR-0532 Phase 1)', () => {
  afterEach(() => {
    setKisClientOverrides({});
    delete process.env.KIS_APP_KEY;
    delete process.env.KIS_APP_SECRET;
    __resetKisFinanceCacheForTests();
  });

  it('returns null when KIS credentials are missing', async () => {
    expect(await getKisFinancials('005930')).toBeNull();
  });

  it('extracts ROE/OPM/debtRatio/EPS from financial-ratio + income-statement (latest row)', async () => {
    process.env.KIS_APP_KEY = 'k';
    process.env.KIS_APP_SECRET = 's';
    setKisClientOverrides({
      realDataKisGet: async (trId: string) => {
        if (trId === 'FHKST66430300') {
          return { output: [{ stac_yymm: '202412', roe_val: '12.5', lblt_rate: '45.6', eps: '4,800', bps: '38000' }] };
        }
        if (trId === 'FHKST66430200') {
          return { output: [{ stac_yymm: '202412', sale_account: '1000', op_prfi: '150', thtr_ntin: '100' }] };
        }
        return {};
      },
    });

    const fin = await getKisFinancials('005930');
    expect(fin).toMatchObject({
      symbol: '005930',
      fiscalYearMonth: '202412',
      roe: 12.5,
      debtRatio: 45.6,
      eps: 4800,
      bps: 38000,
      revenue: 1000,
      operatingIncome: 150,
      netIncome: 100,
      source: 'KIS_FINANCE',
    });
    expect(fin!.opm).toBeCloseTo(15); // 150/1000*100
    expect(fin!.netMargin).toBeCloseTo(10); // 100/1000*100
  });

  it('maps to QmpDartFinancials with KIS roe/opm and null OCF/ICR (DART residual per ADR-0532)', async () => {
    process.env.KIS_APP_KEY = 'k';
    process.env.KIS_APP_SECRET = 's';
    setKisClientOverrides({
      realDataKisGet: async (trId: string) =>
        trId === 'FHKST66430300'
          ? { output: [{ roe_val: '20' }] }
          : { output: [{ sale_account: '200', op_prfi: '40' }] },
    });

    const fin = await getKisFinancials('005930');
    const qmp = kisFinancialsToQmpDartFinancials(fin!);
    expect(qmp).toMatchObject({
      roe: 20,
      // KIS 미가용 축은 null — DART 잔존 (ADR-0532 한계)
      interestCoverageRatio: null,
      operatingCashFlow: null,
      interestExpense: null,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      dataConfidence: 'VERIFIED',
    });
    expect(qmp.opm).toBeCloseTo(20); // 40/200*100
  });

  it('returns null when both finance endpoints yield no rows', async () => {
    process.env.KIS_APP_KEY = 'k';
    process.env.KIS_APP_SECRET = 's';
    setKisClientOverrides({ realDataKisGet: async () => ({ output: [] }) });
    expect(await getKisFinancials('005930')).toBeNull();
  });
});
