// @responsibility provisionalShadowPerformanceReport — ADR-0428 read-only 성과 리포트 SSOT.
//
// ADR-0428:
// Provisional Shadow Performance Report — ADR-0426/0427 provisional-shadow-ledger.json
// 의 entries 의 성과를 multi-horizon (T+30m / T+1h / 종가 / 다음 시가 / T+1d / T+3d) 으로
// 추적. 학습/검증용 read-only 리포트.
//
// 핵심 불변식 (사용자 명시 절대 변경 금지):
//   1. LIVE 매매 영향 0 — KIS 주문 함수 import 0건
//   2. provisional !== true 인 entry 무시 (일반 shadow buy 와 분리)
//   3. source: 'ADR-0426' 또는 'ADR-0427' 만 대상
//   4. 자동 paper/live 승격 0 — 본 PR 은 *report only*
//   5. 외부 API 폭주 차단 — priceProvider 의존성 주입 (호출자 측 quota 제어)
//   6. 데이터 부재 시 PENDING / DATA_UNAVAILABLE / MARKET_CLOSED 명시 (failed 아님)
//   7. 일반 shadow-trades.json 무수정 — provisional ledger 만 read

import type { ProvisionalShadowLedgerEntry } from '../persistence/provisionalShadowLedger.js';

/** 6-value horizon union (사용자 §B 정합, 절대 변경 금지). */
export type ProvisionalShadowHorizon =
  | 'T_PLUS_30M'
  | 'T_PLUS_1H'
  | 'SAME_DAY_CLOSE'
  | 'NEXT_OPEN'
  | 'T_PLUS_1D_CLOSE'
  | 'T_PLUS_3D_CLOSE';

/** 5-value status union (사용자 §B 정합, 절대 변경 금지). */
export type ProvisionalShadowPointStatus =
  | 'PENDING'
  | 'OBSERVED'
  | 'DATA_UNAVAILABLE'
  | 'MARKET_CLOSED'
  | 'ERROR';

export interface ProvisionalShadowPerformancePoint {
  horizon: ProvisionalShadowHorizon;
  observedAtKst?: string;
  price?: number;
  returnPct?: number;
  available: boolean;
  status: ProvisionalShadowPointStatus;
  reason?: string;
}

export type ProvisionalShadowSummaryStatus = 'PENDING' | 'PARTIAL' | 'COMPLETE' | 'INSUFFICIENT_DATA';

export interface ProvisionalShadowPerformanceRecord {
  id: string;
  symbol: string;
  name?: string;
  entryPrice?: number;
  entryAtKst: string;
  scanId?: string;
  label: string;
  source: 'ADR-0426' | 'ADR-0427';
  reasons: string[];
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
    shadowAllowed?: boolean;
    liveAllowed?: boolean;
  };
  points: ProvisionalShadowPerformancePoint[];
  summary: {
    bestReturnPct?: number;
    worstReturnPct?: number;
    latestReturnPct?: number;
    winAtAnyHorizon?: boolean;
    maxFavorableExcursionPct?: number;
    maxAdverseExcursionPct?: number;
    status: ProvisionalShadowSummaryStatus;
  };
}

export interface ProvisionalShadowPerformanceSummary {
  totalEntries: number;
  observedEntries: number;
  pendingEntries: number;
  labelBreakdown: Record<string, number>;
  avgReturnByHorizon: Partial<Record<ProvisionalShadowHorizon, number>>;
  winRateByHorizon: Partial<Record<ProvisionalShadowHorizon, number>>;
  topWinners: ProvisionalShadowPerformanceRecord[];
  topLosers: ProvisionalShadowPerformanceRecord[];
  generatedAtKst: string;
}

/** Horizon 별 entry 후 경과 시간 (밀리초) — 도달 검증 용도. */
export const HORIZON_OFFSET_MS: Record<ProvisionalShadowHorizon, number> = Object.freeze({
  T_PLUS_30M: 30 * 60 * 1_000,
  T_PLUS_1H: 60 * 60 * 1_000,
  // SAME_DAY_CLOSE / NEXT_OPEN — calendar dependent, 본 PR 은 entry+8h heuristic
  // (KST 09:00 entry 가정 시 17:00 도달 목표). 정확 boundary 는 후속 PR scope.
  SAME_DAY_CLOSE: 8 * 60 * 60 * 1_000,
  NEXT_OPEN: 24 * 60 * 60 * 1_000,
  T_PLUS_1D_CLOSE: 32 * 60 * 60 * 1_000,
  T_PLUS_3D_CLOSE: 80 * 60 * 60 * 1_000,
});

