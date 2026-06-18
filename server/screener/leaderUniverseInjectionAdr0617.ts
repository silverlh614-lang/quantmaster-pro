// @responsibility ADR-0617 주도주 Stage1 보존 — expandedUniverse source 태그 carry + top-N 점수컷 주도주 강제 보존(품질 관문 유지). 순수 fetch 0, flag default OFF, 관측 ledger.
//
// ⚠ ARCHITECT SCAFFOLD (Phase 0) — 본 파일은 타입 계약 + 시그니처 + 정책 명세만 담는다.
//   실제 구현(본문 채우기·회귀 테스트)은 engine-dev 인계. 현재는 경계·타입 확정용 스텁이다.
//   single 통로 / 불변식:
//     - source 태그: dynamicUniverseExpander.DynamicStock['source'] union 재사용. **두 번째 태그 enum 신설 금지.**
//     - 강제 보존: top-N 점수컷(universeScanner stage1QuantFilter)만 면제. Stage1 기본 관문
//       (evaluateStage1FilterTracked: price>0·tradable·관리종목·OVERHEAT·OVEREXTENDED 등)은 통과 필수.
//       → 보존은 "점수-랭크 컷 우회"이지 "품질 필터 우회"가 아니다(불변식 #7 — L4 매매 결정 금지와 정합).
//     - 신규 fetch 0: expandedUniverse 는 이미 cron 수집분(getExpandedUniverse). 신규 KIS/KRX/Yahoo 호출 0.
//     - flag OFF → universeScanner :388-390/:425-427 현행 byte-identical(보존 0, scanUniverse·top60 무변경).
//     - 관측 ledger: ADR-0614/0616 패턴(atomic write tmp→rename + rolling FIFO + 손상 JSON fallback + scanDateKey upsert).

import fs from 'fs';
import type { CandidateStock } from './pipelineHelpers.js';
import type { DynamicStock } from './dynamicUniverseExpander.js';
import {
  LEADER_UNIVERSE_INJECTION_LEDGER_FILE,
  ensureDataDir,
} from '../persistence/paths.js';

// ── 주도주 source 정의 (ADR-0617) ──────────────────────────────────────────────

/**
 * "주도주(leader)"로 간주하는 source 태그 — 외인·기관 순매수 + 시총 상위 대형주.
 * DynamicStock['source'] union 의 부분집합(두 번째 enum 신설 금지).
 *   - FOREIGN_NET_BUY : 외국인 순매수 상위(거래량 상위 근사 포함, expandOnEmpty 매핑)
 *   - INST_NET_BUY    : 기관 순매수 상위
 *   - MARKET_CAP      : 시총 상위 대형주
 * 제외: 52W_HIGH(가격 모멘텀·주도성과 직교)·MID_RISER·LARGE_VOLUME(수급 귀속 불명확)·
 *       SHORT_HEAVY(반대 신호 — 보존 절대 금지). 보존 확대는 후속 ADR(관측 후 결정).
 */
export const LEADER_SOURCES: ReadonlyArray<DynamicStock['source']> = [
  'FOREIGN_NET_BUY',
  'INST_NET_BUY',
  'MARKET_CAP',
] as const;

/** 주도주 source 판정 — undefined(full master 종목)·비주도 태그 → false. */
export function isLeaderSource(source: DynamicStock['source'] | undefined): boolean {
  return source !== undefined && (LEADER_SOURCES as readonly string[]).includes(source);
}

// ── ENV SSOT (ADR-0157 정확비교 default OFF) ───────────────────────────────────

/**
 * 주도주 Stage1 보존 활성화 SSOT. `LEADER_UNIVERSE_INJECTION_ENABLED === 'true'`.
 * default OFF — OFF 시 universeScanner scanUniverse 구성·top-N 컷 모두 현행 byte-identical.
 *   carry(source 태그 부여)도 OFF 시 미수행(undefined 유지 → 기존 CandidateStock 형태와 동일).
 */
export function isLeaderUniverseInjectionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.LEADER_UNIVERSE_INJECTION_ENABLED === 'true';
}

