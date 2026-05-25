/**
 * @responsibility KIS 4-엔드포인트 일괄 수집기 — 후보 종목 배열을 입력받아 UnifiedSourceSnapshot 구성
 *
 * ADR-0519: buyListLoop 진입 전 종목당 1회 병렬 fetch → 중복 KIS 호출 제거 (불변식 #3).
 * Feature flag USE_UNIFIED_SOURCE_SNAPSHOT=true 뒤에 격리 — OFF 시 기존 경로 100% 유지.
 *
 * 단일 통로 계약:
 *   - KIS 호출은 모두 server/clients/kisClient.ts 경유 (raw KIS URL 직접 호출 금지)
 *   - macroState 읽기는 server/persistence/macroStateRepo.ts loadMacroState() 경유
 *
 * executionImpact: NONE (flag OFF 시 기존 buyListLoop 시그니처 변경 없음)
 */

import {
  fetchKisStockFullQuote,
  fetchKisMultiStockQuote,
  fetchKisInvestorFlow,
  fetchKisStockDailyBars,
  fetchKisStockProgramTrade,
} from '../clients/kisClient.js';
import type {
  KisStockFullQuote,
  KisStockDailyBar,
  KisInvestorFlow,
  KisStockProgramTrade,
} from '../clients/kisClient.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getAllStockEntries } from '../persistence/krxStockMasterRepo.js';
import type { StockMasterEntry } from '../persistence/krxStockMasterRepo.js';
import { logger } from '../utils/logger.js';
import {
  generateSnapshotId,
} from './sourceSnapshot/unifiedSourceSnapshot.js';
import type {
  UnifiedSourceSnapshot,
  UnifiedMacroContext,
} from './sourceSnapshot/unifiedSourceSnapshot.js';
import type {
  SymbolSnapshotData,
  SymbolTechnicalIndicators,
  SymbolSupplySignal,
  SymbolDataQuality,
} from './sourceSnapshot/symbolSnapshotData.js';

// ─── concurrency helper ──────────────────────────────────────────────────────

/**
 * Promise.allSettled 기반 concurrency-limited map.
 * limit 개 이하의 Promise를 동시 실행하며, 실패한 항목은 reject로 전파하지 않고
 * allSettled 방식으로 집계한다 (한 종목 실패가 전체 중단 방지).
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  const queue = items.map((item, idx) => ({ item, idx }));
  let queueIndex = 0;

  async function runNext(): Promise<void> {
    if (queueIndex >= queue.length) return;
    const { item, idx } = queue[queueIndex++];
    try {
      results[idx] = await fn(item);
    } catch (err) {
      logger.warn(
        '[SymbolDataCollector/mapLimit] 항목 처리 실패:',
        err instanceof Error ? err.message : String(err),
        { idx },
      );
      results[idx] = null;
    }
    return runNext();
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

// ─── 기술 지표 파생 ──────────────────────────────────────────────────────────

/**
 * dailyBars (최신순 정렬 — bars[0]=가장 최근) 와 quote 로부터 기술 지표를 파생한다.
 * bars는 KIS FHKST03010100 응답 그대로 최신순이며 인덱스 0이 오늘/최근 거래일이다.
 */
