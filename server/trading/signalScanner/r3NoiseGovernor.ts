/**
 * @responsibility ADR-0448 Phase 0 — R3 Gate1 zero cause 분류 + streakImpact SSOT.
 *
 * r3NoiseGovernor.ts (ADR-0448 Phase 0)
 * =====================================
 *
 * 목적
 * ----
 * R3 streak 가 SELL_ONLY / LUNCH_BREAK / DATA_UNAVAILABLE / SectorEnergy diagnostic
 * BLOCKED / shadowObservable 존재 같은 *시스템 결함이 아닌 데이터 품질·시간대*
 * 사유로 누적되어 SHADOW_ONLY pre-scan 발동 → 매매엔진 정지로 이어지던 결함 차단.
 *
 * 사용자 핵심 의도 (절대 변경 금지):
 *   "R3 는 데이터 품질 차단을 true weakness streak 로 누적하지 않는다."
 *   "R3 streakImpact=0 은 Live 허용이 아니다. 단지 데이터 품질 차단을 true weakness
 *    로 누적하지 않는 것이다."
 *
 * 절대 불변식 (사용자 §"중요"):
 *   - `streakImpact=0` 이어도 `liveBlockPreserved: true` (literal type 강제).
 *   - 기존 SELL_ONLY / EmergencyStop / R6_DEFENSE / VIX / FOMC 게이트는 그대로 유지.
 *   - R3 기준 자체 완화 없음 — *진짜 weakness* (provider healthy + gate1Pass=0 +
 *     no shadow observable) 시점은 streakImpact=1 그대로.
 *
 * 본 SSOT 는 ADR-0419 `evaluateStreakIncrementAllowed` 위에 *진단 layer* 를 추가한다.
 * ADR-0419 의 11 reason union 은 그대로 유지하고 (호출자 변경 0), 본 모듈은 *cause 분류
 * + streakImpact 결정 + 진단 메시지* 만 신설.
 *
 * 외부 의존성: ADR-0419 `evaluateStreakIncrementAllowed` SSOT 위임. KIS/KRX/Yahoo
 * outbound 0건. 순수 함수.
 */

import {
  evaluateStreakIncrementAllowed,
  type StreakSkipContext,
} from './r3StreakSkipPolicy.js';

/* ───────── R3 Gate1 zero cause 분류 SSOT (사용자 §"구현 C" 정합) ───────── */

/**
 * Gate1 통과 0건 시점의 진단 cause 분류 union.
 *
 * 의도된 시간대·차단 상태:
 *   - SELL_ONLY_GATE1_ZERO          : SELL_ONLY 모드 (정오·장마감 직전).
 *   - LUNCH_BREAK_GATE1_ZERO        : volumeClock CLOSED (점심·장외).
 *   - DATA_UNAVAILABLE_GATE1_ZERO   : 데이터 빈곤 / FrozenQuote STALE.
 *   - SECTOR_ENERGY_DIAGNOSTIC_BLOCKED : SectorEnergy 진단 BLOCKED (sourceTier UNKNOWN /
 *                                       dataQuality FAILED·DEGRADED·STALE / sanity BLOCKED).
 *   - PROVIDER_DEGRADED_GATE1_ZERO  : 외부 provider 일시 장애 (KRX/Yahoo).
 *   - SHADOW_OBSERVABLE_EXISTS      : Counterfactual 학습 후보 존재 → streak 누적 무의미.
 *
 * 진짜 weakness 신호:
 *   - TRUE_GATE1_ZERO               : provider healthy + 모든 게이트 통과 + gate1Pass=0.
 *
 * Fallback:
 *   - UNKNOWN                       : 분류 불가 — 보수적으로 streak 누적 (기존 동작 보존).
 */
type R3Gate1ZeroCause =
  | 'TRUE_GATE1_ZERO'
  | 'SELL_ONLY_GATE1_ZERO'
  | 'LUNCH_BREAK_GATE1_ZERO'
  | 'DATA_UNAVAILABLE_GATE1_ZERO'
  | 'SECTOR_ENERGY_DIAGNOSTIC_BLOCKED'
  | 'PROVIDER_DEGRADED_GATE1_ZERO'
  | 'SHADOW_OBSERVABLE_EXISTS'
  | 'UNKNOWN';

