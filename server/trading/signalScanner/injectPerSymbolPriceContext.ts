// @responsibility buyList candidates per-symbol price context hydration (volume + return5d/20d + 기술지표 ma/rsi/atr via KIS, ADR-0578)
import { fetchKisStockFullQuote, fetchKisStockDailyBars } from '../../clients/kisClient.js';
import { createTraceId, logVisibilityEvent, logger } from '../../utils/logger.js';
import { calcSMA, calcRSI14, calcATR } from '../../screener/adapters/_indicators.js';
import type { SymbolSnapshotData } from '../sourceSnapshot/symbolSnapshotData.js';

export interface PriceInjectionStats {
  totalCandidates: number;
  uniqueSymbols: number;
  volumeInjected: number;
  avgVolumeInjected: number;
  return5dInjected: number;
  return20dInjected: number;
  technicalInjected: number;
  failed: number;
}

interface ResolvedPriceContext {
  volume: number | null;
  avgVolume: number | null;
  return5d: number | null;
  return20d: number | null;
  // ADR-0578 — flag ON 시에만 채움. flag OFF 면 undefined → 주입 안 함(byte-equivalent).
  ma20?: number | null;
  ma60?: number | null;
  rsi14?: number | null;
  atr?: number | null;
  atr20avg?: number | null;
}

/**
 * ADR-0578 — Gate1 기술지표 주입 활성 스위치. **default ON** (2026-06-06 승격, ADR-0157 flag 패턴 `!== 'false'`).
 * RS/모멘텀은 featurePack fallback 으로 생존하나 ma20/ma60/rsi14/atr 는 quote/symbolFeatures
 * 단독 출처라 장후 시세 미수신 시 0 → TECHNICAL_TREND/VOLUME_LIQUIDITY 점수 증발. 본 flag 가
 * 이미 받아온 일봉 bars 로 그 지표들을 계산해 symbolFeatures 에 주입한다(임계 70·게이트 로직 0변경).
 * executionImpact≠NONE: score 입력 enrich → Gate1 통과 분포 상승 가능(의도된 효과, 비-byte-equivalent).
 * 롤백: GATE1_TECHNICAL_INDICATOR_INJECTION_ENABLED=false 명시 → 신규 동작 skip(byte-equivalent).
 */
function isTechnicalInjectionEnabled(): boolean {
  return process.env.GATE1_TECHNICAL_INDICATOR_INJECTION_ENABLED !== 'false';
}

/** fetchKisStockDailyBars 는 *역일(calendar day)* lookback. 기본 35(≈24거래일, return20d 충당). */
const DEFAULT_BAR_LOOKBACK_DAYS = 35;
/** flag ON: ma60(60거래일) 충당 위해 ~90역일(≈62거래일) 확보. KIS 호출 수 불변(rows만 증가). */
const TECHNICAL_BAR_LOOKBACK_DAYS = 90;

function normalizeSymbol(value: unknown): string {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits;
}

/**
 * 이미 확보된 일봉(bars)의 volume 평균을 산출한다 (KIS 추가 호출 없음).
 * 최근 최대 20개 bar 의 finite volume 만 사용. 유효 volume 이 없으면 null.
 * VOLUME_LIQUIDITY scorer(minimumSignalScoreTrace.ts) 의 avgVolume>0 분기 입력.
 */
function averageBarVolume(bars: ReadonlyArray<{ volume: number | null }>): number | null {
  const volumes: number[] = [];
  for (const bar of bars) {
    if (volumes.length >= 20) break;
    if (typeof bar.volume === 'number' && Number.isFinite(bar.volume)) {
      volumes.push(bar.volume);
    }
  }
  if (volumes.length === 0) return null;
  const sum = volumes.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / volumes.length);
}

/**
 * ADR-0578 — 이미 확보된 일봉(bars)에서 기술지표(ma20/ma60/rsi14/atr/atr20avg)를 계산한다.
 * bars 는 최신→과거 *내림차순*(bars[0]=최근)이나 _indicators 헬퍼(calcSMA/calcRSI14/calcATR)는
 * 과거→최신 *오름차순* 을 기대하므로 역순 변환한다. 산식은 kisQuoteAdapter(buildExtendedFromKisDaily)와
 * 동일(공유 _indicators). KIS 추가 호출 없음 — 호출자가 이미 fetch 한 bars 재사용.
 * ma/rsi 는 종가만, atr 은 high/low/close 정합 표본만 사용(필드 부재 시 해당 지표만 null).
 */
