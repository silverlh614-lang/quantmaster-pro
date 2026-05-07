// @responsibility counterfactualShadowLearningPerformanceReport — ADR-0431 read-only 성과 리포트 SSOT.
//
// ADR-0431:
// Counterfactual shadow performance reporting evaluates learning-only samples
// created under SELL_ONLY / HARD_BLOCK by ADR-0430.
// This report must never open execution lanes, promote candidates, mutate
// virtual accounts, lower gate thresholds, or treat PENDING/DATA_UNAVAILABLE
// as losses. It only answers: "what happened after we correctly blocked
// execution but kept learning alive?"
//
// 핵심 불변식 (사용자 명시 §"절대 하지 말 것" 정합):
//   1. LIVE 매매 영향 0 — KIS 주문 함수 5종 import 0건 (정적 grep 가드)
//   2. counterfactual ledger 만 read — provisional/normal shadow ledger 무수정
//   3. eventType !== 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY' / source !== 'ADR-0430' /
//      learningOnly !== true 인 entry 무시 (혼합 차단)
//   4. 자동 paper/live 승격 0 — 본 PR 은 *report only*
//   5. PENDING / DATA_UNAVAILABLE 은 손실 카운트 아님 — failed 와 분리
//   6. priceProvider 의존성 주입 — 호출자 측 caching/quota 결정 (외부 폭주 차단)
//   7. virtual account holdings/cash 무영향 — 본 모듈 read-only

import type { CounterfactualShadowLearningLedgerEntry } from '../persistence/counterfactualShadowLearningRepo.js';

/** 6-value horizon union (사용자 §B 정합, 절대 변경 금지). */
export type CounterfactualShadowHorizon =
  | 'T_PLUS_30M'
  | 'T_PLUS_1H'
  | 'SAME_DAY_CLOSE'
  | 'NEXT_OPEN'
  | 'T_PLUS_1D_CLOSE'
  | 'T_PLUS_3D_CLOSE';

/** 6-value status union (사용자 §B 정합 + INSUFFICIENT_DATA 추가). */
export type CounterfactualShadowPointStatus =
  | 'PENDING'
  | 'OBSERVED'
  | 'DATA_UNAVAILABLE'
  | 'MARKET_CLOSED'
  | 'INSUFFICIENT_DATA'
  | 'ERROR';

/** 7-value source union (사용자 §B 정합). */
export type CounterfactualShadowPointSource =
  | 'ENTRY_SNAPSHOT'
  | 'SCAN_SNAPSHOT'
  | 'INTRADAY_CANDLE_CACHE'
  | 'DAILY_CANDLE_CACHE'
  | 'MARKET_DATA_CACHE'
  | 'READ_ONLY_QUOTE'
  | 'NONE';

export interface CounterfactualShadowPerformancePoint {
  horizon: CounterfactualShadowHorizon;
  observedAtKst?: string;
  price?: number;
  returnPct?: number;
  available: boolean;
  status: CounterfactualShadowPointStatus;
  source?: CounterfactualShadowPointSource;
  reason?: string;
}

export type CounterfactualShadowSummaryStatus =
  | 'PENDING'
  | 'PARTIAL'
  | 'COMPLETE'
  | 'INSUFFICIENT_DATA';

export interface CounterfactualShadowPerformanceRecord {
  id: string;
  symbol: string;
  name?: string;
  entryPrice?: number;
  entryAtKst: string;
  scanId?: string;
  label: string;
  /** ADR-0430 분리 마커 — provisional / normal shadow 와 absolute 차단. */
  source: 'ADR-0430';
  /** literal — 학습 전용 marker. */
  learningOnly: true;
  /** literal — execution shadow 분리. */
  executionShadow: false;
  /** literal — virtual account 무영향. */
  virtualAccountImpact: 'NONE';
  reasons: string[];
  blockedBy: string[];
  regime?: string;
  sectorEnergySnapshot?: {
    dataQuality?: string;
    indexCodeCoverage?: number;
    repairStatus?: string;
    leadershipConfidence?: string;
  };
  routerSnapshot?: {
    severity?: string;
    label?: string;
    learningShadowAllowed?: boolean;
    liveAllowed?: boolean;
    shadowAllowed?: boolean;
  };
  points: CounterfactualShadowPerformancePoint[];
  summary: {
    bestReturnPct?: number;
    worstReturnPct?: number;
    latestReturnPct?: number;
    winAtAnyHorizon?: boolean;
    maxFavorableExcursionPct?: number;
    maxAdverseExcursionPct?: number;
    status: CounterfactualShadowSummaryStatus;
  };
}