function deriveTechnicalIndicators(
  bars: KisStockDailyBar[],
  quote: KisStockFullQuote | null,
): SymbolTechnicalIndicators | null {
  if (bars.length < 2) return null;

  const close = quote?.currentPrice ?? bars[0]?.close ?? null;
  if (close === null) return null;

  // ─ 이동평균 ─
  const ma20Bars = bars.slice(0, 20);
  const ma60Bars = bars.slice(0, 60);

  const ma20 =
    ma20Bars.length >= 20
      ? ma20Bars.reduce((sum, b) => sum + b.close, 0) / ma20Bars.length
      : null;

  const ma60 =
    ma60Bars.length >= 60
      ? ma60Bars.reduce((sum, b) => sum + b.close, 0) / ma60Bars.length
      : null;

  // ─ 수익률 ─
  // bars[0]=최신, bars[5]=6거래일 전, bars[20]=21거래일 전
  const bar5DaysAgo = bars[5] ?? null;
  const bar20DaysAgo = bars[20] ?? null;

  const return5d =
    bar5DaysAgo !== null && bar5DaysAgo.close > 0
      ? ((close - bar5DaysAgo.close) / bar5DaysAgo.close) * 100
      : null;

  const return20d =
    bar20DaysAgo !== null && bar20DaysAgo.close > 0
      ? ((close - bar20DaysAgo.close) / bar20DaysAgo.close) * 100
      : null;

  // ─ 평균 거래량 ─
  const vol20Bars = bars.slice(0, 20);
  const volumeEntries = vol20Bars.map((b) => b.volume).filter((v): v is number => v !== null);
  const avgVolume20d =
    volumeEntries.length >= 10
      ? volumeEntries.reduce((s, v) => s + v, 0) / volumeEntries.length
      : null;

  const avgTradingValue20d =
    avgVolume20d !== null && close > 0 ? avgVolume20d * close : null;

  // ─ MA 배열 상태 ─
  let maAlignmentStatus: SymbolTechnicalIndicators['maAlignmentStatus'] = null;
  if (ma20 !== null && ma60 !== null) {
    if (close > ma20 && ma20 > ma60) {
      maAlignmentStatus = 'BULLISH';
    } else if (close >= ma60) {
      maAlignmentStatus = 'NEUTRAL';
    } else {
      maAlignmentStatus = 'BEARISH';
    }
  }

  return {
    avgVolume20d,
    avgTradingValue20d,
    ma20,
    ma60,
    aboveMA20: ma20 !== null ? close > ma20 : null,
    aboveMA60: ma60 !== null ? close >= ma60 : null,
    return5d,
    return20d,
    rsScore: null,          // 향후 cross-sectional RS 계산 시 채움 (현재 집계 불가)
    relativeReturn20d: null, // 코스피 20d 수익률 필요 — macroContext에서 연계 예정
    maAlignmentStatus,
  };
}

// ─── 수급 신호 파생 ──────────────────────────────────────────────────────────

/**
 * KisInvestorFlow 원시 데이터로부터 수급 신호를 파생한다.
 * null flow → UNKNOWN / providerHealth MISSING.
 */
function deriveSupplySignal(flow: KisInvestorFlow | null): SymbolSupplySignal | null {
  if (flow === null) {
    return {
      foreignNetBuy: null,
      institutionNetBuy: null,
      individualNetBuy: null,
      programNetBuy: null,
      supplySignal: 'UNKNOWN',
      providerHealth: 'MISSING',
      source: 'NONE',
    };
  }

  const foreignNetBuy =
    typeof flow.foreignNetBuy === 'number' && Number.isFinite(flow.foreignNetBuy)
      ? flow.foreignNetBuy
      : null;
  const institutionNetBuy =
    typeof flow.institutionalNetBuy === 'number' && Number.isFinite(flow.institutionalNetBuy)
      ? flow.institutionalNetBuy
      : null;
  const individualNetBuy =
    typeof flow.individualNetBuy === 'number' && Number.isFinite(flow.individualNetBuy)
      ? flow.individualNetBuy
      : null;

  // 수급 신호 분류
  let supplySignal: SymbolSupplySignal['supplySignal'];
  const fBullish = foreignNetBuy !== null && foreignNetBuy > 0;
  const iBullish = institutionNetBuy !== null && institutionNetBuy > 0;
  const fBearish = foreignNetBuy !== null && foreignNetBuy < 0;
  const iBearish = institutionNetBuy !== null && institutionNetBuy < 0;

  if (fBullish && iBullish) {
    supplySignal = 'BULLISH';
  } else if (fBullish || iBullish) {
    supplySignal = 'ACCUMULATING';
  } else if (fBearish && iBearish) {
    supplySignal = 'BEARISH';
  } else {
    supplySignal = 'NEUTRAL';
  }

  // providerHealth — KIS 응답이 있으면 VERIFIED, 주요 필드가 하나라도 누락이면 DEGRADED
  const providerHealth: SymbolSupplySignal['providerHealth'] =
    foreignNetBuy !== null && institutionNetBuy !== null ? 'VERIFIED' : 'DEGRADED';

  return {
    foreignNetBuy,
    institutionNetBuy,
    individualNetBuy,
    programNetBuy: null, // KisInvestorFlow에는 programNetBuy 없음 — programTrade 별도 연계 예정
    supplySignal,
    providerHealth,
    source: 'KIS_API',
  };
}

