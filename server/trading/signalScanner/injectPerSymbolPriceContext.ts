// @responsibility buyList candidates per-symbol price context hydration (volume + return5d/20d via KIS)
import { fetchKisStockFullQuote, fetchKisStockDailyBars } from '../../clients/kisClient.js';
import { createTraceId, logVisibilityEvent, logger } from '../../utils/logger.js';
import type { SymbolSnapshotData } from '../sourceSnapshot/symbolSnapshotData.js';

export interface PriceInjectionStats {
  totalCandidates: number;
  uniqueSymbols: number;
  volumeInjected: number;
  avgVolumeInjected: number;
  return5dInjected: number;
  return20dInjected: number;
  failed: number;
}

interface ResolvedPriceContext {
  volume: number | null;
  avgVolume: number | null;
  return5d: number | null;
  return20d: number | null;
}

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

async function resolvePriceContext(code: string): Promise<ResolvedPriceContext> {
  const [quoteSettled, barsSettled] = await Promise.allSettled([
    fetchKisStockFullQuote(code),
    fetchKisStockDailyBars(code, 35),
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

  return { volume, avgVolume, return5d, return20d };
}

/**
 * 후보 배열에 KIS 현재가(FHKST01010100) + 일봉(FHKST03010100) 데이터를 주입한다.
 * volume / return5d / return20d 가 이미 채워진 필드는 덮어쓰지 않는다.
 * executionImpact=NONE — 매매 결정에 직접 관여하지 않고 candidatePoolBuilder 진단용 필드 공급.
 * snapshotData 제공 시 KIS fetch 없이 스냅샷에서 직접 파생 (중복 KIS 호출 제거).
 */
export async function injectPerSymbolPriceContext<T extends Record<string, unknown>>(
  candidates: T[],
  options?: { snapshotData?: Readonly<Record<string, SymbolSnapshotData>> },
): Promise<{ candidates: T[]; stats: PriceInjectionStats }> {
  const stats: PriceInjectionStats = {
    totalCandidates: candidates.length,
    uniqueSymbols: 0,
    volumeInjected: 0,
    avgVolumeInjected: 0,
    return5dInjected: 0,
    return20dInjected: 0,
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
        return { sym, ctx: { volume, avgVolume, return5d, return20d } };
      }
      return { sym, ctx: await resolvePriceContext(sym) };
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
      `return20dInjected=${stats.return20dInjected} failed=${stats.failed} executionImpact=NONE`,
    summary: { ...stats, executionImpact: 'NONE' },
    details: { stats },
    level: 'info',
    executionImpact: 'NONE',
  });

  return { candidates, stats };
}
