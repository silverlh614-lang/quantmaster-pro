// @responsibility ADR-0622 발굴 적극성 — Stage1 top-N 상향(②)·RS percentile 우선 정렬+laggard 디모트(③)·dry-run 관측. 순수 fetch 0, 양 flag default OFF byte-identical, ledger.
//
//   single 통로 / 불변식:
//     - RS 정의: candidate.quote.return20d − benchmarkReturn20d(둘 다 %, benchmark=macroState.kospi20dReturn).
//       **두 번째 RS 공식 신설 금지** — ADR-0616 universeCompositionBiasObservationAdr0616 RS 정의·
//       UNIVERSE_RS_LEADER_THRESHOLD(=0) 와 동일(재사용·import). calcStage1Score UNIVERSE_RS_GATE 와도 동일.
//     - top-N 컷 상향: universeScanner :356 kisRows.slice(0, resolveStage1TopN()) + :441
//       applyLeaderPreservation(candidates, resolveStage1TopN(), …). 두 flag OFF → 60 byte-identical.
//     - RS percentile 정렬: top-N 컷 비교자 stage1Score 단독 → rsPriorityComparator(positive-RS 우선·
//       laggard 디모트·결손 중립). OFF → stage1Score 단독 byte-identical. ADR-0617 주도주 union 보존 직교.
//     - 신규 fetch 0: benchmarkReturn20d·후보 quote 는 이미 universeScanner 스코프 존재(KIS/KRX/Yahoo 0).
//     - rsScoreFromExcess 구간·AXIS_WEIGHTS·requiredScore=70·STRONG 승격식 0줄(발굴 Stage1 레이어만·Gate2 ADR-0621 직교).
//     - 관측 ledger: ADR-0614/0616 패턴(atomic tmp→rename + rolling FIFO + 손상 JSON fallback + scanDateKey upsert).

import fs from 'fs';
import type { CandidateStock } from './pipelineHelpers.js';
// ADR-0622 — RS 정의 SSOT 재사용(두 번째 공식 신설 금지). leader/laggard 경계는
//   ADR-0616 UNIVERSE_RS_LEADER_THRESHOLD(=0) 를 import 재사용. RS 산출(return20d − benchmark)도
//   0616 의 내부 산출식과 동형 — 동일 식을 본 모듈 한 곳(computeRs)에만 둔다.
import { UNIVERSE_RS_LEADER_THRESHOLD } from './universeCompositionBiasObservationAdr0616.js';
import {
  UNIVERSE_DISCOVERY_AGGRESSIVENESS_LEDGER_FILE,
  ensureDataDir,
} from '../persistence/paths.js';

// ── ② 수량: Stage1 top-N 컷 상향 (ADR-0622 D1) ──────────────────────────────────

/** 현행 top-N 컷(byte-identical baseline). universeScanner :356 kisTop60 · :441 점수컷 limit. */
export const STAGE1_TOPN_BASE = 60 as const;

/**
 * 확대 top-N 컷(초기값·counterfactual 튜닝 대상). flag ON 시에만 적용.
 * 품질 희석 리스크: 60~90위 저점수 후보 유입 → ③ RS percentile 정렬과 병행 권고(저품질 유입 상쇄).
 * quota: kisTop60→90 = KIS quote fetch +30/스캔(budget lazy ADR-0558 컷 후 fetch 유지). 점수컷(:441)은 fetch 증가 0.
 */
export const STAGE1_TOPN_EXPANDED = 90 as const;

/**
 * ② top-N 상향 활성화 SSOT. `UNIVERSE_STAGE1_TOPN_EXPANSION_ENABLED === 'true'`.
 * default OFF — OFF 시 resolveStage1TopN() === 60(현행 byte-identical).
 */
export function isUniverseStage1TopNExpansionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.UNIVERSE_STAGE1_TOPN_EXPANSION_ENABLED === 'true';
}

/**
 * 적용할 top-N 컷 크기 — universeScanner :356/:441 가 이 함수를 호출(하드코딩 60 제거).
 * OFF → STAGE1_TOPN_BASE(60, byte-identical). ON → STAGE1_TOPN_EXPANDED(90).
 */
export function resolveStage1TopN(
  enabled: boolean = isUniverseStage1TopNExpansionEnabled(),
): number {
  return enabled ? STAGE1_TOPN_EXPANDED : STAGE1_TOPN_BASE;
}

// ── ③ 방향: RS percentile 우선 정렬 + laggard 디모트 (ADR-0622 D2) ────────────────

