// @responsibility gateConfig 매매 엔진 모듈
/**
 * gateConfig.ts — 레짐별 Gate Score 임계값 단일 소스
 *
 * 기존 entryEngine.REGIME_GATE_MIN은 하드코딩이라 운용자가 실시간 조정 불가했다.
 * 이 모듈은 두 층위를 분리한다:
 *   1. GATE_SCORE_THRESHOLD_BY_REGIME — 베이스라인 (고정, 정책 값)
 *   2. runtime delta — 오버라이드로 베이스라인을 일시 완화 (TTL 자동 만료)
 *
 * getEffectiveGateThreshold(regime) = BASE[regime] + delta (하한 2.0 clamp)
 *
 * delta는 overrideExecutor가 "임계값 -0.5 완화" 액션에서 설정하고
 * setRuntimeThresholdDelta()로 호출한다. TTL 만료 또는 외부 clearRuntimeThresholdDelta()
 * 호출 시 0으로 복귀한다.
 *
 * 안전 장치:
 *   - 하한 2.0 — 아무리 완화해도 기본 모멘텀·거래량조차 없는 종목은 차단
 *   - LIVE 모드에서는 상위 레이어(overrideExecutor)가 완화 자체를 거부 (SHADOW 전용)
 */

import type { RegimeLevel } from '../../src/types/core.js';
import {
  GATE_SCORE_THRESHOLD_BY_REGIME as SHARED_SCORE_BANDS,
  getRegimeGateScoreBand,
} from '../../src/constants/gateConfig.js';

/**
 * 베이스라인 — 레짐별 Gate 통과 최소 점수(NORMAL). 약세장일수록 높다.
 *
 * src/constants/gateConfig.ts의 GATE_SCORE_THRESHOLD_BY_REGIME (STRONG/NORMAL 페어)
 * 를 단일 소스로 사용한다. 이 맵은 NORMAL만 서버용으로 투영한 호환 뷰.
 */
export const GATE_SCORE_THRESHOLD_BY_REGIME: Record<RegimeLevel, number> = {
  R1_TURBO:   SHARED_SCORE_BANDS.R1_TURBO.normal,
  R2_BULL:    SHARED_SCORE_BANDS.R2_BULL.normal,
  R3_EARLY:   SHARED_SCORE_BANDS.R3_EARLY.normal,
  R4_NEUTRAL: SHARED_SCORE_BANDS.R4_NEUTRAL.normal,
  R5_CAUTION: SHARED_SCORE_BANDS.R5_CAUTION.normal,
  R6_DEFENSE: SHARED_SCORE_BANDS.R6_DEFENSE.normal, // legacy score band only; no execution block
};

/** 레짐별 (STRONG, NORMAL) 쌍 — quantFilter의 signalType 분류에서 사용. */
export function getRegimeGateBand(regime?: RegimeLevel | string): { strong: number; normal: number } {
  return getRegimeGateScoreBand(regime);
}

const MIN_EFFECTIVE_THRESHOLD = 2.0;

interface RuntimeDelta {
  value: number;        // 음수 = 완화, 양수 = 강화
  expiresAt: number;    // epoch ms
  source: string;       // 설정 주체 ('operator_override', 'calibration', ...)
}

let runtimeDelta: RuntimeDelta | null = null;

/**
 * 베이스라인 + 현재 유효한 delta를 합산한 실효 임계값.
 * delta가 만료되었으면 자동 클리어 후 베이스라인만 반환.
 */
export function getEffectiveGateThreshold(regime?: string): number {
  const base = GATE_SCORE_THRESHOLD_BY_REGIME[(regime ?? 'R4_NEUTRAL') as RegimeLevel]
    ?? GATE_SCORE_THRESHOLD_BY_REGIME.R4_NEUTRAL;

  if (runtimeDelta && Date.now() >= runtimeDelta.expiresAt) {
    runtimeDelta = null;
  }
  const delta = runtimeDelta?.value ?? 0;

  // R6는 차단용 999이므로 delta를 적용하지 않는다
  if (base >= 100) return base;

  return Math.max(MIN_EFFECTIVE_THRESHOLD, base + delta);
}

/**
 * 런타임 delta 설정. 기존 delta는 덮어쓴다.
 * @param value     음수 = 완화, 양수 = 강화 (예: -0.5)
 * @param ttlMs     유효 시간 (ms). 기본 30분.
 * @param source    설정 주체 (감사 로그용)
 */
export function setRuntimeThresholdDelta(
  value: number,
  ttlMs: number = 30 * 60_000,
  source: string = 'unknown',
): void {
  runtimeDelta = { value, expiresAt: Date.now() + ttlMs, source };
  console.log(
    `[GateConfig] 임계값 delta=${value >= 0 ? '+' : ''}${value} 설정 ` +
    `(source=${source}, TTL=${Math.round(ttlMs / 60_000)}분)`,
  );
}

