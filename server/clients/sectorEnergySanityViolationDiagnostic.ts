/**
 * @responsibility ADR-0446 SectorEnergy sanity violation 진단 SSOT.
 *
 * 단순 console.warn 로그였던 sanity violation (sector pct > 30% / stockVolume > 1000% /
 * stockReturn > 90% / base 0/tiny / stale baseline) 을 *구조화된 진단* 으로 집계.
 * sector-level pct 와 stock-level safePctChange 분리.
 *
 * 절대 불변식 (사용자 §"절대 불변식"):
 *   1. sanity violation clamp 후 OK 표시 금지 — 진단 ledger 에 영속.
 *   2. sanity violation count > 0 시 leadershipConfidence='OK' 금지.
 *   3. STOCK_DAILY sourceTier 의 sanity violation 은 trusted leadership 금지 (별도 marker).
 *   4. ADR-0370 RETURN_SANITY_BOUND_PCT=30 / VOLUME_SANITY_BOUND_PCT=1000 임계 변경 0.
 *   5. KIS 주문 함수 5종 import 0 (정적 grep 가드).
 *   6. autoTradeEngine / orderExecutor / trancheExecutor import 0.
 *   7. 외부 API 신규 호출 0 (record-time inputs 만, ledger 영속 0).
 *
 * 외부 의존성: sectorEnergyIndexCodeRecoveryDiagnostic.SectorIndexRowSourceTier 만.
 */

import type { SectorIndexRowSourceTier } from './sectorEnergyIndexCodeRecoveryDiagnostic.js';

// ---------------------------------------------------------------------------
// SSOT 상수 + ENV gate
// ---------------------------------------------------------------------------

/** ADR-0157 정확 비교 의무. default OFF — 활성 시 진단 layer 자체 비활성. */
export function isSectorEnergySanityDiagnosticDisabled(): boolean {
  return process.env.SECTOR_ENERGY_SANITY_DIAGNOSTIC_DISABLED === 'true';
}

/**
 * Sanity violation 진단 임계값 SSOT (절대 변경 금지).
 *
 * 사용자 §"진단 원칙" + ADR-0370 정합:
 *   - returnPct 임계: 30% (ADR-0370 RETURN_SANITY_BOUND_PCT)
 *   - volumePct 임계: 1000% (ADR-0370 VOLUME_SANITY_BOUND_PCT)
 *   - stockReturn 임계: 90% (사용자 §"테스트 요구사항")
 *   - confidenceImpact BLOCKED 임계: stockReturn>5 || stockVolume>5 || baseZero>3
 */
export const SECTOR_ENERGY_SANITY_THRESHOLDS = Object.freeze({
  /** sector-level returnPct 임계 (ADR-0370). */
  SECTOR_RETURN_BOUND_PCT: 30,
  /** sector-level volumePct 임계 (ADR-0370). */
  SECTOR_VOLUME_BOUND_PCT: 1000,
  /** stock-level returnPct 임계 (사용자 §"테스트 요구사항"). */
  STOCK_RETURN_BOUND_PCT: 90,
  /** stock-level volumePct 임계 (ADR-0370 VOLUME 동일). */
  STOCK_VOLUME_BOUND_PCT: 1000,
  /** base price 0/tiny 임계 (절대값). */
  BASE_TINY_THRESHOLD: 1.0,
  /** stale baseline 임계 (영업일). */
  STALE_BASELINE_DAYS: 3,
  /** confidenceImpact BLOCKED stockReturn 임계. */
  BLOCKED_STOCK_RETURN_COUNT: 5,
  /** confidenceImpact BLOCKED stockVolume 임계. */
  BLOCKED_STOCK_VOLUME_COUNT: 5,
  /** confidenceImpact BLOCKED baseZeroOrTiny 임계. */
  BLOCKED_BASE_TINY_COUNT: 3,
  /** topViolatingSectors / topViolatingStocks 표시 한도. */
  TOP_VIOLATING_LIMIT: 5,
} as const);

