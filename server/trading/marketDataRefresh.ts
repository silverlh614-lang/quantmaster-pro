// @responsibility marketDataRefresh 매매 엔진 모듈
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

import { logger } from '../utils/logger.js';
import { loadMacroState, saveMacroState, type MacroState } from '../persistence/macroStateRepo.js';
import { loadFssRecords, getFssRecordsAge, upsertFssRecord } from '../persistence/fssRepo.js';
import type { FssRecordsAgeInfo } from '../persistence/fssRepo.js';
import { appendFssDetailRecord } from '../persistence/fssDetailRepo.js';
import { isFssMappingEnabled, mapPassiveActive } from '../persistence/fssMappingPolicy.js';
import { fetchInvestorTradingDetail } from '../clients/krxClient.js';
import { checkAndNotifyRegimeChange } from './regimeBridge.js';
import { resolveRegimeSnapshot } from './regime/regimeResolver.js';
import { classifyMacroDataHealth, listMacroDataHealthIssues, summarizeMacroDataHealth } from './regime/macroDataHealthRouter.js';
import { defaultWarnTtlSec, emitOperationalWarn } from '../observability/operationalWarn.js';
import { fetchKisMarketSupply, fetchKisMarketProgramTrade } from '../clients/kisClient.js';
import { tryKrxShortViaKisProxy } from './shortSellingKisProxy.js';
import { resolveCombinedSource } from './programMarketSnapshot.js';
import { fetchFredLatest } from '../clients/fredClient.js';
import { fetchLatestUsdKrw, fetchLatestMarginBalance5dChange } from '../clients/ecosClient.js';
import { fetchDerivativesIndexDaily } from '../clients/krxOpenApi.js';
import { computeMacroIndex } from '../engines/macroIndexEngine.js';
import { guardedFetch } from '../utils/egressGuard.js';
import { evaluateCrossSource } from './crossSourceValidator.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { evaluateSectorEnergy } from '../../src/services/quant/sectorEnergyEngine.js';
import { getSectorEnergyInputs, buildSectorEnergyInputsWithMeta } from '../clients/sectorEnergyProvider.js';
import { deriveSectorCycle } from './sectorCycleClassifier.js';
import type {
  MacroRefreshReason,
  ProgramMarketFinalStatus,
  MarketRefreshComputed,
  ShortSellingSource,
  ShortSellingResult,
  DailyBar,
  YahooHealthSnapshot,
} from './marketDataRefresh/types.js';
import {
  buildProgramMarketSnapshotId,
  hasSnapshotInvariantViolation,
  formatEokAmount,
  buildUnitCandidates,
  parseKisNumber,
  selectLatestByBsopHour,
  normalizeMarketProgramLeg,
  sumNullablePair,
  parsePct,
  sma,
  nDayReturn,
} from './marketDataRefresh/helpers.js';

// ADR-0580: 타입 선언 (ShortSellingSource/ShortSellingResult/DailyBar/YahooHealthSnapshot 등)
// 은 ./marketDataRefresh/types.js 로 추출됐다. 본 모듈을 통한 기존 import 경로 보존을 위해
// public 타입 표면을 re-export 한다 (byte-equivalent).
export * from './marketDataRefresh/types.js';

function macroRefreshRuntimeContext(now = new Date()): { marketSession: string; engineMode: string; r6State: string; sellOnly: boolean } {
  try {
    const macro = loadMacroState();
    const regimeSnapshot = resolveRegimeSnapshot({ macroState: macro, now });
    const r6State = regimeSnapshot.diagnostics.transitionState.r6StateMachineState ?? regimeSnapshot.effectiveRegime;
    return {
      marketSession: process.env.MARKET_SESSION ?? process.env.NODE_ENV ?? 'UNKNOWN',
      engineMode: regimeSnapshot.engineMode,
      r6State,
      sellOnly: false,
    };
  } catch (e) {
    return {
      marketSession: process.env.MARKET_SESSION ?? process.env.NODE_ENV ?? 'UNKNOWN',
      engineMode: 'UNKNOWN',
      r6State: 'UNKNOWN',
      sellOnly: false,
    };
  }
}

function logMacroRefreshStarted(reason: MacroRefreshReason): void {
  const ctx = macroRefreshRuntimeContext();
  console.info(
    '[MACRO_REFRESH_STARTED] ' +
    `reason=${reason} ` +
    `marketSession=${ctx.marketSession} ` +
    `engineMode=${ctx.engineMode} ` +
    `r6State=${ctx.r6State} ` +
    `sellOnly=${ctx.sellOnly}`,
  );
}

function logMacroRefreshSuccess(input: { updatedAt: string; mhs?: number; vkospi?: number; kospiDayReturn?: number; writeSucceeded: boolean }): void {
  console.info(
    '[MACRO_REFRESH_SUCCESS] ' +
    `updatedAt=${input.updatedAt} ` +
    `mhs=${input.mhs ?? 'N/A'} ` +
    `vkospi=${input.vkospi ?? 'N/A'} ` +
    `kospiDayReturn=${input.kospiDayReturn ?? 'N/A'} ` +
    `writeSucceeded=${input.writeSucceeded}`,
  );
}

function logMacroRefreshFailed(input: { error: unknown; provider: string; fallbackUsed?: boolean | string }): void {
  const errorName = input.error instanceof Error ? input.error.name : 'Error';
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code: 'P1_MACRO_DATA_HEALTH_DEGRADED',
    message: '[MACRO_REFRESH_FAILED] macro provider refresh failed',
    executionImpact: 'NONE',
    mode: 'DEGRADED',
    dedupKey: `macro-refresh-failed:${input.provider}:${errorName}`,
    ttlSec: defaultWarnTtlSec('P1'),
    details: {
      reason: 'providerIssue=true marketSignal=false',
      errorName,
      errorMessage,
      provider: input.provider,
      fallbackUsed: input.fallbackUsed ?? 'N/A',
    },
  });
}

function logMacroRefreshSkipped(reason: string): void {
  const ctx = macroRefreshRuntimeContext();
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code: 'P1_REGIME_DATA_HEALTH_STALE',
    message: '[MACRO_REFRESH_SKIPPED] macro refresh skipped',
    executionImpact: 'NONE',
    mode: 'DEGRADED',
    dedupKey: `macro-refresh-skipped:${reason}:${ctx.r6State}`,
    ttlSec: defaultWarnTtlSec('P1'),
    details: {
      reason,
      engineMode: ctx.engineMode,
      r6State: ctx.r6State,
      shouldNotSkipInR6: true,
      providerIssue: true,
      marketSignal: false,
    },
  });
}

function emitMacroDataHealthSummary(updated: unknown): void {
  const dataHealth = classifyMacroDataHealth(updated as Parameters<typeof classifyMacroDataHealth>[0]);
  const sourceHealth = summarizeMacroDataHealth(dataHealth);
  const issues = listMacroDataHealthIssues(dataHealth);
  if (issues.length === 0) return;
  const staleOnlyShortSelling = issues.length > 0 && issues.every((issue) => issue === 'shortSelling:STALE');
  const hasMacroStateStale = issues.some((issue) => issue.startsWith('macroState:STALE') || issue.startsWith('macroState:HARD_STALE'));
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code: sourceHealth === 'STALE'
      ? (hasMacroStateStale ? 'P1_MACRO_STATE_STALE' : (staleOnlyShortSelling ? 'P1_SHORT_SELLING_DATA_STALE' : 'P1_REGIME_DATA_HEALTH_STALE'))
      : 'P1_MACRO_DATA_HEALTH_DEGRADED',
    message: `[MACRO_DATA_HEALTH] sourceHealth=${sourceHealth}`,
    executionImpact: 'NONE',
    mode: 'DEGRADED',
    dedupKey: `macro-data-health:${sourceHealth}:${issues.join('|')}`,
    ttlSec: defaultWarnTtlSec('P1'),
    details: {
      reason: 'providerIssue=true marketSignal=false',
      sourceHealth,
      issues,
      dataHealth,
    },
  });
}