export interface CounterfactualShadowPerformanceSummary {
  totalEntries: number;
  observedEntries: number;
  pendingEntries: number;
  insufficientDataEntries: number;
  labelBreakdown: Record<string, number>;
  blockedByBreakdown: Record<string, number>;
  avgReturnByHorizon: Partial<Record<CounterfactualShadowHorizon, number>>;
  winRateByHorizon: Partial<Record<CounterfactualShadowHorizon, number>>;
  topWinners: CounterfactualShadowPerformanceRecord[];
  topLosers: CounterfactualShadowPerformanceRecord[];
  generatedAtKst: string;
}

/**
 * Horizon 별 entry 후 경과 시간 (밀리초) — ADR-0428 / ADR-0429 와 일치.
 *
 * Object.freeze SSOT — drift 차단.
 */
export const COUNTERFACTUAL_HORIZON_OFFSET_MS: Record<CounterfactualShadowHorizon, number> =
  Object.freeze({
    T_PLUS_30M: 30 * 60 * 1_000,
    T_PLUS_1H: 60 * 60 * 1_000,
    SAME_DAY_CLOSE: 8 * 60 * 60 * 1_000,
    NEXT_OPEN: 24 * 60 * 60 * 1_000,
    T_PLUS_1D_CLOSE: 32 * 60 * 60 * 1_000,
    T_PLUS_3D_CLOSE: 80 * 60 * 60 * 1_000,
  });

const ALL_HORIZONS: CounterfactualShadowHorizon[] = [
  'T_PLUS_30M',
  'T_PLUS_1H',
  'SAME_DAY_CLOSE',
  'NEXT_OPEN',
  'T_PLUS_1D_CLOSE',
  'T_PLUS_3D_CLOSE',
];

/**
 * priceProvider 의존성 주입 시그니처 (사용자 §C 정합).
 *
 * ADR-0428/0429 의 ProvisionalShadowPriceProvider 와 동등한 함수 시그니처 —
 * 호출자가 thin adapter 로 wrap 하여 reuse 가능 (사용자 §C 권장 — 큰 refactor 회피).
 *
 * 외부 API 폭주 차단 — 호출자 측 caching/quota/batching 책임. 본 모듈은 *시그니처*
 * 만 SSOT, 실제 priceProvider 는 운영 환경에서 별도 wiring.
 *
 * 반환 SSOT:
 *   - { available: true, price, observedAtKst, source? }
 *   - { available: false, reason, status?, source? }
 *
 * status 미설정 시 호출자가 DATA_UNAVAILABLE 로 처리 (사용자 §I).
 * source 미설정 시 NONE 으로 처리 (정합).
 */
export type CounterfactualShadowPriceProvider = (
  symbol: string,
  horizon: CounterfactualShadowHorizon,
  entryAtKst: string,
) => Promise<
  | { available: true; price: number; observedAtKst: string; source?: CounterfactualShadowPointSource }
  | {
      available: false;
      reason: string;
      status?: CounterfactualShadowPointStatus;
      source?: CounterfactualShadowPointSource;
    }
>;

export interface BuildCounterfactualShadowPerformanceReportInput {
  entries: CounterfactualShadowLearningLedgerEntry[];
  nowKst?: string;
  priceProvider?: CounterfactualShadowPriceProvider;
  /** 분석 대상 entry 수 한계 (외부 호출 폭주 차단). default 50. */
  maxEntries?: number;
  /** Top winners/losers 표시 수. default 3. */
  topN?: number;
  /** ENV 우회 — `COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED=true` 시 빈 summary. */
  disableEnvCheck?: boolean;
}