// ---------------------------------------------------------------------------
// 타입 SSOT
// ---------------------------------------------------------------------------

/** 7-value union (사용자 §7). */
export type SectorEnergySanityViolationKind =
  | 'SECTOR_PCT_BOUND_EXCEEDED'
  | 'STOCK_VOLUME_PCT_CHANGE_EXCEEDED'
  | 'STOCK_RETURN_PCT_CHANGE_EXCEEDED'
  | 'BASE_ZERO_OR_TINY'
  | 'CURRENT_OUTLIER'
  | 'STALE_BASELINE'
  | 'UNKNOWN';

/** 3-state confidence impact (사용자 §6). */
export type SectorEnergySanityConfidenceImpact = 'NONE' | 'DEGRADED' | 'BLOCKED';

/** 3-value scope (sector vs stock 분리, 사용자 §6). */
export type SectorEnergySanityScope = 'SECTOR' | 'STOCK_VOLUME' | 'STOCK_RETURN';

/** 단일 sanity violation event (record-time, ledger 영속 0). */
export interface SectorEnergySanityViolation {
  kind: SectorEnergySanityViolationKind;
  scope: SectorEnergySanityScope;
  pct: number;
  bound: number;
  /** sector-level violation 시 sector key. */
  sector?: string;
  /** stock-level violation 시 6자리 stock code. */
  code?: string;
  /** 현재값 (참고용). */
  current?: number;
  /** base 값 (참고용). */
  base?: number;
  /** sourceTier marker — STOCK_DAILY 시 trusted leadership 금지. */
  sourceTier?: SectorIndexRowSourceTier;
}

/**
 * 단일 sector violation 집계 (topViolatingSectors 입력).
 */
export interface SectorViolationSummary {
  sector: string;
  pct: number;
  bound: number;
  count: number;
}

/**
 * 단일 stock violation 집계 (topViolatingStocks 입력).
 */
export interface StockViolationSummary {
  code: string;
  metric: 'stockVolume' | 'stockReturn';
  pct: number;
  current?: number;
  base?: number;
  reason: SectorEnergySanityViolationKind;
}

/** 메인 schema (사용자 §6). */
export interface SectorEnergySanityViolationDiagnostic {
  totalViolations: number;
  sectorPctViolations: number;
  stockVolumeViolations: number;
  stockReturnViolations: number;
  topViolatingSectors: SectorViolationSummary[];
  topViolatingStocks: StockViolationSummary[];
  baseZeroOrTinyCount: number;
  staleBaselineCount: number;
  sourceTierBreakdown: Record<SectorIndexRowSourceTier, number>;
  confidenceImpact: SectorEnergySanityConfidenceImpact;
  /** STOCK_DAILY sourceTier 에서 violation 발생 — trusted leadership 금지 marker. */
  stockDailyTaintedMarker: boolean;
}

/**
 * Mutable 누적 state (호출자가 보관, finalize 시 frozen diagnostic 으로 변환).
 *
 * 사용자 §"헬퍼 SSOT" — recordSanityViolation(state, violation) 가 mutate.
 */
export interface SectorEnergySanityViolationState {
  violations: SectorEnergySanityViolation[];
}

// ---------------------------------------------------------------------------
// 헬퍼 SSOT
// ---------------------------------------------------------------------------

/** 빈 sourceTierBreakdown 초기화 (모든 6 tier = 0). */
function emptySourceTierBreakdown(): Record<SectorIndexRowSourceTier, number> {
  return {
    KRX_CODE: 0,
    STOCK_DAILY: 0,
    ETF: 0,
    CACHE: 0,
    DATA_DBG: 0,
    UNKNOWN: 0,
  };
}

/** 신규 mutable state 초기화. */
export function createSanityViolationState(): SectorEnergySanityViolationState {
  return { violations: [] };
}

