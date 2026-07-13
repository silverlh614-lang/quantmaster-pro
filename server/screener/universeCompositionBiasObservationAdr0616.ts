// @responsibility ADR-0616 유니버스 구성 편향 관측 — 후보의 KOSPI/KOSDAQ 비중·leader/laggard(RS)·시총 tier 를 per-scan aggregate 산출·기록. 순수(fetch 0), default OFF, 미배선.
//
// ⚠ ARCHITECT SCAFFOLD (Phase 0) — 본 파일은 타입 계약 + 시그니처 + 산출식 명세만 담는다.
//   실제 구현(본문 채우기·회귀 테스트)은 engine-dev 인계. 현재는 경계·타입 확정용 스텁이다.
//   single 통로:
//     - market 분류: getStockByCode(로컬 KRX 마스터)만. KIS/KRX/Yahoo 신규 호출 0.
//     - RS: 기존 trace 필드(candidate.quote.return20d) − benchmark(macroState.kospi20dReturn).
//           **두 번째 RS 공식 신설 금지** — calcStage1Score UNIVERSE_RS_GATE 와 동일 정의(단위: 둘 다 %).
//     - 시총: getStockByCode(code).listedShares × candidate.quote.price. listedShares 결손 시 null/제외(가짜 시총 금지).

import fs from 'fs';
import type { CandidateStock } from './pipelineHelpers.js';
import type { StockMasterEntry } from '../persistence/krxStockMasterRepo.js';
import { getStockByCode as defaultGetStockByCode } from '../persistence/krxStockMasterRepo.js';
import {
  UNIVERSE_COMPOSITION_BIAS_LEDGER_FILE,
  ensureDataDir,
} from '../persistence/paths.js';

// ── 정책 상수 (ADR-0616) ───────────────────────────────────────────────────────

/**
 * leader/laggard 경계 = RS 0 기준 (벤치마크 정확히 이긴 종목과 못 이긴 종목 분리).
 *   RS = candidate.quote.return20d − benchmarkReturn20d (둘 다 %, 동일 단위 직접 차감).
 *   RS >= 0 → leader (시장 이상), RS < 0 → laggard (시장 미만). 0 은 leader 에 귀속(>=).
 * (calcStage1Score UNIVERSE_RS_GATE 0-floor 와 동일 RS 정의 — 두 번째 공식 0.)
 */
export const UNIVERSE_RS_LEADER_THRESHOLD = 0 as const;

/**
 * 시총 tier 경계 (원). marketCap = listedShares × price.
 *   LARGE  : marketCap >= 3조
 *   MID    : 1조 <= marketCap < 3조
 *   SMALL  : marketCap < 1조
 * listedShares 결손/비유한 또는 price<=0 → tier 산출 불가 → 해당 종목 제외(null, 가짜 시총 금지, 불변식 #6).
 * 후보 전원 산출 불가 시 marketCapTierDist 전체 null(SKIP).
 */
export const UNIVERSE_MARKET_CAP_TIER_LARGE_KRW = 3_000_000_000_000 as const; // 3조
export const UNIVERSE_MARKET_CAP_TIER_MID_KRW = 1_000_000_000_000 as const;   // 1조

/** topLaggard 예시 표시용 — RS 최하위 N 종목코드. */
export const UNIVERSE_TOP_LAGGARD_SAMPLE_N = 5 as const;

/** per-stock ledger 캡과 동형 — per-scan summary 보관 거래일(스캔) 수 (rolling FIFO). */
export const UNIVERSE_COMPOSITION_BIAS_WINDOW_SCANS = 60 as const;

// ── 타입 (HANDOFF (a)) ─────────────────────────────────────────────────────────

export type UniverseMarketCapTier = 'LARGE' | 'MID' | 'SMALL';

/** 시총 tier 분포 — 전 후보 산출 불가 시 상위에서 null 로 SKIP. */
interface UniverseMarketCapTierDistribution {
  largeCount: number;
  midCount: number;
  smallCount: number;
  /** tier 산출 가능했던 후보 수 (listedShares 보유 + price>0). */
  computedCount: number;
  /** listedShares 결손/price<=0 으로 제외된 후보 수 (가짜 시총 미산출). */
  skippedCount: number;
}

/** RS 최하위 예시 1건 (진단 표시용). */
interface UniverseTopLaggardSample {
  code: string;
  rs: number; // candidate.quote.return20d − benchmark (%)
}

