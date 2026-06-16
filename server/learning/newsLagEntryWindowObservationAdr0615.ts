// @responsibility ADR-0615 뉴스시차 진입윈도우 관측 — 활성 newsSupply record × newsLag posterior 를 sector 조인해 PRE/IN/PAST 분류. 순수 산출(신규 fetch 0), default OFF, Gate/주문 미배선.
//
// ⚠ ARCHITECT SCAFFOLD (Phase 0) — 본 파일은 타입 계약 + 시그니처 + 산출식 명세만 담는다.
//   실제 구현(본문 채우기·회귀 테스트)은 engine-dev 인계. 현재는 경계·타입 확정용 스텁이다.
//   single 통로: newsLag/newsSupply 는 기존 export(loadNewsSupplyRecords·getOptimalEntryWindow)만 경유.

import {
  loadNewsSupplyRecords,
  type NewsSupplyRecord,
} from './newsSupplyLogger.js';
import { getOptimalEntryWindow } from './newsLagBayesian.js';

// ── 정책 상수 (ADR-0615) ───────────────────────────────────────────────────────

/**
 * 분류 임계 = `getOptimalEntryWindow` 가 이미 노출하는 ci95(μ±1.96σ, n≥3) 사용.
 * (μ±σ 대신 ci95 채택 — bayesian posterior 의 정직한 불확실성 구간이고, 추가 산식·재노출 0.
 *  newsLagBayesian.ts:209-210 가 ci95LowDays/ci95HighDays 를 이미 export 하므로 SSOT 단일.)
 */
export const NEWS_LAG_ENTRY_WINDOW_CLASSIFIER = 'CI95' as const;

// ── 타입 (HANDOFF (a)) ─────────────────────────────────────────────────────────

/** 진입 윈도우 분류 — 경과 영업일(elapsed) vs posterior ci95 구간 비교. */
export type NewsLagWindowStatus = 'PRE' | 'IN' | 'PAST';

/** 활성 record 1건에 대한 진입 윈도우 매칭 결과 (관측 전용). */
export interface NewsLagMatchedRecord {
  newsType: string;            // record.newsType (sector 동일 조인 키)
  detectedAt: string;          // record.detectedAt (ISO) — 경과 기준점
  elapsedDays: number;         // businessDaysElapsed(detectedAt, now) — 결정성 위해 now 주입
  meanLagDays: number;         // posterior μ (getOptimalEntryWindow.meanLagDays)
  ci95LowDays: number;         // posterior ci95 하한 (분류 경계)
  ci95HighDays: number;        // posterior ci95 상한 (분류 경계)
  sampleSize: number;          // posterior effectiveN (n≥3 보장 — n<3 record 는 매칭에서 제외)
  windowStatus: NewsLagWindowStatus;
}

/** 후보 stamp 형태 — CandidateStock.newsLagEntryWindow? 에 부착(additive optional). */
export interface NewsLagEntryWindowObservation {
  sector: string;                       // candidate.sector (조인 키)
  matchedRecords: NewsLagMatchedRecord[]; // sector 일치 + 미완료 + posterior n≥3 인 record 만
  /** 우선순위: IN > PRE > PAST > null(매칭 0). 운영자 가시화·후속 승격 입력. */
  bestStatus: NewsLagWindowStatus | null;
  executionImpact: 'NONE';              // literal 강제 (관측 전용)
  observationOnly: true;                // literal 강제
}

// ── ENV SSOT (ADR-0157 정확비교 default OFF) ───────────────────────────────────

/**
 * 관측 전용 진입 윈도우 stamp 활성화 SSOT. `NEWS_LAG_ENTRY_WINDOW_OBSERVATION_ENABLED === 'true'`.
 * default OFF — OFF 시 호출자가 no-op(byte-equivalent). 영속 read 만 추가되므로 opt-in.
 */
export function isNewsLagEntryWindowObservationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NEWS_LAG_ENTRY_WINDOW_OBSERVATION_ENABLED === 'true';
}

// ── 영업일 계산 (newsSupplyLogger businessDaysElapsed 와 동일 정의 — 그쪽은 private) ──

/**
 * from → to 사이 영업일 수(주말 제외). newsSupplyLogger.ts:69-81 와 byte-동일 정의.
 * (그 함수는 module-private export 0 — 본 모듈은 동일 알고리즘을 복제, 정의 drift 금지.)
 * @internal engine-dev: 회귀 테스트로 newsSupplyLogger 정의와 1:1 고정.
 */