function isReportDisabled(): boolean {
  return process.env.COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED === 'true';
}

export function isCounterfactualShadowPerfReportDisabled(): boolean {
  return isReportDisabled();
}

/**
 * entry validation — 사용자 §J 정합.
 *
 * 일반 shadow buy / ADR-0427 provisional shadow 와 절대 분리.
 * 3중 검증 — eventType + source + learningOnly literal 모두 일치 필요.
 */
export function isValidCounterfactualEntry(
  entry: CounterfactualShadowLearningLedgerEntry,
): boolean {
  return (
    entry.eventType === 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY' &&
    entry.source === 'ADR-0430' &&
    entry.learningOnly === true
  );
}

/**
 * Horizon 도달 시점 검증 — entry 후 경과 시간 ≥ horizon offset 일 때만 OBSERVED 시도.
 */
export function isHorizonReached(
  entryAtKst: string,
  horizon: CounterfactualShadowHorizon,
  nowMs: number,
): boolean {
  const entryMs = Date.parse(entryAtKst);
  if (!Number.isFinite(entryMs)) return false;
  return nowMs - entryMs >= COUNTERFACTUAL_HORIZON_OFFSET_MS[horizon];
}

function safeReturnPct(
  entryPrice: number | undefined,
  observedPrice: number,
): number | undefined {
  if (entryPrice === undefined || !Number.isFinite(entryPrice) || entryPrice <= 0) return undefined;
  if (!Number.isFinite(observedPrice) || observedPrice <= 0) return undefined;
  return ((observedPrice - entryPrice) / entryPrice) * 100;
}

/**
 * entryPrice 확보 우선순위 (사용자 §D 정합, 절대 변경 금지).
 *
 * 1. entry.entryPrice (직접 영속된 가격)
 * 2. entry.entryPriceHint (ADR-0430 candidate hint)
 * 3. entry.metadata?.entryPriceHint (확장 schema)
 * 4. entry.conditionSnapshot?.price / .lastPrice (Gate 평가 시점 snapshot)
 * 5. entry.metadata?.quoteSnapshot?.lastPrice (확장 schema)
 *
 * 모두 부재 → undefined (호출자가 INSUFFICIENT_DATA 처리, 사용자 §I).
 *
 * positive finite 검증 의무 (NaN / 0 / 음수 모두 거부).
 */
export function resolveCounterfactualEntryPrice(
  entry: CounterfactualShadowLearningLedgerEntry,
): number | undefined {
  const direct = (entry as CounterfactualShadowLearningLedgerEntry & { entryPrice?: number })
    .entryPrice;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;

  if (
    typeof entry.entryPriceHint === 'number' &&
    Number.isFinite(entry.entryPriceHint) &&
    entry.entryPriceHint > 0
  ) {
    return entry.entryPriceHint;
  }

  // metadata 확장 — ADR-0430 schema 에 metadata 미정의이지만 향후 확장 호환.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (entry as any).metadata as Record<string, unknown> | undefined;
  if (meta) {
    const metaHint = meta.entryPriceHint;
    if (typeof metaHint === 'number' && Number.isFinite(metaHint) && metaHint > 0) {
      return metaHint;
    }
    const quote = meta.quoteSnapshot as Record<string, unknown> | undefined;
    if (quote) {
      const lastPrice = quote.lastPrice;
      if (typeof lastPrice === 'number' && Number.isFinite(lastPrice) && lastPrice > 0) {
        return lastPrice;
      }
    }
  }

  // conditionSnapshot price / lastPrice (옵셔널).
  const snap = entry.conditionSnapshot;
  if (snap) {
    const price = snap.price;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) return price;
    const lastPrice = snap.lastPrice;
    if (typeof lastPrice === 'number' && Number.isFinite(lastPrice) && lastPrice > 0) {
      return lastPrice;
    }
  }

  return undefined;
}

