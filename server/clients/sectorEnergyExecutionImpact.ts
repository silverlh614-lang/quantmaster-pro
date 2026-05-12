/**
 * @responsibility ADR-0448 Phase 0 — SectorEnergy 진단/스코어/실행 3층 분리 SSOT.
 *
 * sectorEnergyExecutionImpact.ts (ADR-0448 Phase 0)
 * ==================================================
 *
 * 목적
 * ----
 * SectorEnergy 데이터 품질 진단 결과 (`dataQuality` / `leadershipConfidence` /
 * `sourceTier` / `sanityConfidenceImpact` / `fallbackUsed` / `indexCodeCoverage`)
 * 가 *전역 매매엔진 차단* 으로 잘못 전파되던 결함을 차단하기 위한 3층 분리 SSOT.
 *
 * 사용자 핵심 의도 (절대 변경 금지):
 *   "SectorEnergy 는 진단과 보조점수로 남기고, 매매엔진의 전역 정지 버튼 역할은 못 하게 한다."
 *
 * 3층 분리 (사용자 §"새로운 개념"):
 *   1. diagnosticStatus  — 운영자 가시화용 진단 상태 (OK/DEGRADED/STALE/BLOCKED/DATA_UNAVAILABLE).
 *   2. scoringImpact     — 점수 산출 영향 (ALLOW_SECTOR_BOOST/ZERO_SECTOR_BOOST/...).
 *   3. executionImpact   — 매매 실행 영향 (NO_EXECUTION_BLOCK/DISALLOW_STRONG_BUY_ONLY/HARD_BLOCK).
 *
 * 핵심 불변식 (사용자 §"절대 불변식" 직접 매핑):
 *   - SectorEnergy 유래는 항상 `executionImpact ≠ HARD_BLOCK` (literal type 강제).
 *   - SectorEnergy OK 가 아니면 `strongBuyAllowed=false`, `sectorBoostAllowed=false`.
 *   - SectorEnergy 만으로 BUY/HOLD/Shadow/Counterfactual 평가 차단 0건.
 *
 * 본 SSOT 는 *기존 분기 로직을 변경하지 않는다*. 현재 코드 (sectorScoreBoost.ts +
 * sectorEnergyStrongBuyGate.ts + r3ViolationStateMachine.ts evaluateGuards) 가
 * 이미 의도된 동작을 수행 중이며, 본 모듈은 그 결과를 *진단 가시화* 와 *3층 결정* 으로
 * 통합 제공한다 (호출자 무수정 + 운영자 가시성 격상).
 *
 * 외부 의존성 0 — 순수 함수만, KIS/KRX/Yahoo/Naver outbound 0.
 */

/* ───────── 3층 분리 타입 (사용자 §"새로운 개념" 정합) ───────── */

export type SectorEnergyDiagnosticStatus =
  | 'OK'
  | 'DEGRADED'
  | 'STALE'
  | 'BLOCKED'
  | 'DATA_UNAVAILABLE';

export type SectorEnergyScoringImpact =
  | 'ALLOW_SECTOR_BOOST'
  | 'ZERO_SECTOR_BOOST'
  | 'SECTOR_SCORE_NEUTRAL'
  | 'SECTOR_PENALTY_ONLY';

export type SectorEnergyExecutionImpact =
  | 'NO_EXECUTION_BLOCK'
  | 'DISALLOW_STRONG_BUY_ONLY'
  | 'HARD_BLOCK';

/* ───────── 입력/결과 schema ───────── */

/**
 * `deriveSectorEnergyExecutionImpact` 입력. 모든 필드 옵셔널 (후방호환 — 호출자가 채울 수 있는 것만 전달).
 */
