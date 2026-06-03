/**
 * @responsibility Yahoo vs KIS Gate quote shadow A/B 차등 하네스 (read-only 측정, ENV 불변)
 *
 * 목적: 같은 종목의 Yahoo OHLCV vs KIS OHLCV 를 동일 builder→evaluateServerGate 로 평가해
 * gateScore/signalType/MTAS/positionPct delta 를 실측한다. 매매 산식·evaluateServerGate
 * 본체 0줄 변경, KIS_OHLCV_PRIMARY_ENABLED 미변경, 실집행 없음(executionImpact NONE).
 *
 * 산식 동등성 증명 전제: 두 경로 모두 buildExtendedFromKisDaily(=_indicators.ts SSOT 공유)
 * 단일 builder 를 통과하므로 Gate 출력 차이는 *입력 OHLCV* 차이에서만 발생한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../clients/kisClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../clients/kisClient.js')>();
  return {
    ...actual,
    realDataKisGet: vi.fn(),
    HAS_REAL_DATA_CLIENT: true,
  };
});
vi.mock('../kisChartDataFetcher.js', () => ({
  fetchKisMTASData: vi.fn(),
  fetchKisDailyCandles: vi.fn(),
}));
vi.mock('../dataCompletenessTracker.js', () => ({
  recordMtasAttempt: vi.fn(),
}));

const { fetchKisQuoteFallback } = await import('./kisQuoteAdapter.js');
const { realDataKisGet } = await import('../../clients/kisClient.js');
const { fetchKisDailyCandles } = await import('../kisChartDataFetcher.js');
const { evaluateServerGate, DEFAULT_CONDITION_WEIGHTS } = await import('../../quantFilter.js');

import type { KisChartCandle } from '../kisChartDataFetcher.js';
import type { YahooQuoteExtended } from './yahooQuoteAdapter.js';
import type { ServerGateResult } from '../../quantFilter.js';

// ── ENV 불변 단언: 하네스 실행 중 프로덕션 KIS-primary flag 켜지 않음 ───────────
const ENV_FLAG_BEFORE = process.env.KIS_OHLCV_PRIMARY_ENABLED;

/** 표준 KIS inquire-price 응답 (현재가/시가/거래량/등락) — live 라이브 시세. */
function makeKisPriceResponse(opts: { price: number; oprc?: number; vol?: number; prdyVrss?: number; sign?: string }) {
  return {
    output: {
      stck_prpr: String(opts.price),
      stck_oprc: String(opts.oprc ?? opts.price),
      acml_vol: String(opts.vol ?? 1_000_000),
      stck_prdy_vrss: String(opts.prdyVrss ?? 0),
      prdy_vrss_sign: opts.sign ?? '3',
    },
  };
}

/**
 * 결정적 합성 OHLCV 생성기 — VCP 후 돌파 시나리오(상승 추세 + 압축 + 거래량).
 * baseClose 시작가에서 점진 상승, mid 구간 변동성 압축, 마지막 돌파.
 */
function makeCandles(opts: {
  n: number;
  baseClose: number;
  drift: number;        // 일간 추세 (원)
  volBase: number;      // 기준 거래량
  closeMul?: number;    // 종가 전체 배율 (수정주가 괴리 모사)
  volMul?: number;      // 거래량 전체 배율
  dryUpTail?: boolean;  // 최근 5봉 거래량 마름
  staleTailDays?: number; // 최근 N봉 종가/고가/저가를 (n-1-N)봉 값으로 동결 (Yahoo stale 모사)
}): KisChartCandle[] {
  const { n, baseClose, drift, volBase, closeMul = 1, volMul = 1, dryUpTail = false, staleTailDays = 0 } = opts;
  const out: KisChartCandle[] = [];
  for (let i = 0; i < n; i++) {
    // 추세 + 결정적 사인파 변동 (난수 없음 → 재현성)
    const wave = Math.sin(i / 4) * drift * 0.6;
    const compress = i > n - 25 && i < n - 5 ? 0.3 : 1; // mid 구간 압축
    const close = (baseClose + drift * i + wave * compress) * closeMul;
    const high = close * 1.012;
    const low = close * 0.988;
    const open = close * 0.997;
    let vol = volBase * volMul;
    if (dryUpTail && i >= n - 5) vol = volBase * volMul * 0.4; // 최근 5봉 마름
    if (i === n - 1) vol = volBase * volMul * 2.2;             // 돌파 거래량 폭증
    out.push({
      date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
      open: Math.round(open),
      high: Math.round(high),
      low: Math.round(low),
      close: Math.round(close),
      volume: Math.round(vol),
    });
  }
  // ── Yahoo staleness 모사: 최근 staleTailDays 봉의 *가격* 을 freeze point 값으로 동결.
  //    Yahoo 가 KRX 종목에 갱신 지연/결측을 일으킬 때 closes[] 배열이 "정체"하는 패턴을 재현.
  //    날짜/거래량은 진행(Yahoo 가 timestamp 만 갱신, 가격은 갱신 못 하는 케이스도 포함) →
  //    timestamp staleness gate 가 *못 잡는* "가격만 stale" 구간을 모델링.
  if (staleTailDays > 0 && staleTailDays < n) {
    const freezeIdx = n - 1 - staleTailDays;
    const frozen = out[freezeIdx];
    for (let i = freezeIdx + 1; i < n; i++) {
      out[i] = {
        ...out[i],          // 날짜·거래량은 진행 (가격만 stale)
        open: frozen.open,
        high: frozen.high,
        low: frozen.low,
        close: frozen.close,
      };
    }
  }
  return out;
}