/**
 * 입력 정보로부터 sanity violation kind 추론 SSOT.
 *
 * 우선순위 (사용자 §"진단 원칙"):
 *  1. base ≤ 1.0 → BASE_ZERO_OR_TINY (current 무관)
 *  2. scope='SECTOR' + |pct| > bound → SECTOR_PCT_BOUND_EXCEEDED
 *  3. scope='STOCK_VOLUME' + |pct| > bound → STOCK_VOLUME_PCT_CHANGE_EXCEEDED
 *  4. scope='STOCK_RETURN' + |pct| > bound → STOCK_RETURN_PCT_CHANGE_EXCEEDED
 *  5. NaN/Infinity current → CURRENT_OUTLIER
 *  6. 그 외 → UNKNOWN
 */
export function classifySanityViolationKind(input: {
  scope: SectorEnergySanityScope;
  pct: number;
  bound: number;
  current?: number;
  base?: number;
}): SectorEnergySanityViolationKind {
  const { scope, pct, bound, current, base } = input;
  if (base !== undefined && Number.isFinite(base) && Math.abs(base) <= SECTOR_ENERGY_SANITY_THRESHOLDS.BASE_TINY_THRESHOLD) {
    return 'BASE_ZERO_OR_TINY';
  }
  if (current !== undefined && !Number.isFinite(current)) {
    return 'CURRENT_OUTLIER';
  }
  if (!Number.isFinite(pct)) {
    return 'CURRENT_OUTLIER';
  }
  if (Math.abs(pct) > Math.abs(bound)) {
    if (scope === 'SECTOR') return 'SECTOR_PCT_BOUND_EXCEEDED';
    if (scope === 'STOCK_VOLUME') return 'STOCK_VOLUME_PCT_CHANGE_EXCEEDED';
    if (scope === 'STOCK_RETURN') return 'STOCK_RETURN_PCT_CHANGE_EXCEEDED';
  }
  return 'UNKNOWN';
}

/** State 에 violation 추가 (mutate, idempotent 아님). */
export function recordSanityViolation(
  state: SectorEnergySanityViolationState,
  violation: SectorEnergySanityViolation,
): void {
  if (isSectorEnergySanityDiagnosticDisabled()) return;
  state.violations.push(violation);
}

/**
 * confidenceImpact 결정 트리 SSOT (사용자 §"진단 원칙").
 *
 * 우선순위:
 *  1. totalViolations === 0 → NONE
 *  2. stockReturnViolations > 5 OR stockVolumeViolations > 5 OR baseZeroOrTinyCount > 3 → BLOCKED
 *  3. STOCK_DAILY sourceTier violation 있음 → BLOCKED (trusted leadership 금지)
 *  4. 그 외 → DEGRADED
 *
 * **사용자 §"절대 불변식" #2**: totalViolations > 0 시 NONE 절대 반환 금지.
 */
export function deriveConfidenceImpact(input: {
  totalViolations: number;
  stockReturnViolations: number;
  stockVolumeViolations: number;
  baseZeroOrTinyCount: number;
  stockDailyTaintedMarker: boolean;
}): SectorEnergySanityConfidenceImpact {
  if (input.totalViolations === 0) return 'NONE';
  if (
    input.stockReturnViolations > SECTOR_ENERGY_SANITY_THRESHOLDS.BLOCKED_STOCK_RETURN_COUNT ||
    input.stockVolumeViolations > SECTOR_ENERGY_SANITY_THRESHOLDS.BLOCKED_STOCK_VOLUME_COUNT ||
    input.baseZeroOrTinyCount > SECTOR_ENERGY_SANITY_THRESHOLDS.BLOCKED_BASE_TINY_COUNT
  ) {
    return 'BLOCKED';
  }
  if (input.stockDailyTaintedMarker) return 'BLOCKED';
  return 'DEGRADED';
}

/**
 * State → frozen diagnostic 변환 SSOT.
 *
 * topViolatingSectors / topViolatingStocks 는 |pct| 절대값 desc 정렬 + Top N 절삭.
 * sourceTierBreakdown 은 violation.sourceTier 필드 카운팅 (부재 시 UNKNOWN bucket).
 */