/**
 * per-scan aggregate 유니버스 구성 편향 관측 (per-candidate stamp 아님 — 스캔당 1 summary).
 *
 * - 시장 구성: KOSPI/KOSDAQ/기타(KONEX/OTHER/마스터 미매칭) 후보 수.
 * - leader/laggard: RS>=0 vs RS<0 카운트 + RS avg/median (RS 산출 가능한 후보 한정).
 * - 시총 tier: 가능 시 분포, 전원 불가 시 null(SKIP).
 * - topLaggardCodes: RS 최하위 N 예시.
 */
export interface UniverseCompositionBiasObservation {
  scanDateKey: string;          // 'YYYY-MM-DD' KST (now 주입 → todayKst)
  totalCandidates: number;

  // ── 시장 구성 ──
  kospiCount: number;
  kosdaqCount: number;
  otherCount: number;           // KONEX/OTHER + getStockByCode null(마스터 미매칭)

  // ── leader/laggard (RS 산출 가능 후보 한정) ──
  rsComputedCount: number;      // benchmark 유한 && quote.return20d 유한 인 후보 수
  leaderCount: number;          // rs >= UNIVERSE_RS_LEADER_THRESHOLD
  laggardCount: number;         // rs < UNIVERSE_RS_LEADER_THRESHOLD
  rsAvg: number | null;         // rsComputedCount 0 → null (결손≠0)
  rsMedian: number | null;      // rsComputedCount 0 → null
  benchmarkReturn20d: number | null; // macroState.kospi20dReturn (null=벤치마크 부재 → RS 전건 skip)

  // ── 시총 tier (전원 불가 시 null = SKIP) ──
  marketCapTierDist: UniverseMarketCapTierDistribution | null;

  // ── 진단 예시 ──
  topLaggardCodes: UniverseTopLaggardSample[];

  executionImpact: 'NONE';      // literal 강제 (관측 전용)
  observationOnly: true;        // literal 강제
}

/** ledger 1행 = per-scan observation (per-stock 아님). */
export type UniverseCompositionBiasLedgerRow = UniverseCompositionBiasObservation & {
  appendedAt: string;           // ISO
};

// ── ENV SSOT (ADR-0157 정확비교 default OFF) ───────────────────────────────────

/**
 * 관측 전용 유니버스 구성 편향 활성화 SSOT. `UNIVERSE_COMPOSITION_BIAS_OBSERVATION_ENABLED === 'true'`.
 * default OFF — OFF 시 universeScanner 가 산출·append 진입 자체 skip(byte-identical).
 */
export function isUniverseCompositionBiasObservationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.UNIVERSE_COMPOSITION_BIAS_OBSERVATION_ENABLED === 'true';
}

// ── KST 거래일 (ADR-0614 todayKst 와 동일 정의) ────────────────────────────────

/** @internal engine-dev: ADR-0614 todayKst 와 byte-동일 정의 — drift 테스트 고정. */
export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

// ── 시총 tier 분류 (순수, HANDOFF (b)) ─────────────────────────────────────────

/**
 * marketCap(원) → tier. **호출자가 listedShares·price 유효성 검증 후** marketCap>0 만 전달.
 *   marketCap >= 3조 → LARGE / 1조 이상 → MID / 그 외 → SMALL.
 * @internal engine-dev: 경계값(정확히 1조/3조) LARGE/MID 귀속 테스트 고정(>= 채택).
 */
export function classifyMarketCapTier(marketCapKrw: number): UniverseMarketCapTier {
  if (marketCapKrw >= UNIVERSE_MARKET_CAP_TIER_LARGE_KRW) return 'LARGE';
  if (marketCapKrw >= UNIVERSE_MARKET_CAP_TIER_MID_KRW) return 'MID';
  return 'SMALL';
}

// ── 순수 산출 (HANDOFF (b)) ─────────────────────────────────────────────────────

/** market 조회 주입 시그니처 — 테스트에서 fake 마스터 주입(결정성). default=로컬 KRX 마스터(fetch-0). */
export type GetStockByCodeFn = (code: string) => StockMasterEntry | null;