type R3NoiseGovernorAction =
  | 'KEEP_COUNTERFACTUAL_LEARNING'
  | 'KEEP_SHADOW_OBSERVATION'
  | 'PATCH_PROVIDER'
  | 'R3_TRUE_EMPTY_SCAN';

/**
 * R3 Noise Governor 결정.
 *
 * 사용자 핵심 불변식: `liveBlockPreserved: true` literal type — streakImpact=0 이어도
 *   기존 Live 차단 (SELL_ONLY/risk) 은 그대로 유지된다는 의미.
 */
export interface R3NoiseGovernorDecision {
  cause: R3Gate1ZeroCause;
  /** R3 streak 증가 여부 — 0=skip, 1=정상 누적 */
  streakImpact: 0 | 1;
  action: R3NoiseGovernorAction;
  /** Live 차단은 기존 규칙 그대로 (literal type 강제). */
  liveBlockPreserved: true;
  /** 운영자 진단 메시지 — /scan_blockers compact line 등 표시용. */
  reason: string;
}

/* ───────── 입력 schema ───────── */

/**
 * 입력 — `evaluateStreakIncrementAllowed` (ADR-0419) 의 `StreakSkipContext` 와
 * SectorEnergy/Shadow 신호를 결합.
 */
export interface R3NoiseGovernorInput {
  /** ADR-0419 streak skip 평가 컨텍스트 (SELL_ONLY/VIX/FOMC/volumeClock 등 11 reason). */
  streakSkipContext: StreakSkipContext;
  /** Gate1 통과 후보 수 (≥1 시 본 모듈 평가 자체 무관 — 호출자가 분기 의무). */
  gate1Pass: number;
  /** 후보 수 (gate1Pass=0 일 때 진단 추가 정보). */
  candidates: number;
  /** SectorEnergy 진단 BLOCKED 여부 (`deriveSectorEnergyExecutionImpact` 결과 등). */
  sectorEnergyDiagnosticBlocked?: boolean;
  /** Counterfactual / shadow observable 존재 — true 시 streak 누적 무의미. */
  shadowObservableExists?: boolean;
  /** Provider degraded 신호 (예: KRX OpenAPI 일시 장애). */
  providerDegraded?: boolean;
}

/* ───────── ENV 우회 SSOT ───────── */

/**
 * ENV `R3_NOISE_GOVERNOR_DISABLED=true` (default OFF).
 *
 * ADR-0157 정확 비교 의무: `'1'` / `'TRUE'` / `'yes'` 모두 거부.
 * 활성 시 본 SSOT 는 보수적 fallback (`TRUE_GATE1_ZERO` + streakImpact=1) 반환 →
 * ADR-0419 단독 동작 (호출자가 evaluateStreakIncrementAllowed 만 사용).
 */
export function isR3NoiseGovernorDisabled(): boolean {
  return process.env.R3_NOISE_GOVERNOR_DISABLED === 'true';
}

/* ───────── 결정 트리 SSOT (사용자 §"구현 C 결정" 정합 — 절대 변경 금지) ───────── */

