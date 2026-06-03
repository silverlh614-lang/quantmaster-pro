/**
 * @responsibility Golden-master characterization harness pinning universeScanner Stage2
 * quote/supply enrichment output so Bundle-5 (V1b/V1c → snapshot featuresBySymbol[].quote/supply)
 * can be proven byte-equivalent.
 *
 * ── BUNDLE-5 합격 기준 (다음 단계 실행자가 반드시 충족) ──────────────────────────────────────
 * 1. golden 0변경: 아래 4개 시나리오 (a)KIS quote+supply 정상 enrich (b)quote(MTAS) enrich
 *    no-op (c)supply fetch 실패 (d)부분/RED-load supply skip 의 golden 단언이 snapshot
 *    입력화 후에도 0건 변경 없이 PASS 해야 한다 (값/필드 추가·삭제 금지).
 * 2. Gate 입력 동일성: evaluateServerGate 로 흘러드는 enriched quote + kisFlow(GATE_INPUTS 캡처)가
 *    snapshot 경유 후에도 동일해야 한다 — 이것이 byte-equivalence 의 핵심 비교점.
 * 3. quota 순증 0: enrichQuoteWithKisMTAS 호출 횟수(후보당 1) + fetchKisInvestorTradeByStockDaily
 *    호출 횟수/대상 집합(resolveKisInvestorFlowFetchTargets budget) 이 보존돼야 한다.
 * 4. flag OFF byte-equiv: evaluateKisChartFallbackAllowed.allowed=false 시 enrich 우회 →
 *    c.quote 원본 그대로 gate 입력 (시나리오 b 가 검증).
 * 5. 후보집합·순서 동일: Stage2 출력 candidate code 배열 + stage2Score 정렬 순서 + 통과/탈락
 *    (HOLD confluence 제거 포함) 이 보존돼야 한다.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * DOWNSTREAM GATE 입력 비교 지점 (snapshot 입력화 시 동일성 검증 필수):
 *  - V1b quote enrich:  server/screener/universeScanner.ts:452 enrichQuoteWithKisMTAS(c.quote, c.code)
 *                       → :454 evaluateServerGate(enrichedQuote, ...) 1차 평가 입력.
 *  - V1c supply fetch:  server/screener/universeScanner.ts:517 fetchKisInvestorTradeByStockDaily(c.code)
 *                       → :519 c.kisFlow 채움 → :538 evaluateServerGate(c.quote, ..., flow, ...) refresh 입력.
 *  - Gate2 소비점:      server/quant/gate2Diagnostics/externalCoverage.ts:260 (input.kisFlow null 분기)
 *                       + :607 foreignNetBuy/:608 institutionalNetBuy availability 판정.
 *  - Confluence carry:  server/screener/universeScanner.ts:576 runConfluenceEngine({quote, kisFlow})
 *                       → Stage2→Stage3 candidate.confluenceResult.
 *  본 하네스의 GATE_INPUTS 배열이 evaluateServerGate 1차/refresh 양쪽 입력 quote+kisFlow 를 캡처하므로,
 *  묶음5 후 이 캡처 값을 본 골든마스터와 대조하면 Gate 입력 동일성이 증명된다.
 *
 * 제약: universeScanner 본체 0줄 변경 (테스트/문서 전용). 신규 타입/enum 0. mock 은 기존
 *       universeScanner 테스트 관습(vi.mock + kisClient/stockScreener 경계 목)을 따른다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CandidateStock } from './pipelineHelpers.js';
import type { YahooQuoteExtended } from './adapters/yahooQuoteAdapter.js';

// ── KIS chart fallback 게이트: 기본 allowed=true (Stage2 enrich/supply 경로 활성) ──────────────
let chartFallbackAllowed = true;
vi.mock('../trading/kisChartFallbackGuard.js', () => ({
  evaluateKisChartFallbackAllowed: vi.fn(() => ({
    allowed: chartFallbackAllowed,
    session: 'REGULAR',
    reason: 'TEST',
    executionImpact: 'NONE',
    marketSignal: false,
    dataVacuum: false,
    newBuyBlocked: false,
    generalBuyBlocked: false,
    shadowLearning: true,
    engineAlive: true,
  })),
  formatPreopenKisFallbackSkippedLog: vi.fn(() => '[test] kis fallback skipped'),
}));

// ── KIS 경계 (V1c supply fetch 단일 통로) — KIS_IS_REAL=true 로 supply 경로 활성 ────────────────
const fetchKisInvestorTradeByStockDaily = vi.fn();
vi.mock('../clients/kisClient.js', () => ({
  realDataKisGet: vi.fn(async () => ({ output: [] })),
  HAS_REAL_DATA_CLIENT: true,
  KIS_IS_REAL: true,
  hasKisClientOverrides: () => true,
  fetchKisInvestorTradeByStockDaily: (code: string) =>
    fetchKisInvestorTradeByStockDaily(code),
}));

// ── stockScreener 경계 (V1b quote MTAS enrich 단일 통로) ─────────────────────────────────────
// enrich 는 결정적으로 quote 에 __mtasEnriched 마커 + monthlyAboveEMA12 plug 를 더한다.
const enrichQuoteWithKisMTAS = vi.fn(
  async (quote: YahooQuoteExtended, code: string) => ({
    ...quote,
    monthlyAboveEMA12: true,
    monthlyEMARising: true,
    // 캡처 가능 마커 — enrich 가 실제로 적용됐는지 골든에서 확인.
    __mtasEnriched: code,
  }),
);
vi.mock('./stockScreener.js', () => ({
  fetchYahooQuote: vi.fn(),
  fetchKisQuoteFallback: vi.fn(),
  enrichQuoteWithKisMTAS: (q: YahooQuoteExtended, code: string) =>
    enrichQuoteWithKisMTAS(q, code),
  STOCK_UNIVERSE: [],
}));

vi.mock('./adapters/kisQuoteAdapter.js', () => ({
  logKisMtasNoiseSummary: vi.fn(),
  resetKisMtasNoiseSummary: vi.fn(),
}));

// ── Gate 평가 결정적 스텁 — 입력(quote+kisFlow)을 GATE_INPUTS 로 캡처 (Gate 입력 동일성 비교점). ──
interface GateInputCapture {
  code: string;
  stage: 'PRIMARY' | 'REFRESH';
  mtasEnriched: unknown;
  monthlyAboveEMA12: boolean;
  foreignNetBuy: number | null;
  institutionalNetBuy: number | null;
}
const GATE_INPUTS: GateInputCapture[] = [];
// gateScore 는 quote.changePercent 기반 결정적 산출 → SKIP/통과 분기 재현.
const evaluateServerGate = vi.fn(
  (
    quote: YahooQuoteExtended & { __mtasEnriched?: unknown },
    _weights: unknown,
    _kospi20dReturn: unknown,
    _dartFin: unknown,
    kisFlow: { foreignNetBuy?: number; institutionalNetBuy?: number } | null,
  ) => {
    GATE_INPUTS.push({
      code: String((quote as unknown as Record<string, unknown>).__code ?? ''),
      stage: kisFlow ? 'REFRESH' : 'PRIMARY',
      mtasEnriched: quote.__mtasEnriched ?? null,
      monthlyAboveEMA12: quote.monthlyAboveEMA12,
      foreignNetBuy: kisFlow?.foreignNetBuy ?? null,
      institutionalNetBuy: kisFlow?.institutionalNetBuy ?? null,
    });
    const cp = quote.changePercent;
    const signalType = cp < 0 ? 'SKIP' : 'NORMAL';
    const gateScore = Math.max(0, cp);
    return {
      gateScore,
      rawScore: gateScore,
      availableMaxScore: 27,
      normalizedGateScore: gateScore / 27,
      signalType,
      details: [`gate:${signalType}`],
      conditionKeys: signalType === 'SKIP' ? [] : ['cond_test'],
      outputs: [],
      gateLayerSummary: undefined,
      gateEvaluation: { gate2Passed: signalType !== 'SKIP', unavailableKeys: [] },
    };
  },
);
vi.mock('../quantFilter.js', () => ({
  evaluateServerGate: (
    q: YahooQuoteExtended,
    w: unknown,
    k: unknown,
    d: unknown,
    f: unknown,
  ) => evaluateServerGate(q, w, k, d, f as never),
}));

// ── Confluence 결정적 스텁 — gateScore<2 → HOLD (confluence 필터 분기 재현). ──────────────────
const runConfluenceEngine = vi.fn((input: { gateScore: number }) => ({
  bullishAxes: input.gateScore >= 2 ? 3 : 1,
  signal: input.gateScore >= 2 ? 'BUY' : 'HOLD',
  cyclePosition: 'MID',
  catalystGrade: 'B',
}));
vi.mock('../trading/confluenceEngine.js', () => ({
  runConfluenceEngine: (i: { gateScore: number }) => runConfluenceEngine(i),
}));

// ── ETF boost: 결정적 0 (V1b/V1c scope 외 side-input 고정). ─────────────────────────────────
vi.mock('../alerts/globalScanAgent.js', () => ({
  computeEtfSectorBoost: vi.fn(() => ({ boost: 0, reasons: [] })),
}));

// ── 순수/파일 의존 보조 모듈 결정적 고정. ────────────────────────────────────────────────────
vi.mock('../persistence/conditionWeightsRepo.js', () => ({
  loadConditionWeights: vi.fn(() => ({})),
}));
vi.mock('../persistence/watchlistRepo.js', () => ({
  loadWatchlist: vi.fn(() => []),
  saveWatchlist: vi.fn(),
}));
// resolveKisInvestorFlowFetchTargets 가 의존하는 watchlist section 매핑 — 전부 MOMENTUM 처리.
vi.mock('./watchlistManager.js', () => ({
  computeFocusCodes: vi.fn(() => new Set<string>()),
  assignSection: vi.fn(() => 'MOMENTUM'),
  addToWatchlist: vi.fn(() => ({ added: false })),
}));
vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(async () => undefined),
}));
// getLeadingSectors 는 실제 사용(섹터 보너스). 나머지 pipelineHelpers 는 실제 유지.

import { stage2SectorGateFilter } from './universeScanner.js';

// ── 결정적 quote 팩토리 (Gate 스텁이 changePercent 만 읽으므로 최소 필드로 충분). ──────────────
function makeQuote(code: string, changePercent: number): YahooQuoteExtended {
  return {
    __code: code,
    price: 10000,
    dayOpen: 9900,
    prevClose: 9800,
    changePercent,
    volume: 1_000_000,
    avgVolume: 500_000,
    ma5: 9900,
    ma20: 9700,
    ma60: 9500,
    high5d: 10100,
    high20d: 10200,
    high60d: 10500,
    atr: 200,
    atr20avg: 180,
    per: 12,
    rsi14: 60,
    macd: 1,
    macdSignal: 0.5,
    macdHistogram: 0.5,
    rsi5dAgo: 55,
    weeklyRSI: 58,
    ma60TrendUp: true,
    macd5dHistAgo: 0.2,
    return5d: 3,
    return20d: 8,
    bbWidthCurrent: 0.05,
    bbWidth20dAvg: 0.06,
    vol5dAvg: 900_000,
    vol20dAvg: 800_000,
    atr5d: 190,
    monthlyAboveEMA12: false,
    monthlyEMARising: false,
    weeklyAboveCloud: false,
    weeklyLaggingSpanUp: false,
    dailyVolumeDrying: false,
    isHighRisk: false,
  } as unknown as YahooQuoteExtended;
}

function makeCandidate(
  code: string,
  changePercent: number,
  stage1Score: number,
): CandidateStock {
  return {
    code,
    name: `종목${code}`,
    symbol: `${code}.KS`,
    sector: '반도체',
    quote: makeQuote(code, changePercent),
    stage1Score,
  };
}

/** GOLDEN — Stage2 출력 후보집합·순서·필드 projection (묶음5 흡수 후 byte 동일 비교 대상). */
function goldenProjection(results: CandidateStock[]) {
  return results.map((c) => ({
    code: c.code,
    gateScore: c.gateScore,
    gateSignal: c.gateSignal,
    stage2Score: c.stage2Score,
    // V1b: enriched quote 가 candidate.quote 로 carry 됐는지.
    quoteMtasEnriched:
      (c.quote as unknown as Record<string, unknown>).__mtasEnriched ?? null,
    quoteMonthlyAboveEMA12: (c.quote as unknown as Record<string, unknown>)
      .monthlyAboveEMA12,
    // V1c: supply fetch 결과가 kisFlow 로 carry 됐는지.
    kisFlow: c.kisFlow
      ? {
          foreignNetBuy: c.kisFlow.foreignNetBuy,
          institutionalNetBuy: c.kisFlow.institutionalNetBuy,
        }
      : null,
    confluenceSignal: c.confluenceResult?.signal ?? null,
  }));
}

