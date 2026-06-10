// @responsibility KOSPI·VKOSPI·USD/KRW·SPX·DXY·FRED·MHS 섹션 갱신 + Yahoo 차트 fetch와 health heartbeat
/**
 * indexMacroSections.ts — ADR-0595 marketDataRefresh 섹션 모듈 분해.
 *
 * 본체 marketDataRefresh.ts 에서 텍스트 그대로 이동 (byte-equivalent, behavior change 0).
 * Yahoo heartbeat mutable 상태는 reader/writer 와 함께 본 모듈에 동반 이동 (상태 분단 없음).
 */

import { fetchFredLatest } from '../../clients/fredClient.js';
import { fetchLatestUsdKrw } from '../../clients/ecosClient.js';
import { fetchDerivativesIndexDaily, isVkospiIndexName } from '../../clients/krxOpenApi.js';
import { computeMacroIndex } from '../../engines/macroIndexEngine.js';
import { deriveMhsDegrade, type MhsDegradeInfo } from '../../engines/mhsDegrade.js';
import { guardedFetch } from '../../utils/egressGuard.js';
import { evaluateCrossSource } from '../crossSourceValidator.js';
import { sendTelegramAlert } from '../../alerts/telegramClient.js';
import type { MacroState } from '../../persistence/macroStateRepo.js';
import type { MarketRefreshComputed, DailyBar, YahooHealthSnapshot } from './types.js';
import { applyKospiTriggerProvenance } from './kospiIntradayRefresh.js';
import { sma, nDayReturn } from './helpers.js';
import { emitMarketDataProviderWarn } from './refreshObservability.js';

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

export const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

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

export async function refreshKospiSection(computed: MarketRefreshComputed): Promise<void> {
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
    await applyKospiTriggerProvenance(computed, latestBar); // ADR-0592: 봉 거래일 영속 + flag-gated KIS intraday quote
  } else {
    emitMarketDataProviderWarn('KOSPI_DATA_INSUFFICIENT');
  }
}

export async function refreshVkospiSection(computed: MarketRefreshComputed, existing: MacroState): Promise<void> {
  try {
    const rows = await fetchDerivativesIndexDaily();
    // VKOSPI(코스피200 변동성지수) 행 선택 — 정밀 이름 매칭. 덤프(2026-06-07) 결과 bare '변동성지수'는
    // 'KRX 최소변동성지수'(주식 지수 ~14694) 등 동음이의까지 매칭하던 fragility 확인 → VKOSPI 한정으로 좁힘.
    // 다중 매칭 시 모호성 경고(향후 KRX 행 추가 대비).
    const vkospiMatches = rows.filter((r) => isVkospiIndexName(r.indexName));
    if (vkospiMatches.length > 1) {
      emitMarketDataProviderWarn('VKOSPI_ROW_AMBIGUOUS', {
        matchCount: vkospiMatches.length,
        names: vkospiMatches.slice(0, 5).map((r) => r.indexName),
      });
    }
    const vkospiRow = vkospiMatches[0];
    if (vkospiRow) {
      computed.vkospi = vkospiRow.close;
      computed.vkospiPrevClose = vkospiRow.change !== 0 ? vkospiRow.close - vkospiRow.change : vkospiRow.close;
      computed.vkospiDayChangeComputed = vkospiRow.changePct;
      computed.vkospiDayChangeSource = 'KRX_DERIV_INDEX_DAILY';
      // 거래일(BAS_DD) + fetch 시각 영속 — 신선도 가시화(facts only, ADR-0584 Phase A 유지).
      if (vkospiRow.baseDate) computed.vkospiBaseDate = vkospiRow.baseDate;
      computed.vkospiFetchedAt = new Date().toISOString();
      const ageMs = existing.updatedAt ? Date.now() - Date.parse(existing.updatedAt) : Number.POSITIVE_INFINITY;
      const shouldKeepClientValue = typeof existing.vkospiDayChange === 'number' && Number.isFinite(ageMs) && ageMs <= 15 * 60_000;
      computed.vkospiDayChange = shouldKeepClientValue ? existing.vkospiDayChange : vkospiRow.changePct;
      console.log(
        `[MarketRefresh] VKOSPI (KRX) source=KRX_DERIV_INDEX_DAILY ` +
        `현재=${vkospiRow.close.toFixed(2)} 전일=${(computed.vkospiPrevClose as number).toFixed(2)} ` +
        `dayChange=${vkospiRow.changePct.toFixed(2)}% baseDate=${vkospiRow.baseDate || 'N/A'}`,
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
        computed.vkospiFetchedAt = new Date().toISOString();
        if (typeof existing.vkospiDayChange !== 'number') computed.vkospiDayChange = vkospiComputed.dayChangePct;
      }
    } catch {}
    // ADR-0584: KRX+Yahoo 모두 실패 → computed.vkospi 미설정 → merge 시 기존 값 silent carry-forward.
    // 공매도/신용잔고처럼 운영자 경고를 띄워 invisible staleness 차단(불변식 #6: provider 이슈, market signal 아님).
    if (computed.vkospi === undefined) {
      emitMarketDataProviderWarn('VKOSPI_CARRY_FORWARD', {
        reason: 'KRX+Yahoo VKOSPI fetch 모두 실패 — 기존 vkospi 값 유지(carry-forward)',
        carryForward: true,
        prevBaseDate: existing.vkospiBaseDate ?? 'N/A',
      });
    }
  }
}