export interface SectorEnergyExecutionImpactInput {
  /** ADR-0399 4-axis 의 `leadershipConfidence`. dataQuality 와 함께 사용. */
  leadershipConfidence?: 'OK' | 'READY_FOR_SHADOW' | 'DEGRADED' | 'BLOCKED';
  /** ADR-0396 5단계 dataQuality (`OK`/`PARTIAL`/`STALE`/`DEGRADED`/`FAILED`/`PARTIAL_VOLUME`). */
  dataQuality?: string;
  /** ADR-0399 sourceTier (`KRX_CODE`/`STOCK_DAILY`/`CACHE`/`YAHOO_ETF`/`UNKNOWN`/`FAILED`). */
  sourceTier?: string;
  /** ADR-0446 sanity confidenceImpact (`NONE`/`DEGRADED`/`BLOCKED`). */
  sanityConfidenceImpact?: 'NONE' | 'DEGRADED' | 'BLOCKED';
  /** ADR-0397/0399 fallbackUsed (`NONE`/`STOCK_DAILY`/`ETF`/`CACHE`). */
  fallbackUsed?: 'NONE' | 'STOCK_DAILY' | 'ETF' | 'CACHE';
  /** ADR-0399 indexCodeCoverage (0~1). */
  indexCodeCoverage?: number;
}

/**
 * 3층 분리 결과 — 사용자 §"권장 결정" 정합.
 *
 * 사용자 핵심 불변식 (`hardBlockAllowed: false` literal type):
 *   SectorEnergy 유래에서는 *절대* `executionImpact = 'HARD_BLOCK'` 발생 안 함.
 *   진짜 HARD_BLOCK 은 EmergencyStop / R6 defense / SELL_ONLY / market-close /
 *   order-safety 같은 *시스템 위험* 만 가능 (별도 SSOT, 본 모듈 외).
 */
export interface SectorEnergyExecutionImpactResult {
  diagnosticStatus: SectorEnergyDiagnosticStatus;
  scoringImpact: SectorEnergyScoringImpact;
  executionImpact: SectorEnergyExecutionImpact;
  /** sectorBoost 적용 가능 (OK 일 때만 true). */
  sectorBoostAllowed: boolean;
  /** STRONG_BUY 승격 가능 (OK 일 때만 true). */
  strongBuyAllowed: boolean;
  /** SectorEnergy 유래 HARD_BLOCK 절대 금지 (literal type). */
  hardBlockAllowed: false;
  /** 운영자 진단용 한국어/영문 mixed 사유. */
  reason: string;
}

/* ───────── ENV 우회 SSOT ───────── */

/**
 * ENV `SECTOR_ENERGY_EXECUTION_DECOUPLING_DISABLED=true` (default OFF).
 *
 * ADR-0157 정확 비교 의무: `'1'` / `'TRUE'` / `'yes'` 모두 거부.
 * `=== 'true'` 만 활성으로 인정.
 *
 * 활성 시 본 SSOT 는 *기존 동작 (ADR-0447 이전)* 으로 복귀 — 호출자가 빈 결과 또는
 * 보수적 fallback 을 사용해야 한다 (호출자 책임). 본 함수 자체는 항상 동작.
 */
export function isSectorEnergyExecutionDecouplingDisabled(): boolean {
  return process.env.SECTOR_ENERGY_EXECUTION_DECOUPLING_DISABLED === 'true';
}

/* ───────── 결정 트리 SSOT (사용자 §"권장 결정" 정합 — 절대 변경 금지) ───────── */

/**
 * SectorEnergy 진단 결과 → 3층 분리.
 *
 * 결정 트리 우선순위 (위에서 아래 첫 매칭):
 *   1. dataQuality === 'FAILED' OR leadershipConfidence === 'BLOCKED' AND sanity BLOCKED
 *      → BLOCKED + ZERO_SECTOR_BOOST + DISALLOW_STRONG_BUY_ONLY
 *   2. sanity confidenceImpact === 'BLOCKED'
 *      → BLOCKED + ZERO_SECTOR_BOOST + DISALLOW_STRONG_BUY_ONLY
 *   3. dataQuality === 'DEGRADED' OR fallbackUsed !== 'NONE' OR sourceTier ∈ {STOCK_DAILY, UNKNOWN, FAILED}
 *      → DEGRADED + ZERO_SECTOR_BOOST + DISALLOW_STRONG_BUY_ONLY
 *   4. dataQuality ∈ {'STALE', 'PARTIAL_VOLUME'} OR leadershipConfidence === 'DEGRADED'
 *      → STALE + ZERO_SECTOR_BOOST + DISALLOW_STRONG_BUY_ONLY
 *   5. dataQuality === 'PARTIAL' (ADR-0396 일부 OK)
 *      → DEGRADED + ZERO_SECTOR_BOOST + DISALLOW_STRONG_BUY_ONLY (보수적)
 *   6. dataQuality === 'OK' AND leadershipConfidence !== 'BLOCKED' AND sanity !== 'BLOCKED'
 *      → OK + ALLOW_SECTOR_BOOST + NO_EXECUTION_BLOCK
 *   7. 입력 부재 (모든 필드 undefined)
 *      → DATA_UNAVAILABLE + SECTOR_SCORE_NEUTRAL + DISALLOW_STRONG_BUY_ONLY
 *
 * 절대 불변식: 모든 분기에서 `hardBlockAllowed: false` literal type 강제.
 */