// ── (a) source carry — scanUniverse 구성 시 주도주 태그 부여 (HANDOFF) ───────────

/** scanUniverse 항목 — 기존 {symbol,code,name} 에 carry 용 source 추가(additive optional). */
export interface TaggedScanUniverseEntry {
  symbol: string;
  code: string;
  name: string;
  /** expandedUniverse 종목에만 부여. full master 전용 종목은 undefined(기존 동작 동치). */
  source?: DynamicStock['source'];
}

/**
 * expandedUniverse 의 code→source 맵 구성 (carry 의 단일 소스).
 *
 * getExpandedUniverse() 는 현재 source 를 노출하지 않으므로(symbol/code/name 만),
 * engine-dev 는 **dynamicUniverseExpander 에 source 보존 getter 를 additive 로 추가**하거나
 * (예: getExpandedUniverseTagged(): {symbol,code,name,source?}[]),
 * loadDynamicUniverse() 의 DynamicStock[] 를 직접 read 해 code→source Map 을 만든다.
 * 정적 STOCK_UNIVERSE 종목은 source 부재(undefined) — 주도주 태그 없음(기존 동작 보존).
 *
 * @internal engine-dev: getExpandedUniverse 시그니처를 깨지 않고 source 를 노출하는 방법 택1.
 *   (권장) dynamicUniverseExpander 에 getExpandedUniverseSourceMap(): Map<string, DynamicStock['source']>
 *   additive export 신설 → 기존 getExpandedUniverse 소비처 무파괴.
 */
export type LeaderSourceByCode = ReadonlyMap<string, DynamicStock['source']>;

/**
 * scanUniverse(krxFullMaster 또는 expanded) 항목에 주도주 source 를 carry.
 * flag OFF → source 전건 undefined(기존 {symbol,code,name} 동치). flag ON → expandedUniverse 종목만 태그.
 * @param baseUniverse universeScanner 가 결정한 scanUniverse(현행 :388-390 결과).
 * @param sourceByCode expandedUniverse code→source 맵(getExpandedUniverseSourceMap).
 * @param enabled flag (default 평가). false → carry 미수행(source undefined).
 * @internal engine-dev: 순수 map — 입력 순서 보존, code 미존재 시 undefined.
 */
export function carrySourceTags(
  baseUniverse: ReadonlyArray<{ symbol: string; code: string; name: string }>,
  sourceByCode: LeaderSourceByCode,
  enabled: boolean = isLeaderUniverseInjectionEnabled(),
): TaggedScanUniverseEntry[] {
  if (!enabled) {
    return baseUniverse.map((u) => ({ symbol: u.symbol, code: u.code, name: u.name }));
  }
  return baseUniverse.map((u) => ({
    symbol: u.symbol,
    code: u.code,
    name: u.name,
    source: sourceByCode.get(u.code),
  }));
}

// ── (b) 강제 보존 — top-N 점수컷에서 주도주 union (HANDOFF) ──────────────────────