describe('universeScanner Stage2 golden master (Bundle-5 byte-equivalence safety net)', () => {
  beforeEach(() => {
    GATE_INPUTS.length = 0;
    chartFallbackAllowed = true;
    fetchKisInvestorTradeByStockDaily.mockReset();
    enrichQuoteWithKisMTAS.mockClear();
    evaluateServerGate.mockClear();
    runConfluenceEngine.mockClear();
    delete process.env.KIS_LOAD_STATE;
  });

  // ── 시나리오 (a): KIS quote(MTAS) + supply 정상 enrich → 후보 통과 + kisFlow carry ───────────
  it('(a) KIS quote+supply success → enriched quote & kisFlow carried (golden master)', async () => {
    fetchKisInvestorTradeByStockDaily.mockImplementation(async (code: string) => ({
      foreignNetBuy: code === '000001' ? 5000 : 3000,
      institutionalNetBuy: code === '000001' ? 2000 : 1000,
      individualNetBuy: -7000,
      actualRows: [],
    }));

    const input = [
      makeCandidate('000001', 5, 10),
      makeCandidate('000002', 3, 8),
    ];
    const result = await stage2SectorGateFilter(input, 'R4_NEUTRAL', {
      kospi20dReturn: 2,
      kospiDayReturn: 0.5,
    } as never);

    expect(goldenProjection(result)).toEqual([
      {
        code: '000001',
        gateScore: 5,
        gateSignal: 'NORMAL',
        // stage2Score = gateScore*sectorBonus(1.0, 반도체 비주도) + stage1*0.3 + flowBonus(0.5)
        stage2Score: 5 + 10 * 0.3 + 0.5,
        quoteMtasEnriched: '000001',
        quoteMonthlyAboveEMA12: true,
        kisFlow: { foreignNetBuy: 5000, institutionalNetBuy: 2000 },
        confluenceSignal: 'BUY',
      },
      {
        code: '000002',
        gateScore: 3,
        gateSignal: 'NORMAL',
        stage2Score: 3 + 8 * 0.3 + 0.5,
        quoteMtasEnriched: '000002',
        quoteMonthlyAboveEMA12: true,
        kisFlow: { foreignNetBuy: 3000, institutionalNetBuy: 1000 },
        confluenceSignal: 'BUY',
      },
    ]);

    // Gate 입력 동일성: 1차(PRIMARY) 평가는 enriched quote, refresh 는 kisFlow 동반.
    const primary = GATE_INPUTS.filter((g) => g.stage === 'PRIMARY');
    const refresh = GATE_INPUTS.filter((g) => g.stage === 'REFRESH');
    expect(primary.map((g) => ({ code: g.code, mtas: g.mtasEnriched }))).toEqual([
      { code: '000001', mtas: '000001' },
      { code: '000002', mtas: '000002' },
    ]);
    expect(refresh.map((g) => ({ code: g.code, fb: g.foreignNetBuy }))).toEqual([
      { code: '000001', fb: 5000 },
      { code: '000002', fb: 3000 },
    ]);
    // quota: enrich 후보당 1회, supply fetch 대상 2개.
    expect(enrichQuoteWithKisMTAS).toHaveBeenCalledTimes(2);
    expect(fetchKisInvestorTradeByStockDaily).toHaveBeenCalledTimes(2);
  }, 15000);

  // ── 시나리오 (b): chartFallback OFF → enrich 우회 (flag OFF byte-equiv) ───────────────────────
  it('(b) chartFallback disallowed → enrich bypassed, raw quote to gate (flag OFF)', async () => {
    chartFallbackAllowed = false;
    const input = [makeCandidate('000010', 4, 6)];
    const result = await stage2SectorGateFilter(input, 'R4_NEUTRAL', {
      kospi20dReturn: 1,
    } as never);

    expect(goldenProjection(result)).toEqual([
      {
        code: '000010',
        gateScore: 4,
        gateSignal: 'NORMAL',
        // flag OFF: enrich 우회 → flowBonus 없음(supply 경로도 enrich 게이트와 동일 분기로 skip).
        stage2Score: 4 + 6 * 0.3,
        quoteMtasEnriched: null, // enrich 미적용 → 마커 부재.
        quoteMonthlyAboveEMA12: false, // 원본 quote 그대로.
        kisFlow: null,
        confluenceSignal: 'BUY',
      },
    ]);
    expect(enrichQuoteWithKisMTAS).not.toHaveBeenCalled();
    expect(fetchKisInvestorTradeByStockDaily).not.toHaveBeenCalled();
    // Gate 입력: enrich 우회 시 PRIMARY 입력은 원본 quote(__mtasEnriched 없음).
    expect(GATE_INPUTS.filter((g) => g.stage === 'PRIMARY')[0]).toMatchObject({
      code: '000010',
      mtasEnriched: null,
      monthlyAboveEMA12: false,
    });
  }, 15000);

  // ── 시나리오 (c): supply fetch 실패(throw) → kisFlow 미부착, 후보는 enriched quote 로 잔존 ────
  it('(c) supply fetch failure → no kisFlow, candidate survives with enriched quote', async () => {
    fetchKisInvestorTradeByStockDaily.mockImplementation(async () => {
      throw new Error('KIS investor flow down');
    });
    const input = [makeCandidate('000020', 6, 9)];
    const result = await stage2SectorGateFilter(input, 'R4_NEUTRAL', {
      kospi20dReturn: 1,
    } as never);

    expect(goldenProjection(result)).toEqual([
      {
        code: '000020',
        gateScore: 6,
        gateSignal: 'NORMAL',
        // supply 실패 → flowBonus 없음, refresh gate 미수행 (현재 동작: flow 없으면 if(flow) 블록 skip).
        stage2Score: 6 + 9 * 0.3,
        quoteMtasEnriched: '000020', // enrich 는 정상 적용.
        quoteMonthlyAboveEMA12: true,
        kisFlow: null, // supply 실패 → 미부착.
        confluenceSignal: 'BUY',
      },
    ]);
    // supply 실패해도 throw 0 (Stage2 always-on) — fetch 는 1회 시도.
    expect(fetchKisInvestorTradeByStockDaily).toHaveBeenCalledTimes(1);
    // refresh gate 는 호출되지 않음 (flow 없으면 refresh skip).
    expect(GATE_INPUTS.filter((g) => g.stage === 'REFRESH')).toHaveLength(0);
  }, 15000);

  // ── 시나리오 (d): supply accepted-empty(null) + 음수 changePercent SKIP → 후보 탈락/순서 ──────
  it('(d) SKIP gate signal drops candidate; supply null = no kisFlow (set/order golden)', async () => {
    fetchKisInvestorTradeByStockDaily.mockImplementation(async () => null);
    const input = [
      makeCandidate('000030', 7, 12), // 통과
      makeCandidate('000031', -2, 20), // changePercent<0 → SKIP 탈락
      makeCandidate('000032', 1, 5), // gateScore=1 → confluence HOLD 제거
    ];
    const result = await stage2SectorGateFilter(input, 'R4_NEUTRAL', {
      kospi20dReturn: 1,
    } as never);

    // 후보집합·순서: SKIP(000031) 탈락 + HOLD(000032) confluence 제거 → 000030 만 잔존.
    expect(goldenProjection(result)).toEqual([
      {
        code: '000030',
        gateScore: 7,
        gateSignal: 'NORMAL',
        stage2Score: 7 + 12 * 0.3, // supply null → flowBonus 없음.
        quoteMtasEnriched: '000030',
        quoteMonthlyAboveEMA12: true,
        kisFlow: null,
        confluenceSignal: 'BUY',
      },
    ]);
    // SKIP 후보(000031)는 supply fetch 대상에서 제외 — quota 보존(통과 후보만 fetch).
    expect(fetchKisInvestorTradeByStockDaily.mock.calls.map((c) => c[0])).not.toContain(
      '000031',
    );
  }, 15000);

  // ── 불변식 가드: 어떤 supply 실패 조합에도 Stage2 throw 0 (engine always-on). ──────────────────
  it('never throws under supply fetch failure permutations (throw 0)', async () => {
    const perms: Array<() => Promise<unknown>> = [
      () => {
        fetchKisInvestorTradeByStockDaily.mockImplementation(async () => {
          throw new Error('x');
        });
        return stage2SectorGateFilter([makeCandidate('000040', 5, 5)], 'R4_NEUTRAL', null);
      },
      () => {
        fetchKisInvestorTradeByStockDaily.mockImplementation(async () => null);
        return stage2SectorGateFilter([makeCandidate('000041', 5, 5)], 'R4_NEUTRAL', null);
      },
    ];
    for (const run of perms) {
      await expect(run()).resolves.toBeDefined();
    }
  }, 15000);
});