function computeTechnicalIndicators(
  bars: ReadonlyArray<{ close: number | null; high?: number | null; low?: number | null }>,
): { ma20: number | null; ma60: number | null; rsi14: number | null; atr: number | null; atr20avg: number | null } {
  const asc = [...bars].reverse();
  const closes = asc
    .map((b) => b.close)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const hlc = asc.filter(
    (b): b is { close: number; high: number; low: number } =>
      typeof b.close === 'number' && Number.isFinite(b.close) &&
      typeof b.high === 'number' && Number.isFinite(b.high) &&
      typeof b.low === 'number' && Number.isFinite(b.low),
  );
  const highs = hlc.map((b) => b.high);
  const lows = hlc.map((b) => b.low);
  const hcloses = hlc.map((b) => b.close);
  return {
    ma20: closes.length >= 20 ? calcSMA(closes, 20) : null,
    ma60: closes.length >= 60 ? calcSMA(closes, 60) : null,
    rsi14: closes.length >= 15 ? calcRSI14(closes) : null,
    atr: hlc.length >= 15 ? calcATR(highs, lows, hcloses, 14) : null,
    atr20avg: hlc.length >= 21 ? calcATR(highs, lows, hcloses, 20) : null,
  };
}

async function resolvePriceContext(
  code: string,
  opts: { computeIndicators: boolean; barLookbackDays: number },
): Promise<ResolvedPriceContext> {
  const [quoteSettled, barsSettled] = await Promise.allSettled([
    fetchKisStockFullQuote(code),
    fetchKisStockDailyBars(code, opts.barLookbackDays),
  ]);

  const quote = quoteSettled.status === 'fulfilled' ? quoteSettled.value : null;
  const bars = barsSettled.status === 'fulfilled' ? barsSettled.value : [];

  const volume = quote?.volume ?? (bars.length > 0 ? bars[0].volume : null);
  const avgVolume = bars.length > 0 ? averageBarVolume(bars) : null;

  // bars[0] = 최근 거래일, bars[5] = 5영업일 전, bars[20] = 20영업일 전 (내림차순)
  let return5d: number | null = null;
  let return20d: number | null = null;
  if (bars.length >= 2) {
    const latest = bars[0].close;
    if (bars.length >= 6 && bars[5].close > 0) {
      return5d = parseFloat((((latest - bars[5].close) / bars[5].close) * 100).toFixed(2));
    }
    if (bars.length >= 21 && bars[20].close > 0) {
      return20d = parseFloat((((latest - bars[20].close) / bars[20].close) * 100).toFixed(2));
    }
  }

  const ctx: ResolvedPriceContext = { volume, avgVolume, return5d, return20d };
  // ADR-0578 — flag ON 시에만 기술지표 계산(추가 fetch 없이 위 bars 재사용).
  if (opts.computeIndicators && bars.length > 0) {
    Object.assign(ctx, computeTechnicalIndicators(bars));
  }
  return ctx;
}

/**
 * 후보 배열에 KIS 현재가(FHKST01010100) + 일봉(FHKST03010100) 데이터를 주입한다.
 * volume / return5d / return20d 가 이미 채워진 필드는 덮어쓰지 않는다.
 * executionImpact=NONE — 매매 결정에 직접 관여하지 않고 candidatePoolBuilder 진단용 필드 공급.
 * snapshotData 제공 시 KIS fetch 없이 스냅샷에서 직접 파생 (중복 KIS 호출 제거).
 * ADR-0578 — flag default ON: 동일 bars 로 ma20/ma60/rsi14/atr 를 계산해 candidate.symbolFeatures 에
 * 주입(기존 값 보존). GATE1_TECHNICAL_INDICATOR_INJECTION_ENABLED=false 명시 시 신규 동작 skip → byte-equivalent.
 */