/**
 * 강제 보존 메커니즘 = **설계 (a) "60컷 후 주도주 union(중복제거)"** 채택.
 *
 * 근거(설계 택1):
 *   (a) union  — top-N 컷 후 주도주를 합집합(이미 포함된 건 dedup). N 고정·주도주는 *추가*.
 *   (b) 예약 슬롯 — top-N 중 K 슬롯을 주도주에 예약. → 비주도 후보 K개를 *밀어냄*(품질 후보 손실).
 *   → (a) 채택. 이유: ① top-N 비주도 후보를 한 건도 희생하지 않음(Stage2 평가 풀 보존)
 *      ② 주도주는 "추가 유입"이라 의미가 명확(관측·롤백 단순) ③ Stage2(수급 confluence·RS)가
 *      주도주를 평가 — Stage1 은 후보 풀을 좁히지 않고 넓히기만 함. preservedCount 가 곧 union 증분.
 *
 * **품질 관문은 유지**: 입력 candidates 는 이미 evaluateStage1FilterTracked 통과분(price>0·tradable·
 *   관리종목·OVERHEAT·OVEREXTENDED 면제 아님). 즉 +9% 과열 주도주는 OVERHEAT 에서 *이미 탈락* —
 *   본 함수에 도달하지 않음. 본 함수는 **점수-랭크 컷만** 우회(품질 필터 우회 0, 불변식 #7 정합).
 *   → carry 된 source 태그는 candidate 가 Stage1 필터를 통과해 candidates 에 들어온 종목에만 존재.
 *
 * 알고리즘:
 *   topN = candidates.sort(desc stage1Score).slice(0, limit)         // 현행 :425-427 과 동일
 *   leadersInPool = candidates.filter(c => isLeaderSource(c.source))  // 풀 내 주도주 전체(점수 무관)
 *   preserved = leadersInPool.filter(c => !topN.has(c.code))          // 컷 밖 주도주(보존 대상)
 *   result = [...topN, ...preserved]                                  // union(중복제거)
 *
 * flag OFF → preserved 0 → result === topN(byte-identical, 현행 :425-427 동치).
 * @param candidates Stage1 필터 통과 후보(source carry 됨, flag ON 시).
 * @param limit 현행 top-N(60).
 * @param enabled flag. false → 보존 0(현행 slice 동치).
 * @param topNComparator (ADR-0622 ③, 직교 layer) top-N 컷 정렬 비교자 주입(optional).
 *   미지정 → stage1Score desc 단독(현행 byte-identical). ADR-0622 ③ flag ON 시 universeScanner 가
 *   rsPriorityComparator 주입(positive-RS 우선·laggard 디모트). 주도주 union 보존(0617)과 직교 —
 *   비교자는 컷 순서만 바꾸고, union 보존은 컷 후 별도 append 로 그대로 유지.
 * @returns {result, observation} — result=주도주 union 후보, observation=관측 stamp(append 는 호출자).
 * @internal engine-dev: dedup 은 code 기준·topN 우선(점수순) → preserved 는 그 뒤 append.
 *   stage1Score 정렬은 현행과 동일 비교자 재사용(두 번째 정렬식 신설 금지·ADR-0622 ③ 는 주입식 직교).
 */
export function applyLeaderPreservation(
  candidates: readonly CandidateStock[],
  limit: number,
  now: Date = new Date(),
  enabled: boolean = isLeaderUniverseInjectionEnabled(),
  topNComparator?: (a: CandidateStock, b: CandidateStock) => number,
): { result: CandidateStock[]; observation: LeaderUniverseInjectionObservation } {
  // ── top-N 컷 정렬 비교자 — 미주입 시 현행 stage1Score desc(byte-identical) ──
  //   ADR-0622 ③: flag ON 시 universeScanner 가 rsPriorityComparator 주입(직교 layer, union 보존 무영향).
  const comparator = topNComparator ?? ((a: CandidateStock, b: CandidateStock) => b.stage1Score - a.stage1Score);
  const sorted = [...candidates].sort(comparator);
  const topN = sorted.slice(0, limit);

  if (!enabled) {
    // flag OFF → 현행 동작 그대로. observation 은 "보존 안 했을 때 드롭됐을 수" 산출용으로만 채움.
    const observation = computeLeaderUniverseInjectionObservation(candidates, topN, [], now);
    return { result: topN, observation };
  }

  // ── 주도주 강제 보존(union) ──
  const topNCodes = new Set(topN.map((c) => c.code));
  const leadersInPool = candidates.filter((c) => isLeaderSource(c.source));
  const preserved = leadersInPool.filter((c) => !topNCodes.has(c.code));
  const result = [...topN, ...preserved];
  const observation = computeLeaderUniverseInjectionObservation(candidates, topN, preserved, now);
  return { result, observation };
}

// ── 관측 타입 (ADR-0617) ────────────────────────────────────────────────────────

export type LeaderSourceTag = (typeof LEADER_SOURCES)[number];