/**
 * priceProvider 의존성 주입 (사용자 §D 정합).
 *
 * 외부 API 폭주 차단 — 호출자 측이 caching / quota / batching 을 결정.
 * 본 PR 은 *함수 시그니처 SSOT* 만 정의 — 실제 구현 wiring 은 후속 PR.
 *
 * 반환:
 *   - { available: true, price, observedAtKst } 정상
 *   - { available: false, reason } DATA_UNAVAILABLE / MARKET_CLOSED / ERROR
 */
export type ProvisionalShadowPriceProvider = (
  symbol: string,
  horizon: ProvisionalShadowHorizon,
  entryAtKst: string,
) => Promise<{ available: true; price: number; observedAtKst: string }
  | { available: false; reason: string; status?: ProvisionalShadowPointStatus }>;

export interface BuildProvisionalShadowPerformanceReportInput {
  entries: ProvisionalShadowLedgerEntry[];
  nowKst?: string;
  priceProvider?: ProvisionalShadowPriceProvider;
  /** 분석 대상 entry 수 한계 (외부 호출 폭주 차단). default 50. */
  maxEntries?: number;
  /** Top winners/losers 표시 수. default 3. */
  topN?: number;
  /** ENV 우회 — `PROVISIONAL_SHADOW_PERF_REPORT_DISABLED=true` 시 빈 summary. */
  disableEnvCheck?: boolean;
}

const ALL_HORIZONS: ProvisionalShadowHorizon[] = [
  'T_PLUS_30M',
  'T_PLUS_1H',
  'SAME_DAY_CLOSE',
  'NEXT_OPEN',
  'T_PLUS_1D_CLOSE',
  'T_PLUS_3D_CLOSE',
];

function isReportDisabled(): boolean {
  return process.env.PROVISIONAL_SHADOW_PERF_REPORT_DISABLED === 'true';
}

export function isProvisionalShadowPerfReportDisabled(): boolean {
  return isReportDisabled();
}

/**
 * entry validation — 사용자 §J 정합. 일반 shadow buy 와 섞이지 않도록 source/eventType 검증.
 */
function isValidProvisionalEntry(entry: ProvisionalShadowLedgerEntry): boolean {
  return (
    entry.eventType === 'PROVISIONAL_SHADOW_ENTRY' &&
    entry.provisional === true &&
    entry.source === 'ADR-0426'
  );
}

/**
 * Horizon 도달 시점 검증 — entry 후 경과 시간 ≥ horizon offset 일 때만 OBSERVED 시도.
 */
function isHorizonReached(
  entryAtKst: string,
  horizon: ProvisionalShadowHorizon,
  nowMs: number,
): boolean {
  const entryMs = Date.parse(entryAtKst);
  if (!Number.isFinite(entryMs)) return false;
  return nowMs - entryMs >= HORIZON_OFFSET_MS[horizon];
}

function safeReturnPct(entryPrice: number | undefined, observedPrice: number): number | undefined {
  if (entryPrice === undefined || !Number.isFinite(entryPrice) || entryPrice <= 0) return undefined;
  if (!Number.isFinite(observedPrice) || observedPrice <= 0) return undefined;
  return ((observedPrice - entryPrice) / entryPrice) * 100;
}

/**
 * Build report SSOT (사용자 §E 정합).
 *
 * read-time 계산 — 별도 영속 layer 없음 (사용자 §F 선택 1 추천).
 * priceProvider 미전달 시 모든 horizon 이 PENDING — 외부 호출 0 (default).
 */