/**
 * ③ RS percentile 우선 정렬 활성화 SSOT. `UNIVERSE_RS_PERCENTILE_RANK_ENABLED === 'true'`.
 * default OFF — OFF 시 top-N 컷 정렬 비교자는 stage1Score 단독(현행 byte-identical).
 */
export function isUniverseRsPercentileRankEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.UNIVERSE_RS_PERCENTILE_RANK_ENABLED === 'true';
}

/**
 * 후보별 RS percentile 산출 결과 (cross-sectional, 후보 집합 내).
 * - rs: candidate.quote.return20d − benchmarkReturn20d (둘 다 %, ADR-0616 정의 재사용).
 * - percentile: RS 산출 가능 후보 집합 내 백분위(0~100). 결손 후보는 null(미부여·디모트 안 함).
 * - isLeader: rs >= UNIVERSE_RS_LEADER_THRESHOLD(=0). 결손 시 null(중립).
 */
export interface CandidateRsRank {
  code: string;
  rs: number | null;            // 결손(return20d/benchmark 비유한) → null
  percentile: number | null;    // RS 산출 가능 후보 한정 백분위. 결손 → null
  isLeader: boolean | null;     // rs>=0 → true / rs<0 → false / 결손 → null(중립)
}

/**
 * 단일 후보 RS 산출 — ADR-0616 정의 재사용(두 번째 공식 신설 금지).
 * rs = return20d − benchmark (둘 다 %, 동일 단위 직접 차감). 결손(비유한) → null.
 * 본 모듈 내 RS 산출의 유일한 진입점(식 중복 금지).
 */
function computeRs(
  return20d: number | undefined,
  benchmark: number | null,
): number | null {
  if (benchmark === null) return null;
  if (typeof return20d !== 'number' || !Number.isFinite(return20d)) return null;
  return return20d - benchmark;
}

/** benchmark 유효성 정규화 — undefined/NaN/Infinity → null(결손≠laggard, 불변식 #6). */
function normalizeBenchmark(benchmarkReturn20d: number | null | undefined): number | null {
  return typeof benchmarkReturn20d === 'number' && Number.isFinite(benchmarkReturn20d)
    ? benchmarkReturn20d
    : null;
}

/**
 * 후보 집합 + benchmarkReturn20d → 후보별 RS percentile 산출 (순수, fetch 0).
 *
 * RS = c.quote.return20d − benchmarkReturn20d (둘 다 %·동일 단위 직접 차감·ADR-0616 정의 재사용·
 *   두 번째 RS 공식 신설 금지). benchmark 비유한(undefined/NaN/Infinity) → 전건 결손(percentile null)
 *   → 정렬 무변경(불변식 #6 결손≠laggard). 후보별 return20d 결손도 개별 null.
 *
 * percentile = RS 산출 가능 후보 집합 내 cross-sectional 백분위(0~100).
 *   순위(낮은 rs=낮은 percentile) = (자신보다 낮은 rs 수) / (산출 가능 후보 수 − 1) × 100.
 *   산출 가능 후보 1건이면 percentile=100(유일 → 최상위). 결손 후보는 percentile/isLeader null.
 *
 * @param candidates Stage1 통과 후보(quote.return20d 보유).
 * @param benchmarkReturn20d macroState.kospi20dReturn (universeScanner stage1BenchmarkReturn20d 스코프 재사용).
 * @returns code→CandidateRsRank Map (입력 순서 무관·정렬 비교자가 lookup).
 */
export function computeRsPercentiles(
  candidates: readonly CandidateStock[],
  benchmarkReturn20d: number | null | undefined,
): Map<string, CandidateRsRank> {
  void UNIVERSE_RS_LEADER_THRESHOLD; // 식별자 재사용 보증 — 아래 isLeader 판정에서 사용.
  const benchmark = normalizeBenchmark(benchmarkReturn20d);

  // 1차 패스 — rs 산출(결손은 null). isLeader 는 THRESHOLD 재사용.
  const ranks = new Map<string, CandidateRsRank>();
  const computed: number[] = [];
  for (const c of candidates) {
    const rs = computeRs(c.quote?.return20d, benchmark);
    const isLeader = rs === null ? null : rs >= UNIVERSE_RS_LEADER_THRESHOLD;
    ranks.set(c.code, { code: c.code, rs, percentile: null, isLeader });
    if (rs !== null) computed.push(rs);
  }

  // 2차 패스 — cross-sectional percentile (산출 가능 후보 집합 내). 결손은 미부여(null 유지).
  const denom = computed.length - 1;
  for (const rank of ranks.values()) {
    if (rank.rs === null) continue;
    if (denom <= 0) {
      rank.percentile = 100; // 산출 가능 후보 1건 → 유일·최상위.
      continue;
    }
    let lower = 0;
    for (const v of computed) {
      if (v < rank.rs) lower += 1;
    }
    rank.percentile = (lower / denom) * 100;
  }
  return ranks;
}