export async function injectPerSymbolPriceContext<T extends Record<string, unknown>>(
  candidates: T[],
  options?: { snapshotData?: Readonly<Record<string, SymbolSnapshotData>> },
): Promise<{ candidates: T[]; stats: PriceInjectionStats }> {
  const technicalInjectionEnabled = isTechnicalInjectionEnabled();
  const barLookbackDays = technicalInjectionEnabled ? TECHNICAL_BAR_LOOKBACK_DAYS : DEFAULT_BAR_LOOKBACK_DAYS;

  const stats: PriceInjectionStats = {
    totalCandidates: candidates.length,
    uniqueSymbols: 0,
    volumeInjected: 0,
    avgVolumeInjected: 0,
    return5dInjected: 0,
    return20dInjected: 0,
    technicalInjected: 0,
    failed: 0,
  };

  if (candidates.length === 0) return { candidates, stats };

  const symbols = [...new Set(
    candidates.map((c) => normalizeSymbol((c.symbol ?? c.code) as unknown)).filter(Boolean),
  )];
  stats.uniqueSymbols = symbols.length;

  const settled = await Promise.allSettled(
    symbols.map(async (sym) => {
      const snap = options?.snapshotData?.[sym];
      if (snap) {
        // UnifiedSourceSnapshot Phase 2 — 스냅샷에서 직접 파생 (KIS fetch 없음)
        const close = snap.quote?.currentPrice ?? snap.dailyBars[0]?.close ?? null;
        const bars = snap.dailyBars;
        const volume = snap.quote?.volume ?? (bars.length > 0 ? bars[0].volume : null);
        const avgVolume = bars.length > 0 ? averageBarVolume(bars) : null;
        let return5d: number | null = null;
        let return20d: number | null = null;
        if (close !== null && bars.length >= 6 && bars[5].close > 0) {
          return5d = parseFloat((((close - bars[5].close) / bars[5].close) * 100).toFixed(2));
        }
        if (close !== null && bars.length >= 21 && bars[20].close > 0) {
          return20d = parseFloat((((close - bars[20].close) / bars[20].close) * 100).toFixed(2));
        }
        const ctx: ResolvedPriceContext = { volume, avgVolume, return5d, return20d };
        // ADR-0578 — 스냅샷 dailyBars(최대 60일)로 기술지표 계산(추가 fetch 없음).
        if (technicalInjectionEnabled && bars.length > 0) {
          Object.assign(ctx, computeTechnicalIndicators(bars));
        }
        return { sym, ctx };
      }
      return { sym, ctx: await resolvePriceContext(sym, { computeIndicators: technicalInjectionEnabled, barLookbackDays }) };
    }),
  );

  const priceMap = new Map<string, ResolvedPriceContext>();
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      priceMap.set(result.value.sym, result.value.ctx);
    } else {
      stats.failed++;
      logger.warn('[PER_SYMBOL_PRICE_CONTEXT] 종목 조회 실패', result.reason instanceof Error ? result.reason.message : result.reason);
    }
  }

  for (const candidate of candidates) {
    const sym = normalizeSymbol((candidate.symbol ?? candidate.code) as unknown);
    const ctx = sym ? priceMap.get(sym) : undefined;
    if (!ctx) continue;

    if (ctx.volume !== null && (candidate.volume == null || !Number.isFinite(candidate.volume as number))) {
      (candidate as Record<string, unknown>).volume = ctx.volume;
      stats.volumeInjected++;
    }
    if (ctx.avgVolume !== null && (candidate.avgVolume == null || !Number.isFinite(candidate.avgVolume as number))) {
      (candidate as Record<string, unknown>).avgVolume = ctx.avgVolume;
      stats.avgVolumeInjected++;
    }
    if (ctx.return5d !== null && (candidate.return5d == null || !Number.isFinite(candidate.return5d as number))) {
      (candidate as Record<string, unknown>).return5d = ctx.return5d;
      stats.return5dInjected++;
    }
    if (ctx.return20d !== null && (candidate.return20d == null || !Number.isFinite(candidate.return20d as number))) {
      (candidate as Record<string, unknown>).return20d = ctx.return20d;
      stats.return20dInjected++;
    }

    // ADR-0578 — 기술지표를 candidate.symbolFeatures 에 주입(스코어러 ma20 읽기 경로 = symbolFeatures?.ma20 ?? quote?.ma20).
    // 기존 symbolFeatures 값은 보존(덮어쓰기 금지) — full adapter 하이드레이션을 거친 종목은 자기 값 유지.
    if (technicalInjectionEnabled) {
      const sf = (candidate.symbolFeatures && typeof candidate.symbolFeatures === 'object')
        ? (candidate.symbolFeatures as Record<string, unknown>)
        : {};
      let injectedAny = false;
      const fillIfMissing = (key: string, val: number | null | undefined): void => {
        if (typeof val !== 'number' || !Number.isFinite(val)) return;
        const cur = sf[key];
        if (cur == null || !Number.isFinite(cur as number)) {
          sf[key] = val;
          injectedAny = true;
        }
      };
      fillIfMissing('ma20', ctx.ma20);
      fillIfMissing('ma60', ctx.ma60);
      fillIfMissing('rsi14', ctx.rsi14);
      fillIfMissing('atr', ctx.atr);
      fillIfMissing('atr20avg', ctx.atr20avg);
      if (injectedAny) {
        (candidate as Record<string, unknown>).symbolFeatures = sf;
        stats.technicalInjected++;
      }
    }
  }

  const traceId = createTraceId('price_ctx');
  logVisibilityEvent({
    visibility: 'DIAGNOSTIC',
    category: 'KIS',
    sourceCommand: '/scan',
    traceId,
    message:
      `[PER_SYMBOL_PRICE_CONTEXT_INJECTION] ` +
      `totalCandidates=${stats.totalCandidates} uniqueSymbols=${stats.uniqueSymbols} ` +
      `volumeInjected=${stats.volumeInjected} avgVolumeInjected=${stats.avgVolumeInjected} ` +
      `return5dInjected=${stats.return5dInjected} ` +
      `return20dInjected=${stats.return20dInjected} ` +
      `technicalInjected=${stats.technicalInjected} ` +
      `technicalInjectionEnabled=${technicalInjectionEnabled} failed=${stats.failed} executionImpact=NONE`,
    summary: { ...stats, executionImpact: 'NONE' },
    details: { stats },
    level: 'info',
    executionImpact: 'NONE',
  });

  return { candidates, stats };
}
