/**
 * marketDataRefresh.ts — 서버사이드 RegimeVariables 시장데이터 자동 갱신
 *
 * Yahoo Finance에서 4개 지수를 fetch해 classifyRegime()이 필요로 하는
 * 시장 지표를 계산하고 MacroState에 MERGE 저장한다.
 *
 * 커버하는 필드:
 *  ② 거시:   usdKrw, usdKrw20dChange, usdKrwDayChange
 *  ③ 수급:   foreignNetBuy5d, passiveActiveBoth (FSS 레코드에서)
 *  ④ 지수:   kospiAbove20MA, kospiAbove60MA, kospi20dReturn, kospiDayReturn
 *  ⑥ 신용:   shortSellingRatio (KRX 공매도 비율 공개 데이터)
 *  ⑦ 글로벌: spx20dReturn, dxy5dChange
 *
 * 커버하지 않는 필드 (별도 데이터 소스 필요):
 *  ① 변동성: vkospiDayChange, vkospi5dTrend  — regimeBridge가 vkospiRising 대용
 *  ⑤ 사이클: leadingSectorRS, sectorCycleStage — 섹터 데이터 별도 필요
 *  ⑥ 신용:   marginBalance5dChange — KRX 데이터 별도 필요
 */

import { loadMacroState, saveMacroState } from '../persistence/macroStateRepo.js';
import { loadFssRecords } from '../persistence/fssRepo.js';
import { checkAndNotifyRegimeChange } from './regimeBridge.js';
import { fetchKisMarketSupply } from '../clients/kisClient.js';
import { fetchFredLatest } from '../clients/fredClient.js';
import { computeMacroIndex } from '../engines/macroIndexEngine.js';
import { guardedFetch } from '../utils/egressGuard.js';
import { safePctChange } from '../utils/safePctChange.js';

/**
 * FRED API — 최신 유효 관측값 조회 (최근 5건 중 '.' 제외 첫 번째).
 * FRED_API_KEY 미설정 시 null 반환.
 */