/**
 * top-N 컷 정렬 비교자 (flag ON). positive-RS 우선 → stage1Score tiebreak.
 *
 * 우선순위 (구현 명세):
 *   1) isLeader true(rs>=0) > isLeader null(결손·중립) > isLeader false(laggard, 디모트).
 *   2) 동급 내 stage1Score desc (현행 비교자 — 두 번째 정렬식 신설 금지).
 * → positive-RS 종목이 컷 안으로 끌어올려지고, laggard 는 동점 시 후순위.
 * flag OFF 경로에서는 호출되지 않음(universeScanner 가 stage1Score 단독 비교자 유지 → byte-identical).
 *
 * @param rsRanks computeRsPercentiles 결과.
 * @internal applyLeaderPreservation 내부 sort 와 정합(주도주 union 보존은 직교 layer 로 별도 유지).
 */
export function rsPriorityComparator(
  rsRanks: ReadonlyMap<string, CandidateRsRank>,
): (a: CandidateStock, b: CandidateStock) => number {
  // isLeader true(2) > null(1) > false(0). 결손은 중립 — laggard 보다 우선, leader 보다 후순위.
  const tier = (code: string): number => {
    const isLeader = rsRanks.get(code)?.isLeader ?? null;
    if (isLeader === true) return 2;
    if (isLeader === false) return 0;
    return 1; // null(결손·중립)
  };
  return (a, b) => {
    const tierDelta = tier(b.code) - tier(a.code);
    if (tierDelta !== 0) return tierDelta;
    // 동급 내 stage1Score desc — 현행 비교자 재사용(두 번째 정렬식 신설 금지).
    return b.stage1Score - a.stage1Score;
  };
}

// ── 공통 dry-run 관측 (ADR-0622 D3, flag 무관 산출) ──────────────────────────────

/**
 * per-scan aggregate dry-run 관측 (per-candidate stamp 아님 — 스캔당 1 summary).
 * flag 무관 항상 산출 — "적극 발굴(②+③ ON)이었다면 후보가 어떻게 달라졌을지". append 만 flag ON.
 */
export interface UniverseDiscoveryAggressivenessObservation {
  scanDateKey: string;              // 'YYYY-MM-DD' KST
  topNExpansionEnabled: boolean;    // ② flag 상태(관측 시점)
  rsPercentileRankEnabled: boolean; // ③ flag 상태(관측 시점)

  totalCandidates: number;          // Stage1 통과 후보 총수
  appliedTopN: number;              // 실제 적용된 top-N(resolveStage1TopN)

  // ② dry-run — top-N 60→90 시 추가 편입됐을 후보 수(현행 컷 밖이나 확대 컷 안).
  wouldExpandTopNAddedCount: number;

  // ③ dry-run — RS percentile 정렬 시 끌어올려질 positive-RS / 밀려날 laggard 수.
  wouldRsPromoteCount: number;
  wouldLaggardDemoteCount: number;

  // 운영자 실측 추세 추적(현행 후보 중 laggard rs<0 비율, ADR-0616 동일 RS). 결손 후보 제외.
  currentLaggardShare: number | null; // RS 산출 가능 후보 0 → null

  benchmarkReturn20d: number | null;  // 산출에 쓴 벤치마크(kospi20dReturn). 결손 → null(③ dry-run skip)
  executionImpact: 'NONE' | 'EXECUTION_ADJACENT'; // 양 flag OFF=NONE / ON=adjacent
  observationOnly: boolean;            // 양 flag OFF=true / 어느 한쪽 ON=false
}

/** ledger 1행 = per-scan observation. */
export type UniverseDiscoveryAggressivenessLedgerRow =
  UniverseDiscoveryAggressivenessObservation & { appendedAt: string };

/** @internal ADR-0614/0616/0617 todayKst 와 byte-동일 정의 — drift 테스트 고정. */
export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** stage1Score 단독 desc 정렬 — 현행 applyLeaderPreservation 비교자와 byte-동일(baseline). */
function sortByStage1ScoreDesc(candidates: readonly CandidateStock[]): CandidateStock[] {
  return [...candidates].sort((a, b) => b.stage1Score - a.stage1Score);
}