/**
 * R3 Noise Governor 결정 트리 SSOT.
 *
 * 우선순위 (위에서 아래 첫 매칭):
 *   1. ENV DISABLED → TRUE_GATE1_ZERO + streakImpact=1 (기존 동작 복원)
 *   2. ADR-0419 evaluateStreakIncrementAllowed 가 skip 결정 → cause 매핑 + streakImpact=0
 *      - SELL_ONLY_MODE → SELL_ONLY_GATE1_ZERO
 *      - VOLUME_CLOCK_CLOSED → LUNCH_BREAK_GATE1_ZERO
 *      - DATA_STARVED_SCAN / FROZEN_QUOTE_STALE → DATA_UNAVAILABLE_GATE1_ZERO
 *      - 그 외 (KRX_NON_TRADING_DAY / EMERGENCY_STOP / MANUAL_BLOCK / R6 / VIX / FOMC /
 *               BLOCKED_DAY) → 호출자 측에서 처리 (본 모듈은 cause=UNKNOWN + skip)
 *   3. shadowObservableExists=true → SHADOW_OBSERVABLE_EXISTS + streakImpact=0
 *   4. sectorEnergyDiagnosticBlocked=true → SECTOR_ENERGY_DIAGNOSTIC_BLOCKED + streakImpact=0
 *   5. providerDegraded=true → PROVIDER_DEGRADED_GATE1_ZERO + streakImpact=0
 *   6. 그 외 → TRUE_GATE1_ZERO + streakImpact=1 (정상 누적)
 *
 * `liveBlockPreserved: true` 모든 분기에서 literal 강제.
 */
export function evaluateR3NoiseGovernor(
  input: R3NoiseGovernorInput,
): R3NoiseGovernorDecision {
  // (1) ENV DISABLED — 기존 ADR-0419 동작 복원 (보수적 streakImpact=1).
  if (isR3NoiseGovernorDisabled()) {
    return {
      cause: 'TRUE_GATE1_ZERO',
      streakImpact: 1,
      action: 'R3_TRUE_EMPTY_SCAN',
      liveBlockPreserved: true,
      reason: 'R3_NOISE_GOVERNOR_DISABLED env active — fallback to ADR-0419 default (streakImpact=1).',
    };
  }

  // (2) ADR-0419 streak skip 결정 위임 — cause 매핑.
  const skipDecision = evaluateStreakIncrementAllowed(input.streakSkipContext);
  if (!skipDecision.allowed && skipDecision.skipReason !== undefined) {
    const cause = mapAdr0419SkipReasonToCause(skipDecision.skipReason);
    return {
      cause,
      streakImpact: 0,
      action: deriveActionForCause(cause, input),
      liveBlockPreserved: true,
      reason: `ADR-0419 streak skip: ${skipDecision.skipReason} — streakImpact=0 (live block preserved by existing rules).`,
    };
  }

  // (3) shadowObservableExists=true → SHADOW_OBSERVABLE_EXISTS
  if (input.shadowObservableExists === true) {
    return {
      cause: 'SHADOW_OBSERVABLE_EXISTS',
      streakImpact: 0,
      action: 'KEEP_COUNTERFACTUAL_LEARNING',
      liveBlockPreserved: true,
      reason: 'Counterfactual / shadow observable candidates exist — streak accumulation not meaningful.',
    };
  }

  // (4) sectorEnergyDiagnosticBlocked=true → SECTOR_ENERGY_DIAGNOSTIC_BLOCKED
  if (input.sectorEnergyDiagnosticBlocked === true) {
    return {
      cause: 'SECTOR_ENERGY_DIAGNOSTIC_BLOCKED',
      streakImpact: 0,
      action: 'KEEP_SHADOW_OBSERVATION',
      liveBlockPreserved: true,
      reason: 'SectorEnergy diagnostic BLOCKED (sector-index leadership unavailable) — streakImpact=0 (data quality issue, not true weakness).',
    };
  }

  // (5) providerDegraded=true → PROVIDER_DEGRADED_GATE1_ZERO
  if (input.providerDegraded === true) {
    return {
      cause: 'PROVIDER_DEGRADED_GATE1_ZERO',
      streakImpact: 0,
      action: 'PATCH_PROVIDER',
      liveBlockPreserved: true,
      reason: 'External provider degraded (KRX/Yahoo transient failure) — streakImpact=0.',
    };
  }

  // (6) 그 외 — TRUE_GATE1_ZERO (provider healthy + 모든 게이트 통과 + gate1Pass=0).
  return {
    cause: 'TRUE_GATE1_ZERO',
    streakImpact: 1,
    action: 'R3_TRUE_EMPTY_SCAN',
    liveBlockPreserved: true,
    reason: `True empty scan — provider healthy, all gates passed, gate1Pass=${input.gate1Pass}/${input.candidates}.`,
  };
}