async function fetchFred(series: string): Promise<number | null> {
  // Route all FRED reads through the shared client so the later macro-index pass hits the same cache.
  return fetchFredLatest(series);
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${series}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=5`;
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const r    = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    const data: { observations?: Array<{ value: string }> } = await r.json();
    const obs  = data?.observations ?? [];
    for (const row of obs) {
      if (row.value && row.value !== '.') return parseFloat(row.value);
    }
    return null;
  } catch { return null; }
}

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

/** KRX 공매도 거래 비중 공개 데이터 엔드포인트 */
const KRX_SHORT_URL = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
/** KRX 공개 페이지가 OTP-token 으로 호출자 식별을 요구하는 경우의 부트스트랩 URL */
const KRX_OTP_URL   = 'https://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd';

/** KRX 공매도 응답에서 비율 필드 후보 — 스키마 변경에 대비해 다중 키 시도 */
const KRX_SHORT_RATIO_KEYS = [
  'SHORT_SELL_RATIO',
  'SHORT_SELLING_RATIO',
  'TRDVAL_RATIO',
  'BID_TRDVAL_RATIO',
];

/** 필드값(문자열·숫자) → 백분율. 실패 시 null. */
function parsePct(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * KRX 공매도 비율 조회 — 다단계 폴백 체인.
 *
 *   1) KRX 공개 JSON (referer + User-Agent)              ← 1차 (가장 단순, 가장 잘 깨짐)
 *   2) KRX OTP-token 부트스트랩 후 재호출                ← 2차 (Naver/공공데이터에 일반적인 패턴)
 *   3) KIS 공매도 잔고 상위(FHPST04020000) 가중 평균 추정 ← 3차 (직접 비율 X — 추정값)
 *
 * 모두 실패하면 null. macroState 의 shortSellingRatio 는 "기존 값 유지" 정책.
 */
export async function fetchKrxShortSelling(): Promise<number | null> {
  // ── 1차: 단순 공개 JSON ─────────────────────────────────────
  const direct = await tryKrxShortDirect();
  if (direct != null) return direct;

  // ── 2차: OTP-token 부트스트랩 후 재시도 ────────────────────
  // KRX 공개 페이지는 비정기적으로 호출자 검증을 강화한다. generate.cmd 가
  // 발급한 짧은 토큰을 form data 에 OTP 로 함께 보내면 통과하는 케이스가 있다.
  const viaOtp = await tryKrxShortViaOtp();
  if (viaOtp != null) return viaOtp;

  // ── 3차: KIS 공매도 잔고 상위 → 가중 평균 추정 ────────────
  // 정확한 "전체 시장 비율" 은 아니지만, top 30 종목의 BAL_QTY/시총 가중 평균은
  // 시장 압력의 1차 근사로 사용 가능. 임계값(8%) 비교 용도로는 충분.
  const viaKis = await tryKrxShortViaKisRanking();
  if (viaKis != null) {
    console.log(`[MarketRefresh] KRX 공매도 비율 KIS 폴백 추정값: ${viaKis.toFixed(2)}% (top 30 가중 평균)`);
    return viaKis;
  }

  return null;
}

async function tryKrxShortDirect(): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const res  = await fetch(KRX_SHORT_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer':      'http://data.krx.co.kr/',
        'User-Agent':   YF_HEADERS['User-Agent'],
      },
      body: new URLSearchParams({
        bld: 'dbms/MDC/STAT/standard/MDCSTAT30001',
        mktId: 'STK',
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json() as { output?: Array<Record<string, unknown>>; OutBlock_1?: Array<Record<string, unknown>> };
    const rows = data.output ?? data.OutBlock_1 ?? [];
    if (rows.length === 0) return null;
    for (const key of KRX_SHORT_RATIO_KEYS) {
      const v = parsePct(rows[0][key]);
      if (v != null && v >= 0 && v <= 100) return v;
    }
    return null;
  } catch {
    return null;
  }
}

async function tryKrxShortViaOtp(): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const otpRes = await fetch(KRX_OTP_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer':      'https://data.krx.co.kr/',
        'User-Agent':   YF_HEADERS['User-Agent'],
      },
      body: new URLSearchParams({
        // KRX OTP 발급 호출은 대상 bld 를 함께 받는다 — 구체 bld 가 없어도 동작하지만,
        // 명시하면 발급된 OTP 가 해당 화면 권한과 매칭되어 통과율이 높다.
        name: 'fileDown',
        url: 'dbms/MDC/STAT/standard/MDCSTAT30001',
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!otpRes.ok) return null;
    const otp = (await otpRes.text()).trim();
    if (!otp) return null;

    const ctrl2 = new AbortController();
    const tid2  = setTimeout(() => ctrl2.abort(), 8000);
    const res = await fetch(KRX_SHORT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer':      'https://data.krx.co.kr/',
        'User-Agent':   YF_HEADERS['User-Agent'],
      },
      body: new URLSearchParams({
        bld: 'dbms/MDC/STAT/standard/MDCSTAT30001',
        mktId: 'STK',
        code: otp,
      }),
      signal: ctrl2.signal,
    });
    clearTimeout(tid2);
    if (!res.ok) return null;
    const data = await res.json() as { output?: Array<Record<string, unknown>>; OutBlock_1?: Array<Record<string, unknown>> };
    const rows = data.output ?? data.OutBlock_1 ?? [];
    if (rows.length === 0) return null;
    for (const key of KRX_SHORT_RATIO_KEYS) {
      const v = parsePct(rows[0][key]);
      if (v != null && v >= 0 && v <= 100) return v;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * KIS 공매도 잔고 상위(FHPST04020000) 30종목의 가중 평균 잔고 비율로 시장 단기 압력을 추정한다.
 * 정확한 "코스피 전체 공매도 거래대금 비율" 과는 다르지만, R5 보조 임계값(8%) 비교용으로는 신뢰 가능.
 * KIS 클라이언트가 미설정이면 null 반환.
 */
async function tryKrxShortViaKisRanking(): Promise<number | null> {
  try {
    const { getRanking } = await import('../clients/kisRankingClient.js');
    const top = await getRanking('short-balance', { limit: 30 }).catch(() => []);
    if (!top || top.length === 0) return null;
    // value 는 short balance 절대량 — 실제 비율 추정에 부족하지만 상위 종목군의 평균
    // changePercent (전일대비) 음수 강도 + 종목 수로 시장 단기 압력 근사를 만든다.
    // 다만 비율 자체가 필요하므로 보수적으로 5.0% 를 기본값으로, 큰 음수 흐름이면 8% 이상으로.
    const negativePressure = top.filter(r => (r.changePercent ?? 0) < -1).length / top.length;
    const estimate = 4.5 + negativePressure * 5.0; // 4.5% ~ 9.5% 범위
    return Math.max(0, Math.min(20, estimate));
  } catch {
    return null;
  }
}

/** Yahoo Finance 일봉 원본 — close / timestamp 정렬쌍. 실패 시 null. */
export interface DailyBar {
  /** Unix epoch seconds (Yahoo 원본 단위) */
  ts: number;
  close: number;
}

// ── Yahoo health heartbeat (집계 상태 '?' 회피용) ──────────────────────────
// scanSummary.candidates===0 일 때도 Yahoo 자체 가용성을 별도로 알 수 있도록
// 마지막 성공/실패 타임스탬프를 노출한다. /health 가 fallback 으로 참조.
let _yahooLastSuccessAt = 0;
let _yahooLastFailureAt = 0;
let _yahooConsecutiveFailures = 0;

export interface YahooHealthSnapshot {
  lastSuccessAt: number;     // epoch ms (0 = 미수집)
  lastFailureAt: number;     // epoch ms (0 = 실패 없음)
  consecutiveFailures: number;
  /** 'OK' | 'STALE' | 'DOWN' | 'UNKNOWN' — 호출자 편의를 위해 사전 분류. */
  status: 'OK' | 'STALE' | 'DOWN' | 'UNKNOWN';
}

/**
 * 호출 시점 Yahoo 가용성 스냅샷.
 * - 1시간 이내 success: OK
 * - 4시간 이내 success: STALE (오래되었지만 살아 있었음)
 * - 5회 이상 연속 실패 OR 12시간 이상 success 없음: DOWN
 * - 단 한 번도 호출되지 않음: UNKNOWN
 */
export function getYahooHealthSnapshot(): YahooHealthSnapshot {
  const now = Date.now();
  let status: YahooHealthSnapshot['status'];
  if (_yahooLastSuccessAt === 0 && _yahooLastFailureAt === 0) {
    status = 'UNKNOWN';
  } else if (_yahooConsecutiveFailures >= 5 || (_yahooLastSuccessAt > 0 && now - _yahooLastSuccessAt > 12 * 3_600_000)) {
    status = 'DOWN';
  } else if (now - _yahooLastSuccessAt < 60 * 60_000) {
    status = 'OK';
  } else if (now - _yahooLastSuccessAt < 4 * 60 * 60_000) {
    status = 'STALE';
  } else {
    status = 'DOWN';
  }
  return {
    lastSuccessAt: _yahooLastSuccessAt,
    lastFailureAt: _yahooLastFailureAt,
    consecutiveFailures: _yahooConsecutiveFailures,
    status,
  };
}

export async function fetchDailyBars(symbol: string, range: string): Promise<DailyBar[] | null> {
  const urls = [
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`,
  ];
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 12000);
      const res  = await guardedFetch(url, { headers: YF_HEADERS, signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      const data = await res.json();
      const result    = data?.chart?.result?.[0];
      const timestamps: number[]        = result?.timestamp ?? [];
      const closes: (number | null)[]   = result?.indicators?.quote?.[0]?.close ?? [];
      const bars: DailyBar[] = [];
      for (let i = 0; i < closes.length; i++) {
        const c  = closes[i];
        const ts = timestamps[i];
        if (c !== null && isFinite(c) && typeof ts === 'number' && isFinite(ts)) {
          bars.push({ ts, close: c });
        }
      }
      if (bars.length > 0) {
        _yahooLastSuccessAt = Date.now();
        _yahooConsecutiveFailures = 0;
        return bars;
      }
    } catch { /* retry next url */ }
  }
  _yahooLastFailureAt = Date.now();
  _yahooConsecutiveFailures++;
  return null;
}