function emitMarketDataProviderWarn(reason: string, details: Record<string, unknown> = {}): void {
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code: 'P1_MACRO_DATA_HEALTH_DEGRADED',
    message: `[MarketRefresh] ${reason}`,
    executionImpact: 'NONE',
    mode: 'DEGRADED',
    dedupKey: `market-refresh-provider:${reason}`,
    ttlSec: defaultWarnTtlSec('P1'),
    details: {
      reason: 'providerIssue=true marketSignal=false',
      providerIssue: true,
      marketSignal: false,
      ...details,
    },
  });
}

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

/**
 * KRX 공매도 비율 조회 — 다단계 폴백 체인 (ADR-0543 확장):
 *   1) KRX 공개 JSON(L1)  2) KRX OTP(L1)  3) KIS 프록시 ETF(L1, ENV gated)  4) KIS 추정(L4, 최후)
 * 모두 실패하면 null → macroState shortSellingRatio "기존 값 유지"(carryForward) 정책.
 * 반환값 source 라벨은 macroState 에 영속(`shortSellingSource`) → /health 노출.
 */
export async function fetchKrxShortSelling(): Promise<ShortSellingResult | null> {
  const fetchedAt = new Date().toISOString();

  // ── 1차: 단순 공개 JSON ─────────────────────────────────────
  const direct = await tryKrxShortDirect();
  if (direct != null) return { ratio: direct, source: 'KRX_DIRECT', fetchedAt };

  // ── 2차: OTP-token 부트스트랩 후 재시도 ────────────────────
  // KRX 공개 페이지는 비정기적으로 호출자 검증을 강화한다. generate.cmd 가
  // 발급한 짧은 토큰을 form data 에 OTP 로 함께 보내면 통과하는 케이스가 있다.
  const viaOtp = await tryKrxShortViaOtp();
  if (viaOtp != null) return { ratio: viaOtp, source: 'KRX_OTP', fetchedAt };

  // ── 3차 (ADR-0543, ENV gated default OFF): KIS 시장-프록시 ETF 비중 (L1) ──
  // 플래그 !== 'true' 면 미호출 → byte-equivalent (기존 3경로 유지). kisClient 단일통로.
  if (process.env.SHORT_SELLING_KIS_PROXY_FALLBACK === 'true') {
    const viaKisProxy = await tryKrxShortViaKisProxy();
    if (viaKisProxy != null) {
      console.log(`[MarketRefresh] KRX 공매도 비율 KIS L1 프록시: ${viaKisProxy.toFixed(2)}% (daily-short-sale)`);
      return { ratio: viaKisProxy, source: 'KIS_PROXY', fetchedAt };
    }
  }

  // ── 4차 (최후): KIS 공매도 잔고 상위 → 가중 평균 추정 (L4) ────────────
  // 정확한 "전체 시장 비율" 은 아니지만, top 30 종목의 BAL_QTY/시총 가중 평균은
  // 시장 압력의 1차 근사로 사용 가능. 임계값(8%) 비교 용도로는 충분.
  const viaKis = await tryKrxShortViaKisRanking();
  if (viaKis != null) {
    console.log(`[MarketRefresh] KRX 공매도 비율 KIS 폴백 추정값: ${viaKis.toFixed(2)}% (top 30 가중 평균)`);
    return { ratio: viaKis, source: 'KIS_ESTIMATE', fetchedAt };
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

// ── Yahoo health heartbeat (집계 상태 '?' 회피용) ──────────────────────────
// scanSummary.candidates===0 일 때도 Yahoo 자체 가용성을 별도로 알 수 있도록
// 마지막 성공/실패 타임스탬프를 노출한다. /health 가 fallback 으로 참조.
let _yahooLastSuccessAt = 0;
let _yahooLastFailureAt = 0;
let _yahooConsecutiveFailures = 0;

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
      const res  = await guardedFetch(url, { headers: YF_HEADERS, signal: ctrl.signal }, 'HISTORICAL');
      clearTimeout(tid);
      if (!res.ok) continue;
      const data = await res.json();
      const result    = data?.chart?.result?.[0];
      const timestamps: number[]        = result?.timestamp ?? [];
      const quote = result?.indicators?.quote?.[0] ?? {};
      const closes: (number | null)[]   = quote.close ?? [];
      const opens: (number | null)[]    = quote.open ?? [];
      const highs: (number | null)[]    = quote.high ?? [];
      const lows: (number | null)[]     = quote.low ?? [];
      const bars: DailyBar[] = [];
      for (let i = 0; i < closes.length; i++) {
        const c  = closes[i];
        const ts = timestamps[i];
        if (c !== null && isFinite(c) && typeof ts === 'number' && isFinite(ts)) {
          const open = typeof opens[i] === 'number' && isFinite(opens[i] as number) ? opens[i] as number : undefined;
          const high = typeof highs[i] === 'number' && isFinite(highs[i] as number) ? highs[i] as number : undefined;
          const low = typeof lows[i] === 'number' && isFinite(lows[i] as number) ? lows[i] as number : undefined;
          bars.push({ ts, close: c, open, high, low });
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

/**
 * 외국인 연속 일수 카운트 — 최근부터 역순 누적 (테스트 가능한 순수 함수).
 *
 * @param records   날짜 오름차순 정렬된 외국인 일별 net buy 레코드 (Pick: passiveNetBuy + activeNetBuy).
 * @param direction 'BUY' = (passive+active) > 0 연속, 'SELL' = (passive+active) < 0 연속.
 * @returns 0 이상 정수. 빈 배열 / 직전 일이 반대 방향이면 0.
 */
export function tallyConsecutiveForeignFlowDays(
  records: ReadonlyArray<{ passiveNetBuy: number; activeNetBuy: number }>,
  direction: 'BUY' | 'SELL',
): number {
  let count = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const dayNet = records[i].passiveNetBuy + records[i].activeNetBuy;
    if (direction === 'BUY' ? dayNet > 0 : dayNet < 0) count++;
    else break;
  }
  return count;
}

/**
 * FSS 레코드 → foreignNetBuy5d(억원) + passiveActiveBoth + foreignContinuousBuyDays + foreignContinuousSellDays.
 *
 * - foreignContinuousBuyDays: 최근부터 역순 연속 *순매수* 일수.
 * - foreignContinuousSellDays: 최근부터 역순 연속 *순매도* 일수.
 *
 * 두 카운터는 **상호 배타적** (직전 일은 한쪽 방향만 가능 — 한쪽 ≥ 1 이면 다른 쪽 0).
 * marketDataRefresh 가 foreignFuturesSellDays 필드에 SellDays 를 매핑해 confluenceEngine 의
 * "외국인 5일+ 매도" 약세 신호 가산점을 작동시킨다 (원래는 선물 의도였으나 KIS/KRX
 * 선물 fetch 인프라 부담 회피 위해 현물 누적 순매도 카운트로 대체).
 */
/**
 * ADR-0136 격상: 반환 타입에 `passiveActiveBoth: boolean | null` (null = 평가 제외)
 * + `fssRecordsAge` 신선도 진단 추가. `FSS_STATUS_DIAGNOSTIC_DISABLED=true` ENV 시
 * 기존 동작 (false fallback) 100% 복원.
 */
export function computeFssVars(now: Date = new Date()): {
  foreignNetBuy5d: number;
  passiveActiveBoth: boolean | null;
  fssRecordsAge: FssRecordsAgeInfo;
  foreignContinuousBuyDays: number;
  foreignContinuousSellDays: number;
} {
  const records = loadFssRecords()
    .sort((a, b) => a.date.localeCompare(b.date));
  const fssRecordsAge = getFssRecordsAge(now);
  const diagnosticDisabled = process.env.FSS_STATUS_DIAGNOSTIC_DISABLED === 'true';
  const last5 = records.slice(-5);

  // ADR-0136: STALE/MISSING 시 passiveActiveBoth=null (평가 제외 명시).
  // 표본 < 3일도 통계 신뢰도 부족 → null. ENV 우회 시 기존 false fallback.
  const insufficientSample = fssRecordsAge.status !== 'OK' || last5.length < 3;
  if (insufficientSample) {
    return {
      foreignNetBuy5d: last5.reduce((s, r) => s + r.passiveNetBuy + r.activeNetBuy, 0),
      passiveActiveBoth: diagnosticDisabled ? false : null,
      fssRecordsAge,
      foreignContinuousBuyDays: tallyConsecutiveForeignFlowDays(records, 'BUY'),
      foreignContinuousSellDays: 0,
    };
  }

  const foreignNetBuy5d  = last5.reduce((s, r) => s + r.passiveNetBuy + r.activeNetBuy, 0);
  const passiveActiveBoth = last5.every(r => r.passiveNetBuy > 0 && r.activeNetBuy > 0);

  const continuousBuyDays  = tallyConsecutiveForeignFlowDays(records, 'BUY');
  const continuousSellDays = continuousBuyDays === 0
    ? tallyConsecutiveForeignFlowDays(records, 'SELL')
    : 0;

  return {
    foreignNetBuy5d,
    passiveActiveBoth,
    fssRecordsAge,
    foreignContinuousBuyDays: continuousBuyDays,
    foreignContinuousSellDays: continuousSellDays,
  };
}

/**
 * 시장 지표를 Yahoo Finance + FSS에서 계산해 MacroState에 MERGE 저장.
 * 실패한 개별 지표는 기존 값 유지.
 */
export function computeVkospiDayChangeFromBars(bars: DailyBar[] | null): { current: number; prevClose: number; dayChangePct: number } | null {
  if (!bars || bars.length < 2) return null;
  const current = bars[bars.length - 1]?.close;
  const prevClose = bars[bars.length - 2]?.close;
  if (typeof current !== 'number' || typeof prevClose !== 'number' || prevClose <= 0) return null;
  return { current, prevClose, dayChangePct: ((current - prevClose) / prevClose) * 100 };
}

export async function refreshMarketRegimeVars(reason: MacroRefreshReason = 'SCHEDULED'): Promise<MarketRefreshComputed> {
  const refreshAttemptAt = new Date().toISOString();
  logMacroRefreshStarted(reason);
  const existing = loadMacroState();
  if (!existing) {
    logMacroRefreshSkipped('MACRO_STATE_MISSING');
    emitMarketDataProviderWarn('MACRO_STATE_MISSING', {
      action: 'POST /macro/state required before refresh',
    });
    return {};
  }

  // macro refresh is observational data collection, not trade execution.  It must
  // continue through R6_DEFENSE / SELL_ONLY / SHADOW_ONLY / OBSERVE_ONLY and when
  // Keep this path independent from execution state.
  saveMacroState({
    ...existing,
    lastRefreshAttemptAt: refreshAttemptAt,
    refreshJobEnabled: true,
    refreshJobLastRunAt: refreshAttemptAt,
    refreshBlockedReason: 'NONE',
    writeSucceeded: true,
    updatedAtChanged: false,
  });

  try {
    const computed: MarketRefreshComputed = {};

  // ── ④ KOSPI (^KS11) 60일 — MA, 수익률 ──────────────────────────────────────
  const kospiBars = await fetchDailyBars('^KS11', '65d');
  const kospi = kospiBars ? kospiBars.map(b => b.close) : null;
  if (kospi && kospi.length >= 22) {
    const last     = kospi[kospi.length - 1];
    const prev     = kospi[kospi.length - 2];
    const latestBar = kospiBars?.[kospiBars.length - 1];
    const ma20     = sma(kospi, 20);
    const ma60     = kospi.length >= 62 ? sma(kospi, 60) : null;
    computed.kospiAbove20MA  = last > ma20;
    if (ma60 !== null) computed.kospiAbove60MA = last > ma60;
    computed.kospi20dReturn  = nDayReturn(kospi, 20);
    computed.kospiDayReturn  = kospi.length >= 2
      ? ((last - prev) / prev) * 100
      : 0;
    computed.kospiCloseReturn = computed.kospiDayReturn;
    if (prev > 0 && latestBar?.low !== undefined) computed.kospiIntradayLowReturn = ((latestBar.low - prev) / prev) * 100;
    if (prev > 0 && latestBar?.high !== undefined) computed.kospiIntradayHighReturn = ((latestBar.high - prev) / prev) * 100;
    computed.kospiTriggerSourceUpdatedAt = new Date().toISOString();
    // ⑧ KOSPI가 MA20 대비 몇 % 위에 있는지 — 레짐 R3 강제 승급 판단용
    computed.kospiAboveMA20Pct = ma20 > 0 ? ((last - ma20) / ma20) * 100 : 0;
    console.log(`[MarketRefresh] KOSPI: 현재=${last.toFixed(0)}, MA20=${ma20.toFixed(0)}, MA20대비=${(computed.kospiAboveMA20Pct as number).toFixed(2)}%, 20d=${(computed.kospi20dReturn as number).toFixed(2)}%`);
  } else {
    emitMarketDataProviderWarn('KOSPI_DATA_INSUFFICIENT');
  }

  // ── ④-B VKOSPI — KRX OpenAPI 파생상품 지수 일별 우선, Yahoo fallback ───────
  try {
    const rows = await fetchDerivativesIndexDaily();
    const vkospiRow = rows.find((r) =>
      r.indexName.includes('VKOSPI') ||
      r.indexName.includes('변동성지수') ||
      r.indexName.includes('코스피변동성'),
    );
    if (vkospiRow) {
      computed.vkospi = vkospiRow.close;
      computed.vkospiPrevClose = vkospiRow.change !== 0 ? vkospiRow.close - vkospiRow.change : vkospiRow.close;
      computed.vkospiDayChangeComputed = vkospiRow.changePct;
      computed.vkospiDayChangeSource = 'KRX_DERIV_INDEX_DAILY';
      const ageMs = existing.updatedAt ? Date.now() - Date.parse(existing.updatedAt) : Number.POSITIVE_INFINITY;
      const shouldKeepClientValue = typeof existing.vkospiDayChange === 'number' && Number.isFinite(ageMs) && ageMs <= 15 * 60_000;
      computed.vkospiDayChange = shouldKeepClientValue ? existing.vkospiDayChange : vkospiRow.changePct;
      console.log(
        `[MarketRefresh] VKOSPI (KRX) source=KRX_DERIV_INDEX_DAILY ` +
        `현재=${vkospiRow.close.toFixed(2)} 전일=${(computed.vkospiPrevClose as number).toFixed(2)} ` +
        `dayChange=${vkospiRow.changePct.toFixed(2)}%`,
      );
    } else {
      throw new Error('KRX VKOSPI row not found');
    }
  } catch (err) {
    console.warn('[MarketRefresh] VKOSPI KRX fetch 실패, Yahoo fallback 시도:', err instanceof Error ? err.message : String(err));
    try {
      const vkospiBars = await fetchDailyBars('^VKOSPI', '5d');
      const vkospiComputed = computeVkospiDayChangeFromBars(vkospiBars);
      if (vkospiComputed) {
        computed.vkospi = vkospiComputed.current;
        computed.vkospiPrevClose = vkospiComputed.prevClose;
        computed.vkospiDayChangeComputed = vkospiComputed.dayChangePct;
        computed.vkospiDayChangeSource = 'YAHOO_FALLBACK_COMPUTED';
        if (typeof existing.vkospiDayChange !== 'number') computed.vkospiDayChange = vkospiComputed.dayChangePct;
      }
    } catch {}
  }

  // ── ② USD/KRW (Yahoo `KRW=X` + ECOS 한국은행 공식 교차 검증, ADR-0071) ──────
  const [usdkrw, ecosUsdKrw] = await Promise.all([
    fetchCloses('KRW=X', '25d'),
    fetchLatestUsdKrw().catch(() => null),  // ECOS_API_KEY 미설정/throw graceful
  ]);
  const yahooLast = usdkrw && usdkrw.length >= 3 ? usdkrw[usdkrw.length - 1] : null;
  const xs = evaluateCrossSource(yahooLast, ecosUsdKrw, 'USD/KRW');
  if (xs.selected !== null) {
    computed.usdKrw                  = xs.selected;
    computed.usdKrwSource            = xs.selectedSource;     // 'PRIMARY' | 'SECONDARY'
    computed.usdKrwDivergencePct     = xs.divergencePct;      // null = 한쪽 미수집
    computed.usdKrwDivergenceTier    = xs.tier;               // AGREED/WARN/CRITICAL/...
    if (yahooLast !== null && usdkrw && usdkrw.length >= 2) {
      computed.usdKrwDayChange = ((yahooLast - usdkrw[usdkrw.length - 2]) / usdkrw[usdkrw.length - 2]) * 100;
      computed.usdKrw20dChange = nDayReturn(usdkrw, Math.min(20, usdkrw.length - 1));
    }
    console.log(
      `[MarketRefresh] USD/KRW: ${xs.selected.toFixed(2)} ` +
      `(source=${xs.selectedSource}, tier=${xs.tier}, ` +
      `Yahoo=${yahooLast?.toFixed(2) ?? 'null'}, ECOS=${ecosUsdKrw?.toFixed(2) ?? 'null'}, ` +
      `divergence=${xs.divergencePct?.toFixed(2) ?? 'null'}%)`,
    );
    if (xs.diverged) {
      // CRITICAL 격차 → 텔레그램 알림 (운영자가 신뢰 문제 즉시 인지)
      await sendTelegramAlert(
        `🛑 <b>[USD/KRW 격차 임계 초과]</b>\n` +
        `${xs.message}\n` +
        `사용 값: ${xs.selected.toFixed(2)} (${xs.selectedSource})\n` +
        `<i>Yahoo / ECOS 두 소스 중 공식(ECOS) 우선 사용 — 자동매매 영향: macroState.usdKrw 가 ECOS 값.</i>`,
      ).catch(console.error);
    }
  } else {
    emitMarketDataProviderWarn('USD_KRW_ALL_SOURCES_FAILED', {
      error: xs.message,
    });
  }

  // ── ⑦ S&P500 (^GSPC) 20일 ────────────────────────────────────────────────
  const spx = await fetchCloses('^GSPC', '25d');
  if (spx && spx.length >= 3) {
    computed.spxDayReturn = nDayReturn(spx, 1);
    computed.spx20dReturn = nDayReturn(spx, Math.min(20, spx.length - 1));
    console.log(`[MarketRefresh] SPX: 1d=${(computed.spxDayReturn as number).toFixed(2)}%, 20d=${(computed.spx20dReturn as number).toFixed(2)}%`);
  } else {
    emitMarketDataProviderWarn('SPX_DATA_INSUFFICIENT');
  }

  // ── ⑦ DXY (DX-Y.NYB) 5일 ────────────────────────────────────────────────
  const dxy = await fetchCloses('DX-Y.NYB', '10d');
  if (dxy && dxy.length >= 3) {
    computed.dxy5dChange = nDayReturn(dxy, Math.min(5, dxy.length - 1));
    console.log(`[MarketRefresh] DXY: 5d=${(computed.dxy5dChange as number).toFixed(2)}%`);
  } else {
    emitMarketDataProviderWarn('DXY_DATA_INSUFFICIENT');
  }

  // ── ③ FSS 수급 (서버 로컬 레코드) ────────────────────────────────────────
  const fssVars = computeFssVars();
  computed.foreignNetBuy5d  = fssVars.foreignNetBuy5d;
  computed.passiveActiveBoth = fssVars.passiveActiveBoth;  // ADR-0136: boolean | null
  computed.foreignContinuousBuyDays = fssVars.foreignContinuousBuyDays;
  // ADR-0136: fssRecordsAge 영속 — saveMacroState merge 단계에서 spread.
  const fssRecordsAgeSnapshot = fssVars.fssRecordsAge;
  // foreignFuturesSellDays — confluenceEngine 의 "외국인 5일+ 매도" 약세 신호 활성화.
  // 본 필드는 원래 선물 데이터 의도였으나 KIS/KRX 선물 fetch 인프라 부담 회피 위해
  // FSS 레코드 기반 외국인 *현물 연속 순매도* 일수로 매핑한다 (의미 근사 — 본질은
  // "외국인이 N일 연속 빠지고 있다" 약세 신호 동일). foreignContinuousBuyDays 와
  // 상호 배타적 (한쪽이 ≥1 이면 다른 쪽은 0).
  computed.foreignFuturesSellDays = fssVars.foreignContinuousSellDays;
  console.log(
    `[MarketRefresh] 수급: foreignNetBuy5d=${fssVars.foreignNetBuy5d.toFixed(0)}억, ` +
    `passiveActiveBoth=${fssVars.passiveActiveBoth}, ` +
    `연속매수=${fssVars.foreignContinuousBuyDays}일, ` +
    `연속매도=${fssVars.foreignContinuousSellDays}일, ` +
    `fssRecordsAge=${fssVars.fssRecordsAge.status}` +
    `${fssVars.fssRecordsAge.ageDays !== null ? `(${fssVars.fssRecordsAge.ageDays}일전)` : '(MISSING)'}`,
  );

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

  // ── ③-c ADR-0138: KIS 시장 종합 프로그램 매매 추이 (코스피 시장 단위) ────
  // 사용자 12 아이디어 #4 — 시장 단위 프로그램 자금 흐름. KIS 응답은 원 단위 →
  // macroState 는 *억원* 환산 (foreignNetBuy5d 등 다른 자금 흐름 필드와 단위 정합).
  // 호출 실패 시 programSource='NONE' 마커 + 기존 값 보존 (silent degradation 차단).
  const marketProgram = await fetchKisMarketProgramTrade().catch(() => null);
  if (marketProgram && marketProgram.programNetBuyAmount !== null) {
    const eokwon = marketProgram.programNetBuyAmount / 100_000_000;
    const arbEokwon = marketProgram.programArbitrageNetBuy === null
      ? null
      : marketProgram.programArbitrageNetBuy / 100_000_000;
    computed.programNetBuyAmount = eokwon;
    computed.programArbitrageNetBuy = arbEokwon;
    computed.programFetchedAt = marketProgram.fetchedAt;
    computed.programSource = 'KIS_API';
    const rawWhole = marketProgram.programNetBuyAmount;
    const rawArb = marketProgram.programArbitrageNetBuy;
    const rawNonArb = marketProgram.programNonArbitrageNetBuy ?? null;
    const rawNonZero = [rawWhole, rawArb, rawNonArb].some((v) => typeof v === 'number' && v !== 0);
    const agg = (marketProgram.aggregateDiagnostic as Record<string, unknown> | undefined) ?? {};
    const bundle = (agg.rowBreakdownBundle as Record<string, unknown> | undefined) ?? {};
    const bk = (bundle.kospi as Record<string, unknown> | undefined) ?? {};
    const bq = (bundle.kosdaq as Record<string, unknown> | undefined) ?? {};
    const bc = (bundle.combined as Record<string, unknown> | undefined) ?? {};
    const kospiLen = Number(bk.outputLength ?? marketProgram.kospiDiagnostics?.rowCount ?? 0);
    const kosdaqLen = Number(bq.outputLength ?? marketProgram.kosdaqDiagnostics?.rowCount ?? 0);
    const kisRawOutput = (((agg as any)?.output as Array<Record<string, unknown>> | undefined) ?? []);
    const combinedLen = Number(bc.outputLength ?? kisRawOutput.length ?? (kospiLen + kosdaqLen));
    const combinedSource = resolveCombinedSource({
      kospiRequested: true, kosdaqRequested: true, kospiOutputLength: kospiLen, kosdaqOutputLength: kosdaqLen,
      combinedOutputLength: combinedLen, combinedMatchesSplit: combinedLen === (kospiLen + kosdaqLen), upstreamHint: String(agg.combinedSource ?? ''),
    });
    const hasSplitRows = (kospiLen + kosdaqLen) > 0 && combinedLen === (kospiLen + kosdaqLen);
    const provisionalSplitAvailable = combinedSource === 'KOSPI_PLUS_KOSDAQ' && hasSplitRows;
    const kospiRows = provisionalSplitAvailable ? (((bundle.kospi as any)?.rows as Array<Record<string, unknown>> | undefined) ?? []) : [];
    const kosdaqRows = provisionalSplitAvailable ? (((bundle.kosdaq as any)?.rows as Array<Record<string, unknown>> | undefined) ?? []) : [];
    const combinedRows = provisionalSplitAvailable
      ? ((((bundle.combined as any)?.rows as Array<Record<string, unknown>> | undefined) ?? [...kospiRows, ...kosdaqRows]))
      : ((((bundle.combined as any)?.rows as Array<Record<string, unknown>> | undefined) ?? kisRawOutput));
    const kospiLeg = normalizeMarketProgramLeg({ rows: kospiRows });
    const kosdaqLeg = normalizeMarketProgramLeg({ rows: kosdaqRows });
    const combinedLeg = normalizeMarketProgramLeg({ rows: combinedRows });
    const combinedWholeNetBuy = sumNullablePair(kospiLeg.rawWholeNetBuy, kosdaqLeg.rawWholeNetBuy);
    const combinedArbitrageNetBuy = sumNullablePair(kospiLeg.rawArbitrageNetBuy, kosdaqLeg.rawArbitrageNetBuy);
    const combinedNonArbitrageNetBuy = sumNullablePair(kospiLeg.rawNonArbitrageNetBuy, kosdaqLeg.rawNonArbitrageNetBuy);
    const invariants = hasSnapshotInvariantViolation({
      kospiLen,
      kosdaqLen,
      combinedLen: combinedLeg.outputLength,
      combinedNonZero: combinedLeg.nonZeroRows,
      combinedSource,
      rawTopFirstBsopHour: String((agg as any)?.firstRowSample?.bsop_hour ?? ''),
      selectedBsopHour: combinedLeg.selectedBsopHour ?? '',
    });
    const rowInvariantViolation = [kospiLeg, kosdaqLeg, combinedLeg].find((leg) => (
      leg.outputLength === 0
      && (leg.selectedBsopHour !== null
        || leg.rawWholeNetBuy !== null
        || leg.rawArbitrageNetBuy !== null
        || leg.rawNonArbitrageNetBuy !== null
        || leg.displayWholeNetBuy !== 'N/A')
    ) || (leg.rawWholeNetBuy !== null && leg.outputLength === 0));
    const legInvariantViolated = kospiLeg.invariantViolated || kosdaqLeg.invariantViolated || combinedLeg.invariantViolated || Boolean(rowInvariantViolation);
    const legInvariantReason = rowInvariantViolation ? 'RAW_EXISTS_WITH_EMPTY_ROWS' : (kospiLeg.invariantReason ?? kosdaqLeg.invariantReason ?? combinedLeg.invariantReason);
    const finalStatus: ProgramMarketFinalStatus = (invariants.violated || legInvariantViolated)
      ? 'SNAPSHOT_INCONSISTENT'
      : (provisionalSplitAvailable ? 'OFFICIAL_PARAMS_VERIFIED' : 'SINGLE_RESPONSE_VERIFIED');
    const resolvedCombinedSource = (invariants.violated || legInvariantViolated) ? 'UNKNOWN' : combinedSource;
    const splitAvailable = !(invariants.violated || legInvariantViolated) && resolvedCombinedSource === 'KOSPI_PLUS_KOSDAQ';
    const combinedOnly = !splitAvailable;
    const snapshotId = buildProgramMarketSnapshotId();
    const programMarketSnapshot: NonNullable<MacroState['programMarket']> = {
      status: marketProgram.marketProgramStatus ?? 'OK_NONZERO',
      rawStatus: marketProgram.marketProgramStatus ?? 'OK_NONZERO',
      snapshotId,
      finalStatus,
      source: marketProgram.source ?? 'KIS_API',
      paramMode: 'OFFICIAL',
      asOfKst: marketProgram.fetchedAt,
      selectedBsopHour: marketProgram.selectedBsopHour ?? '',
      selectedReason: marketProgram.selectedReason ?? 'LATEST_BY_BSOP_HOUR',
      raw: {
        wholeNetBuyTradeAmount: rawWhole,
        arbitrageNetBuyTradeAmount: rawArb,
        nonArbitrageNetBuyTradeAmount: rawNonArb,
        arbitrageSellAmount: marketProgram.programArbitrageSellAmount ?? null,
        nonArbitrageSellAmount: marketProgram.programNonArbitrageSellAmount ?? null,
        arbitrageBuyAmount: marketProgram.programArbitrageBuyAmount ?? null,
        nonArbitrageBuyAmount: marketProgram.programNonArbitrageBuyAmount ?? null,
      },
      display: {
        wholeNetBuy: formatEokAmount(rawWhole, 'KRW_1K'),
        arbitrageNetBuy: formatEokAmount(rawArb, 'KRW_1K'),
        nonArbitrageNetBuy: formatEokAmount(rawNonArb, 'KRW_1K'),
      },
      unit: { rawUnitAssumption: 'KRW_1K', displayUnit: 'EOK_KRW', mappingConfidence: 'MAPPING_VERIFIED' },
      unitCandidates: buildUnitCandidates(rawWhole),
      policy: {
        scoring: (invariants.violated || legInvariantViolated) ? 'excluded' : 'advisory',
        useForExecution: false,
        useForShadow: true,
        executionImpact: 'NONE',
        providerIssue: false,
        marketSignal: false,
        blockGateUsage: true,
        blockRegimeUsage: true,
      },
      rawNonZero,
      combinedSource: resolvedCombinedSource,
      splitAvailable,
      combinedOnly,
      snapshotMismatch: invariants.snapshotMismatch,
      inconsistencyReason: (invariants.violated || legInvariantViolated) ? (legInvariantReason ?? invariants.reason) : null,
      aggregateDiagnostic: agg as any,
      rowBreakdown: {
        kospi: { outputLength: kospiLeg.outputLength, nonZeroRows: kospiLeg.nonZeroRows, selectedBsopHour: kospiLeg.selectedBsopHour ?? 'N/A', rawWholeNetBuy: kospiLeg.rawWholeNetBuy, rawArbitrageNetBuy: kospiLeg.rawArbitrageNetBuy, rawNonArbitrageNetBuy: kospiLeg.rawNonArbitrageNetBuy, displayWholeNetBuy: kospiLeg.displayWholeNetBuy, unitCandidates: kospiLeg.unitCandidates },
        kosdaq: { outputLength: kosdaqLeg.outputLength, nonZeroRows: kosdaqLeg.nonZeroRows, selectedBsopHour: kosdaqLeg.selectedBsopHour ?? 'N/A', rawWholeNetBuy: kosdaqLeg.rawWholeNetBuy, rawArbitrageNetBuy: kosdaqLeg.rawArbitrageNetBuy, rawNonArbitrageNetBuy: kosdaqLeg.rawNonArbitrageNetBuy, displayWholeNetBuy: kosdaqLeg.displayWholeNetBuy, unitCandidates: kosdaqLeg.unitCandidates },
        combined: {
          outputLength: combinedLeg.outputLength,
          nonZeroRows: combinedLeg.nonZeroRows,
          selectedBsopHour: marketProgram.selectedBsopHour ?? combinedLeg.selectedBsopHour ?? 'N/A',
          rawWholeNetBuy: combinedWholeNetBuy,
          rawArbitrageNetBuy: combinedArbitrageNetBuy,
          rawNonArbitrageNetBuy: combinedNonArbitrageNetBuy,
          displayWholeNetBuy: formatEokAmount(combinedWholeNetBuy, 'KRW_1K'),
          unitCandidates: buildUnitCandidates(combinedWholeNetBuy),
        },
      },
    };
    programMarketSnapshot.snapshotSource = resolvedCombinedSource;
    computed.programMarket = programMarketSnapshot;
    const structured = `snapshotId=${snapshotId} selectedBsopHour=${programMarketSnapshot.selectedBsopHour || 'NONE'} rawWholeNetBuy=${rawWhole} rawArbitrageNetBuy=${rawArb} rawNonArbitrageNetBuy=${rawNonArb} displayWholeNetBuy=${programMarketSnapshot.display.wholeNetBuy} selectedDisplayUnitAssumption=KRW_1K rawUnitAssumption=KRW_1K mappingConfidence=MAPPING_VERIFIED scoring=advisory useForExecution=false useForShadow=true executionImpact=NONE regimeStatus=DECOUPLED programMarketImpact=NONE`;
    console.log(`[PROGRAM_MARKET_KIS_OFFICIAL_VERIFIED] ${structured}`);
    console.log(`[PROGRAM_MARKET_UNIT_UNVERIFIED] ${structured}`);
    console.log(`[PROGRAM_MARKET_MACROSTATE_PERSISTED] ${structured}`);
    if (rawNonZero) console.log(`[PROGRAM_MARKET_RAW_NONZERO_PRESERVED] ${structured}`);
    console.log(`[PROGRAM_MARKET_EXECUTION_IMPACT_NONE] ${structured}`);
    console.log(`[PROGRAM_MARKET_REGIME_DECOUPLED] ${structured}`);
    const srcLog = `kospiOutputLength=${marketProgram.kospiDiagnostics?.rowCount ?? 0} kosdaqOutputLength=${marketProgram.kosdaqDiagnostics?.rowCount ?? 0} combinedOutputLength=${programMarketSnapshot.rowBreakdown?.combined.outputLength ?? 0} combinedSource=${combinedSource} splitAvailable=${splitAvailable} combinedOnly=${combinedOnly} mappingConfidence=${programMarketSnapshot.unit.mappingConfidence} scoring=${programMarketSnapshot.policy.scoring} useForExecution=${programMarketSnapshot.policy.useForExecution} executionImpact=${programMarketSnapshot.policy.executionImpact}`;
    console.log(`[KIS_MARKET_PROGRAM_KOSPI_RESPONSE] ${srcLog}`);
    console.log(`[KIS_MARKET_PROGRAM_KOSDAQ_RESPONSE] ${srcLog}`);
    console.log(`[KIS_MARKET_PROGRAM_COMBINED_SOURCE_RESOLVED] ${srcLog}`);
    if (!splitAvailable) console.log(`[PROGRAM_MARKET_SPLIT_UNAVAILABLE] ${srcLog}`);
    if (programMarketSnapshot.unit.mappingConfidence === 'UNIT_UNVERIFIED' || combinedSource === 'UNKNOWN') console.log(`[PROGRAM_MARKET_SIGNAL_CANDIDATE_ONLY] ${srcLog}`);
    console.log(
      `[MarketRefresh] KIS 시장 프로그램 매매: ` +
      `${eokwon >= 0 ? '+' : ''}${eokwon.toFixed(1)}억원` +
      (arbEokwon !== null ? ` (차익 ${arbEokwon >= 0 ? '+' : ''}${arbEokwon.toFixed(1)}억원)` : ' (차익 미수집)'),
    );
  } else {
    computed.programSource = 'NONE';
    emitMarketDataProviderWarn('PROGRAM_TRADING_QUERY_FAILED', {
      programSource: 'NONE',
      carryForward: true,
    });
  }

  // ── ⑥ KRX 공매도 비율 (코스피 전체) ──────────────────────────────────────
  // 8% 초과 시 R5_CAUTION 보조 — regimeEngine.classifyRegime 가 regimeBridge 경유 `> 8` 참조.
  // source/fetchedAt 도 macroState 영속 → /health 노출.
  const shortResult = await fetchKrxShortSelling();
  if (shortResult != null) {
    // ADR-0543 소비측 L4 가드(불변식 #7): KIS_ESTIMATE(휴리스틱)·CACHE(수동백필)는 L4 → R5 8%
    // 임계 평가 제외 — 영속 ratio 를 경계(8) 이하로 캡(source/fetchedAt 보존). regime 산출 자체
    // (regimeBridge.base.ts `?? 5`) 무변경=엔진 생존(불변식 #1). ENV OFF 면 미적용(byte-equivalent).
    const L4_SOURCES: ReadonlySet<ShortSellingSource | 'CACHE'> = new Set(['KIS_ESTIMATE', 'CACHE']);
    const capL4 = process.env.SHORT_SELLING_KIS_PROXY_FALLBACK === 'true' && L4_SOURCES.has(shortResult.source);
    const ratioForRegime = capL4 ? Math.min(shortResult.ratio, 8) : shortResult.ratio;
    computed.shortSellingRatio = ratioForRegime;
    computed.shortSellingSource = shortResult.source;
    computed.shortSellingFetchedAt = shortResult.fetchedAt;
    console.log(
      `[MarketRefresh] KRX 공매도비율: ${shortResult.ratio.toFixed(2)}% (source=${shortResult.source})` +
        (ratioForRegime !== shortResult.ratio ? ` [L4 R5임계 제외→${ratioForRegime.toFixed(2)}%]` : '') +
        (ratioForRegime > 8 ? ' ⚠ R5_CAUTION 보조' : ''),
    );
  } else {
    emitMarketDataProviderWarn('SHORT_SELLING_QUERY_FAILED', {
      carryForward: true,
    });
  }

  // ── ⑥-b ADR-0139: ECOS 신용공여잔액 5영업일 변화율 ───────────────────────
  // 사용자 12 아이디어 #7 — marginBalance5dChange 결손 해소.
  // 호출 실패 시 marginBalanceSource='NONE' + 기존 값 보존 (silent degradation 차단).
  const marginResult = await fetchLatestMarginBalance5dChange().catch(() => null);
  if (marginResult) {
    computed.marginBalance5dChange = marginResult.changePct;
    computed.marginBalanceFetchedAt = marginResult.fetchedAt;
    computed.marginBalanceSource = 'ECOS_API';
    console.log(
      `[MarketRefresh] 신용공여 5d 변화율: ${marginResult.changePct >= 0 ? '+' : ''}${marginResult.changePct.toFixed(2)}% ` +
      `(latest=${marginResult.latestDate})${marginResult.changePct >= 5 ? ' ⚠ 신용잔고 과열' : ''}`,
    );
  } else {
    computed.marginBalanceSource = 'NONE';
    emitMarketDataProviderWarn('MARGIN_BALANCE_QUERY_FAILED', {
      marginBalanceSource: 'NONE',
      carryForward: true,
    });
  }

  // ── ⑥-c ADR-0141 Stage 1: KRX 11분류 raw 데이터 영속 ───────────────────
  // 사용자 후속 보강 P0-2 — FSS 자동 fetcher Stage 1 (raw 만, 매핑 미적용).
  // Passive/Active 매핑은 ADR-0142 별도 PR (운영 데이터 1~2주 누적 후 데이터 기반 검증).
  // FSS_DETAIL_FETCHER_DISABLED=true 시 fetch skip (긴급 우회).
  if (process.env.FSS_DETAIL_FETCHER_DISABLED !== 'true') {
    try {
      const detailRows = await fetchInvestorTradingDetail();
      if (detailRows.length > 0) {
        // resolveTradeDate KST 일자 — 최신 영업일.
        const todayKst = new Date(Date.now() + 9 * 3_600_000)
          .toISOString().slice(0, 10);
        appendFssDetailRecord({
          date: todayKst,
          rows: detailRows,
          fetchedAt: new Date().toISOString(),
        });
        computed.fssDetailFetchedAt = new Date().toISOString();
        computed.fssDetailSource = 'KRX_BLD';
        console.log(
          `[MarketRefresh] FSS 11분류 raw 영속: ${detailRows.length} 카테고리 ` +
          `(date=${todayKst})`,
        );

        // ── ⑥-d ADR-0142 Stage 2: Passive/Active 매핑 (ENV gate, default OFF) ──
        // FSS_MAPPING_ENABLED=true 명시 시에만 작동. 사용자 명시 *통념 추정 위험*
        // 차단을 위해 운영자가 1~2주 데이터 검증 후 활성화 결정.
        if (isFssMappingEnabled()) {
          try {
            const mapped = mapPassiveActive(detailRows, todayKst);
            upsertFssRecord({
              date: mapped.date,
              passiveNetBuy: mapped.passiveNetBuy,
              activeNetBuy: mapped.activeNetBuy,
            });
            console.log(
              `[MarketRefresh] FSS 매핑 영속 (ENV ON): ` +
              `passive=${mapped.passiveNetBuy.toFixed(0)}억, ` +
              `active=${mapped.activeNetBuy.toFixed(0)}억, ` +
              `foreign=${mapped.foreignNetBuy.toFixed(0)}억` +
              (mapped.unmatched.length > 0 ? ` (unmatched: ${mapped.unmatched.join(',')})` : ''),
            );
          } catch (e) {
            emitMarketDataProviderWarn('FSS_MAPPING_FAILED', {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      } else {
        computed.fssDetailSource = 'NONE';
        emitMarketDataProviderWarn('FSS_DETAIL_EMPTY_RESPONSE', {
          carryForward: true,
        });
      }
    } catch (e) {
      computed.fssDetailSource = 'NONE';
      emitMarketDataProviderWarn('FSS_DETAIL_QUERY_FAILED', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
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
  // ADR-0107 (사용자 진단 4/29): mhsAxis 4-axis 분해 영속 — 별도 변수로 추출 후 updated 객체에 직접 저장.
  let mhsAxisSnapshot: { interestRate: number; liquidity: number; economy: number; risk: number } | undefined;
  let mhsAxisSnapshotAt: string | undefined;
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
    mhsAxisSnapshot = idx.axis;
    mhsAxisSnapshotAt = new Date().toISOString();
    // regime 필드는 기존에 classifyRegime 이 덮어쓰므로 그대로 두되, MHS 만 반영.
    console.log(
      `[MarketRefresh] MHS 자체 계산 완료 — ${idx.mhs}/100 (${idx.regime}` +
      `${idx.buyingHalted ? ', 매수중단' : ''}) | 소스 ecos=${idx.sourcesOk.ecos} fred=${idx.sourcesOk.fred}` +
      ` | axis 금리=${idx.axis.interestRate} 유동성=${idx.axis.liquidity} 경기=${idx.axis.economy} 리스크=${idx.axis.risk}`,
    );
  } catch (e) {
    emitMarketDataProviderWarn('MHS_COMPUTE_FAILED', {
      error: e instanceof Error ? e.message : String(e),
      carryForward: true,
    });
  }

  // ── ADR-0075 PR-4 wiring: 강세 섹터 Gate Score 가산점 SSOT 영속 ─────────────
  // ADR-0125 (PR-1) 격상: buildSectorEnergyInputsWithMeta 사용 — dataQuality 4값
  // (OK/PARTIAL/STALE/FAILED) + validSectorCount + reasons 동시 영속.
  // applySectorScoreBoost 가 read 후 dataQuality 분기로 boost 강도 분기.
  let sectorEnergyResult: ReturnType<typeof evaluateSectorEnergy> | undefined;
  let sectorEnergyUpdatedAt: string | undefined;
  // ADR-0454: meta.inputs 를 saveMacroState merge scope 까지 노출. ADR-0343 L3 CACHE
  // fallback 의 writer wiring (SilentDegradation 1건 해소). meta.inputs.length>0 분기에만 채움.
  let sectorEnergyInputsResolved: Awaited<ReturnType<typeof buildSectorEnergyInputsWithMeta>>['inputs'] | undefined;
  // ADR-0396: 5단계 union (DEGRADED 신규).
  let sectorEnergyDataQuality: 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED' | undefined;
  let sectorEnergyValidSectorCount: number | undefined;
  let sectorEnergyReasons: string[] | undefined;
  // ADR-0396 4-axis 영속 (사용자 명시 ADR-0371) + ADR-0399 진단 메타 (사용자 명시 ADR-0374).
  let sectorEnergySourceTier:
    | 'KIS_OFFICIAL_INDEX'
    | 'KIS_OFFICIAL_DAILY'
    | 'KIS_STOCK_BASKET_DERIVED'
    | 'KRX_OFFICIAL_INDEX'
    | 'KRX_CODE'
    | 'STOCK_DAILY'
    | 'CACHE'
    | 'YAHOO_GLOBAL_PROXY'
    | 'YAHOO_ETF'
    | 'INTERNAL_PROXY'
    | 'MISSING'
    | 'FAILED'
    | undefined;
  let sectorEnergyFreshness: 'FRESH' | 'DEGRADED' | 'EXPIRED' | undefined;
  let sectorEnergyCoverage: number | undefined;
  let sectorEnergyConfidence: number | undefined;
  let sectorEnergyDiagnostics: NonNullable<typeof existing.sectorEnergyDiagnostics> | undefined;
  // ADR-0423: SectorEnergy 데이터 진실성 진단 (옵셔널, sectorEnergyProvider build 결과에서 직접 부착).
  let sectorEnergyQualityDiagnostic: NonNullable<typeof existing.sectorEnergyQualityDiagnostic> | undefined;
  try {
    // ADR-0125: WithMeta 사용 — symmetry 검증 + dataQuality 동시 산출 (캐시 우회).
    // ADR-0399: WithMetaWithFallback 으로 격상 — L1 KRX_CODE → L2 STOCK_DAILY → L3 CACHE → L4 YAHOO_ETF.
    // marketDataRefresh 일일 cron 이라 캐시 부담 없음. 진단 정확성 우선.
    const meta = await buildSectorEnergyInputsWithMeta();
    sectorEnergyDataQuality = meta.dataQuality;
    sectorEnergyValidSectorCount = meta.validSectorCount;
    sectorEnergyReasons = meta.reasons;
    // ADR-0423: quality diagnostic — provider 가 모든 return site 에서 부착. type union 정합.
    if (meta.qualityDiagnostic) {
      sectorEnergyQualityDiagnostic = meta.qualityDiagnostic;
    }

    // ADR-0399: meta.diagnostics + meta.sourceTier 가 부착되어 있으면 4-axis 영속.
    if (meta.diagnostics) {
      sectorEnergyDiagnostics = meta.diagnostics;
      sectorEnergySourceTier = meta.diagnostics.finalSourceTier;
      sectorEnergyConfidence = meta.diagnostics.confidence;
      // ADR-0396: coverage = validSectorCount / totalSectorCount, freshness 는 sourceTier 기반.
      sectorEnergyCoverage = meta.totalSectorCount > 0
        ? Math.max(0, Math.min(1, meta.validSectorCount / meta.totalSectorCount))
        : 0;
      // freshness 분기: KRX_CODE/STOCK_DAILY → FRESH (raw fetch 직후), CACHE → ageMs 기반,
      // YAHOO_ETF → FRESH (raw fetch), FAILED → EXPIRED.
      sectorEnergyFreshness =
        meta.diagnostics.finalSourceTier === 'CACHE' ? 'DEGRADED'
          : meta.diagnostics.finalSourceTier === 'FAILED' ? 'EXPIRED'
          : 'FRESH';
    } else if (meta.sourceTier) {
      // ADR-0399: diagnostics 부재 + sourceTier 만 있을 때 (raw 결과 정상 분기).
      sectorEnergySourceTier = meta.sourceTier;
      sectorEnergyCoverage = meta.totalSectorCount > 0
        ? Math.max(0, Math.min(1, meta.validSectorCount / meta.totalSectorCount))
        : 0;
      sectorEnergyFreshness = meta.sourceTier === 'FAILED' ? 'EXPIRED' : 'FRESH';
      // ADR-0396 SSOT 호출 — 신규 산출식 도입 금지.
      try {
        const { buildSectorEnergyQualityComposite } = await import('../clients/sectorEnergyDataQuality.js');
        const composite = buildSectorEnergyQualityComposite(
          meta.validSectorCount,
          meta.sourceTier,
          0,
          meta.totalSectorCount,
        );
        sectorEnergyConfidence = composite.confidence;
      } catch {
        sectorEnergyConfidence = 0;
      }
    }

    if (meta.inputs.length > 0) {
      sectorEnergyResult = {
        ...evaluateSectorEnergy(meta.inputs),
        ...(meta.diagnostics?.finalSourceTier ? { sourceTier: meta.diagnostics.finalSourceTier } : {}),
        ...(typeof meta.diagnostics?.confidence === 'number' ? { confidence: meta.diagnostics.confidence } : {}),
        ...(meta.diagnostics?.leadershipConfidence ? { leadershipConfidence: meta.diagnostics.leadershipConfidence } : {}),
        ...(meta.diagnostics?.coverageBreakdown
          ? {
              verifiedIndexCodeCoverage: meta.diagnostics.coverageBreakdown.verifiedIndexCodeCoverage,
              kisOfficialCoverage: meta.diagnostics.coverageBreakdown.kisOfficialCoverage,
              kisBasketCoverage: meta.diagnostics.coverageBreakdown.kisBasketCoverage,
              internalProxyCoverage: meta.diagnostics.coverageBreakdown.internalProxyCoverage,
              stockDailyFallbackCoverage: meta.diagnostics.coverageBreakdown.stockDailyFallbackCoverage,
            }
          : {}),
        liveExecutionAllowed: false as const,
        executionImpact: 'NONE' as const,
      };
      sectorEnergyUpdatedAt = new Date().toISOString();
      // ADR-0454: meta.inputs SSOT 영속 — saveMacroState merge 분기에서 sectorEnergyInputs 영속.
      sectorEnergyInputsResolved = meta.inputs;
      console.log(
        `[MarketRefresh] sectorEnergy 갱신 — ${meta.inputs.length}개 섹터 ` +
        `(dataQuality=${meta.dataQuality}, valid=${meta.validSectorCount}/12, ` +
        `LEADING ${sectorEnergyResult.leadingSectors.length}, ` +
        `LAGGING ${sectorEnergyResult.laggingSectors.length})`,
      );
    } else {
      logger.debug(
        `[MarketRefresh] sectorEnergy 입력 0건 — dataQuality=${meta.dataQuality}, ` +
        `이전 sectorEnergyResult 캐시 보존 (STALE reference).`,
      );
    }
  } catch (e) {
    emitMarketDataProviderWarn('SECTOR_ENERGY_REFRESH_FAILED', {
      error: e instanceof Error ? e.message : String(e),
    });
    sectorEnergyDataQuality = 'FAILED';
    sectorEnergyReasons = ['buildSectorEnergyInputsWithMeta throw'];
  }

  // ── 섹터 사이클 분류 (sectorEnergyResult → sectorCycleStage / leadingSectorRS) ─
  // sectorCycleDashboard / regimeBridge / preflight / sizingTierDecider 가 read.
  // sectorEnergyResult 가 이번 사이클에 갱신된 경우에만 분류 시도 — 분류 결과가
  // null (leadingSectors=0) 이면 기존 값 보존 정책 (이전 stage 유지).
  const cycleClassification = sectorEnergyResult ? deriveSectorCycle(sectorEnergyResult) : null;
  if (cycleClassification) {
    console.log(
      `[MarketRefresh] sectorCycleStage=${cycleClassification.sectorCycleStage} ` +
      `· leadingSectorRS=${cycleClassification.leadingSectorRS}`,
    );
  }

  // ── MacroState에 MERGE 저장 ───────────────────────────────────────────────
  const updatedAt = new Date().toISOString();
  const updatedAtChanged = updatedAt !== existing.updatedAt;
  const updated = {
    ...existing,
    ...computed,
    updatedAt,
    lastRefreshAttemptAt: refreshAttemptAt,
    lastRefreshSuccessAt: new Date().toISOString(),
    lastRefreshError: undefined,
    refreshJobEnabled: true,
    refreshJobLastRunAt: refreshAttemptAt,
    refreshBlockedReason: 'NONE',
    writeSucceeded: true,
    updatedAtChanged,
    providerUsed: 'MARKET_DATA_REFRESH',
    fallbackUsed: sectorEnergyQualityDiagnostic?.fallbackUsed && sectorEnergyQualityDiagnostic.fallbackUsed !== 'NONE' ? sectorEnergyQualityDiagnostic.fallbackUsed : false,
    // sectorEnergyResult 가 갱신됐을 때만 덮어쓰기 — 실패 시 이전 값 보존.
    ...(sectorEnergyResult ? { sectorEnergyResult, sectorEnergyUpdatedAt } : {}),
    // ADR-0454: sectorEnergyInputs writer wiring — ADR-0343 L3 CACHE fallback 의 입력 데이터.
    // 본 PR 이전엔 reader (sectorEnergyProvider:1065) 만 있고 writer 0건이라 영구 dead code
    // 였음 (SilentDegradation 1건). sectorEnergyInputsResolved 가 채워진 사이클에만 영속 —
    // meta.inputs.length===0 또는 throw 시 이전 cache 보존.
    ...(sectorEnergyInputsResolved && sectorEnergyUpdatedAt
      ? {
          sectorEnergyInputs: sectorEnergyInputsResolved,
          sectorEnergyInputsUpdatedAt: sectorEnergyUpdatedAt,
        }
      : {}),
    // ADR-0125: dataQuality 메타는 항상 영속 (이전 캐시 reference 활용 시 STALE 판정 입력).
    // ADR-0399 (= 사용자 명시 ADR-0374): 4-axis (sourceTier/freshness/coverage/confidence)
    // + diagnostics 동시 영속 — `/sector_energy_diag` 명령 처음 실제 데이터 표시.
    ...(sectorEnergyDataQuality !== undefined
      ? {
          sectorEnergyDataQuality,
          sectorEnergyValidSectorCount,
          sectorEnergyReasons,
          ...(sectorEnergySourceTier !== undefined ? { sectorEnergySourceTier } : {}),
          ...(sectorEnergyFreshness !== undefined ? { sectorEnergyFreshness } : {}),
          ...(sectorEnergyCoverage !== undefined ? { sectorEnergyCoverage } : {}),
          ...(sectorEnergyConfidence !== undefined ? { sectorEnergyConfidence } : {}),
          ...(sectorEnergyDiagnostics !== undefined ? { sectorEnergyDiagnostics } : {}),
          // ADR-0423: SectorEnergy 데이터 진실성 진단 영속 (옵셔널, 후방호환).
          ...(sectorEnergyQualityDiagnostic !== undefined ? { sectorEnergyQualityDiagnostic } : {}),
        }
      : {}),
    // 사이클 분류가 가능했을 때만 덮어쓰기 — 실패 시 이전 stage / RS 유지.
    ...(cycleClassification
      ? {
          sectorCycleStage: cycleClassification.sectorCycleStage,
          leadingSectorRS:  cycleClassification.leadingSectorRS,
        }
      : {}),
    // ADR-0107 mhsAxis 4-axis 영속 — computeMacroIndex 성공 시에만 덮어쓰기.
    ...(mhsAxisSnapshot ? { mhsAxis: mhsAxisSnapshot, mhsAxisUpdatedAt: mhsAxisSnapshotAt } : {}),
    // ADR-0136 fssRecordsAge 진단 영속 — getFssRecordsAge 항상 객체 반환 (MISSING 포함).
    fssRecordsAge: fssRecordsAgeSnapshot,
  };
  saveMacroState(updated as typeof existing);
  emitMacroDataHealthSummary(updated);
  logMacroRefreshSuccess({ updatedAt, mhs: updated.mhs, vkospi: updated.vkospi, kospiDayReturn: updated.kospiDayReturn, writeSucceeded: true });
  console.log(`[MarketRefresh] MacroState 갱신 완료 — ${Object.keys(computed).length}개 필드`);

  // ── 레짐 전환 감지 + 즉시 알림 ─────────────────────────────────────────────
  await checkAndNotifyRegimeChange(updated as typeof existing).catch(console.error);

    return computed;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const latest = loadMacroState() ?? existing;
    saveMacroState({
      ...latest,
      lastRefreshAttemptAt: refreshAttemptAt,
      lastRefreshError: message,
      refreshJobEnabled: true,
      refreshJobLastRunAt: refreshAttemptAt,
      refreshBlockedReason: 'REFRESH_THROW',
      providerUsed: 'MARKET_DATA_REFRESH',
      writeSucceeded: false,
      updatedAtChanged: false,
    });
    logMacroRefreshFailed({ error: e, provider: 'MARKET_DATA_REFRESH', fallbackUsed: latest?.fallbackUsed });
    emitOperationalWarn({
      priority: 'P1',
      domain: 'DATA',
      code: 'P1_MACRO_DATA_HEALTH_DEGRADED',
      message: '[MarketRefresh] MacroState refresh failed and diagnostics were persisted',
      executionImpact: 'NONE',
      mode: 'DEGRADED',
      dedupKey: 'market-refresh:refresh-throw',
      ttlSec: defaultWarnTtlSec('P1'),
      details: {
        reason: 'providerIssue=true marketSignal=false',
        error: message,
        refreshBlockedReason: 'REFRESH_THROW',
      },
    });
    throw e;
  }
}