/**
 * 후보 집합 → per-scan 유니버스 구성 편향 관측 순수 산출 (provider/fetch 0).
 *
 * 알고리즘 (HANDOFF (b)):
 *   (시장) 각 후보 getStockByCode(c.code).market → KOSPI/KOSDAQ/기타 카운트.
 *          null(마스터 미매칭) 또는 KONEX/OTHER → otherCount.
 *   (RS)   benchmarkReturn20d 유한 && c.quote.return20d 유한 → rs = quote.return20d − benchmark.
 *          rs>=0 leader, rs<0 laggard. rsAvg/Median 은 rsComputed 한정(0건→null).
 *          벤치마크 null → RS 전건 skip(rsComputedCount=0, avg/median null) — 결손≠0(불변식 #6).
 *   (시총) listedShares 유한>0 && price>0 → marketCap=listedShares×price → classifyMarketCapTier.
 *          결손 종목은 skippedCount 만 증가(가짜 시총 0). computedCount 0(전원 불가) → marketCapTierDist=null(SKIP).
 *   (예시) RS 산출 가능 후보를 rs 오름차순 → 하위 UNIVERSE_TOP_LAGGARD_SAMPLE_N 코드.
 *
 * @param candidates 스캔 후보 배열 (Stage3 진입 시점).
 * @param benchmarkReturn20d macroState.kospi20dReturn (%, null 가능 — 부재 시 RS skip).
 * @param now      주입 가능(default new Date()) — scanDateKey 결정성.
 * @param getStockByCode 주입 가능(default 로컬 마스터) — 테스트 결정성.
 * @returns 항상 observation 반환(후보 0건이어도 totalCandidates:0). 호출자가 append 여부 판단.
 * @internal engine-dev: 벤치마크 null·listedShares 전결손·return20d 비유한·후보 0건 graceful 테스트 고정.
 */
export function computeUniverseCompositionBiasObservation(
  candidates: readonly CandidateStock[],
  benchmarkReturn20d: number | null | undefined,
  now: Date = new Date(),
  getStockByCode: GetStockByCodeFn = defaultGetStockByCode,
): UniverseCompositionBiasObservation {
  const benchmark =
    typeof benchmarkReturn20d === 'number' && Number.isFinite(benchmarkReturn20d)
      ? benchmarkReturn20d
      : null;

  let kospiCount = 0;
  let kosdaqCount = 0;
  let otherCount = 0;

  const rsValues: number[] = [];
  let leaderCount = 0;
  let laggardCount = 0;
  const laggardSamples: UniverseTopLaggardSample[] = [];

  let largeCount = 0;
  let midCount = 0;
  let smallCount = 0;
  let tierComputedCount = 0;
  let tierSkippedCount = 0;

  for (const c of candidates) {
    const master = getStockByCode(c.code);

    // ── 시장 구성 ── (로컬 마스터 read, fetch 0). null/KONEX/OTHER → otherCount.
    const market = master?.market ?? null;
    if (market === 'KOSPI') kospiCount += 1;
    else if (market === 'KOSDAQ') kosdaqCount += 1;
    else otherCount += 1;

    // ── RS = quote.return20d − benchmark (둘 다 %, calcStage1Score UNIVERSE_RS_GATE 와 동일 정의) ──
    //   benchmark null → 전건 skip(결손≠0, 불변식 #6). quote.return20d 비유한 → 해당 후보 skip.
    const r20d = c.quote?.return20d;
    if (benchmark !== null && typeof r20d === 'number' && Number.isFinite(r20d)) {
      const rs = r20d - benchmark;
      rsValues.push(rs);
      if (rs >= UNIVERSE_RS_LEADER_THRESHOLD) leaderCount += 1;
      else laggardCount += 1;
      laggardSamples.push({ code: c.code, rs });
    }

    // ── 시총 tier = listedShares × price ── listedShares 결손/비유한·≤0 또는 price≤0 → skip(가짜 시총 0, 불변식 #6).
    const listedShares = master?.listedShares;
    const price = c.quote?.price;
    if (
      typeof listedShares === 'number' && Number.isFinite(listedShares) && listedShares > 0 &&
      typeof price === 'number' && Number.isFinite(price) && price > 0
    ) {
      const marketCap = listedShares * price;
      const tier = classifyMarketCapTier(marketCap);
      if (tier === 'LARGE') largeCount += 1;
      else if (tier === 'MID') midCount += 1;
      else smallCount += 1;
      tierComputedCount += 1;
    } else {
      tierSkippedCount += 1;
    }
  }

  const rsComputedCount = rsValues.length;
  const rsAvg = rsComputedCount > 0
    ? rsValues.reduce((sum, v) => sum + v, 0) / rsComputedCount
    : null;
  const rsMedian = rsComputedCount > 0 ? median(rsValues) : null;

  // RS 오름차순 → 하위 N (최약 laggard). 동률은 안정성 위해 code 보조 정렬.
  const topLaggardCodes = [...laggardSamples]
    .sort((a, b) => (a.rs - b.rs) || a.code.localeCompare(b.code))
    .slice(0, UNIVERSE_TOP_LAGGARD_SAMPLE_N);

  // 전원 산출 불가(computedCount 0) → marketCapTierDist=null(SKIP, 결손≠0). 후보 0건도 null.
  const marketCapTierDist: UniverseMarketCapTierDistribution | null =
    tierComputedCount > 0
      ? {
          largeCount,
          midCount,
          smallCount,
          computedCount: tierComputedCount,
          skippedCount: tierSkippedCount,
        }
      : null;

  return {
    scanDateKey: todayKst(now),
    totalCandidates: candidates.length,
    kospiCount,
    kosdaqCount,
    otherCount,
    rsComputedCount,
    leaderCount,
    laggardCount,
    rsAvg,
    rsMedian,
    benchmarkReturn20d: benchmark,
    marketCapTierDist,
    topLaggardCodes,
    executionImpact: 'NONE',
    observationOnly: true,
  };
}