/**
 * Build report SSOT (사용자 §E 정합).
 *
 * read-time 계산 — 별도 영속 layer 없음 (ADR-0428 패턴 정합, drift 차단).
 *
 * 결정 트리 (사용자 §F 절대 변경 금지):
 *   1. ENV DISABLED → 빈 summary
 *   2. entries 필터링 (isValidCounterfactualEntry) + maxEntries 제한
 *   3. 각 entry × ALL_HORIZONS 순회
 *   4. horizon 미도달 → PENDING
 *   5. priceProvider 미전달 → PENDING
 *   6. priceProvider 정상 + entryPrice 부재 → INSUFFICIENT_DATA
 *   7. priceProvider 정상 + entryPrice 가용 → OBSERVED + returnPct
 *   8. priceProvider 실패 → DATA_UNAVAILABLE / MARKET_CLOSED / ERROR
 *   9. summary status 합성 — observedCount=0 + 모두 PENDING → PENDING /
 *      observedCount=0 + INSUFFICIENT_DATA 우세 → INSUFFICIENT_DATA / 일부 → PARTIAL / 전체 → COMPLETE
 */
export async function buildCounterfactualShadowPerformanceReport(
  input: BuildCounterfactualShadowPerformanceReportInput,
): Promise<CounterfactualShadowPerformanceSummary> {
  const generatedAtKst = input.nowKst ?? new Date().toISOString();
  const nowMs = Date.parse(generatedAtKst);
  const maxEntries = input.maxEntries ?? 50;
  const topN = input.topN ?? 3;

  if (!input.disableEnvCheck && isReportDisabled()) {
    return {
      totalEntries: 0,
      observedEntries: 0,
      pendingEntries: 0,
      insufficientDataEntries: 0,
      labelBreakdown: {},
      blockedByBreakdown: {},
      avgReturnByHorizon: {},
      winRateByHorizon: {},
      topWinners: [],
      topLosers: [],
      generatedAtKst,
    };
  }

  // 사용자 §J — entry 필터링 + 최신순 정렬 + maxEntries 제한 (외부 호출 폭주 차단).
  const validEntries = input.entries
    .filter(isValidCounterfactualEntry)
    .slice()
    .sort((a, b) => Date.parse(b.createdAtKst) - Date.parse(a.createdAtKst))
    .slice(0, maxEntries);

  const records: CounterfactualShadowPerformanceRecord[] = [];
  const labelBreakdown: Record<string, number> = {};
  const blockedByBreakdown: Record<string, number> = {};

  for (const entry of validEntries) {
    labelBreakdown[entry.label] = (labelBreakdown[entry.label] ?? 0) + 1;
    for (const b of entry.blockedBy ?? []) {
      blockedByBreakdown[b] = (blockedByBreakdown[b] ?? 0) + 1;
    }

    const points: CounterfactualShadowPerformancePoint[] = [];
    let bestReturn: number | undefined;
    let worstReturn: number | undefined;
    let latestReturn: number | undefined;
    let observedCount = 0;
    let insufficientCount = 0;

    const entryPrice = resolveCounterfactualEntryPrice(entry);

    for (const horizon of ALL_HORIZONS) {
      // 4. horizon 미도달 — PENDING
      if (!isHorizonReached(entry.createdAtKst, horizon, nowMs)) {
        points.push({
          horizon,
          available: false,
          status: 'PENDING',
          source: 'NONE',
          reason: 'horizon not yet reached',
        });
        continue;
      }

      // 5. priceProvider 미전달 — PENDING (외부 호출 0)
      if (!input.priceProvider) {
        points.push({
          horizon,
          available: false,
          status: 'PENDING',
          source: 'NONE',
          reason: 'priceProvider not configured',
        });
        continue;
      }

      try {
        const result = await input.priceProvider(entry.symbol, horizon, entry.createdAtKst);
        if (result.available) {
          // 6. entryPrice 부재 — INSUFFICIENT_DATA (사용자 §I)
          const returnPct = safeReturnPct(entryPrice, result.price);
          if (returnPct === undefined) {
            points.push({
              horizon,
              observedAtKst: result.observedAtKst,
              price: result.price,
              available: false,
              status: 'INSUFFICIENT_DATA',
              source: result.source ?? 'NONE',
              reason: 'entryPrice missing or invalid — see resolveCounterfactualEntryPrice',
            });
            insufficientCount += 1;
            continue;
          }
          // 7. OBSERVED + returnPct
          points.push({
            horizon,
            observedAtKst: result.observedAtKst,
            price: result.price,
            returnPct,
            available: true,
            status: 'OBSERVED',
            source: result.source ?? 'ENTRY_SNAPSHOT',
          });
          observedCount += 1;
          if (bestReturn === undefined || returnPct > bestReturn) bestReturn = returnPct;
          if (worstReturn === undefined || returnPct < worstReturn) worstReturn = returnPct;
          latestReturn = returnPct;
        } else {
          // 8. priceProvider 실패 (DATA_UNAVAILABLE / MARKET_CLOSED 등)
          points.push({
            horizon,
            available: false,
            status: result.status ?? 'DATA_UNAVAILABLE',
            source: result.source ?? 'NONE',
            reason: result.reason,
          });
        }
      } catch (e) {
        points.push({
          horizon,
          available: false,
          status: 'ERROR',
          source: 'NONE',
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 9. summary status 합성
    let summaryStatus: CounterfactualShadowSummaryStatus;
    if (observedCount === 0) {
      if (points.every((p) => p.status === 'PENDING')) {
        summaryStatus = 'PENDING';
      } else {
        summaryStatus = 'INSUFFICIENT_DATA';
      }
    } else if (observedCount === ALL_HORIZONS.length) {
      summaryStatus = 'COMPLETE';
    } else {
      summaryStatus = 'PARTIAL';
    }

    const record: CounterfactualShadowPerformanceRecord = {
      id: `${entry.scanId ?? 'noscan'}:${entry.symbol}:${entry.createdAtKst}`,
      symbol: entry.symbol,
      ...(entry.name !== undefined ? { name: entry.name } : {}),
      ...(entryPrice !== undefined ? { entryPrice } : {}),
      entryAtKst: entry.createdAtKst,
      ...(entry.scanId !== undefined ? { scanId: entry.scanId } : {}),
      label: entry.label,
      source: 'ADR-0430',
      learningOnly: true,
      executionShadow: false,
      virtualAccountImpact: 'NONE',
      reasons: (entry.reasons ?? []).map(String),
      blockedBy: (entry.blockedBy ?? []).map(String),
      ...(entry.regime !== undefined ? { regime: entry.regime } : {}),
      ...(entry.sectorEnergySnapshot
        ? { sectorEnergySnapshot: entry.sectorEnergySnapshot }
        : {}),
      ...(entry.routerSeverity !== undefined || entry.routerLabel !== undefined
        ? {
            routerSnapshot: {
              ...(entry.routerSeverity !== undefined ? { severity: entry.routerSeverity } : {}),
              ...(entry.routerLabel !== undefined ? { label: entry.routerLabel } : {}),
              learningShadowAllowed: true,
              shadowAllowed: false,
              liveAllowed: false,
            },
          }
        : {}),
      points,
      summary: {
        ...(bestReturn !== undefined ? { bestReturnPct: bestReturn } : {}),
        ...(worstReturn !== undefined ? { worstReturnPct: worstReturn } : {}),
        ...(latestReturn !== undefined ? { latestReturnPct: latestReturn } : {}),
        ...(observedCount > 0 && bestReturn !== undefined
          ? {
              winAtAnyHorizon: bestReturn > 0,
              maxFavorableExcursionPct: bestReturn,
              maxAdverseExcursionPct: worstReturn ?? 0,
            }
          : {}),
        status: summaryStatus,
      },
    };
    // insufficientCount 표면화는 records 외부 카운트로 합성 (record.summary.status===INSUFFICIENT_DATA)
    void insufficientCount;
    records.push(record);
  }

  // Horizon 별 avg return + win rate (observed only, PENDING/DATA_UNAVAILABLE 제외)
  const avgReturnByHorizon: Partial<Record<CounterfactualShadowHorizon, number>> = {};
  const winRateByHorizon: Partial<Record<CounterfactualShadowHorizon, number>> = {};
  for (const horizon of ALL_HORIZONS) {
    const observed = records.flatMap((r) =>
      r.points.filter(
        (p) => p.horizon === horizon && p.status === 'OBSERVED' && p.returnPct !== undefined,
      ),
    );
    if (observed.length > 0) {
      const sum = observed.reduce((acc, p) => acc + (p.returnPct ?? 0), 0);
      avgReturnByHorizon[horizon] = sum / observed.length;
      const wins = observed.filter((p) => (p.returnPct ?? 0) > 0).length;
      winRateByHorizon[horizon] = wins / observed.length;
    }
  }

  // Top winners / losers — bestReturnPct / worstReturnPct 기준 (observed only)
  const recordsWithObserved = records.filter((r) => r.summary.bestReturnPct !== undefined);
  const topWinners = recordsWithObserved
    .slice()
    .sort((a, b) => (b.summary.bestReturnPct ?? 0) - (a.summary.bestReturnPct ?? 0))
    .slice(0, topN);
  const topLosers = recordsWithObserved
    .slice()
    .sort((a, b) => (a.summary.worstReturnPct ?? 0) - (b.summary.worstReturnPct ?? 0))
    .slice(0, topN);

  // 상태별 카운트
  const observedEntries = records.filter(
    (r) => r.summary.status === 'COMPLETE' || r.summary.status === 'PARTIAL',
  ).length;
  const pendingEntries = records.filter((r) => r.summary.status === 'PENDING').length;
  const insufficientDataEntries = records.filter(
    (r) => r.summary.status === 'INSUFFICIENT_DATA',
  ).length;

  return {
    totalEntries: records.length,
    observedEntries,
    pendingEntries,
    insufficientDataEntries,
    labelBreakdown,
    blockedByBreakdown,
    avgReturnByHorizon,
    winRateByHorizon,
    topWinners,
    topLosers,
    generatedAtKst,
  };
}

/**
 * 텔레그램 메시지 빌더 SSOT (사용자 §G 정합).
 *
 * created=0 / 모든 horizon pending / data 부족 case 모두 명시 처리 (사용자 §I).
 */
export function formatCounterfactualShadowPerformanceMessage(
  summary: CounterfactualShadowPerformanceSummary,
): string {
  const lines: string[] = [];
  lines.push('🧠 <b>Counterfactual Shadow Report (ADR-0431)</b>');
  lines.push('  • <i>SELL_ONLY/HARD_BLOCK 시점 학습 표본 read-only 성과 — 실매수/가상계좌 영향 0</i>');

  if (summary.totalEntries === 0) {
    // 사용자 §I — created=0 처리
    lines.push('  • <i>아직 counterfactual shadow learning entry 가 없습니다.</i>');
    lines.push(
      '  • <i>SELL_ONLY/HARD_BLOCK 발생 시 ADR-0430 가 자동으로 학습 표본을 기록합니다.</i>',
    );
    lines.push(`  • generatedAtKst: ${summary.generatedAtKst}`);
    return lines.join('\n');
  }

  lines.push(`  • totalEntries: <b>${summary.totalEntries}</b>`);
  lines.push(`  • observed: <b>${summary.observedEntries}</b>`);
  lines.push(`  • pending: <b>${summary.pendingEntries}</b>`);
  lines.push(`  • insufficient: <b>${summary.insufficientDataEntries}</b>`);
  lines.push('  • lanes: live=❌ paper=❌ shadow=❌ <b>learning=✅</b>');

  // Label breakdown
  const labelEntries = Object.entries(summary.labelBreakdown).sort((a, b) => b[1] - a[1]);
  if (labelEntries.length > 0) {
    lines.push('');
    lines.push('  <b>📋 Label Breakdown</b>');
    for (const [label, count] of labelEntries) {
      lines.push(`    • ${label}: ${count}건`);
    }
  }

  // BlockedBy breakdown — counterfactual 의 핵심 진단 (왜 차단됐는가)
  const blockedEntries = Object.entries(summary.blockedByBreakdown).sort(
    (a, b) => b[1] - a[1],
  );
  if (blockedEntries.length > 0) {
    lines.push('');
    lines.push('  <b>🚫 BlockedBy Breakdown</b>');
    for (const [b, count] of blockedEntries.slice(0, 8)) {
      lines.push(`    • ${b}: ${count}건`);
    }
  }

  // Horizon 성과
  const HORIZON_LABELS: Record<CounterfactualShadowHorizon, string> = {
    T_PLUS_30M: '+30m',
    T_PLUS_1H: '+1h',
    SAME_DAY_CLOSE: 'close',
    NEXT_OPEN: 'nextOpen',
    T_PLUS_1D_CLOSE: '+1d',
    T_PLUS_3D_CLOSE: '+3d',
  };
  const horizonsWithData = ALL_HORIZONS.filter(
    (h) => summary.avgReturnByHorizon[h] !== undefined,
  );
  if (horizonsWithData.length > 0) {
    lines.push('');
    lines.push('  <b>📊 Horizon 성과</b>');
    for (const horizon of ALL_HORIZONS) {
      const avg = summary.avgReturnByHorizon[horizon];
      const win = summary.winRateByHorizon[horizon];
      if (avg !== undefined && win !== undefined) {
        const sign = avg >= 0 ? '+' : '';
        lines.push(
          `    • ${HORIZON_LABELS[horizon]}: avg <b>${sign}${avg.toFixed(2)}%</b> / winRate <b>${(win * 100).toFixed(0)}%</b>`,
        );
      } else {
        lines.push(`    • ${HORIZON_LABELS[horizon]}: <i>pending</i>`);
      }
    }
  } else {
    lines.push('');
    lines.push('  <b>📊 Horizon 성과</b>');
    lines.push('    • <i>insufficient data — 모든 horizon pending</i>');
  }

  // Top winners
  if (summary.topWinners.length > 0) {
    lines.push('');
    lines.push('  <b>🏆 Top winners (had we bought)</b>');
    summary.topWinners.forEach((r, i) => {
      const pct = r.summary.bestReturnPct ?? 0;
      const sign = pct >= 0 ? '+' : '';
      lines.push(
        `    ${i + 1}. ${r.symbol}${r.name ? ` ${r.name}` : ''} <b>${sign}${pct.toFixed(2)}%</b>`,
      );
    });
  }

  // Top losers — counterfactual 의 핵심 가치 (차단 정합 검증)
  if (summary.topLosers.length > 0) {
    lines.push('');
    lines.push('  <b>📉 Top losers (block was correct)</b>');
    summary.topLosers.forEach((r, i) => {
      const pct = r.summary.worstReturnPct ?? 0;
      const sign = pct >= 0 ? '+' : '';
      lines.push(
        `    ${i + 1}. ${r.symbol}${r.name ? ` ${r.name}` : ''} <b>${sign}${pct.toFixed(2)}%</b>`,
      );
    });
  }

  lines.push('');
  lines.push(
    '  <i>read-only 학습 리포트 — 자동 paper/live 승격 0, ' +
      'counterfactual ledger 만 read (provisional / 일반 shadow 분리, ADR-0430 정합).</i>',
  );
  lines.push(`  • generatedAtKst: ${summary.generatedAtKst}`);

  return lines.join('\n');
}

/**
 * /scan_blockers 짧은 요약 (사용자 §H 정합).
 *
 * 전체 리포트는 /shadow_counterfactual 명령에서, 본 함수는 한눈에 보이는 카운트만.
 */
export function formatCounterfactualShadowSummaryLine(
  summary: CounterfactualShadowPerformanceSummary,
): string | null {
  if (summary.totalEntries === 0) return null;
  return (
    `🧠 Counterfactual Shadow — ledger: <b>${summary.totalEntries}</b> / ` +
    `observed: <b>${summary.observedEntries}</b> / pending: <b>${summary.pendingEntries}</b> / ` +
    `insufficient: <b>${summary.insufficientDataEntries}</b> ` +
    `<i>(report: /shadow_counterfactual)</i>`
  );
}