/**
 * 후보 집합 + RS rank + top-N 컷 → per-scan dry-run 관측 순수 산출 (provider/fetch 0).
 *
 * dry-run 은 flag 무관 산출(OFF baseline 도 "적용했다면" delta 노출). append 만 호출자(universeScanner)가 flag 격리.
 *
 * 산출 알고리즘:
 *   baseline = stage1Score desc 정렬 후 STAGE1_TOPN_BASE(60) 컷(현행 동작).
 *   ② wouldExpandTopNAddedCount = STAGE1_TOPN_EXPANDED(90) 컷 ∖ baseline 컷(추가 편입 수).
 *   ③ rsSorted = rsPriorityComparator 정렬 후 baseline 크기(60) 컷.
 *      wouldRsPromoteCount  = rs 정렬 후 컷에 새로 들어온 종목(현행 컷 밖이었던 positive-RS 끌어올림).
 *      wouldLaggardDemoteCount = 현행 컷 안이었으나 rs 정렬 후 컷 밖으로 밀린 종목(laggard 디모트).
 *      benchmark 결손 → rs 전건 null → 정렬 무변경 → promote/demote 0(불변식 #6).
 *   currentLaggardShare = 현행 컷 후보 중 laggard(rs<0) / RS 산출 가능 컷 후보 수.
 *
 * @param candidates Stage1 통과 후보(stage1Score 보유).
 * @param rsRanks computeRsPercentiles 결과(③ dry-run·currentLaggardShare).
 * @param benchmarkReturn20d 산출 벤치마크(결손 → ③ dry-run skip).
 * @param now scanDateKey 결정성 주입.
 */
export function computeUniverseDiscoveryAggressivenessObservation(
  candidates: readonly CandidateStock[],
  rsRanks: ReadonlyMap<string, CandidateRsRank>,
  benchmarkReturn20d: number | null | undefined,
  now: Date = new Date(),
  topNExpansionEnabled: boolean = isUniverseStage1TopNExpansionEnabled(),
  rsPercentileRankEnabled: boolean = isUniverseRsPercentileRankEnabled(),
): UniverseDiscoveryAggressivenessObservation {
  const benchmark = normalizeBenchmark(benchmarkReturn20d);

  // ── baseline 컷 (현행 동작: stage1Score desc → BASE 60) ──
  const sortedByScore = sortByStage1ScoreDesc(candidates);
  const baseCut = sortedByScore.slice(0, STAGE1_TOPN_BASE);
  const baseCutCodes = new Set(baseCut.map((c) => c.code));

  // ── ② dry-run — 확대 컷(90) ∖ 현행 컷(60) ──
  const expandedCut = sortedByScore.slice(0, STAGE1_TOPN_EXPANDED);
  let wouldExpandTopNAddedCount = 0;
  for (const c of expandedCut) {
    if (!baseCutCodes.has(c.code)) wouldExpandTopNAddedCount += 1;
  }

  // ── ③ dry-run — RS percentile 정렬 후 BASE 컷 vs 현행 컷 delta ──
  //   benchmark 결손 → rs 전건 null → rsPriorityComparator tier 전건 중립 → 정렬 무변경 → delta 0.
  let wouldRsPromoteCount = 0;
  let wouldLaggardDemoteCount = 0;
  if (benchmark !== null) {
    const rsSorted = [...candidates].sort(rsPriorityComparator(rsRanks));
    const rsCutCodes = new Set(rsSorted.slice(0, STAGE1_TOPN_BASE).map((c) => c.code));
    for (const code of rsCutCodes) {
      if (!baseCutCodes.has(code)) wouldRsPromoteCount += 1; // 새로 끌어올려진 종목
    }
    for (const code of baseCutCodes) {
      if (!rsCutCodes.has(code)) wouldLaggardDemoteCount += 1; // 밀려난 종목
    }
  }

  // ── currentLaggardShare — 현행 컷 후보 중 laggard(rs<0) 비율(RS 산출 가능 한정) ──
  let cutRsComputed = 0;
  let cutLaggard = 0;
  for (const c of baseCut) {
    const rank = rsRanks.get(c.code);
    if (rank?.isLeader === null || rank?.isLeader === undefined) continue;
    cutRsComputed += 1;
    if (rank.isLeader === false) cutLaggard += 1;
  }
  const currentLaggardShare = cutRsComputed > 0 ? cutLaggard / cutRsComputed : null;

  const observationOnly = !topNExpansionEnabled && !rsPercentileRankEnabled;

  return {
    scanDateKey: todayKst(now),
    topNExpansionEnabled,
    rsPercentileRankEnabled,
    totalCandidates: candidates.length,
    appliedTopN: resolveStage1TopN(topNExpansionEnabled),
    wouldExpandTopNAddedCount,
    wouldRsPromoteCount,
    wouldLaggardDemoteCount,
    currentLaggardShare,
    benchmarkReturn20d: benchmark,
    executionImpact: observationOnly ? 'NONE' : 'EXECUTION_ADJACENT',
    observationOnly,
  };
}