/** source 태그별 분포 (주도주 union/보존 카운트). */
export interface LeaderSourceDistribution {
  FOREIGN_NET_BUY: number;
  INST_NET_BUY: number;
  MARKET_CAP: number;
}

/**
 * per-scan 주도주 보존 관측 (per-candidate stamp 아님 — 스캔당 1 summary).
 *
 * - leadersInPool: Stage1 통과 후보 중 주도주 source 보유 수(점수 무관, 풀 내 전체).
 * - preservedCount: top-N 컷 밖이라 보존(union)된 주도주 수 = "보존 안 했으면 드롭됐을 수".
 * - droppedIfNotPreservedCount: preservedCount 와 동일(flag OFF/ON 무관 — 관측 일관).
 * - sourceDist*: 태그별 분포(운영자가 어떤 수급 채널이 컷 밖으로 밀렸는지 관측).
 */
export interface LeaderUniverseInjectionObservation {
  scanDateKey: string;           // 'YYYY-MM-DD' KST
  enabled: boolean;              // flag 상태(관측 시점)
  topNLimit: number;             // 적용된 top-N(60)
  totalCandidates: number;       // Stage1 통과 후보 총수
  topNCount: number;             // top-N 컷 통과 수(=min(total, limit))

  leadersInPoolCount: number;    // 풀 내 주도주 총수(점수 무관)
  leadersInTopNCount: number;    // 이미 top-N 안에 든 주도주 수(보존 불요)
  preservedCount: number;        // 컷 밖 → union 보존된 주도주 수(=드롭됐을 수)

  /** 풀 내 주도주 source 분포. */
  leadersInPoolDist: LeaderSourceDistribution;
  /** 보존(union)된 주도주 source 분포. */
  preservedDist: LeaderSourceDistribution;

  executionImpact: 'NONE' | 'EXECUTION_ADJACENT'; // OFF=NONE / ON=adjacent(유니버스 변경)
  observationOnly: boolean;      // OFF=true(보존 0) / ON=false(실제 후보 풀 변경)
}

/** ledger 1행 = per-scan observation. */
export type LeaderUniverseInjectionLedgerRow = LeaderUniverseInjectionObservation & {
  appendedAt: string;            // ISO
};

// ── KST 거래일 (ADR-0614/0616 todayKst 동일 정의) ──────────────────────────────

/** @internal engine-dev: ADR-0614/0616 todayKst 와 byte-동일 정의 — drift 테스트 고정. */
export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

// ── 순수 산출 (HANDOFF) ─────────────────────────────────────────────────────────

const EMPTY_SOURCE_DIST = (): LeaderSourceDistribution => ({
  FOREIGN_NET_BUY: 0,
  INST_NET_BUY: 0,
  MARKET_CAP: 0,
});

function tallySourceDist(rows: readonly CandidateStock[]): LeaderSourceDistribution {
  const dist = EMPTY_SOURCE_DIST();
  for (const c of rows) {
    const s = c.source;
    if (s === 'FOREIGN_NET_BUY') dist.FOREIGN_NET_BUY += 1;
    else if (s === 'INST_NET_BUY') dist.INST_NET_BUY += 1;
    else if (s === 'MARKET_CAP') dist.MARKET_CAP += 1;
  }
  return dist;
}

/**
 * 후보 집합 + top-N + 보존분 → per-scan 관측 순수 산출 (provider/fetch 0).
 *
 * executionImpact/observationOnly 는 preserved 유무로 결정:
 *   preserved.length === 0 → NONE/true(보존 0 — flag OFF 또는 ON 인데 컷 밖 주도주 0).
 *   preserved.length  >  0 → EXECUTION_ADJACENT/false(후보 풀 실제 변경, LIVE 시 실매수 대상 변동).
 *
 * @param candidates Stage1 통과 후보(source carry 됨).
 * @param topN 점수컷 통과분(현행 slice).
 * @param preserved union 보존된 주도주(flag OFF → []).
 * @param now 주입(scanDateKey 결정성).
 * @internal engine-dev: leadersInPool/preserved 분포·preservedCount=드롭됐을 수 테스트 고정.
 */