export function deriveSectorEnergyExecutionImpact(
  input: SectorEnergyExecutionImpactInput | undefined | null,
): SectorEnergyExecutionImpactResult {
  // (7) 입력 부재 — DATA_UNAVAILABLE 보수 fallback (STRONG_BUY 차단, sectorBoost neutral).
  if (!input || (input.dataQuality === undefined && input.leadershipConfidence === undefined && input.sanityConfidenceImpact === undefined)) {
    return {
      diagnosticStatus: 'DATA_UNAVAILABLE',
      scoringImpact: 'SECTOR_SCORE_NEUTRAL',
      executionImpact: 'DISALLOW_STRONG_BUY_ONLY',
      sectorBoostAllowed: false,
      strongBuyAllowed: false,
      hardBlockAllowed: false,
      reason: 'SectorEnergy diagnostic input absent — STRONG_BUY suppressed conservatively.',
    };
  }

  const dq = input.dataQuality;
  const lc = input.leadershipConfidence;
  const sc = input.sanityConfidenceImpact;
  const ft = input.fallbackUsed;
  const st = input.sourceTier;

  // (1) FAILED / leadership BLOCKED + sanity BLOCKED → BLOCKED 분기
  if (
    dq === 'FAILED' ||
    (lc === 'BLOCKED' && sc === 'BLOCKED')
  ) {
    return {
      diagnosticStatus: 'BLOCKED',
      scoringImpact: 'ZERO_SECTOR_BOOST',
      executionImpact: 'DISALLOW_STRONG_BUY_ONLY',
      sectorBoostAllowed: false,
      strongBuyAllowed: false,
      hardBlockAllowed: false,
      reason: 'SectorEnergy BLOCKED (sector-index leadership data unavailable or corrupted).',
    };
  }

  // (2) sanity confidenceImpact BLOCKED 단독 → BLOCKED
  if (sc === 'BLOCKED') {
    return {
      diagnosticStatus: 'BLOCKED',
      scoringImpact: 'ZERO_SECTOR_BOOST',
      executionImpact: 'DISALLOW_STRONG_BUY_ONLY',
      sectorBoostAllowed: false,
      strongBuyAllowed: false,
      hardBlockAllowed: false,
      reason: 'SectorEnergy sanity violations BLOCKED (volume/return outliers detected).',
    };
  }

  // (3) DEGRADED / fallback / STOCK_DAILY / UNKNOWN / FAILED tier → DEGRADED
  const fallbackTainted = ft !== undefined && ft !== 'NONE';
  const sourceTainted = st === 'STOCK_DAILY' || st === 'UNKNOWN' || st === 'FAILED';
  const kisBasketShadowOnly = st === 'KIS_STOCK_BASKET_DERIVED' || lc === 'READY_FOR_SHADOW';
  if (kisBasketShadowOnly) {
    return {
      diagnosticStatus: 'DEGRADED',
      scoringImpact: 'ZERO_SECTOR_BOOST',
      executionImpact: 'DISALLOW_STRONG_BUY_ONLY',
      sectorBoostAllowed: false,
      strongBuyAllowed: false,
      hardBlockAllowed: false,
      reason: 'KIS basket is derived representative basket, not official sector index — shadow/watch/ranking only.',
    };
  }
  if (dq === 'DEGRADED' || fallbackTainted || sourceTainted) {
    return {
      diagnosticStatus: 'DEGRADED',
      scoringImpact: 'ZERO_SECTOR_BOOST',
      executionImpact: 'DISALLOW_STRONG_BUY_ONLY',
      sectorBoostAllowed: false,
      strongBuyAllowed: false,
      hardBlockAllowed: false,
      reason: dq === 'DEGRADED'
        ? 'SectorEnergy DEGRADED (validSectorCount low / coverage incomplete).'
        : `SectorEnergy DEGRADED (fallback=${ft ?? 'NONE'} sourceTier=${st ?? 'UNKNOWN'}).`,
    };
  }

  // (4) STALE / PARTIAL_VOLUME / leadership DEGRADED → STALE
  if (dq === 'STALE' || dq === 'PARTIAL_VOLUME' || lc === 'DEGRADED') {
    return {
      diagnosticStatus: 'STALE',
      scoringImpact: 'ZERO_SECTOR_BOOST',
      executionImpact: 'DISALLOW_STRONG_BUY_ONLY',
      sectorBoostAllowed: false,
      strongBuyAllowed: false,
      hardBlockAllowed: false,
      reason: `SectorEnergy STALE (dataQuality=${dq ?? 'unknown'} leadership=${lc ?? 'unknown'}).`,
    };
  }

  // (5) PARTIAL — sectorBoost 0.5 (sectorScoreBoost.ts 자체 분기), 보수적 STRONG_BUY 차단
  if (dq === 'PARTIAL') {
    return {
      diagnosticStatus: 'DEGRADED',
      scoringImpact: 'ZERO_SECTOR_BOOST',
      executionImpact: 'DISALLOW_STRONG_BUY_ONLY',
      sectorBoostAllowed: false,
      strongBuyAllowed: false,
      hardBlockAllowed: false,
      reason: 'SectorEnergy PARTIAL (some sectors missing — STRONG_BUY suppressed conservatively).',
    };
  }

  // (6) OK + leadership OK (sanity 는 분기 (1)(2) 에서 BLOCKED 차단됨) → ALLOW
  if (dq === 'OK' && lc !== 'BLOCKED') {
    return {
      diagnosticStatus: 'OK',
      scoringImpact: 'ALLOW_SECTOR_BOOST',
      executionImpact: 'NO_EXECUTION_BLOCK',
      sectorBoostAllowed: true,
      strongBuyAllowed: true,
      hardBlockAllowed: false,
      reason: 'SectorEnergy OK — sector-index leadership healthy.',
    };
  }

  // 그 외 안전 fallback — DATA_UNAVAILABLE
  return {
    diagnosticStatus: 'DATA_UNAVAILABLE',
    scoringImpact: 'SECTOR_SCORE_NEUTRAL',
    executionImpact: 'DISALLOW_STRONG_BUY_ONLY',
    sectorBoostAllowed: false,
    strongBuyAllowed: false,
    hardBlockAllowed: false,
    reason: `SectorEnergy state ambiguous (dataQuality=${dq ?? 'undef'} leadership=${lc ?? 'undef'}).`,
  };
}

/* ───────── /scan_blockers compact line SSOT ───────── */

/**
 * /scan_blockers compact line — 사용자 §"권장 텔레그램 표시" 정합.
 *
 * 출력 예 (plain text, no `<b>` tags — Telegram HTML parse failure 방지):
 *   "🧩 SectorEnergy: diagnostic BLOCKED · sectorBoost=0 · STRONG_BUY blocked · execution HARD_BLOCK=no"
 *
 * 핵심: 마지막 필드 `execution HARD_BLOCK=no` 가 항상 표시 — 운영자가 "SectorEnergy 가
 * 매매엔진을 멈추지 않는다" 를 즉시 인지.
 */
export function formatSectorEnergyExecutionImpactCompactLine(
  result: SectorEnergyExecutionImpactResult,
): string {
  const sectorBoostText = result.sectorBoostAllowed ? 'allowed' : '0';
  const strongBuyText = result.strongBuyAllowed ? 'allowed' : 'blocked';
  return (
    `🧩 SectorEnergy: diagnostic ${result.diagnosticStatus} · ` +
    `sectorBoost=${sectorBoostText} · STRONG_BUY ${strongBuyText} · execution HARD_BLOCK=no`
  );
}