export function clearRuntimeThresholdDelta(): void {
  if (runtimeDelta) {
    console.log(`[GateConfig] 임계값 delta 해제 (이전 value=${runtimeDelta.value})`);
  }
  runtimeDelta = null;
}

export interface ThresholdDeltaSnapshot {
  active: boolean;
  value: number;
  expiresAt: string | null;
  remainingMs: number;
  source: string | null;
}

export function getRuntimeThresholdSnapshot(): ThresholdDeltaSnapshot {
  if (!runtimeDelta || Date.now() >= runtimeDelta.expiresAt) {
    return { active: false, value: 0, expiresAt: null, remainingMs: 0, source: null };
  }
  return {
    active: true,
    value: runtimeDelta.value,
    expiresAt: new Date(runtimeDelta.expiresAt).toISOString(),
    remainingMs: runtimeDelta.expiresAt - Date.now(),
    source: runtimeDelta.source,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0546 — Gate1 Required-Score SSOT (Phase 1, 동작 보존)
//
// 포렌식/관측/dry-run 계층은 ×10 스케일(0~100, required 70)을 쓰고, live 재검증·
// 사이징은 ×1 스케일(0~10, getEffectiveGateThreshold)을 쓴다. 두 스케일을 잇는
// 환산 상수·레짐 인식 임계·레거시 임계를 본 모듈에 단일화한다. Phase 1 은 플래그
// OFF 기본 → 모든 호출이 레거시 70 을 반환해 live/diagnostic 결과가 0 변화한다.
// 레짐 인식값은 섀도 병행 로깅 전용으로만 계산한다(Phase 2 운영자 승인 후 전환).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Gate1 score scale — live ×1 임계(getEffectiveGateThreshold)를 포렌식 ×10
 * 스케일로 환산하는 단일 명명 상수. `scoreScale ?? 10` 매직넘버 제거 SSOT.
 */
export const GATE1_SCORE_SCALE = 10;

/**
 * 레거시(현행) Gate1 minimum-signal 통과 임계 — ×10 스케일 70.
 * 포렌식/관측/dry-run 8개 파일에 하드코딩돼 있던 70 의 단일 출처.
 */
export const LEGACY_GATE1_REQUIRED_SCORE = 70;

/**
 * 레짐 인식 Gate1 임계 활성 스위치. default OFF — Phase 1 동작 보존.
 * `GATE1_REGIME_AWARE_REQUIRED=true` 전환은 Phase 2(운영자 승인) 사안 — ENV 1줄 즉시 롤백.
 */
export function isGate1RegimeAwareRequiredEnabled(): boolean {
  return process.env.GATE1_REGIME_AWARE_REQUIRED === 'true';
}

/**
 * 레짐 인식 required score (×10 스케일). live 임계 SSOT(getEffectiveGateThreshold)
 * 를 ×GATE1_SCORE_SCALE 환산. 플래그와 무관하게 항상 레짐값을 계산 — Phase 1
 * 섀도 병행 로깅(legacy 70 vs regime-aware)에서 관측 데이터로만 사용한다.
 */
export function getRegimeAwareGate1RequiredScore(regime?: string): number {
  return getEffectiveGateThreshold(regime) * GATE1_SCORE_SCALE;
}

/**
 * counterfacture_gate Phase D — 학습 임계 provider 주입 seam(역의존 방지).
 * 기본 미등록(null) → resolveGate1RequiredScore 는 byte-identical(레거시 70).
 * learning 레이어가 명시 등록할 때만, 그리고 flag ON + operator 승인분이 있을 때만
 * provider 가 유효값(아니면 null) 을 반환한다 — gateConfig 는 learning 을 import 하지 않는다.
 */
export type LearnedGate1ThresholdProvider = (regime: string | undefined) => number | null;
let learnedGate1ThresholdProvider: LearnedGate1ThresholdProvider | null = null;
export function registerLearnedGate1ThresholdProvider(provider: LearnedGate1ThresholdProvider | null): void {
  learnedGate1ThresholdProvider = provider;
}

/**
 * Gate1 required-score 단일 진입점 (ADR-0546). 플래그 OFF(기본)면 레거시 70,
 * ON 이면 레짐 인식값. Phase 1 에서는 항상 OFF → live/diagnostic 결과 0 변화.
 * 하드코딩 70 을 우회하지 말고 본 함수(또는 LEGACY_GATE1_REQUIRED_SCORE)만 쓴다.
 *
 * counterfacture_gate Phase D — provider 가 유효 학습 임계를 반환하면 그 값을 우선한다.
 * provider 는 자체적으로 flag/승인/window-clamp 를 책임지고, 미충족 시 null → 아래 레거시 경로.
 */
export function resolveGate1RequiredScore(regime?: string): number {
  const learned = learnedGate1ThresholdProvider?.(regime);
  if (typeof learned === 'number' && Number.isFinite(learned)) return learned;
  return isGate1RegimeAwareRequiredEnabled()
    ? getRegimeAwareGate1RequiredScore(regime)
    : LEGACY_GATE1_REQUIRED_SCORE;
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0613 — Gate1 Positive-Ceiling Wiring 승격 스위치 (Phase 0, 동작 보존)
//
// 천장 배선 3종(RS percentile 입력·BREAKOUT_STRUCTURE OHLCV·positive max→100
// 정규화)을 LIVE minimum-signal scorer(buildMinimumSignalScoreTrace)에 연결하되,
// 본 flag OFF(기본)면 각 transform 이 기존 산출과 byte-equivalent 값을 반환한다.
// ADR-0546(regime-aware required-score)·ADR-0611(SECTOR_RS 재활성)과 동일 패턴 —
// "ENV OFF=byte-identical, 항상 관측 계산" 의 Gate1 ENV 게이트 단일 거주지.
// requiredScore=70(LEGACY_GATE1_REQUIRED_SCORE)·computedScore=ΣweightedScore·
// passed 판정 라인 무변경. flip 은 Phase 2(운영자 forward-outcome 성숙 후) 사안.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Gate1 천장 배선 활성 스위치. default ON (ADR-0643 burn-down activation).
 * `GATE1_POSITIVE_CEILING_WIRING_ENABLED=false` 1줄로 baseline byte-identical 즉시 롤백.
 * 미설정(unset)·`=true`/`=1`/`=yes` → ON (관용). `!== 'false'` default-ON 패턴(ADR-0578 선례).
 * OFF 분기(transform identity)는 보존 — D4 sunset cleanup 은 별도 후속 패치로 연기(ADR-0643 D2).
 * 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용한다.
 */
export function isGate1PositiveCeilingWiringEnabled(): boolean {
  return process.env.GATE1_POSITIVE_CEILING_WIRING_ENABLED !== 'false';
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0627 — Gate1 RS percentile 연속 승격 스위치 (default OFF, byte-identical)
//
// decompositionBuilder 의 RS percentile→relativeStrengthScore 변환이 연속
// percentile(rsRankPct 0~100)을 5단 step(0/2/5/8/10)으로 양자화해 p<50 을 전부
// 0 으로 붕괴시켰다(정보 손실 버그). 본 flag ON 시 step 대신 연속 승격
// (clamp(rsRankPct/10, 0, 10))으로 이미 계산된 percentile 분해능을 손실 없이
// 복원한다. maxScore 10·weight 1 무변경 — weight 인상이 아니라 손실 복원.
// p=100 은 step·연속 동일 10(천장 무변). OFF=byte-identical(기존 step 유지).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Gate1 RS percentile 연속 승격 스위치. default ON (ADR-0643 burn-down activation).
 * `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED=false` 1줄로 step 양자화 baseline 즉시 롤백.
 * 미설정(unset)·`=true`/`=1`/`=yes` → ON (관용). `!== 'false'` default-ON 패턴(ADR-0578 선례).
 * OFF 분기(step 양자화)는 보존 — D4 sunset cleanup 은 별도 후속 패치로 연기(ADR-0643 D2).
 * 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용한다.
 */
export function isGate1RsPercentileContinuousEnabled(): boolean {
  return process.env.GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED !== 'false';
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0640 — Gate1 Denominator Normalization 활성 스위치 (default OFF, byte-identical)
//
// 결손(UNKNOWN/MISSING/STALE) 컴포넌트의 maxScore 가 분모(configuredPositiveMax)에
// 남아 requiredScore=70 의 실효 문턱을 올리는 구조를 교정한다. flag ON 시 결손 maxScore 를
// 분모에서 제외하고 requiredScore 를 가용 분모 비례로 축소(절대 인상 안 함, 하한 0.7× clamp).
// 불변식 #6 완결(점수 중립화 + 분모 제외). OFF = passed/scoreGap byte-identical(레거시 70 고정).
// default ON (ADR-0643 burn-down activation). `=false` 1줄로 effective===requiredScore(70) 즉시 롤백.
// 미설정(unset)·`=true`/`=1`/`=yes` → ON (관용). OFF 분기(early-return)는 보존 — D4 cleanup 후속 연기.
// ───────────────────────────────────────────────────────────────────────────
export function isGate1DenominatorNormalizationEnabled(): boolean {
  return process.env.GATE1_DENOMINATOR_NORMALIZATION_ENABLED !== 'false';
}
