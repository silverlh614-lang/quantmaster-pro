// @responsibility ADR-0658 UN observe-probe 회귀 — flag OFF byte-identical·J 무변경·UN 분류·격리 검증.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _realDataKisGet = vi.fn();
const _getKisOverrides = vi.fn();
const _HAS_REAL_DATA_CLIENT = { value: false };

vi.mock('../http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../http.js')>();
  return {
    ...actual,
    realDataKisGet: (trId: string, path: string, params: Record<string, string>, priority?: unknown) =>
      _realDataKisGet(trId, path, params, priority),
  };
});

vi.mock('../overrides.js', () => ({
  getKisOverrides: () => _getKisOverrides(),
}));

vi.mock('../constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../constants.js')>();
  return {
    ...actual,
    get HAS_REAL_DATA_CLIENT() { return _HAS_REAL_DATA_CLIENT.value; },
  };
});

let fetchKisInvestorTradeByStockDaily: typeof import('../query.js').fetchKisInvestorTradeByStockDaily;
let drainObserveLedger: () => unknown[];

async function load(): Promise<void> {
  vi.resetModules();
  const queryMod = await import('../query.js');
  fetchKisInvestorTradeByStockDaily = queryMod.fetchKisInvestorTradeByStockDaily;
  const probeMod = await import('./investorFlowUnMarketProbeAdr0658.js');
  drainObserveLedger = probeMod.__investorFlowUnProbeTestOnly.drainObserveLedger;
  probeMod.__investorFlowUnProbeTestOnly.reset();
}

const PATH = '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily';

/** J가 materialize 하는 완전한 외인+기관 응답. */
function jMaterializedResponse() {
  return {
    output2: [{ stck_bsop_date: '20260508', frgn_ntby_qty: '1000', orgn_ntby_qty: '2000', prsn_ntby_qty: '-3000' }],
  };
}

/** J가 못 잡는(net-buy 부재) 빈 수급 응답 → not-materialized → shadow-only 행. */
function jNullResponse() {
  return { output2: [{ stck_bsop_date: '20260508', stck_clpr: '70000' }] };
}

beforeEach(async () => {
  _realDataKisGet.mockReset();
  _getKisOverrides.mockReset();
  _getKisOverrides.mockReturnValue({});
  _HAS_REAL_DATA_CLIENT.value = false;
  process.env.KIS_APP_KEY = 'test-key';
  delete process.env.INVESTOR_FLOW_UN_MARKET_PROBE_ENABLED;
  delete process.env.KIS_INVESTOR_OUTPUT_BUCKET_FIX;
  delete process.env.KIS_ONLY_TRACE;
  await load();
});

afterEach(() => {
  delete process.env.KIS_APP_KEY;
  delete process.env.INVESTOR_FLOW_UN_MARKET_PROBE_ENABLED;
  vi.clearAllMocks();
});