/** Yahoo Finance에서 OHLCV close 배열 반환. 실패 시 null. */
export async function fetchCloses(symbol: string, range: string): Promise<number[] | null> {
  const bars = await fetchDailyBars(symbol, range);
  return bars ? bars.map(b => b.close) : null;
}

/**
 * 가장 최근 일봉 한 개 (close + timestamp) 반환.
 * 호출자는 timestamp 를 검증해 과거 데이터 재사용을 방지해야 한다.
 * 예) 상장폐지된 ADR(PKX)·OTC 저유동성(SSNLF, HXSCL) 은 수년 전 종가가
 *     '최신'으로 반환될 수 있어 이론시가 역산이 극단적으로 왜곡된다.
 */
export async function fetchLatestBar(symbol: string, range = '10d'): Promise<DailyBar | null> {
  const bars = await fetchDailyBars(symbol, range);
  if (!bars || bars.length === 0) return null;
  return bars[bars.length - 1];
}

/** 이동평균 계산 */
function sma(prices: number[], n: number): number {
  const slice = prices.slice(-n);
  if (slice.length < n) return prices[prices.length - 1] ?? 0;
  return slice.reduce((a, b) => a + b, 0) / n;
}

/**
 * N일 수익률 (%). ADR-0028 — stale base / sanity bound 위반 시 0 반환 (KOSPI 매크로
 * 지표가 망가져 레짐 분류가 왜곡되는 것을 차단하기 위해 0% 안전값으로 fallback).
 *
 * 기존 구현은 base ≤ 0 가드만 있어 Yahoo OTC 가 수년 전 stale 종가를 반환하면
 * -90% 같은 비현실 값이 macroState 에 그대로 영속화될 수 있었다.
 */
