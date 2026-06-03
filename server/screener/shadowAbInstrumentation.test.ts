/**
 * @responsibility shadow A/B 계측 차등 테스트 — flag OFF dormant·byte-equiv / flag ON 델타로깅·결정 미반영 / 불변식6 / top-N bound
 *
 * 목적: ShadowAbCollector 가 (a) flag OFF 시 KIS 신규호출 0콜·로그 0(byte-equivalent dormant),
 * (b) flag ON 시 top-N survivor 만 dual-eval 하여 델타를 로깅만(후보집합/점수/주문 0 영향),
 * (c) KIS 실패를 약세 신호로 변환하지 않음(불변식 #6), (d) top-N 한정(quota bound) 임을 단언한다.
 * fetchTechnicalQuoteByCode / evaluateServerGate 는 mock — 라이브 quota 0 침범.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchTechnicalQuoteByCode = vi.fn();
const evaluateServerGate = vi.fn();

vi.mock('./adapters/technicalQuoteRouter.js', () => ({
  fetchTechnicalQuoteByCode,
}));
vi.mock('../quantFilter.js', () => ({
  evaluateServerGate,
}));

const { ShadowAbCollector, SHADOW_AB_TOP_N, isShadowAbEnabled } = await import('./shadowAbInstrumentation.js');
import type { ServerGateResult } from '../quantFilter.js';
import type { YahooQuoteExtended } from './adapters/yahooQuoteAdapter.js';

const ENV_BEFORE = process.env.KIS_SHADOW_AB_ENABLED;

/** 결정에 이미 사용된 live(Yahoo 경로) Gate 결과 stub — 읽기 전용. */
function makeYahooGate(opts: { gateScore: number; signalType?: ServerGateResult['signalType']; mtas?: number }): ServerGateResult {
  return {
    gateScore: opts.gateScore,
    rawScore: opts.gateScore,
    signalType: opts.signalType ?? 'NORMAL',
    mtas: opts.mtas ?? 7,
    positionPct: 0.08,
    conditionKeys: [],
    details: [],
  } as unknown as ServerGateResult;
}

/** KIS-first quote stub(가격>0). */
function makeKisQuote(price = 10000): YahooQuoteExtended {
  return { price } as unknown as YahooQuoteExtended;
}

beforeEach(() => {
  fetchTechnicalQuoteByCode.mockReset();
  evaluateServerGate.mockReset();
});

afterEach(() => {
  if (ENV_BEFORE === undefined) delete process.env.KIS_SHADOW_AB_ENABLED;
  else process.env.KIS_SHADOW_AB_ENABLED = ENV_BEFORE;
});