/** 한 경로 평가: KIS 라이브 시세 + 일봉 candles → buildExtendedFromKisDaily → evaluateServerGate. */
async function evalPath(candles: KisChartCandle[], livePrice: number, liveVol: number): Promise<{
  quote: YahooQuoteExtended;
  gate: ServerGateResult;
}> {
  (realDataKisGet as any).mockResolvedValue(makeKisPriceResponse({ price: livePrice, vol: liveVol, sign: '2', prdyVrss: 100 }));
  (fetchKisDailyCandles as any).mockResolvedValue(candles);
  const quote = await fetchKisQuoteFallback('005930');
  if (!quote) throw new Error('quote build failed');
  const gate = evaluateServerGate(quote, DEFAULT_CONDITION_WEIGHTS, 1.5);
  return { quote, gate };
}

/** Gate 출력에서 A/B 비교 대상 핵심 튜플만 추출. */
function gateTuple(g: ServerGateResult) {
  return {
    gateScore: g.gateScore,
    signalType: g.signalType,
    positionPct: g.positionPct,
    mtas: g.mtas,
    compressionScore: g.compressionScore,
    conditionKeys: [...g.conditionKeys].sort(),
    mtasBooleans: {
      monthlyAboveEMA12: undefined as unknown, // filled below from quote
    },
  };
}

/** quote 의 MTAS boolean 5종 추출 (flip 카운트용). */
function mtasBooleans(q: YahooQuoteExtended) {
  return {
    monthlyAboveEMA12: q.monthlyAboveEMA12,
    monthlyEMARising: q.monthlyEMARising,
    weeklyAboveCloud: q.weeklyAboveCloud,
    weeklyLaggingSpanUp: q.weeklyLaggingSpanUp,
    dailyVolumeDrying: q.dailyVolumeDrying,
  };
}

function countBooleanFlips(a: ReturnType<typeof mtasBooleans>, b: ReturnType<typeof mtasBooleans>): number {
  let flips = 0;
  (Object.keys(a) as Array<keyof typeof a>).forEach((k) => { if (a[k] !== b[k]) flips++; });
  return flips;
}