describe('ADR-0658 — UN observe-probe', () => {
  it('1) flag OFF = byte-identical (UN 호출 0·fetch 동작 동일·ledger stamp 0)', async () => {
    // J-null 행. flag 미설정(OFF).
    _realDataKisGet.mockResolvedValue(jNullResponse());
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).toBeNull(); // J 기반 동작 보존.
    // J 호출만 발생(dateCandidates 만큼). UN(FID_COND_MRKT_DIV_CODE='UN') 호출은 0.
    const unCalls = _realDataKisGet.mock.calls.filter(
      (call) => (call[2] as Record<string, string>)?.FID_COND_MRKT_DIV_CODE === 'UN',
    );
    expect(unCalls.length).toBe(0);
    expect(drainObserveLedger().length).toBe(0);
  });

  it('2) flag ON + J materialized = probe skip (UN 호출 0·fetch 정상 반환)', async () => {
    process.env.INVESTOR_FLOW_UN_MARKET_PROBE_ENABLED = 'true';
    await load();
    _realDataKisGet.mockResolvedValue(jMaterializedResponse());
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).not.toBeNull();
    expect(result?.foreignNetBuy).toBe(1000);
    expect(result?.institutionalNetBuy).toBe(2000);
    const unCalls = _realDataKisGet.mock.calls.filter(
      (call) => (call[2] as Record<string, string>)?.FID_COND_MRKT_DIV_CODE === 'UN',
    );
    expect(unCalls.length).toBe(0);
    expect(drainObserveLedger().length).toBe(0);
  });

  it('3) flag ON + J null + UN materialized = ledger 기록·fetch 여전히 null (J 무변경)', async () => {
    process.env.INVESTOR_FLOW_UN_MARKET_PROBE_ENABLED = 'true';
    await load();
    _realDataKisGet.mockImplementation((_trId: string, _path: string, params: Record<string, string>) => {
      if (params.FID_COND_MRKT_DIV_CODE === 'UN') {
        // UN 이 J가 놓친 net-buy 를 잡음 → unMaterialized·jMissedRowRecovered.
        return Promise.resolve({
          output2: [{ stck_bsop_date: '20260508', frgn_ntby_qty: '4444', orgn_ntby_qty: '5555' }],
        });
      }
      return Promise.resolve(jNullResponse());
    });
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).toBeNull(); // J 기반 무변경 — fetch 여전히 null.

    const ledger = drainObserveLedger() as Array<Record<string, unknown>>;
    expect(ledger.length).toBe(1);
    expect(ledger[0].unMaterialized).toBe(true);
    expect(ledger[0].jMissedRowRecovered).toBe(true);
    expect(ledger[0].unInvalidOpsq2001).toBe(false);
    expect(ledger[0].marketSignal).toBe(false);
    expect(ledger[0].executionImpact).toBe('NONE');
    expect(ledger[0].stockCode).toBe('005930');

    const unCalls = _realDataKisGet.mock.calls.filter(
      (call) => (call[2] as Record<string, string>)?.FID_COND_MRKT_DIV_CODE === 'UN',
    );
    expect(unCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('4) flag ON + J null + UN OPSQ2001 = unInvalidOpsq2001 분류·격리·fetch null', async () => {
    process.env.INVESTOR_FLOW_UN_MARKET_PROBE_ENABLED = 'true';
    await load();
    _realDataKisGet.mockImplementation((_trId: string, _path: string, params: Record<string, string>) => {
      if (params.FID_COND_MRKT_DIV_CODE === 'UN') {
        return Promise.resolve({ rt_cd: '1', msg_cd: 'OPSQ2001', msg1: 'INVALID FID_COND_MRKT_DIV_CODE' });
      }
      return Promise.resolve(jNullResponse());
    });
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).toBeNull();

    const ledger = drainObserveLedger() as Array<Record<string, unknown>>;
    expect(ledger.length).toBe(1);
    expect(ledger[0].unInvalidOpsq2001).toBe(true);
    expect(ledger[0].unMaterialized).toBe(false);
    expect(ledger[0].providerIssue).toBe(true);
    expect(ledger[0].marketSignal).toBe(false); // 불변식 #6 — bearish 변환 금지.
    expect(ledger[0].executionImpact).toBe('NONE');
  });

  it('5) flag ON + UN probe 예외(network) = 격리(throw 안 함·엔진 생존)·fetch null', async () => {
    process.env.INVESTOR_FLOW_UN_MARKET_PROBE_ENABLED = 'true';
    await load();
    _realDataKisGet.mockImplementation((_trId: string, _path: string, params: Record<string, string>) => {
      if (params.FID_COND_MRKT_DIV_CODE === 'UN') {
        return Promise.reject(new Error('UN 회로차단/network'));
      }
      return Promise.resolve(jNullResponse());
    });
    // UN probe 예외가 fetch 로 전파되지 않아야 함 — resolve 로 null 반환(throw 금지·엔진 생존).
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).toBeNull(); // J 기반 무변경.

    const ledger = drainObserveLedger() as Array<Record<string, unknown>>;
    expect(ledger.length).toBe(1);
    expect(ledger[0].providerIssue).toBe(true);
    expect(ledger[0].unMaterialized).toBe(false);
    expect(ledger[0].unInvalidOpsq2001).toBe(false);
    expect(ledger[0].marketSignal).toBe(false);
    expect(ledger[0].executionImpact).toBe('NONE');
  });
});
