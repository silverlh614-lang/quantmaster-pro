// @responsibility ADR-0605 — Gate2 반도체 후보의 sectorCycle 잔존 결손을 SOX(글로벌 반도체) 20일 수익 proxy 로 보충 (default OFF, BULLISH 민팅 금지).
/**
 * gate2SoxSemiAxisAdr0605.ts — ADR-0604 잔여 이행 "SOXX→Gate2 반도체 섹터축".
 *
 * ADR-0601(국내 업종지수 hydration) **이후에도** sectorCycle 이 결손인 반도체 후보에 한해
 * macroState 의 SOX 20일 수익(refreshSpxSection 일 1회 수집, 본 모듈 KIS fetch 0)을
 * proxy 섹터 사이클로 주입한다. `stockVsSectorReturn20d` 만 채워 buildSectorAxis 의
 * 최대 점수가 62(stockLeader 급)로 자연 캡 — sectorRelativeReturn20d 미주입으로
 * currentLeader(72/95) 민팅이 구조적으로 불가능하다 (ADR-0600 동종군 fallback 과 동일 보수).
 */

import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { getSectorByCode } from '../../../screener/sectorMap.js';

export interface Gate2SoxSemiAxisReportAdr0605 {
  enabled: boolean;
  soxAvailable: boolean;
  candidates: number;
  semiconductorCandidates: number;
  hydrated: number;
  executionImpact: 'NONE';
  /** flag 무관 항상 산출되는 관측 블록(스냅샷 mutate 0). 산출 no-op 시 undefined. */
  observation?: Gate2SoxSemiAxisObservationAdr0605;
}

/** flag OFF 에서도 산출되는 SOX→Gate2 dry-run 관측. 스냅샷 mutate 0, KIS fetch 0 (ADR-0605). */
export interface Gate2SoxSemiAxisObservationAdr0605 {
  observed: boolean;
  /** macroState.sox20dReturn (proxy 소스). 결손 시 null — 결손은 신호 아님(불변식 #6). */
  sox20dReturn: number | null;
  semiconductorCandidates: number;
  /** sectorCycle 결손이라 SOX proxy 가 채울 "결손-커버리지 모집단" 수 (활성화 판단 1차 지표). */
  sectorCycleMissingCandidates: number;
  /** 위 모집단 중 stockReturn20d finite 라 dry-run 점수가 실제 계산된 표본 수. */
  dryRunEvaluable: number;
  scoreDelta: Gate2SoxScoreDeltaDistributionAdr0605;
  /** 결손-커버리지 모집단 대비 dry-run 표본 비율(0~1, round2). */
  coverageRatio: number;
  executionImpact: 'NONE';
}

/** dry-run 점수 분포 — buildSectorAxis 호출 없이 순수 재현(점수식 2분기). */
export interface Gate2SoxScoreDeltaDistributionAdr0605 {
  count: number;
  /** baseline(주입 전) SECTOR_LEADERSHIP 은 missingAxis(score=null, scoreIncluded=false)라
   *  confluence 에서 *제외*된다 — 숫자 0 아님(gate2ConfluenceScore.ts L247-257 검증). 관측 핵심은
   *  "결손→축 제외" → "proxy 주입→축 included" 포함 전이. 리터럴로 회귀 가드. */
  baselineIncluded: false;
  baselineScore: null;
  /** proxy 주입 후 점수 — sectorRelativeReturn20d 미주입이라 62/50 두 값으로 닫힘. */
  bucket62: number;            // stockLeader (stockVsSector20d >= 3 || rsAxis BULLISH)
  bucket50: number;            // 중립
  /** sectorRelative null 이라 buildSectorAxis 식상 도달 불가 — 방어적 0(타입 호환 위해 필드 보존). */
  bucket35: number;
  /** baseline 이 null(제외)이라 delta(주입후-baseline) 대신 주입 후 절대 점수를 추세선으로 본다. */
  avgScore: number;
  maxScore: number;
}

/** ADR-0605 스위치 — 정확 비교(=== 'true'), default OFF (관측 데이터 누적 후 운영자 활성화). */
export function isGate2SoxSectorAxisEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GATE2_SOX_SECTOR_AXIS_ENABLED === 'true';
}