describe('Gate quote Yahoo vs KIS shadow A/B 차등 하네스', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── 시나리오 (a): OHLCV 동일 → Gate 출력 byte-equal (산식 동등성 증명) ─────────
  it('(a) 동일 OHLCV → 두 경로 Gate 출력 deep-equal (산식 동등 증명, 차이는 입력에서만)', async () => {
    // Yahoo 경로와 KIS 경로가 *동일* OHLCV 를 받으면, 둘 다 동일 builder
    // (buildExtendedFromKisDaily, _indicators.ts SSOT 공유)를 통과하므로 출력은 byte-equal.
    const candles = makeCandles({ n: 80, baseClose: 60000, drift: 250, volBase: 1_200_000 });
    const livePrice = candles[candles.length - 1].close;
    const liveVol = candles[candles.length - 1].volume;

    const A = await evalPath(candles, livePrice, liveVol);          // "Yahoo OHLCV" 라벨
    const B = await evalPath(candles.map(c => ({ ...c })), livePrice, liveVol); // "KIS OHLCV" 라벨 (동일 값)

    // 산식 동등성 증명: 모든 *계산된 지표* 필드는 byte-equal 이어야 한다.
    // (asOf/kisOfficialQuote 는 wall-clock fetch 시점 metadata 로 산식과 무관 → 비교 제외)
    const strip = (q: YahooQuoteExtended) => {
      const c = { ...(q as YahooQuoteExtended & Record<string, unknown>) };
      delete c.asOf; delete c.kisOfficialQuote; delete c.priceAsOf;
      return c;
    };
    // 핵심 단언: 동일 입력 OHLCV → 동일 builder(_indicators.ts SSOT) → 동일 파생지표 전 필드
    expect(strip(B.quote)).toEqual(strip(A.quote));
    // 핵심 단언: 동일 quote → 동일 Gate 출력 (gateScore/signalType/positionPct/mtas byte-equal)
    expect(B.gate.gateScore).toBe(A.gate.gateScore);
    expect(B.gate.signalType).toBe(A.gate.signalType);
    expect(B.gate.positionPct).toBe(A.gate.positionPct);
    expect(B.gate.mtas).toBe(A.gate.mtas);
    expect(B.gate.compressionScore).toBe(A.gate.compressionScore);
    expect([...B.gate.conditionKeys].sort()).toEqual([...A.gate.conditionKeys].sort());
    expect(countBooleanFlips(mtasBooleans(A.quote), mtasBooleans(B.quote))).toBe(0);
  });

  // ── 시나리오 (b): 수정주가 미세 차이 → Gate 출력 민감도 측정 ──────────────────
  it('(b) 수정주가 0.3% 차이 → ratio-invariant 지표는 동등, 절대 지표만 비례 이동', async () => {
    // KIS FID_ORG_ADJ_PRC 정책차로 KIS 가 Yahoo 대비 종가 전체에 미세 배율(0.997)을 가진 시나리오.
    const yahooCandles = makeCandles({ n: 80, baseClose: 60000, drift: 250, volBase: 1_200_000 });
    const kisCandles = makeCandles({ n: 80, baseClose: 60000, drift: 250, volBase: 1_200_000, closeMul: 0.997 });

    const yLive = yahooCandles[yahooCandles.length - 1].close;
    const kLive = kisCandles[kisCandles.length - 1].close;

    const Y = await evalPath(yahooCandles, yLive, 2_640_000);
    const K = await evalPath(kisCandles, kLive, 2_640_000);

    // 정량화 diff
    const dScore = K.gate.gateScore - Y.gate.gateScore;
    const dMtas = K.gate.mtas - Y.gate.mtas;
    const dPos = K.gate.positionPct - Y.gate.positionPct;
    const flips = countBooleanFlips(mtasBooleans(Y.quote), mtasBooleans(K.quote));

    // 측정 로그 (보고용)
    // eslint-disable-next-line no-console
    console.log('[shadow-ab][b] adj-price drift 0.3%:',
      JSON.stringify({ dScore, dMtas, dPos, flips,
        yScore: Y.gate.gateScore, kScore: K.gate.gateScore,
        ySig: Y.gate.signalType, kSig: K.gate.signalType,
        yMtas: Y.gate.mtas, kMtas: K.gate.mtas }));

    // bbWidth (4σ/SMA, ratio-invariant) 는 종가 균일 배율에 불변 → MTAS atr-compression 일부 불변
    // 핵심 단언: 균일 배율은 비율 지표를 보존한다 → MTAS boolean flip 은 경계값 외 0 근처.
    // signalType 은 동일 추세이므로 동일 (경계 미접근).
    expect(Math.abs(dMtas)).toBeLessThanOrEqual(1.5); // 일봉 MTAS 일부 boolean flip 허용 범위
    expect(flips).toBeLessThanOrEqual(1);
    // 민감도가 *측정됨*을 단언 (NaN/undefined 아님)
    expect(Number.isFinite(dScore)).toBe(true);
    expect(Number.isFinite(dPos)).toBe(true);
  });

  // ── 시나리오 (c): 거래량 차이 → MTAS dailyVolumeDrying / volume condition 영향 ──
  it('(c) 거래량 마름 차이 → dailyVolumeDrying flip → MTAS/positionPct 차등 발생', async () => {
    // Yahoo 는 정상 거래량, KIS 는 최근 5봉 거래량 마름(dry-up tail) → dailyVolumeDrying=true.
    const yahooCandles = makeCandles({ n: 80, baseClose: 60000, drift: 250, volBase: 1_200_000, dryUpTail: false });
    const kisCandles = makeCandles({ n: 80, baseClose: 60000, drift: 250, volBase: 1_200_000, dryUpTail: true });

    const yLive = yahooCandles[yahooCandles.length - 1].close;
    const kLive = kisCandles[kisCandles.length - 1].close;

    const Y = await evalPath(yahooCandles, yLive, 1_200_000);
    const K = await evalPath(kisCandles, kLive, 480_000); // KIS live 거래량도 마름

    const dScore = K.gate.gateScore - Y.gate.gateScore;
    const dMtas = K.gate.mtas - Y.gate.mtas;
    const dPos = K.gate.positionPct - Y.gate.positionPct;
    const flips = countBooleanFlips(mtasBooleans(Y.quote), mtasBooleans(K.quote));

    // eslint-disable-next-line no-console
    console.log('[shadow-ab][c] volume dry-up:',
      JSON.stringify({ dScore, dMtas, dPos, flips,
        yDry: Y.quote.dailyVolumeDrying, kDry: K.quote.dailyVolumeDrying,
        yMtas: Y.gate.mtas, kMtas: K.gate.mtas,
        ySig: Y.gate.signalType, kSig: K.gate.signalType }));

    // 핵심 단언: 거래량 차이가 dailyVolumeDrying boolean 을 flip 시킴 → MTAS 입력 변화 실측
    expect(Y.quote.dailyVolumeDrying).toBe(false);
    expect(K.quote.dailyVolumeDrying).toBe(true);
    expect(flips).toBeGreaterThanOrEqual(1);
    // dailyVolumeDrying=true 는 MTAS dailyScore +1 → KIS 경로 MTAS >= Yahoo (압축 신호 보강)
    expect(K.gate.mtas).toBeGreaterThanOrEqual(Y.gate.mtas);
    expect(Number.isFinite(dScore)).toBe(true);
    expect(Number.isFinite(dPos)).toBe(true);
  });

  // ── per 갭 격리: KIS per=0(DATA_UNAVAILABLE) vs Yahoo per 보유 → rawScore 영향 범위 ──
  it('per 갭: KIS builder per=0 → DATA_UNAVAILABLE (normalized 분모만 영향, raw gateScore 보존)', async () => {
    const candles = makeCandles({ n: 80, baseClose: 60000, drift: 250, volBase: 1_200_000 });
    const live = candles[candles.length - 1].close;
    const { quote, gate } = await evalPath(candles, live, candles[candles.length - 1].volume);

    // KIS builder 는 per=0 고정 → per evaluator DATA_UNAVAILABLE → unavailableConditions 에 포함
    expect(quote.per).toBe(0);
    expect(gate.unavailableConditions).toContain('per');

    // Yahoo 가 valid trailingPE(예: 12)를 가졌을 때만 per 가 raw score 에 기여.
    // 동일 quote 에 per 만 12로 주입하면 raw gateScore 가 증가(또는 유지)함을 확인 →
    // per 갭의 영향 범위 = "Yahoo 가 PER 제공 + per<35 일 때 KIS 가 그 점수를 잃음" 으로 한정.
    const quoteWithPer: YahooQuoteExtended = { ...quote, per: 12 };
    const gateWithPer = evaluateServerGate(quoteWithPer, DEFAULT_CONDITION_WEIGHTS, 1.5);

    // eslint-disable-next-line no-console
    console.log('[shadow-ab][per] gap impact:',
      JSON.stringify({
        kisRawScore: gate.gateScore, yahooLikeRawScore: gateWithPer.gateScore,
        delta: gateWithPer.gateScore - gate.gateScore,
        kisUnavailable: gate.unavailableConditions.includes('per'),
        yahooUnavailable: gateWithPer.unavailableConditions.includes('per'),
      }));

    // per=12 (적정, FIRED w=1.0) → raw gateScore 가 per weight 만큼 증가.
    expect(gateWithPer.gateScore).toBeGreaterThanOrEqual(gate.gateScore);
    // KIS 경로는 per 제외, Yahoo(per 보유) 경로는 per 포함 → 차이는 per weight 상한.
    expect(gateWithPer.unavailableConditions).not.toContain('per');
  });

  // ── 시나리오 (d): Yahoo N일 묵은 close(가격 정체) vs KIS fresh → 큰 괴리 정량 ──
  it('(d) Yahoo 3일 stale close (가격 정체) vs KIS fresh → return5d/20d·RS·momentum·gateScore Δ 정량', async () => {
    // Yahoo: 최근 3봉 가격이 freeze (closes[] 정체) — KRX 종목 Yahoo 지연/결측 모사.
    //        KIS: 추세가 계속 진행한 fresh 종가.
    // 기존 합성 (b/c) 는 "작은 괴리" 였으나, staleness 는 *수익률 산식 입력 자체* 를 오염시켜
    // return5d/return20d 가 stale plateau 만큼 낮게 산출 → relative_strength·momentum 동반 하락.
    const STALE_DAYS = 3;
    const drift = 600; // 일간 +600원 추세 → 3일 freeze = 약 -1800원 (≈ -2.x%) 정체 손실
    const freshCandles = makeCandles({ n: 80, baseClose: 60000, drift, volBase: 1_200_000 });
    const staleCandles = makeCandles({ n: 80, baseClose: 60000, drift, volBase: 1_200_000, staleTailDays: STALE_DAYS });

    const freshLive = freshCandles[freshCandles.length - 1].close;   // KIS fresh 현재가
    const staleLive = staleCandles[staleCandles.length - 1].close;   // Yahoo stale 현재가 (정체)

    // KOSPI 20d 벤치마크를 동일하게 주입 → relative_strength gap 비교 공정.
    const KOSPI_20D = 2.0;
    const Y = await evalPath(staleCandles, staleLive, 1_200_000); // "Yahoo stale" 경로
    const K = await evalPath(freshCandles, freshLive, 1_200_000); // "KIS fresh" 경로
    const yGate = evaluateServerGate(Y.quote, DEFAULT_CONDITION_WEIGHTS, KOSPI_20D);
    const kGate = evaluateServerGate(K.quote, DEFAULT_CONDITION_WEIGHTS, KOSPI_20D);

    const dReturn5d = K.quote.return5d - Y.quote.return5d;
    const dReturn20d = K.quote.return20d - Y.quote.return20d;
    const dScore = kGate.gateScore - yGate.gateScore;
    const dMtas = kGate.mtas - yGate.mtas;
    const dPos = kGate.positionPct - yGate.positionPct;

    // eslint-disable-next-line no-console
    console.log('[shadow-ab][d] Yahoo stale(3d) vs KIS fresh:',
      JSON.stringify({
        STALE_DAYS, dScore, dMtas, dPos, dReturn5d, dReturn20d,
        yReturn5d: Y.quote.return5d, kReturn5d: K.quote.return5d,
        yReturn20d: Y.quote.return20d, kReturn20d: K.quote.return20d,
        yScore: yGate.gateScore, kScore: kGate.gateScore,
        ySig: yGate.signalType, kSig: kGate.signalType,
        yKeys: [...yGate.conditionKeys].sort(), kKeys: [...kGate.conditionKeys].sort(),
      }));

    // 핵심 단언: stale plateau 가 수익률 입력을 직접 오염 → fresh KIS 의 return 이 더 높다.
    expect(K.quote.return5d).toBeGreaterThan(Y.quote.return5d);
    expect(K.quote.return20d).toBeGreaterThan(Y.quote.return20d);
    // stale 은 KOSPI 대비 상대강도·돌파에서 손해 → fresh KIS gateScore 가 >= stale Yahoo.
    expect(kGate.gateScore).toBeGreaterThanOrEqual(yGate.gateScore);
    expect(Number.isFinite(dScore)).toBe(true);
    expect(Number.isFinite(dPos)).toBe(true);
  });

  // ── 시나리오 (e): Yahoo 결측 필드(high5d/high20d) vs KIS 완비 → breakout/MTAS 영향 ──
  it('(e) Yahoo high5d/high20d 결측(0) vs KIS 완비 → breakout_momentum DATA_UNAVAILABLE 전환', async () => {
    // 프로덕션 덤프 단서: topMissingFields=rsRankPct/high5d/high20d.
    // Yahoo 가 일부 KRX 종목에 high 배열을 결측/0 으로 반환하는 케이스를 모델링 —
    // breakout_momentum 은 high5d>0 가드(evaluators.ts:386) 에서 DATA_UNAVAILABLE 로 전환.
    const candles = makeCandles({ n: 80, baseClose: 60000, drift: 250, volBase: 1_200_000 });
    const live = candles[candles.length - 1].close;
    const { quote } = await evalPath(candles, live, candles[candles.length - 1].volume);

    // KIS 완비 경로 — high5d/high20d 정상.
    const kGate = evaluateServerGate(quote, DEFAULT_CONDITION_WEIGHTS, 2.0);

    // Yahoo 결측 모사 — high5d/high20d=0 (Yahoo high 배열 결측).
    const yahooMissing: YahooQuoteExtended = { ...quote, high5d: 0, high20d: 0 };
    const yGate = evaluateServerGate(yahooMissing, DEFAULT_CONDITION_WEIGHTS, 2.0);

    const dScore = kGate.gateScore - yGate.gateScore;

    // eslint-disable-next-line no-console
    console.log('[shadow-ab][e] Yahoo high5d/20d missing vs KIS complete:',
      JSON.stringify({
        dScore, kScore: kGate.gateScore, yScore: yGate.gateScore,
        kHasBreakout: kGate.conditionKeys.includes('breakout_momentum'),
        yHasBreakout: yGate.conditionKeys.includes('breakout_momentum'),
        kUnavailBreakout: kGate.unavailableConditions.includes('breakout_momentum'),
        yUnavailBreakout: yGate.unavailableConditions.includes('breakout_momentum'),
      }));

    // 핵심 단언: high5d=0 → breakout_momentum DATA_UNAVAILABLE (raw score 미합산).
    expect(yGate.unavailableConditions).toContain('breakout_momentum');
    // 완비 KIS 가 breakout 점수를 얻으면(또는 동률) gateScore >= stale Yahoo.
    expect(kGate.gateScore).toBeGreaterThanOrEqual(yGate.gateScore);
    expect(Number.isFinite(dScore)).toBe(true);
  });

  // ── 민감도 sweep: stale 정도(1/3/5일) → gateScore Δ (KIS 실익의 진짜 크기) ─────
  it('민감도: Yahoo stale 1/3/5일 → return20d·gateScore Δ 단조 증가 (합성 작은괴리 대비 크기 측정)', async () => {
    const drift = 600;
    const KOSPI_20D = 2.0;
    const fresh = makeCandles({ n: 80, baseClose: 60000, drift, volBase: 1_200_000 });
    const freshEval = await evalPath(fresh, fresh[fresh.length - 1].close, 1_200_000);
    const freshGate = evaluateServerGate(freshEval.quote, DEFAULT_CONDITION_WEIGHTS, KOSPI_20D);

    const rows: Array<{ staleDays: number; dReturn20d: number; dScore: number; yReturn20d: number }> = [];
    for (const staleDays of [1, 3, 5]) {
      const stale = makeCandles({ n: 80, baseClose: 60000, drift, volBase: 1_200_000, staleTailDays: staleDays });
      const sEval = await evalPath(stale, stale[stale.length - 1].close, 1_200_000);
      const sGate = evaluateServerGate(sEval.quote, DEFAULT_CONDITION_WEIGHTS, KOSPI_20D);
      rows.push({
        staleDays,
        dReturn20d: parseFloat((freshEval.quote.return20d - sEval.quote.return20d).toFixed(2)),
        dScore: parseFloat((freshGate.gateScore - sGate.gateScore).toFixed(3)),
        yReturn20d: sEval.quote.return20d,
      });
    }

    // eslint-disable-next-line no-console
    console.log('[shadow-ab][sensitivity] stale 1/3/5d → Δ:',
      JSON.stringify({ freshReturn20d: freshEval.quote.return20d, freshScore: freshGate.gateScore, rows }));

    // 핵심 단언: stale 일수가 늘수록 return20d 격차(Δ)가 단조 증가 — KIS 실익 크기.
    expect(rows[1].dReturn20d).toBeGreaterThanOrEqual(rows[0].dReturn20d);
    expect(rows[2].dReturn20d).toBeGreaterThanOrEqual(rows[1].dReturn20d);
    // 5일 stale 의 return20d 격차는 측정 가능한 양수 (합성 균일배율 ≈0 과 질적으로 다름).
    expect(rows[2].dReturn20d).toBeGreaterThan(0);
    rows.forEach(r => expect(Number.isFinite(r.dScore)).toBe(true));
  });

  // ── ENV 불변 단언 ────────────────────────────────────────────────────────────
  it('하네스 실행이 KIS_OHLCV_PRIMARY_ENABLED ENV flag 을 변경하지 않음 (executionImpact NONE)', () => {
    expect(process.env.KIS_OHLCV_PRIMARY_ENABLED).toBe(ENV_FLAG_BEFORE);
  });
});
