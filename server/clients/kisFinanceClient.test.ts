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

  it('extracts ROE/OPM/debtRatio/EPS + currentRatio/YoY from financial-ratio + income-statement + stability-ratio', async () => {
    process.env.KIS_APP_KEY = 'k';
    process.env.KIS_APP_SECRET = 's';
    setKisClientOverrides({
      realDataKisGet: async (trId: string) => {
        if (trId === 'FHKST66430300') {
          // financial-ratio 응답에는 YoY 성장(grs/bsop_prfi_inrt/ntin_inrt)이 이미 포함됨.
          return { output: [{ stac_yymm: '202412', roe_val: '12.5', lblt_rate: '45.6', eps: '4,800', bps: '38000', grs: '10.0', bsop_prfi_inrt: '18.0', ntin_inrt: '12.0' }] };
        }
        if (trId === 'FHKST66430200') {
          return { output: [{ stac_yymm: '202412', sale_account: '1000', op_prfi: '150', thtr_ntin: '100' }] };
        }
        if (trId === 'FHKST66430600') {
          return { output: [{ stac_yymm: '202412', lblt_rate: '45.6', crnt_rate: '210.5', quck_rate: '180.0' }] };
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
      currentRatio: 210.5,
      revenueYoYGrowth: 10.0,
      operatingIncomeYoYGrowth: 18.0,
      eps: 4800,
      bps: 38000,
      revenue: 1000,
      operatingIncome: 150,
      netIncome: 100,
      source: 'KIS_FINANCE',
    });
    expect(fin!.opm).toBeCloseTo(15); // 150/1000*100
    expect(fin!.netMargin).toBeCloseTo(10); // 100/1000*100
    expect(fin!.marginAcceleration).toBeCloseTo(8.0); // 18.0 - 10.0 (영업이익증가율 - 매출액증가율)
  });

  it('survives stability-ratio failure (best-effort) without nulling core fields', async () => {
    process.env.KIS_APP_KEY = 'k';
    process.env.KIS_APP_SECRET = 's';
    setKisClientOverrides({
      realDataKisGet: async (trId: string) => {
        if (trId === 'FHKST66430600') throw new Error('stability endpoint down');
        if (trId === 'FHKST66430300') return { output: [{ roe_val: '12.5', lblt_rate: '45.6' }] };
        return { output: [{ sale_account: '1000', op_prfi: '150', thtr_ntin: '100' }] };
      },
    });
    const fin = await getKisFinancials('005930');
    expect(fin!.roe).toBe(12.5);
    expect(fin!.debtRatio).toBe(45.6);
    expect(fin!.currentRatio).toBeNull(); // stability 실패 → null, 핵심 결과는 유지
  });

  it('maps to QmpDartFinancials with KIS roe/opm/debtRatio/currentRatio/YoY and null OCF/ICR (DART residual)', async () => {
    process.env.KIS_APP_KEY = 'k';
    process.env.KIS_APP_SECRET = 's';
    setKisClientOverrides({
      realDataKisGet: async (trId: string) => {
        if (trId === 'FHKST66430300') return { output: [{ roe_val: '20', lblt_rate: '60', grs: '5.0', bsop_prfi_inrt: '9.0' }] };
        if (trId === 'FHKST66430600') return { output: [{ crnt_rate: '150' }] };
        return { output: [{ sale_account: '200', op_prfi: '40' }] };
      },
    });

    const fin = await getKisFinancials('005930');
    const qmp = kisFinancialsToQmpDartFinancials(fin!);
    expect(qmp).toMatchObject({
      roe: 20,
      debtRatio: 60,
      currentRatio: 150,
      revenueYoYGrowth: 5.0,
      operatingIncomeYoYGrowth: 9.0,
      // KIS 미가용 축은 null — DART 잔존 (사용자 지시: OCF/ICR DART 의존 유지)
      interestCoverageRatio: null,
      operatingCashFlow: null,
      interestExpense: null,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      dataConfidence: 'VERIFIED',
    });
    expect(qmp.opm).toBeCloseTo(20); // 40/200*100
    expect(qmp.marginAcceleration).toBeCloseTo(4.0); // 9.0 - 5.0
  });

  it('ADR-0655: roe_val 결손 시 profit-ratio self_cptl_ntin_inrt 로 ROE 보강 (fieldSources.roe=KIS_L1)', async () => {
    process.env.KIS_APP_KEY = 'k';
    process.env.KIS_APP_SECRET = 's';
    setKisClientOverrides({
      realDataKisGet: async (trId: string) => {
        // financial-ratio 에 roe_val 결손 → profit-ratio fallback 발동.
        if (trId === 'FHKST66430300') return { output: [{ lblt_rate: '70', grs: '3.0', bsop_prfi_inrt: '4.0' }] };
        if (trId === 'FHKST66430400') return { output: [{ self_cptl_ntin_inrt: '8.4', sale_ntin_rate: '5.1' }] };
        if (trId === 'FHKST66430600') return { output: [{ crnt_rate: '120', lblt_rate: '70' }] };
        return { output: [{ sale_account: '500', op_prfi: '60', thtr_ntin: '25' }] };
      },
    });
    const fin = await getKisFinancials('005930');
    expect(fin!.roe).toBe(8.4);
    expect(fin!.fieldSources.roe).toBe('KIS_L1');
    expect(fin!.debtRatio).toBe(70);
  });

  it('ADR-0655: roe_val 가용 시 profit-ratio 추가 호출 없음 (호출 빈도 합리적 유지)', async () => {
    process.env.KIS_APP_KEY = 'k';
    process.env.KIS_APP_SECRET = 's';
    let profitRatioCalls = 0;
    setKisClientOverrides({
      realDataKisGet: async (trId: string) => {
        if (trId === 'FHKST66430400') { profitRatioCalls += 1; return { output: [{ self_cptl_ntin_inrt: '8.4' }] }; }
        if (trId === 'FHKST66430300') return { output: [{ roe_val: '15.2', lblt_rate: '40' }] };
        if (trId === 'FHKST66430600') return { output: [{ crnt_rate: '180' }] };
        return { output: [{ sale_account: '500', op_prfi: '60' }] };
      },
    });
    const fin = await getKisFinancials('005930');
    expect(fin!.roe).toBe(15.2);
    expect(profitRatioCalls).toBe(0);
  });

  it('returns null when both finance endpoints yield no rows', async () => {
    process.env.KIS_APP_KEY = 'k';
    process.env.KIS_APP_SECRET = 's';
    setKisClientOverrides({ realDataKisGet: async () => ({ output: [] }) });
    expect(await getKisFinancials('005930')).toBeNull();
  });
});