/* ───────── ADR-0419 skipReason → cause 매핑 SSOT ───────── */

/**
 * ADR-0419 11 reason union → R3Gate1ZeroCause 매핑.
 *
 * 매핑 규칙 (사용자 §"구현 C 결정" 정합):
 *   - SELL_ONLY_MODE → SELL_ONLY_GATE1_ZERO
 *   - VOLUME_CLOCK_CLOSED → LUNCH_BREAK_GATE1_ZERO
 *   - DATA_STARVED_SCAN → DATA_UNAVAILABLE_GATE1_ZERO
 *   - FROZEN_QUOTE_STALE → DATA_UNAVAILABLE_GATE1_ZERO
 *   - 그 외 (KRX_NON_TRADING_DAY / EMERGENCY_STOP / MANUAL_BLOCK / R6 / VIX / FOMC /
 *            BLOCKED_DAY_SCAN) → UNKNOWN (호출자가 별도 처리, 본 모듈은 진단만)
 */
function mapAdr0419SkipReasonToCause(skipReason: string): R3Gate1ZeroCause {
  switch (skipReason) {
    case 'SELL_ONLY_MODE':
      return 'SELL_ONLY_GATE1_ZERO';
    case 'VOLUME_CLOCK_CLOSED':
      return 'LUNCH_BREAK_GATE1_ZERO';
    case 'DATA_STARVED_SCAN':
    case 'FROZEN_QUOTE_STALE':
      return 'DATA_UNAVAILABLE_GATE1_ZERO';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Cause → action 매핑 SSOT.
 */
function deriveActionForCause(
  cause: R3Gate1ZeroCause,
  input: R3NoiseGovernorInput,
): R3NoiseGovernorAction {
  if (input.shadowObservableExists === true) return 'KEEP_COUNTERFACTUAL_LEARNING';
  switch (cause) {
    case 'SELL_ONLY_GATE1_ZERO':
    case 'LUNCH_BREAK_GATE1_ZERO':
      return 'KEEP_SHADOW_OBSERVATION';
    case 'DATA_UNAVAILABLE_GATE1_ZERO':
    case 'PROVIDER_DEGRADED_GATE1_ZERO':
      return 'PATCH_PROVIDER';
    case 'SECTOR_ENERGY_DIAGNOSTIC_BLOCKED':
      return 'KEEP_SHADOW_OBSERVATION';
    case 'SHADOW_OBSERVABLE_EXISTS':
      return 'KEEP_COUNTERFACTUAL_LEARNING';
    case 'TRUE_GATE1_ZERO':
      return 'R3_TRUE_EMPTY_SCAN';
    case 'UNKNOWN':
    default:
      return 'KEEP_SHADOW_OBSERVATION';
  }
}

/* ───────── /scan_blockers compact line SSOT ───────── */

/**
 * /scan_blockers compact line — 사용자 §"권장 텔레그램 표시" 정합.
 *
 * 출력 예 (plain text, no `<b>` tags):
 *   "🛡️ R3 Noise: cause SECTOR_ENERGY_DIAGNOSTIC_BLOCKED · streakImpact=0 · learning kept"
 *   "🛡️ R3 Noise: cause TRUE_GATE1_ZERO · streakImpact=1 · scan empty"
 */
export function formatR3NoiseGovernorCompactLine(
  decision: R3NoiseGovernorDecision,
): string {
  const tail =
    decision.action === 'R3_TRUE_EMPTY_SCAN'
      ? 'scan empty'
      : decision.action === 'KEEP_COUNTERFACTUAL_LEARNING'
        ? 'learning kept'
        : decision.action === 'KEEP_SHADOW_OBSERVATION'
          ? 'shadow observed'
          : 'patch provider';
  return `🛡️ R3 Noise: cause ${decision.cause} · streakImpact=${decision.streakImpact} · ${tail}`;
}