// ─── 데이터 품질 판정 ────────────────────────────────────────────────────────

function assessDataQuality(data: {
  quote: KisStockFullQuote | null;
  flow: KisInvestorFlow | null;
  bars: KisStockDailyBar[];
  program: KisStockProgramTrade | null;
}): SymbolDataQuality {
  if (data.quote === null) return 'MISSING';

  const successCount = [
    data.flow !== null,
    data.bars.length > 0,
    data.program !== null,
  ].filter(Boolean).length;

  if (successCount === 3) return 'FULL';
  if (successCount >= 1) return 'PARTIAL';
  return 'MINIMAL';
}

// ─── per-symbol 수집 ─────────────────────────────────────────────────────────

/**
 * 단일 종목에 대해 KIS 4개 엔드포인트를 동시 호출한다.
 * preloadedQuote가 제공된 경우 fetchKisStockFullQuote 개별 호출을 스킵한다
 * (ADR-0519 Phase 5: intstock-multprice 배치 시세 최적화).
 * 각 fetch는 내부적으로 에러를 catch하여 null/빈배열을 반환하므로
 * 이 함수 자체는 throw하지 않는다.
 */
async function collectSymbolData(
  code: string,
  krxEntry?: StockMasterEntry,
  preloadedQuote?: KisStockFullQuote,
): Promise<SymbolSnapshotData> {
  const t0 = performance.now();

  // preloadedQuote가 있으면 개별 quote fetch 스킵 — flow/bars/program은 항상 병렬 fetch
  const [flowResult, barsResult, programResult] = await Promise.all([
    Promise.allSettled([fetchKisInvestorFlow(code)]).then((r) => r[0]),
    Promise.allSettled([fetchKisStockDailyBars(code, 90)]).then((r) => r[0]),
    Promise.allSettled([fetchKisStockProgramTrade(code)]).then((r) => r[0]),
  ]);

  // quote 결정: preloadedQuote 우선, 없으면 개별 KIS 호출
  let quote: KisStockFullQuote | null;
  if (preloadedQuote !== undefined) {
    quote = preloadedQuote;
  } else {
    const [quoteResult] = await Promise.allSettled([fetchKisStockFullQuote(code)]);
    if (quoteResult.status === 'rejected') {
      logger.warn(
        '[SymbolDataCollector] fetchKisStockFullQuote 실패:',
        quoteResult.reason instanceof Error ? quoteResult.reason.message : String(quoteResult.reason),
        { code },
      );
      quote = null;
    } else {
      quote = quoteResult.value;
    }
  }

  const flow =
    flowResult.status === 'fulfilled' ? flowResult.value : null;
  if (flowResult.status === 'rejected') {
    logger.warn(
      '[SymbolDataCollector] fetchKisInvestorFlow 실패:',
      flowResult.reason instanceof Error ? flowResult.reason.message : String(flowResult.reason),
      { code },
    );
  }

  const bars =
    barsResult.status === 'fulfilled' ? (barsResult.value ?? []) : [];
  if (barsResult.status === 'rejected') {
    logger.warn(
      '[SymbolDataCollector] fetchKisStockDailyBars 실패:',
      barsResult.reason instanceof Error ? barsResult.reason.message : String(barsResult.reason),
      { code },
    );
  }

  const program =
    programResult.status === 'fulfilled' ? programResult.value : null;
  if (programResult.status === 'rejected') {
    logger.warn(
      '[SymbolDataCollector] fetchKisStockProgramTrade 실패:',
      programResult.reason instanceof Error ? programResult.reason.message : String(programResult.reason),
      { code },
    );
  }

  const fetchDurationMs = Math.round(performance.now() - t0);
  const fetchedAt = new Date().toISOString();

  const technicalIndicators = deriveTechnicalIndicators(bars, quote);
  const supplySignal = deriveSupplySignal(flow);
  const dataQuality = assessDataQuality({ quote, flow, bars, program });

  const resolvedMarket =
    krxEntry && krxEntry.market !== 'OTHER' ? krxEntry.market : 'KOSPI';

  return {
    code,
    name: krxEntry?.name ?? '',
    market: resolvedMarket,
    quote,
    investorFlow: flow,
    dailyBars: bars,
    programTrade: program,
    technicalIndicators,
    supplySignal,
    dataQuality,
    fetchedAt,
    fetchDurationMs,
  };
}