export async function refreshUsdKrwSection(computed: MarketRefreshComputed): Promise<void> {
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
}

export async function refreshSpxSection(computed: MarketRefreshComputed): Promise<void> {
  const spx = await fetchCloses('^GSPC', '25d');
  if (spx && spx.length >= 3) {
    computed.spxDayReturn = nDayReturn(spx, 1);
    computed.spx20dReturn = nDayReturn(spx, Math.min(20, spx.length - 1));
    console.log(`[MarketRefresh] SPX: 1d=${(computed.spxDayReturn as number).toFixed(2)}%, 20d=${(computed.spx20dReturn as number).toFixed(2)}%`);
  } else {
    emitMarketDataProviderWarn('SPX_DATA_INSUFFICIENT');
  }
}

export async function refreshDxySection(computed: MarketRefreshComputed): Promise<void> {
  const dxy = await fetchCloses('DX-Y.NYB', '10d');
  if (dxy && dxy.length >= 3) {
    computed.dxy5dChange = nDayReturn(dxy, Math.min(5, dxy.length - 1));
    console.log(`[MarketRefresh] DXY: 5d=${(computed.dxy5dChange as number).toFixed(2)}%`);
  } else {
    emitMarketDataProviderWarn('DXY_DATA_INSUFFICIENT');
  }
}

// ── ⑧ FRED 거시 지표 (병렬 조회) ────────────────────────────────────────
// T10Y2Y: 음수 전환 → 경기침체 6~18개월 선행 / STLFSI4 > 0 = 금융 스트레스
export async function refreshFredSection(computed: MarketRefreshComputed): Promise<void> {
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
}

// ── ⑨ 아이디어 11: ECOS+FRED 기반 MHS 자체 계산 ─────────────────────────
// 기존 MHS 는 클라이언트 batchIntel Phase A 가 Gemini 에게 추론시켰지만,
// 서버에서 ECOS 실데이터 + FRED 지표만으로 결정적으로 도출한다.
// 시장 보조(vkospi/vix/samsungIri)는 이 함수 상단에서 계산된 computed 를 재사용.
// ADR-0107 (사용자 진단 4/29): mhsAxis 4-axis 분해 영속 — 별도 변수로 추출 후 updated 객체에 직접 저장.
export async function resolveMhsSection(computed: MarketRefreshComputed, existing: MacroState): Promise<{
  mhsAxisSnapshot: { interestRate: number; liquidity: number; economy: number; risk: number } | undefined;
  mhsAxisSnapshotAt: string | undefined;
  mhsDegradeSnapshot: MhsDegradeInfo | undefined;
}> {
  let mhsAxisSnapshot: { interestRate: number; liquidity: number; economy: number; risk: number } | undefined;
  let mhsAxisSnapshotAt: string | undefined;
  // ADR-0583: MHS 소스 저하(degrade) 영속용 — computeMacroIndex().sourcesOk 도출.
  let mhsDegradeSnapshot: MhsDegradeInfo | undefined;
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
    // ADR-0583: 소스 저하 등급(FULL/PARTIAL/FALLBACK) 도출 — silent degradation 가시화.
    mhsDegradeSnapshot = deriveMhsDegrade(idx.sourcesOk);
    // regime 필드는 기존에 classifyRegime 이 덮어쓰므로 그대로 두되, MHS 만 반영.
    console.log(
      `[MarketRefresh] MHS 자체 계산 완료 — ${idx.mhs}/100 (${idx.regime}` +
      `${idx.buyingHalted ? ', 매수중단' : ''}) | 소스 ecos=${idx.sourcesOk.ecos} fred=${idx.sourcesOk.fred}` +
      ` confidence=${mhsDegradeSnapshot.confidence}${mhsDegradeSnapshot.degraded ? ' ⚠️DEGRADED' : ''}` +
      ` | axis 금리=${idx.axis.interestRate} 유동성=${idx.axis.liquidity} 경기=${idx.axis.economy} 리스크=${idx.axis.risk}`,
    );
  } catch (e) {
    emitMarketDataProviderWarn('MHS_COMPUTE_FAILED', {
      error: e instanceof Error ? e.message : String(e),
      carryForward: true,
    });
  }
  return { mhsAxisSnapshot, mhsAxisSnapshotAt, mhsDegradeSnapshot };
}