export function computeLeaderUniverseInjectionObservation(
  candidates: readonly CandidateStock[],
  topN: readonly CandidateStock[],
  preserved: readonly CandidateStock[],
  now: Date = new Date(),
  topNLimit?: number,
  enabled: boolean = isLeaderUniverseInjectionEnabled(),
): LeaderUniverseInjectionObservation {
  const leadersInPool = candidates.filter((c) => isLeaderSource(c.source));
  const topNCodes = new Set(topN.map((c) => c.code));
  const leadersInTopN = leadersInPool.filter((c) => topNCodes.has(c.code));

  return {
    scanDateKey: todayKst(now),
    enabled,
    topNLimit: topNLimit ?? topN.length,
    totalCandidates: candidates.length,
    topNCount: topN.length,
    leadersInPoolCount: leadersInPool.length,
    leadersInTopNCount: leadersInTopN.length,
    preservedCount: preserved.length,
    leadersInPoolDist: tallySourceDist(leadersInPool),
    preservedDist: tallySourceDist(preserved),
    executionImpact: preserved.length > 0 ? 'EXECUTION_ADJACENT' : 'NONE',
    observationOnly: preserved.length === 0,
  };
}

// ── 영속 I/O (ADR-0614/0616 패턴: atomic write + FIFO 캡 + 손상 JSON fallback) ────

/** per-scan summary 보관 거래일(스캔) 수 (rolling FIFO). */
export const LEADER_UNIVERSE_INJECTION_WINDOW_SCANS = 60 as const;

function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidLedgerRow(row: unknown): row is LeaderUniverseInjectionLedgerRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return isValidDateKey(r.scanDateKey)
    && typeof r.totalCandidates === 'number'
    && typeof r.appendedAt === 'string';
}

function loadAll(filePath = LEADER_UNIVERSE_INJECTION_LEDGER_FILE): LeaderUniverseInjectionLedgerRow[] {
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
  rows: LeaderUniverseInjectionLedgerRow[],
  filePath = LEADER_UNIVERSE_INJECTION_LEDGER_FILE,
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
 * 신규 fetch 0(입력은 이미 fetch 된 후보 + 로컬 산출). 호출자(universeScanner)가 flag·try/catch 격리.
 * @internal engine-dev: atomic rename·손상 fallback·FIFO 캡·scanDateKey upsert 테스트 고정.
 */
export function appendLeaderUniverseInjectionObservation(
  observation: LeaderUniverseInjectionObservation,
  now: Date = new Date(),
  filePath: string = LEADER_UNIVERSE_INJECTION_LEDGER_FILE,
): LeaderUniverseInjectionLedgerRow {
  const row: LeaderUniverseInjectionLedgerRow = {
    ...observation,
    appendedAt: now.toISOString(),
  };
  const rows = loadAll(filePath);
  const byDate = new Map<string, LeaderUniverseInjectionLedgerRow>();
  for (const existing of rows) byDate.set(existing.scanDateKey, existing);
  byDate.set(row.scanDateKey, row);
  const merged = [...byDate.values()].sort((a, b) => a.scanDateKey.localeCompare(b.scanDateKey));
  const trimmed = merged.slice(Math.max(0, merged.length - LEADER_UNIVERSE_INJECTION_WINDOW_SCANS));
  saveAll(trimmed, filePath);
  return row;
}

/** ledger 전체 조회(추세 분석). 손상 fallback → []. */
export function loadLeaderUniverseInjectionLedger(
  filePath: string = LEADER_UNIVERSE_INJECTION_LEDGER_FILE,
): LeaderUniverseInjectionLedgerRow[] {
  return loadAll(filePath);
}

/** 테스트 전용 — ledger 파일 초기화. */
export function __resetLeaderUniverseInjectionLedgerForTests(
  filePath: string = LEADER_UNIVERSE_INJECTION_LEDGER_FILE,
): void {
  try { fs.unlinkSync(filePath); } catch { /* SDS-ignore: 미존재 파일 idempotent */ }
}