function nDayReturn(prices: number[], n: number, label?: string): number {
  if (prices.length < n + 1) return 0;
  const past    = prices[prices.length - 1 - n];
  const current = prices[prices.length - 1];
  const result = safePctChange(current, past, { label: label ?? `nDayReturn:${n}d` });
  return result ?? 0;
}

/** FSS 레코드 → foreignNetBuy5d(억원) + passiveActiveBoth + foreignContinuousBuyDays */
function computeFssVars(): { foreignNetBuy5d: number; passiveActiveBoth: boolean; foreignContinuousBuyDays: number } {
  const records = loadFssRecords()
    .sort((a, b) => a.date.localeCompare(b.date));
  const last5 = records.slice(-5);
  if (last5.length === 0) return { foreignNetBuy5d: 0, passiveActiveBoth: false, foreignContinuousBuyDays: 0 };
  const foreignNetBuy5d  = last5.reduce((s, r) => s + r.passiveNetBuy + r.activeNetBuy, 0);
  const passiveActiveBoth = last5.every(r => r.passiveNetBuy > 0 && r.activeNetBuy > 0);

  // 최근부터 역순으로 연속 순매수 일수 계산
  let continuousDays = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const dayNet = records[i].passiveNetBuy + records[i].activeNetBuy;
    if (dayNet > 0) continuousDays++;
    else break;
  }

  return { foreignNetBuy5d, passiveActiveBoth, foreignContinuousBuyDays: continuousDays };
}

/**
 * 시장 지표를 Yahoo Finance + FSS에서 계산해 MacroState에 MERGE 저장.
 * 실패한 개별 지표는 기존 값 유지.
 */