export function finalizeSanityDiagnostic(
  state: SectorEnergySanityViolationState,
): SectorEnergySanityViolationDiagnostic {
  const violations = state.violations;
  if (violations.length === 0) {
    return {
      totalViolations: 0,
      sectorPctViolations: 0,
      stockVolumeViolations: 0,
      stockReturnViolations: 0,
      topViolatingSectors: [],
      topViolatingStocks: [],
      baseZeroOrTinyCount: 0,
      staleBaselineCount: 0,
      sourceTierBreakdown: emptySourceTierBreakdown(),
      confidenceImpact: 'NONE',
      stockDailyTaintedMarker: false,
    };
  }

  let sectorPctViolations = 0;
  let stockVolumeViolations = 0;
  let stockReturnViolations = 0;
  let baseZeroOrTinyCount = 0;
  let staleBaselineCount = 0;
  let stockDailyTaintedMarker = false;

  const sectorAcc = new Map<string, { pct: number; bound: number; count: number }>();
  const stockAcc = new Map<
    string,
    { code: string; metric: 'stockVolume' | 'stockReturn'; pct: number; current?: number; base?: number; reason: SectorEnergySanityViolationKind }
  >();
  const sourceTierBreakdown = emptySourceTierBreakdown();

  for (const v of violations) {
    if (v.scope === 'SECTOR') sectorPctViolations += 1;
    else if (v.scope === 'STOCK_VOLUME') stockVolumeViolations += 1;
    else if (v.scope === 'STOCK_RETURN') stockReturnViolations += 1;

    if (v.kind === 'BASE_ZERO_OR_TINY') baseZeroOrTinyCount += 1;
    if (v.kind === 'STALE_BASELINE') staleBaselineCount += 1;

    const tier: SectorIndexRowSourceTier = v.sourceTier ?? 'UNKNOWN';
    sourceTierBreakdown[tier] += 1;
    if (tier === 'STOCK_DAILY') stockDailyTaintedMarker = true;

    if (v.scope === 'SECTOR' && v.sector) {
      const prev = sectorAcc.get(v.sector);
      if (!prev || Math.abs(v.pct) > Math.abs(prev.pct)) {
        sectorAcc.set(v.sector, {
          pct: v.pct,
          bound: v.bound,
          count: (prev?.count ?? 0) + 1,
        });
      } else {
        prev.count += 1;
      }
    } else if (v.code && (v.scope === 'STOCK_VOLUME' || v.scope === 'STOCK_RETURN')) {
      const metric = v.scope === 'STOCK_VOLUME' ? 'stockVolume' : 'stockReturn';
      const accKey = `${v.code}:${metric}`;
      const prev = stockAcc.get(accKey);
      if (!prev || Math.abs(v.pct) > Math.abs(prev.pct)) {
        stockAcc.set(accKey, {
          code: v.code,
          metric,
          pct: v.pct,
          current: v.current,
          base: v.base,
          reason: v.kind,
        });
      }
    }
  }

  const topViolatingSectors: SectorViolationSummary[] = Array.from(sectorAcc.entries())
    .map(([sector, info]) => ({ sector, pct: info.pct, bound: info.bound, count: info.count }))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, SECTOR_ENERGY_SANITY_THRESHOLDS.TOP_VIOLATING_LIMIT);

  const topViolatingStocks: StockViolationSummary[] = Array.from(stockAcc.values())
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, SECTOR_ENERGY_SANITY_THRESHOLDS.TOP_VIOLATING_LIMIT);

  const totalViolations = violations.length;
  const confidenceImpact = deriveConfidenceImpact({
    totalViolations,
    stockReturnViolations,
    stockVolumeViolations,
    baseZeroOrTinyCount,
    stockDailyTaintedMarker,
  });

  return {
    totalViolations,
    sectorPctViolations,
    stockVolumeViolations,
    stockReturnViolations,
    topViolatingSectors,
    topViolatingStocks,
    baseZeroOrTinyCount,
    staleBaselineCount,
    sourceTierBreakdown,
    confidenceImpact,
    stockDailyTaintedMarker,
  };
}