interface HydratableSnapshot {
  symbol?: string;
  sector?: string;
  return20d?: number;
  symbolFeatures?: { return20d?: number };
  gate2ExternalDataCoverage?: Record<string, unknown>;
  /** read-only — buildSectorAxis stockLeader 의 rsAxis.status==='BULLISH' OR 항 재현용.
   *  부재 시 보수적으로 false 취급(점수 과대평가 금지 — 관측 정확도를 낮추는 쪽 = 안전). */
  rsAxisStatus?: string;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function stockReturn20dOf(snapshot: HydratableSnapshot): number | null {
  if (finite(snapshot.symbolFeatures?.return20d)) return snapshot.symbolFeatures.return20d;
  if (finite(snapshot.return20d)) return snapshot.return20d;
  return null;
}

/**
 * proxy 주입 시 buildSectorAxis SECTOR_LEADERSHIP 점수 순수 재현 (gate2ConfluenceScore.ts
 * L498-512 의 proxy 입력 한정 부분식). buildSectorAxis 직접 import·호출 금지 (비-export 내부 함수).
 *
 * proxy 는 stockVsSectorReturn20d 만 주입 → sectorRelative=null → currentLeader=false 확정.
 * 따라서 도달 가능 점수는 stockLeader 여부에 따라 62 또는 50 두 값. (crowded 페널티는 leader 데이터
 * 부재로 미적용, sectorRelative<-5 의 35 경로는 sectorRelative null 이라 도달 불가.)
 */
function pureSectorAxisScoreFromProxy(stockVsSector20d: number, rsAxisStatus?: string): 62 | 50 {
  const stockLeader = stockVsSector20d >= 3 || String(rsAxisStatus ?? '').toUpperCase() === 'BULLISH';
  return stockLeader ? 62 : 50;
}

function hasSectorCoverage(snapshot: HydratableSnapshot): boolean {
  const cycle = snapshot.gate2ExternalDataCoverage?.sectorCycle as Record<string, unknown> | undefined;
  if (!cycle) return false;
  const status = String(cycle.status ?? '').toUpperCase();
  return status === 'VERIFIED' || status === 'PARTIAL' || cycle.available === true;
}

function isSemiconductorSector(snapshot: HydratableSnapshot): boolean {
  const sector = snapshot.sector ?? getSectorByCode(snapshot.symbol);
  return /반도체/.test(sector ?? '');
}

/**
 * SOX→Gate2 dry-run 관측 산출 — flag 와 독립적으로 항상 시도. 순수 함수: 스냅샷 mutate 0,
 * KIS fetch 0. buildSectorAxis 미호출(순수 재현). 결손은 어떤 신호로도 변환되지 않는다(불변식 #6).
 */
export function buildGate2SoxObservation(
  candidateSnapshots: readonly HydratableSnapshot[],
  sox20dReturn: number | null,
): Gate2SoxSemiAxisObservationAdr0605 {
  let semiconductorCandidates = 0;
  let sectorCycleMissingCandidates = 0;
  let dryRunEvaluable = 0;
  let bucket62 = 0;
  let bucket50 = 0;
  const scores: number[] = [];
  const soxFinite = finite(sox20dReturn);

  for (const snapshot of candidateSnapshots) {
    if (!snapshot.symbol || !isSemiconductorSector(snapshot)) continue;
    semiconductorCandidates += 1;
    if (hasSectorCoverage(snapshot)) continue;        // 이미 커버 → proxy 대상 아님
    sectorCycleMissingCandidates += 1;                // ← ADR-0605 "결손-커버리지 모집단"
    if (!soxFinite) continue;                          // 결손 ≠ 신호 (불변식 #6)
    const stockReturn20d = stockReturn20dOf(snapshot);
    if (stockReturn20d === null) continue;
    dryRunEvaluable += 1;
    const stockVsSector = round1(stockReturn20d - (sox20dReturn as number));
    const score = pureSectorAxisScoreFromProxy(stockVsSector, snapshot.rsAxisStatus);
    scores.push(score);
    if (score === 62) bucket62 += 1; else bucket50 += 1;
  }

  return {
    observed: true,
    sox20dReturn: soxFinite ? round1(sox20dReturn as number) : null,
    semiconductorCandidates,
    sectorCycleMissingCandidates,
    dryRunEvaluable,
    scoreDelta: {
      count: dryRunEvaluable,
      baselineIncluded: false,
      baselineScore: null,
      bucket62,
      bucket50,
      bucket35: 0,                                     // sectorRelative null → 도달 불가, 방어적 0.
      avgScore: scores.length > 0 ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      maxScore: scores.length > 0 ? round1(Math.max(...scores)) : 0,
    },
    coverageRatio: sectorCycleMissingCandidates > 0
      ? round2(dryRunEvaluable / sectorCycleMissingCandidates)
      : 0,
    executionImpact: 'NONE',
  };
}

/**
 * 반도체 후보의 잔존 sectorCycle 결손을 SOX proxy(PARTIAL)로 보충. KIS fetch 0 —
 * macroState 에 sox20dReturn 이 없으면 전체 no-op (결손 ≠ 신호, 불변식 #6).
 *
 * flag OFF 에서도 observation 블록을 산출(스냅샷 mutate 0). flag ON hydration 경로는
 * byte-identical 보존 — 관측은 read-only 부가일 뿐 기존 7필드·주입 동작 무변경.
 */
export function hydrateGate2SoxSemiAxisAdr0605(input: {
  candidateSnapshots: readonly HydratableSnapshot[];
  sox20dReturn?: number | null;
  env?: NodeJS.ProcessEnv;
}): Gate2SoxSemiAxisReportAdr0605 {
  const env = input.env ?? process.env;
  const report: Gate2SoxSemiAxisReportAdr0605 = {
    enabled: isGate2SoxSectorAxisEnabled(env),
    soxAvailable: false,
    candidates: input.candidateSnapshots.length,
    semiconductorCandidates: 0,
    hydrated: 0,
    executionImpact: 'NONE',
  };

  const sox20d = input.sox20dReturn !== undefined
    ? input.sox20dReturn
    : loadMacroState()?.sox20dReturn ?? null;

  // 관측은 flag 와 독립적으로 항상 산출 (스냅샷 mutate 0). 산출 throw 는 호출부(persistScanResults
  // L724) try/catch 가 격리 — 엔진 무중단(불변식 #1).
  report.observation = buildGate2SoxObservation(input.candidateSnapshots, sox20d);

  if (!report.enabled) return report;
  if (!finite(sox20d)) return report;
  report.soxAvailable = true;

  for (const snapshot of input.candidateSnapshots) {
    if (!snapshot.symbol || !isSemiconductorSector(snapshot)) continue;
    report.semiconductorCandidates += 1;
    if (hasSectorCoverage(snapshot)) continue;
    const stockReturn20d = finite(snapshot.symbolFeatures?.return20d)
      ? snapshot.symbolFeatures.return20d
      : finite(snapshot.return20d) ? snapshot.return20d : null;
    if (stockReturn20d == null) continue;

    snapshot.gate2ExternalDataCoverage = {
      ...(snapshot.gate2ExternalDataCoverage ?? {}),
      sectorCycle: {
        status: 'PARTIAL',
        available: true,
        // stockVsSectorReturn20d 만 주입 — buildSectorAxis 최대 62(stockLeader) 자연 캡.
        values: {
          sectorReturn20d: round1(sox20d),
          stockVsSectorReturn20d: round1(stockReturn20d - sox20d),
        },
        hydratedBy: 'ADR_0605_SOX_GLOBAL_SEMI_PROXY',
      },
    };
    report.hydrated += 1;
  }

  if (report.hydrated > 0) {
    console.info(
      `[ADR-0605] Gate2 SOX semi-proxy hydration — hydrated=${report.hydrated}/` +
        `${report.semiconductorCandidates} (sox20d=${round1(sox20d)}) executionImpact=NONE`,
    );
  }
  return report;
}