/** 중앙값 — 짝수 길이는 중앙 2값 평균. 빈 배열은 호출자가 사전 차단(0건→null). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ── 영속 I/O (ADR-0614 패턴: atomic write + FIFO 캡 + 손상 JSON fallback) ───────

/**
 * per-scan observation append (단일 배열 ledger, rolling FIFO UNIVERSE_COMPOSITION_BIAS_WINDOW_SCANS).
 *
 * - ADR-0614 saveAll 패턴: tmp write → rename(atomic), 실패 시 tmp cleanup best-effort.
 * - 손상 JSON → 빈 배열 fallback(시스템 무중단).
 * - 동일 scanDateKey 재스캔 시 last-write-wins upsert(장중 재실행 안전).
 * - 신규 fetch 0(입력은 이미 fetch 된 후보 + 로컬 마스터 read).
 *
 * @internal engine-dev: atomic rename·손상 fallback·FIFO 캡·scanDateKey upsert 테스트 고정.
 */
function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 손상/이질 row 방어 — 최소 식별 필드(scanDateKey)만 검증. 산출 필드 결손은 영속 그대로 신뢰. */
function isValidLedgerRow(row: unknown): row is UniverseCompositionBiasLedgerRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return isValidDateKey(r.scanDateKey)
    && typeof r.totalCandidates === 'number'
    && typeof r.appendedAt === 'string';
}

function loadAll(filePath = UNIVERSE_COMPOSITION_BIAS_LEDGER_FILE): UniverseCompositionBiasLedgerRow[] {
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
  rows: UniverseCompositionBiasLedgerRow[],
  filePath = UNIVERSE_COMPOSITION_BIAS_LEDGER_FILE,
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

export function appendUniverseCompositionBiasObservation(
  observation: UniverseCompositionBiasObservation,
  now: Date = new Date(),
  filePath: string = UNIVERSE_COMPOSITION_BIAS_LEDGER_FILE,
): UniverseCompositionBiasLedgerRow {
  const row: UniverseCompositionBiasLedgerRow = {
    ...observation,
    appendedAt: now.toISOString(),
  };
  const rows = loadAll(filePath);
  // scanDateKey upsert (last-write-wins) — 장중 재스캔/재시작 안전. byDate Map 패턴(ADR-0614 동형).
  const byDate = new Map<string, UniverseCompositionBiasLedgerRow>();
  for (const existing of rows) byDate.set(existing.scanDateKey, existing);
  byDate.set(row.scanDateKey, row);
  const merged = [...byDate.values()].sort((a, b) => a.scanDateKey.localeCompare(b.scanDateKey));
  // rolling FIFO — 가장 오래된 scanDateKey 부터 캡 초과분 제거.
  const trimmed = merged.slice(Math.max(0, merged.length - UNIVERSE_COMPOSITION_BIAS_WINDOW_SCANS));
  saveAll(trimmed, filePath);
  return row;
}

/** ledger 전체 조회(추세 분석). 손상 fallback → []. */
export function loadUniverseCompositionBiasLedger(
  filePath: string = UNIVERSE_COMPOSITION_BIAS_LEDGER_FILE,
): UniverseCompositionBiasLedgerRow[] {
  return loadAll(filePath);
}

/** 테스트 전용 — ledger 파일 초기화. */
export function __resetUniverseCompositionBiasLedgerForTests(
  filePath: string = UNIVERSE_COMPOSITION_BIAS_LEDGER_FILE,
): void {
  try { fs.unlinkSync(filePath); } catch { /* SDS-ignore: 미존재 파일 idempotent */ }
}