// ---------------------------------------------------------------------------
// HTML Escape SSOT (텔레그램 plain text 안전)
// ---------------------------------------------------------------------------

/** ADR-0446 plain text safe formatter — `<` `>` `&` 영구 차단. */
export function escapeSanityHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Formatter SSOT
// ---------------------------------------------------------------------------

/** /sector_energy_diag 의 Sanity 섹션 plain text. */
export function formatSanityDiagnosticSection(
  diag: SectorEnergySanityViolationDiagnostic,
): string {
  if (diag.totalViolations === 0) {
    return '🧪 SectorEnergy Sanity\n  • totalViolations: 0\n  • confidenceImpact: NONE';
  }

  const lines: string[] = [];
  lines.push('🧪 SectorEnergy Sanity');
  lines.push(
    `  • totalViolations: ${diag.totalViolations} / sectorPct ${diag.sectorPctViolations} / ` +
      `stockVolume ${diag.stockVolumeViolations} / stockReturn ${diag.stockReturnViolations}`,
  );
  if (diag.baseZeroOrTinyCount > 0) {
    lines.push(`  • baseZeroOrTiny: ${diag.baseZeroOrTinyCount}건`);
  }
  if (diag.staleBaselineCount > 0) {
    lines.push(`  • staleBaseline: ${diag.staleBaselineCount}건`);
  }
  if (diag.topViolatingSectors.length > 0) {
    const top = diag.topViolatingSectors
      .map((s) => `${escapeSanityHtml(s.sector)} ${formatSignedPct(s.pct)}>${formatSignedPct(s.bound)}`)
      .join(' / ');
    lines.push(`  • topSectors: ${top}`);
  }
  if (diag.topViolatingStocks.length > 0) {
    const top = diag.topViolatingStocks
      .map(
        (s) =>
          `${escapeSanityHtml(s.code)}(${s.metric === 'stockVolume' ? '거래량' : '수익률'}) ${formatSignedPct(s.pct)}`,
      )
      .join(' / ');
    lines.push(`  • topStocks: ${top}`);
  }
  const tierBreakdown = formatSourceTierBreakdown(diag.sourceTierBreakdown);
  if (tierBreakdown) {
    lines.push(`  • sourceTierBreakdown: ${tierBreakdown}`);
  }
  if (diag.stockDailyTaintedMarker) {
    lines.push('  • ⚠️ STOCK_DAILY sourceTier 에서 violation 발생 — trusted leadership 금지');
  }
  lines.push(`  • confidenceImpact: ${diag.confidenceImpact}`);
  if (diag.confidenceImpact !== 'NONE') {
    lines.push('  • operatorAction: source mapping / baseline 점검 전 leadership 사용 금지');
  }

  return lines.join('\n');
}

/** /scan_blockers 의 sanity 한 줄 (사용자 §"운영 출력 기대값"). */
export function formatSanityDiagnosticCompactLine(
  diag: SectorEnergySanityViolationDiagnostic,
): string {
  if (diag.totalViolations === 0) {
    return 'Sanity OK (0건)';
  }
  return (
    `Sanity ${diag.totalViolations}건 ` +
    `(sectorPct ${diag.sectorPctViolations}, stockVol ${diag.stockVolumeViolations}, ` +
    `stockRet ${diag.stockReturnViolations}) · confidence ${diag.confidenceImpact}` +
    (diag.stockDailyTaintedMarker ? ' · STOCK_DAILY tainted' : '')
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatSignedPct(pct: number): string {
  if (!Number.isFinite(pct)) return 'NaN';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function formatSourceTierBreakdown(breakdown: Record<SectorIndexRowSourceTier, number>): string {
  const entries = Object.entries(breakdown).filter(([, count]) => count > 0);
  if (entries.length === 0) return '';
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([tier, count]) => `${tier} ${count}`)
    .join(' / ');
}