// ─── 매크로 컨텍스트 ─────────────────────────────────────────────────────────

/**
 * macroStateRepo에서 읽은 최신 macroState를 UnifiedMacroContext로 변환한다.
 * macroState 부재 시 안전한 기본값을 사용한다 (9대 불변식 #1: Trading Engine 항상 생존).
 */
async function buildMacroContext(): Promise<UnifiedMacroContext> {
  // loadMacroState()는 sync I/O — blocking이지만 경량 JSON 읽기로 허용
  const macro = loadMacroState();

  return {
    regime: macro?.regime ?? 'UNKNOWN',
    engineMode: 'OBSERVE_ONLY',   // EngineModeManager는 서버 상태 싱글톤 — 여기서는 보수적 기본값
    marketSession: macro?.marketSessionState ?? 'UNKNOWN',
    sectorCycleStage: macro?.sectorCycleStage ?? null,
    fomcPhase: 'NORMAL',          // fomcPhase는 preflight에서 확정 — 수집기 단계 미필요
    macroStateUpdatedAt: macro?.updatedAt ?? null,
    kospi20dReturn:
      typeof macro?.kospi20dReturn === 'number' && Number.isFinite(macro.kospi20dReturn)
        ? macro.kospi20dReturn
        : null,
  };
}

// ─── 교차 집합 RS 계산 ───────────────────────────────────────────────────────

/**
 * 전 후보 수집 완료 후 cross-sectional relativeReturn20d / rsScore 를 일괄 계산한다.
 * Object.freeze() 전에 perSymbol 을 직접 변경한다 (freeze 후에는 변경 불가).
 *
 * rsScore: relativeReturn20d 의 퍼센타일 순위 (0~100, 100=최상위).
 * 유효 후보(return20d ≠ null) 가 2개 미만이면 no-op.
 */
function computeCrossSectionalRS(
  perSymbol: Record<string, SymbolSnapshotData>,
  kospi20dReturn: number | null,
): void {
  if (kospi20dReturn === null) return;

  // return20d 가 있는 종목만 대상
  type Entry = { code: string; relativeReturn: number };
  const valid: Entry[] = [];
  for (const [code, snap] of Object.entries(perSymbol)) {
    const r20 = snap.technicalIndicators?.return20d;
    if (typeof r20 === 'number' && Number.isFinite(r20)) {
      valid.push({ code, relativeReturn: r20 - kospi20dReturn });
    }
  }

  if (valid.length < 2) return;

  // 오름차순 정렬 후 퍼센타일 부여
  const sorted = [...valid].sort((a, b) => a.relativeReturn - b.relativeReturn);
  const n = sorted.length;
  const rankMap = new Map<string, number>(
    sorted.map((e, i) => [e.code, Math.round((i / (n - 1)) * 100)]),
  );

  for (const { code, relativeReturn } of valid) {
    const ti = perSymbol[code]?.technicalIndicators;
    if (ti) {
      ti.relativeReturn20d = parseFloat(relativeReturn.toFixed(2));
      ti.rsScore = rankMap.get(code) ?? null;
    }
  }

  logger.info('[SymbolDataCollector] cross-sectional RS 계산 완료', {
    validCount: valid.length,
    kospi20dReturn,
  });
}

// ─── 메인 수집 함수 ──────────────────────────────────────────────────────────

export interface CollectUnifiedSnapshotOptions {
  /** Promise 동시 실행 수 (기본 5 — KIS 레이트 리밋 준수) */
  concurrency?: number;
  /** 상위 buyListLoop의 사이클 식별자 */
  scanCycleId?: string;
}

/**
 * 후보 종목 목록을 받아 KIS 4개 엔드포인트를 종목당 1회 병렬 fetch하고
 * UnifiedSourceSnapshot을 구성하여 반환한다.
 *
 * 멱등성: 동일한 candidates + scanCycleId로 재호출 시 새 snapshotId로 독립 스냅샷 생성.
 * 재진입 안전: 각 fetch는 Promise.allSettled 기반이라 실패 후 재호출 안전.
 */