export async function buildProvisionalShadowPerformanceReport(
  input: BuildProvisionalShadowPerformanceReportInput,
): Promise<ProvisionalShadowPerformanceSummary> {
  const generatedAtKst = input.nowKst ?? new Date().toISOString();
  const nowMs = Date.parse(generatedAtKst);
  const maxEntries = input.maxEntries ?? 50;
  const topN = input.topN ?? 3;

  if (!input.disableEnvCheck && isReportDisabled()) {
    return {
      totalEntries: 0,
      observedEntries: 0,
      pendingEntries: 0,
      labelBreakdown: {},
      avgReturnByHorizon: {},
      winRateByHorizon: {},
      topWinners: [],
      topLosers: [],
      generatedAtKst,
    };
  }

  // entry 필터링 + 최신 순 정렬 + maxEntries 제한 (외부 호출 폭주 차단)
  const validEntries = input.entries
    .filter(isValidProvisionalEntry)
    .slice()
    .sort((a, b) => Date.parse(b.createdAtKst) - Date.parse(a.createdAtKst))
    .slice(0, maxEntries);

  const records: ProvisionalShadowPerformanceRecord[] = [];
  const labelBreakdown: Record<string, number> = {};

  for (const entry of validEntries) {
    labelBreakdown[entry.label] = (labelBreakdown[entry.label] ?? 0) + 1;

    const points: ProvisionalShadowPerformancePoint[] = [];
    let bestReturn: number | undefined;
    let worstReturn: number | undefined;
    let latestReturn: number | undefined;
    let observedCount = 0;

    for (const horizon of ALL_HORIZONS) {
      // horizon 도달 검증
      if (!isHorizonReached(entry.createdAtKst, horizon, nowMs)) {
        points.push({
          horizon,
          available: false,
          status: 'PENDING',
          reason: 'horizon not yet reached',
        });
        continue;
      }

      // priceProvider 미전달 시 PENDING (사용자 §D — 외부 호출 0)
      if (!input.priceProvider) {
        points.push({
          horizon,
          available: false,
          status: 'PENDING',
          reason: 'priceProvider not configured',
        });
        continue;
      }

      try {
        const result = await input.priceProvider(entry.symbol, horizon, entry.createdAtKst);
        if (result.available) {
          // ADR-0620 — entryPrice 정식 타입 read (캐스팅 제거). 부재 시 DATA_UNAVAILABLE.
          const returnPct = safeReturnPct(entry.entryPrice, result.price);
          if (returnPct === undefined) {
            points.push({
              horizon,
              observedAtKst: result.observedAtKst,
              price: result.price,
              available: false,
              status: 'DATA_UNAVAILABLE',
              reason: 'entryPrice missing or invalid',
            });
            continue;
          }
          points.push({
            horizon,
            observedAtKst: result.observedAtKst,
            price: result.price,
            returnPct,
            available: true,
            status: 'OBSERVED',
          });
          observedCount += 1;
          if (bestReturn === undefined || returnPct > bestReturn) bestReturn = returnPct;
          if (worstReturn === undefined || returnPct < worstReturn) worstReturn = returnPct;
          latestReturn = returnPct;
        } else {
          points.push({
            horizon,
            available: false,
            status: result.status ?? 'DATA_UNAVAILABLE',
            reason: result.reason,
          });
        }
      } catch (e) {
        /* SDS-ignore: price-provider errors are converted to returned read-only point diagnostics; executionImpact=NONE. */
        points.push({
          horizon,
          available: false,
          status: 'ERROR',
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // summary status 합성
    let summaryStatus: ProvisionalShadowSummaryStatus;
    if (observedCount === 0) {
      summaryStatus = points.every((p) => p.status === 'PENDING') ? 'PENDING' : 'INSUFFICIENT_DATA';
    } else if (observedCount === ALL_HORIZONS.length) {
      summaryStatus = 'COMPLETE';
    } else {
      summaryStatus = 'PARTIAL';
    }

    records.push({
      id: `${entry.scanId ?? 'noscan'}:${entry.symbol}:${entry.createdAtKst}`,
      symbol: entry.symbol,
      ...(entry.name !== undefined ? { name: entry.name } : {}),
      ...((entry as { entryPrice?: number }).entryPrice !== undefined
        ? { entryPrice: (entry as { entryPrice?: number }).entryPrice }
        : {}),
      entryAtKst: entry.createdAtKst,
      ...(entry.scanId !== undefined ? { scanId: entry.scanId } : {}),
      label: entry.label,
      source: entry.source,
      reasons: entry.reasons.map(String),
      regime: entry.regime,
      ...(entry.metadata
        ? {
            sectorEnergySnapshot: {
              ...(entry.metadata.sectorEnergyDataQuality !== undefined
                ? { dataQuality: entry.metadata.sectorEnergyDataQuality }
                : {}),
              ...(entry.metadata.sectorEnergyIndexCodeCoverage !== undefined
                ? { indexCodeCoverage: entry.metadata.sectorEnergyIndexCodeCoverage }
                : {}),
              ...(entry.metadata.sectorEnergyRepairStatus !== undefined
                ? { repairStatus: entry.metadata.sectorEnergyRepairStatus }
                : {}),
            },
          }
        : {}),
      ...(entry.routerSeverity !== undefined
        ? { routerSnapshot: { severity: entry.routerSeverity, liveAllowed: false, shadowAllowed: true } }
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
    });
  }

  // Horizon 별 avg return + win rate (observed only)
  const avgReturnByHorizon: Partial<Record<ProvisionalShadowHorizon, number>> = {};
  const winRateByHorizon: Partial<Record<ProvisionalShadowHorizon, number>> = {};
  for (const horizon of ALL_HORIZONS) {
    const observed = records.flatMap((r) =>
      r.points.filter((p) => p.horizon === horizon && p.status === 'OBSERVED' && p.returnPct !== undefined),
    );
    if (observed.length > 0) {
      const sum = observed.reduce((acc, p) => acc + (p.returnPct ?? 0), 0);
      avgReturnByHorizon[horizon] = sum / observed.length;
      const wins = observed.filter((p) => (p.returnPct ?? 0) > 0).length;
      winRateByHorizon[horizon] = wins / observed.length;
    }
  }

  // Top winners/losers — bestReturnPct 기준
  const recordsWithObserved = records.filter((r) => r.summary.bestReturnPct !== undefined);
  const topWinners = recordsWithObserved
    .slice()
    .sort((a, b) => (b.summary.bestReturnPct ?? 0) - (a.summary.bestReturnPct ?? 0))
    .slice(0, topN);
  const topLosers = recordsWithObserved
    .slice()
    .sort((a, b) => (a.summary.worstReturnPct ?? 0) - (b.summary.worstReturnPct ?? 0))
    .slice(0, topN);

  // observedEntries — 실제 가격 관측에 성공한 entry (COMPLETE | PARTIAL).
  // pendingEntries — horizon 미도달 entry (PENDING).
  // INSUFFICIENT_DATA — entryPrice 부재 또는 priceProvider 실패 — 위 둘 어디에도 카운트 안 됨.
  const observedEntries = records.filter(
    (r) => r.summary.status === 'COMPLETE' || r.summary.status === 'PARTIAL',
  ).length;
  const pendingEntries = records.filter((r) => r.summary.status === 'PENDING').length;

  return {
    totalEntries: records.length,
    observedEntries,
    pendingEntries,
    labelBreakdown,
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
export function formatProvisionalShadowPerformanceMessage(
  summary: ProvisionalShadowPerformanceSummary,
): string {
  const lines: string[] = [];
  lines.push('🌱 <b>Provisional Shadow Report (ADR-0428)</b>');

  if (summary.totalEntries === 0) {
    // 사용자 §I — created=0 처리
    lines.push('  • <i>아직 provisional shadow entry 가 없습니다.</i>');
    lines.push('  • <i>HARD_BLOCK / SELL_ONLY 상태에서는 Shadow 학습도 제한됩니다.</i>');
    lines.push(`  • generatedAtKst: ${summary.generatedAtKst}`);
    return lines.join('\n');
  }

  lines.push(`  • totalEntries: <b>${summary.totalEntries}</b>`);
  lines.push(`  • observed: <b>${summary.observedEntries}</b>`);
  lines.push(`  • pending: <b>${summary.pendingEntries}</b>`);

  // Label breakdown
  const labelEntries = Object.entries(summary.labelBreakdown).sort((a, b) => b[1] - a[1]);
  if (labelEntries.length > 0) {
    lines.push('');
    lines.push('  <b>📋 Label Breakdown</b>');
    for (const [label, count] of labelEntries) {
      lines.push(`    • ${label}: ${count}건`);
    }
  }

  // Horizon 성과
  const HORIZON_LABELS: Record<ProvisionalShadowHorizon, string> = {
    T_PLUS_30M: '+30m',
    T_PLUS_1H: '+1h',
    SAME_DAY_CLOSE: 'close',
    NEXT_OPEN: 'nextOpen',
    T_PLUS_1D_CLOSE: '+1d',
    T_PLUS_3D_CLOSE: '+3d',
  };
  const horizonsWithData = ALL_HORIZONS.filter((h) => summary.avgReturnByHorizon[h] !== undefined);
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
    lines.push('  <b>🏆 Top winners</b>');
    summary.topWinners.forEach((r, i) => {
      const pct = r.summary.bestReturnPct ?? 0;
      const sign = pct >= 0 ? '+' : '';
      lines.push(
        `    ${i + 1}. ${r.symbol}${r.name ? ` ${r.name}` : ''} <b>${sign}${pct.toFixed(2)}%</b>`,
      );
    });
  }

  // Top losers
  if (summary.topLosers.length > 0) {
    lines.push('');
    lines.push('  <b>📉 Top losers</b>');
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
    '  <i>read-only 학습/검증 리포트 — 자동 paper/live 승격 0, ' +
    'provisional ledger 만 read (일반 shadow buy 와 분리, ADR-0427 정합).</i>',
  );
  lines.push(`  • generatedAtKst: ${summary.generatedAtKst}`);

  return lines.join('\n');
}

/**
 * /scan_blockers 짧은 요약 (사용자 §H 정합).
 *
 * 전체 리포트는 /shadow_provisional 명령에서, 본 함수는 한눈에 보이는 카운트만.
 */
export function formatProvisionalShadowSummaryLine(
  summary: ProvisionalShadowPerformanceSummary,
): string | null {
  if (summary.totalEntries === 0) return null;
  return (
    `🌱 Provisional Shadow — ledger: <b>${summary.totalEntries}</b> / ` +
    `observed: <b>${summary.observedEntries}</b> / pending: <b>${summary.pendingEntries}</b> ` +
    `<i>(report: /shadow_provisional)</i>`
  );
}