export function businessDaysElapsed(from: Date, to: Date): number {
  let count = 0;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

// ── 순수 산출 (HANDOFF (b)) ─────────────────────────────────────────────────────

/**
 * elapsed vs posterior ci95 구간 → 분류.
 *   elapsed < ci95Low            → 'PRE'   (반응 시작 전 — 선제 관심)
 *   ci95Low ≤ elapsed ≤ ci95High → 'IN'    (반응 윈도우 내부 — 핵심 관측)
 *   elapsed > ci95High           → 'PAST'  (반응 윈도우 경과)
 */
export function classifyWindowStatus(
  elapsedDays: number,
  ci95LowDays: number,
  ci95HighDays: number,
): NewsLagWindowStatus {
  if (elapsedDays < ci95LowDays) return 'PRE';
  if (elapsedDays > ci95HighDays) return 'PAST';
  return 'IN';
}

/** bestStatus 우선순위: IN > PRE > PAST > null. */
export function pickBestStatus(
  records: readonly NewsLagMatchedRecord[],
): NewsLagWindowStatus | null {
  if (records.some((r) => r.windowStatus === 'IN')) return 'IN';
  if (records.some((r) => r.windowStatus === 'PRE')) return 'PRE';
  if (records.some((r) => r.windowStatus === 'PAST')) return 'PAST';
  return null;
}

/**
 * 단일 후보 sector 에 대한 진입 윈도우 관측 산출 (순수, now 주입 — 테스트 결정성).
 *
 * 알고리즘 (HANDOFF (b)):
 *   (a) records 중 `r.sector === sector && !r.isComplete` 활성 record 선별.
 *   (b) 각 record 에 `getOptimalEntryWindow(r.newsType, sector)` 조회.
 *       n<3 → posterior null → **graceful skip**(매칭 제외, 불변식 #6 결손≠신호).
 *   (c) elapsed = businessDaysElapsed(r.detectedAt, now), classifyWindowStatus 로 PRE/IN/PAST.
 *
 * @param records 호출자가 1회 loadNewsSupplyRecords() 한 결과를 주입(스캔 루프 N+1 read 회피).
 * @param now     주입 가능(default new Date()) — 테스트 결정성.
 * @returns 매칭 0건이어도 observation 반환(matchedRecords:[], bestStatus:null) — 호출자가 stamp 여부 판단.
 *
 * @internal engine-dev: posterior null·detectedAt 파싱 실패·빈 records graceful 처리 테스트 고정.
 */
export function computeNewsLagEntryWindowObservation(
  sector: string,
  records: readonly NewsSupplyRecord[],
  now: Date = new Date(),
): NewsLagEntryWindowObservation {
  const matchedRecords: NewsLagMatchedRecord[] = [];
  for (const r of records) {
    if (r.sector !== sector || r.isComplete) continue;
    const posterior = getOptimalEntryWindow(r.newsType, sector); // single 통로, n<3→null
    if (!posterior) continue; // graceful skip — 표본 부족(불변식 #6)
    const detected = new Date(r.detectedAt);
    if (Number.isNaN(detected.getTime())) continue; // 손상 detectedAt → skip(결손≠신호)
    const elapsedDays = businessDaysElapsed(detected, now);
    matchedRecords.push({
      newsType: r.newsType,
      detectedAt: r.detectedAt,
      elapsedDays,
      meanLagDays: posterior.meanLagDays,
      ci95LowDays: posterior.ci95LowDays,
      ci95HighDays: posterior.ci95HighDays,
      sampleSize: posterior.sampleSize,
      windowStatus: classifyWindowStatus(
        elapsedDays,
        posterior.ci95LowDays,
        posterior.ci95HighDays,
      ),
    });
  }
  return {
    sector,
    matchedRecords,
    bestStatus: pickBestStatus(matchedRecords),
    executionImpact: 'NONE',
    observationOnly: true,
  };
}

/**
 * 스캔 후보 배열 → sector 별 1회 산출 캐시 사용(동일 sector 중복 산출 회피).
 * records 는 호출자가 1회 loadNewsSupplyRecords() 주입(스캔당 영속 read 1회 — fetch 0).
 *
 * @returns sector → observation Map. 후보 stamp 시 candidate.sector 로 lookup.
 * @internal engine-dev: universeScanner Stage3 루프 진입 전 1회 호출 → 루프 내 Map lookup.
 */
export function computeNewsLagEntryWindowBySector(
  sectors: readonly string[],
  records: readonly NewsSupplyRecord[],
  now: Date = new Date(),
): Map<string, NewsLagEntryWindowObservation> {
  const out = new Map<string, NewsLagEntryWindowObservation>();
  for (const sector of new Set(sectors)) {
    out.set(sector, computeNewsLagEntryWindowObservation(sector, records, now));
  }
  return out;
}

/** records 1회 로드 헬퍼 — single 통로 강제(내부 store 직접 접근 금지). */
export function loadActiveNewsSupplyRecordsForObservation(): NewsSupplyRecord[] {
  return loadNewsSupplyRecords();
}