describe('ShadowAbCollector — flag OFF dormant (byte-equivalent)', () => {
  it('(a) flag OFF → add/flush 모두 no-op: KIS 신규호출 0콜, 로그 0, dual-eval 0', async () => {
    delete process.env.KIS_SHADOW_AB_ENABLED; // OFF (미설정)
    expect(isShadowAbEnabled()).toBe(false);

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const c = new ShadowAbCollector();
    for (let i = 0; i < 50; i++) {
      c.add({ code: `00000${i}`, name: `S${i}`, yahooGate: makeYahooGate({ gateScore: i }), weights: {} as never });
    }
    const evaluated = await c.flush();

    expect(evaluated).toBe(0);
    expect(fetchTechnicalQuoteByCode).not.toHaveBeenCalled(); // KIS 신규호출 0콜
    expect(evaluateServerGate).not.toHaveBeenCalled();
    // [KIS_SHADOW_AB] 로그 0 (byte-equivalent: 스캔 로그 불변)
    expect(infoSpy.mock.calls.filter(a => String(a[0]).includes('[KIS_SHADOW_AB]'))).toHaveLength(0);
    expect(warnSpy.mock.calls.filter(a => String(a[0]).includes('[KIS_SHADOW_AB]'))).toHaveLength(0);

    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('ShadowAbCollector — flag ON 델타 로깅 + 결정 미반영', () => {
  beforeEach(() => { process.env.KIS_SHADOW_AB_ENABLED = 'true'; });

  it('(b) flag ON → KIS dual-eval 후 델타 1라인 로깅, yahooGate 불변(결정 미반영)', async () => {
    fetchTechnicalQuoteByCode.mockResolvedValue(makeKisQuote(12345));
    // shadow Gate 결과는 live 와 다른 값 — 결정에 새면 안 됨(로깅만).
    evaluateServerGate.mockReturnValue(makeYahooGate({ gateScore: 9.0, signalType: 'STRONG', mtas: 10 }));

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const yahooGate = makeYahooGate({ gateScore: 6.0, signalType: 'NORMAL', mtas: 7 });
    const yahooGateSnapshot = JSON.stringify(yahooGate);

    const c = new ShadowAbCollector();
    c.add({ code: '005930', name: '삼성전자', yahooGate, weights: {} as never, kospi20dReturn: 1.2, regime: 'NEUTRAL' });
    const evaluated = await c.flush();

    expect(evaluated).toBe(1);
    expect(fetchTechnicalQuoteByCode).toHaveBeenCalledWith('005930', { kisFirst: true }); // 단일 통로 + kisFirst

    // 델타 로그 1라인 — 운영자 집계 포맷 단언.
    const log = infoSpy.mock.calls.map(a => String(a[0])).find(s => s.includes('[KIS_SHADOW_AB]'));
    expect(log).toBeDefined();
    expect(log).toContain('code=005930');
    expect(log).toContain('yahooScore=6.000');
    expect(log).toContain('kisScore=9.000');
    expect(log).toContain('dScore=3.000');
    expect(log).toContain('yahooSignal=NORMAL');
    expect(log).toContain('kisSignal=STRONG');
    expect(log).toContain('signalFlip=true');
    expect(log).toContain('mtasDelta=3.000');
    expect(log).toContain('marketSignal=false');
    expect(log).toContain('executionImpact=NONE');

    // 결정 미반영 단언: live yahooGate 객체가 shadow 평가 후에도 byte-equal(변형 0).
    expect(JSON.stringify(yahooGate)).toBe(yahooGateSnapshot);

    infoSpy.mockRestore();
  });

  it('(c) 불변식 #6 — KIS throw 시 throw 0·marketSignal=false·providerIssue=true(약세 변환 금지)', async () => {
    fetchTechnicalQuoteByCode.mockRejectedValue(new Error('KIS 5xx'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const c = new ShadowAbCollector();
    c.add({ code: '000660', name: 'SK하이닉스', yahooGate: makeYahooGate({ gateScore: 7 }), weights: {} as never });

    // throw 0 — 스캔 본흐름 무중단(불변식 #1).
    await expect(c.flush()).resolves.toBe(1);

    // KIS 실패는 shadow Gate 재평가 0 (약세 신호로 변환하지 않음).
    expect(evaluateServerGate).not.toHaveBeenCalled();
    const warn = warnSpy.mock.calls.map(a => String(a[0])).find(s => s.includes('[KIS_SHADOW_AB]'));
    expect(warn).toBeDefined();
    expect(warn).toContain('providerIssue=true');
    expect(warn).toContain('marketSignal=false');
    expect(warn).toContain('executionImpact=NONE');

    warnSpy.mockRestore();
  });

  it('(c2) KIS empty(price<=0) → providerIssue 로그만, shadow Gate 재평가 0', async () => {
    fetchTechnicalQuoteByCode.mockResolvedValue(makeKisQuote(0));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const c = new ShadowAbCollector();
    c.add({ code: '035720', name: '카카오', yahooGate: makeYahooGate({ gateScore: 5 }), weights: {} as never });
    await expect(c.flush()).resolves.toBe(1);

    expect(evaluateServerGate).not.toHaveBeenCalled();
    const warn = warnSpy.mock.calls.map(a => String(a[0])).find(s => s.includes('[KIS_SHADOW_AB]'));
    expect(warn).toContain('marketSignal=false');

    warnSpy.mockRestore();
  });

  it('(d) top-N bound — survivor 35개 등재 시 상위 N(=30, gateScore 내림차순)만 dual-eval', async () => {
    fetchTechnicalQuoteByCode.mockResolvedValue(makeKisQuote());
    evaluateServerGate.mockReturnValue(makeYahooGate({ gateScore: 5 }));
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const c = new ShadowAbCollector();
    const total = SHADOW_AB_TOP_N + 5; // 35
    for (let i = 0; i < total; i++) {
      c.add({ code: String(100000 + i), name: `S${i}`, yahooGate: makeYahooGate({ gateScore: i }), weights: {} as never });
    }
    const evaluated = await c.flush();

    expect(evaluated).toBe(SHADOW_AB_TOP_N); // top-N 한정(quota bound)
    expect(fetchTechnicalQuoteByCode).toHaveBeenCalledTimes(SHADOW_AB_TOP_N);

    // gateScore 내림차순 top-N: i = 34..5 (최저 5개 i=0..4 제외).
    const calledCodes = fetchTechnicalQuoteByCode.mock.calls.map(call => call[0]);
    expect(calledCodes).toContain(String(100000 + 34)); // 최고점 포함
    expect(calledCodes).not.toContain(String(100000 + 0)); // 최저점 제외

    vi.restoreAllMocks();
  });
});

describe('ShadowAbCollector — flag snapshot 재진입 안전', () => {
  it('생성 시점 flag 를 snapshot — 생성 후 ON 토글해도 dormant 유지(스캔 1회 일관)', async () => {
    delete process.env.KIS_SHADOW_AB_ENABLED;
    const c = new ShadowAbCollector(); // OFF snapshot
    process.env.KIS_SHADOW_AB_ENABLED = 'true'; // 중간 토글
    c.add({ code: '005930', name: 'X', yahooGate: makeYahooGate({ gateScore: 8 }), weights: {} as never });
    expect(await c.flush()).toBe(0); // 생성 시점 OFF 일관 → no-op
    expect(fetchTechnicalQuoteByCode).not.toHaveBeenCalled();
  });
});