// ── 영속 I/O (ADR-0614/0616/0617 패턴: atomic write + FIFO 캡 + 손상 JSON fallback) ──

/** per-scan summary 보관 거래일(스캔) 수 (rolling FIFO). */
export const UNIVERSE_DISCOVERY_AGGRESSIVENESS_WINDOW_SCANS = 60 as const;

function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 손상/이질 row 방어 — 최소 식별 필드(scanDateKey)만 검증. 산출 필드 결손은 영속 그대로 신뢰. */
function isValidLedgerRow(row: unknown): row is UniverseDiscoveryAggressivenessLedgerRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return isValidDateKey(r.scanDateKey)
    && typeof r.totalCandidates === 'number'
    && typeof r.appendedAt === 'string';
}

function loadAll(
  filePath = UNIVERSE_DISCOVERY_AGGRESSIVENESS_LEDGER_FILE,
): UniverseDiscoveryAggressivenessLedgerRow[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    const rows = parsed.filter(isValidLedgerRow);
    rows.sort((a, b) => a.scanDateKey.localeCompare(b.scanDateKey));
    return rows;
  } catch {
    // 손상 JSON → 빈 배열 fallback (ADR-0614 패턴, 시스템 무중단).
    return [];
  }
}

function saveAll(
  rows: UniverseDiscoveryAggressivenessLedgerRow[],
  filePath = UNIVERSE_DISCOVERY_AGGRESSIVENESS_LEDGER_FILE,
): void {
  ensureDataDir();
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
    fs.renameSync(tmp, filePath);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* SDS-ignore: tmp cleanup best-effort, idempotent */ }
  }
}

/**
 * per-scan observation append (단일 배열 ledger, rolling FIFO + scanDateKey upsert).
 * 신규 fetch 0. 호출자(universeScanner)가 flag(어느 한쪽 ON)·try/catch 격리(불변식 #1).
 * ADR-0617 appendLeaderUniverseInjectionObservation 의 loadAll/saveAll/byDate upsert 패턴 동형.
 */
export function appendUniverseDiscoveryAggressivenessObservation(
  observation: UniverseDiscoveryAggressivenessObservation,
  now: Date = new Date(),
  filePath: string = UNIVERSE_DISCOVERY_AGGRESSIVENESS_LEDGER_FILE,
): UniverseDiscoveryAggressivenessLedgerRow {
  const row: UniverseDiscoveryAggressivenessLedgerRow = {
    ...observation,
    appendedAt: now.toISOString(),
  };
  const rows = loadAll(filePath);
  // scanDateKey upsert (last-write-wins) — 장중 재스캔/재시작 안전.
  const byDate = new Map<string, UniverseDiscoveryAggressivenessLedgerRow>();
  for (const existing of rows) byDate.set(existing.scanDateKey, existing);
  byDate.set(row.scanDateKey, row);
  const merged = [...byDate.values()].sort((a, b) => a.scanDateKey.localeCompare(b.scanDateKey));
  // rolling FIFO — 가장 오래된 scanDateKey 부터 캡 초과분 제거.
  const trimmed = merged.slice(
    Math.max(0, merged.length - UNIVERSE_DISCOVERY_AGGRESSIVENESS_WINDOW_SCANS),
  );
  saveAll(trimmed, filePath);
  return row;
}

/** ledger 전체 조회(추세 분석). 손상 fallback → []. */
export function loadUniverseDiscoveryAggressivenessLedger(
  filePath: string = UNIVERSE_DISCOVERY_AGGRESSIVENESS_LEDGER_FILE,
): UniverseDiscoveryAggressivenessLedgerRow[] {
  return loadAll(filePath);
}

/** 테스트 전용 — ledger 파일 초기화. */
export function __resetUniverseDiscoveryAggressivenessLedgerForTests(
  filePath: string = UNIVERSE_DISCOVERY_AGGRESSIVENESS_LEDGER_FILE,
): void {
  try { fs.unlinkSync(filePath); } catch { /* SDS-ignore: 미존재 파일 idempotent */ }
}