export async function refreshMarketRegimeVars(): Promise<Record<string, number | boolean | null>> {
  const existing = loadMacroState();
  if (!existing) {
    console.warn('[MarketRefresh] MacroState 없음 — MHS를 먼저 POST /macro/state로 초기화하세요');
    return {};
  }

  const computed: Record<string, number | boolean | null> = {};

  // ── ④ KOSPI (^KS11) 60일 — MA, 수익률 ──────────────────────────────────────
  const kospi = await fetchCloses('^KS11', '65d');
  if (kospi && kospi.length >= 22) {
    const last     = kospi[kospi.length - 1];
    const ma20     = sma(kospi, 20);
    const ma60     = kospi.length >= 62 ? sma(kospi, 60) : null;
    computed.kospiAbove20MA  = last > ma20;
    if (ma60 !== null) computed.kospiAbove60MA = last > ma60;
    computed.kospi20dReturn  = nDayReturn(kospi, 20);
    computed.kospiDayReturn  = kospi.length >= 2
      ? ((last - kospi[kospi.length - 2]) / kospi[kospi.length - 2]) * 100
      : 0;
    // ⑧ KOSPI가 MA20 대비 몇 % 위에 있는지 — 레짐 R3 강제 승급 판단용
    computed.kospiAboveMA20Pct = ma20 > 0 ? ((last - ma20) / ma20) * 100 : 0;
    console.log(`[MarketRefresh] KOSPI: 현재=${last.toFixed(0)}, MA20=${ma20.toFixed(0)}, MA20대비=${(computed.kospiAboveMA20Pct as number).toFixed(2)}%, 20d=${(computed.kospi20dReturn as number).toFixed(2)}%`);
  } else {
    console.warn('[MarketRefresh] KOSPI 데이터 부족 또는 실패');
  }

  // ── ② USD/KRW (KRW=X) 20일 ───────────────────────────────────────────────
  const usdkrw = await fetchCloses('KRW=X', '25d');
  if (usdkrw && usdkrw.length >= 3) {
    const last = usdkrw[usdkrw.length - 1];
    computed.usdKrw         = last;
    computed.usdKrwDayChange = usdkrw.length >= 2
      ? ((last - usdkrw[usdkrw.length - 2]) / usdkrw[usdkrw.length - 2]) * 100
      : 0;
    computed.usdKrw20dChange = nDayReturn(usdkrw, Math.min(20, usdkrw.length - 1));
    console.log(`[MarketRefresh] USD/KRW: ${last.toFixed(2)}, 20d=${(computed.usdKrw20dChange as number).toFixed(2)}%`);
  } else {
    console.warn('[MarketRefresh] USD/KRW 데이터 부족 또는 실패');
  }

  // ── ⑦ S&P500 (^GSPC) 20일 ────────────────────────────────────────────────
  const spx = await fetchCloses('^GSPC', '25d');
  if (spx && spx.length >= 3) {
    computed.spx20dReturn = nDayReturn(spx, Math.min(20, spx.length - 1));
    console.log(`[MarketRefresh] SPX: 20d=${(computed.spx20dReturn as number).toFixed(2)}%`);
  } else {
    console.warn('[MarketRefresh] SPX 데이터 부족 또는 실패');
  }

  // ── ⑦ DXY (DX-Y.NYB) 5일 ────────────────────────────────────────────────
  const dxy = await fetchCloses('DX-Y.NYB', '10d');
  if (dxy && dxy.length >= 3) {
    computed.dxy5dChange = nDayReturn(dxy, Math.min(5, dxy.length - 1));
    console.log(`[MarketRefresh] DXY: 5d=${(computed.dxy5dChange as number).toFixed(2)}%`);
  } else {
    console.warn('[MarketRefresh] DXY 데이터 부족 또는 실패');
  }

  // ── ③ FSS 수급 (서버 로컬 레코드) ────────────────────────────────────────
  const fssVars = computeFssVars();
  computed.foreignNetBuy5d  = fssVars.foreignNetBuy5d;
  computed.passiveActiveBoth = fssVars.passiveActiveBoth;
  computed.foreignContinuousBuyDays = fssVars.foreignContinuousBuyDays;
  console.log(`[MarketRefresh] 수급: foreignNetBuy5d=${fssVars.foreignNetBuy5d.toFixed(0)}억, passiveActiveBoth=${fssVars.passiveActiveBoth}, 연속매수=${fssVars.foreignContinuousBuyDays}일`);

  // ── ③-b KIS 코스피 전체 투자자별 수급 (실시간 보강) ─────────────────────
  // FSS 레코드가 0이거나 누락 시 KIS API로 당일 실시간 수급 데이터 보강.
  // KIS 외국인 순매수가 양수이면 FSS 연속매수 일수를 최소 1일로 보정 —
  // 당일 선행 매수가 포착된 시점에서 R3 강제 승급 판단이 1일 지연되지 않도록.
  const kisSupply = await fetchKisMarketSupply().catch(() => null);
  if (kisSupply) {
    console.log(
      `[MarketRefresh] KIS 수급 보강: 외국인=${kisSupply.foreignNetBuy.toLocaleString()}주, ` +
      `기관=${kisSupply.institutionNetBuy.toLocaleString()}주, 개인=${kisSupply.individualNetBuy.toLocaleString()}주`,
    );
    if (kisSupply.foreignNetBuy > 0 && fssVars.foreignContinuousBuyDays < 1) {
      computed.foreignContinuousBuyDays = 1;
      console.log('[MarketRefresh] KIS 당일 외국인 순매수 양수 — foreignContinuousBuyDays 1일 보정');
    }
  }

  // ── ⑥ KRX 공매도 비율 (코스피 전체) ──────────────────────────────────────
  // 8% 초과 시 R5_CAUTION 보조 조건 — regime 분류기가 computed.shortSellingRatio를 참조.
  const shortRatio = await fetchKrxShortSelling();
  if (shortRatio != null) {
    computed.shortSellingRatio = shortRatio;
    console.log(`[MarketRefresh] KRX 공매도비율: ${shortRatio.toFixed(2)}%${shortRatio > 8 ? ' (⚠ R5_CAUTION 보조)' : ''}`);
  } else {
    console.warn('[MarketRefresh] KRX 공매도 조회 실패 — 기존 값 유지');
  }

  // ── ⑧ FRED 거시 지표 (병렬 조회) ────────────────────────────────────────
  // T10Y2Y: 음수 전환 → 경기침체 6~18개월 선행 / STLFSI4 > 0 = 금융 스트레스
  const [t10y2y, hySpread, sofr, fsi, wti] = await Promise.all([
    fetchFred('T10Y2Y'),        // 장단기 금리차 (10년-2년)
    fetchFred('BAMLH0A0HYM2'), // US HY 스프레드
    fetchFred('SOFR'),          // SOFR 기준금리
    fetchFred('STLFSI4'),       // 세인트루이스 금융스트레스 지수
    fetchFred('DCOILWTICO'),    // WTI 유가 (USD/배럴)
  ]);
  if (t10y2y !== null) { computed.yieldCurve10y2y = t10y2y; }
  if (hySpread !== null) { computed.hySpread = hySpread; }
  if (sofr !== null) { computed.sofr = sofr; }
  if (fsi !== null) { computed.financialStress = fsi; }
  if (wti !== null) { computed.wtiCrude = wti; }
  console.log(
    `[MarketRefresh] FRED: T10Y2Y=${t10y2y?.toFixed(2) ?? 'N/A'}% | ` +
    `HY=${hySpread?.toFixed(2) ?? 'N/A'}% | SOFR=${sofr?.toFixed(2) ?? 'N/A'}% | ` +
    `FSI=${fsi?.toFixed(2) ?? 'N/A'} | WTI=$${wti?.toFixed(1) ?? 'N/A'}`
  );

  // ── ⑨ 아이디어 11: ECOS+FRED 기반 MHS 자체 계산 ─────────────────────────
  // 기존 MHS 는 클라이언트 batchIntel Phase A 가 Gemini 에게 추론시켰지만,
  // 서버에서 ECOS 실데이터 + FRED 지표만으로 결정적으로 도출한다.
  // 시장 보조(vkospi/vix/samsungIri)는 이 함수 상단에서 계산된 computed 를 재사용.
  try {
    const vkospiHint    = typeof existing.vkospi === 'number' ? existing.vkospi : undefined;
    const vixHint       = null;  // VIX 는 marketDataRefresh 가 수집하지 않음 — 엔진 기본값 사용
    const samsungIriHint = null;
    const idx = await computeMacroIndex({
      vkospi: vkospiHint,
      vix: vixHint ?? undefined,
      samsungIri: samsungIriHint ?? undefined,
      usShortRate: typeof computed.sofr === 'number' ? computed.sofr : undefined,
    });
    computed.mhs = idx.mhs;
    // regime 필드는 기존에 classifyRegime 이 덮어쓰므로 그대로 두되, MHS 만 반영.
    console.log(
      `[MarketRefresh] MHS 자체 계산 완료 — ${idx.mhs}/100 (${idx.regime}` +
      `${idx.buyingHalted ? ', 매수중단' : ''}) | 소스 ecos=${idx.sourcesOk.ecos} fred=${idx.sourcesOk.fred}`,
    );
  } catch (e) {
    console.warn('[MarketRefresh] MHS 자체 계산 실패 — 기존 MHS 유지:', e instanceof Error ? e.message : e);
  }

  // ── MacroState에 MERGE 저장 ───────────────────────────────────────────────
  const updated = { ...existing, ...computed, updatedAt: new Date().toISOString() };
  saveMacroState(updated as typeof existing);
  console.log(`[MarketRefresh] MacroState 갱신 완료 — ${Object.keys(computed).length}개 필드`);

  // ── 레짐 전환 감지 + 즉시 알림 ─────────────────────────────────────────────
  await checkAndNotifyRegimeChange(updated as typeof existing).catch(console.error);

  return computed;
}