export async function collectUnifiedSnapshot(
  candidates: string[],
  options: CollectUnifiedSnapshotOptions = {},
): Promise<UnifiedSourceSnapshot> {
  const { concurrency = 5, scanCycleId = `cycle_${Date.now()}` } = options;
  const snapshotId = generateSnapshotId();
  const t0 = performance.now();

  logger.info('[SymbolDataCollector] 수집 시작', {
    snapshotId,
    scanCycleId,
    candidateCount: candidates.length,
    concurrency,
  });

  // KRX 마스터 코드→엔트리 맵 (동기 로드 — 경량 JSON)
  const krxMasterMap = new Map<string, StockMasterEntry>(
    getAllStockEntries().map((e) => [e.code, e]),
  );

  // ADR-0519 Phase 5: 배치 시세 선행 fetch (100종목 기준 100회 → 4회 KIS 호출 감소).
  // 배치 실패 시 빈 Map 반환 — collectSymbolData 내 개별 fallback 경로로 수렴.
  let quoteMap: Map<string, KisStockFullQuote> = new Map();
  try {
    quoteMap = await fetchKisMultiStockQuote(candidates);
  } catch (batchErr) {
    logger.warn(
      '[SymbolDataCollector] 배치 시세 fetch 실패 — 개별 quote fetch로 fallback',
      batchErr instanceof Error ? batchErr.message : String(batchErr),
    );
  }

  // macroContext는 fetch와 병행 수집
  const [macroContext, rawResults] = await Promise.all([
    buildMacroContext(),
    mapLimit(candidates, concurrency, (code) =>
      collectSymbolData(code, krxMasterMap.get(code), quoteMap.get(code)),
    ),
  ]);

  // perSymbol 맵 구성
  const perSymbol: Record<string, SymbolSnapshotData> = {};
  let fullCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const code = candidates[i];
    const data = rawResults[i];
    if (data !== null) {
      perSymbol[code] = data;
      if (data.dataQuality === 'FULL') fullCount++;
    } else {
      // mapLimit에서 이미 warn 로그 → 여기서는 MISSING 레코드로 채움
      logger.warn('[SymbolDataCollector] 종목 수집 결과 null — MISSING 처리', { code });
      const missingEntry = krxMasterMap.get(code);
      const missingMarket =
        missingEntry && missingEntry.market !== 'OTHER' ? missingEntry.market : 'KOSPI';
      perSymbol[code] = {
        code,
        name: missingEntry?.name ?? '',
        market: missingMarket,
        quote: null,
        investorFlow: null,
        dailyBars: [],
        programTrade: null,
        technicalIndicators: null,
        supplySignal: null,
        dataQuality: 'MISSING',
        fetchedAt: new Date().toISOString(),
        fetchDurationMs: 0,
      };
    }
  }

  // 교차 집합 RS 계산 — freeze 전에 실행
  computeCrossSectionalRS(perSymbol, macroContext.kospi20dReturn);

  const collectorDurationMs = Math.round(performance.now() - t0);
  const completionRate =
    candidates.length > 0 ? fullCount / candidates.length : 0;

  logger.info('[SymbolDataCollector] 수집 완료', {
    snapshotId,
    scanCycleId,
    totalCandidates: candidates.length,
    fullCount,
    completionRate: completionRate.toFixed(3),
    collectorDurationMs,
  });

  if (completionRate < 0.5 && candidates.length > 0) {
    logger.warn(
      '[SymbolDataCollector] completionRate < 0.5 — KIS API 상태 점검 필요',
      { snapshotId, completionRate, totalCandidates: candidates.length },
    );
  }

  return {
    snapshotId,
    createdAt: new Date().toISOString(),
    scanCycleId,
    universeTotalCount: candidates.length,
    screenedCandidates: candidates,
    perSymbol: Object.freeze(perSymbol),
    macroContext,
    completionRate,
    dataSourceVersion: '2.0',
    collectorDurationMs,
    pipelinePath: 'UNIFIED_SNAPSHOT',
  };
}
