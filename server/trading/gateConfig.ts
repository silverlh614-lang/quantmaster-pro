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
// ADR-0613 — Gate1 Positive-Ceiling Wiring 승격 스위치 (ADR-0644 default ON)
//
// 천장 배선 2종(RS percentile 입력·BREAKOUT_STRUCTURE OHLCV)을 LIVE
// minimum-signal scorer(buildMinimumSignalScoreTrace)에 연결한다. ADR-0644 로
// default ON 승격 — explicit `=false` kill-switch 로 byte-identical OFF 복귀(ENV 1줄 즉시 롤백).
// positive max→100 정규화는 ADR-0643 으로 전용 flag(isGate1PositiveMaxNormalizationEnabled,
// default OFF 유지)로 분리됐다 — 본 flag 와 무관. requiredScore=70(LEGACY_GATE1_REQUIRED_SCORE)·
// computedScore=ΣweightedScore·passed 판정 라인 무변경.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Gate1 천장 배선 활성 스위치. default ON (explicit `=false` 로 비활성, ADR-0644).
 * `GATE1_POSITIVE_CEILING_WIRING_ENABLED !== 'false'` (ADR-0157 정합 — 미설정·`'true'`·
 * 기타값 = ON, 정확히 `'false'` 만 kill-switch OFF). ENV 1줄 즉시 롤백.
 * 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용한다.
 */
export function isGate1PositiveCeilingWiringEnabled(): boolean {
  return process.env.GATE1_POSITIVE_CEILING_WIRING_ENABLED !== 'false';
}

/**
 * Gate1 positive-max→100 정규화 스위치. default OFF — ADR-0613 단일 flag 번들에서 분리(ADR-0643).
 * `GATE1_POSITIVE_MAX_NORMALIZATION_ENABLED=true` 정확 비교(ADR-0157). 16/16 과개방 risk —
 * forward-outcome 성숙 전 flip 금지. 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용한다.
 */
export function isGate1PositiveMaxNormalizationEnabled(): boolean {
  return process.env.GATE1_POSITIVE_MAX_NORMALIZATION_ENABLED === 'true';
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0627 — Gate1 RS percentile 연속 승격 스위치 (ADR-0644 default ON)
//
// decompositionBuilder 의 RS percentile→relativeStrengthScore 변환이 연속
// percentile(rsRankPct 0~100)을 5단 step(0/2/5/8/10)으로 양자화해 p<50 을 전부
// 0 으로 붕괴시켰다(정보 손실 버그). 본 flag ON 시 step 대신 연속 승격
// (clamp(rsRankPct/10, 0, 10))으로 이미 계산된 percentile 분해능을 손실 없이
// 복원한다. maxScore 10·weight 1 무변경 — weight 인상이 아니라 손실 복원.
// p=100 은 step·연속 동일 10(천장 무변). explicit `=false`=byte-identical(기존 step 유지).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Gate1 RS percentile 연속 승격 스위치. default ON (explicit `=false` 로 비활성, ADR-0644).
 * `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED !== 'false'` (ADR-0157 정합 — 미설정·`'true'`·
 * 기타값 = ON, 정확히 `'false'` 만 kill-switch OFF). 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용한다.
 */
export function isGate1RsPercentileContinuousEnabled(): boolean {
  return process.env.GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED !== 'false';
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0640 — Gate1 Denominator Normalization 활성 스위치 (ADR-0644 default ON)
//
// 결손(UNKNOWN/MISSING/STALE) 컴포넌트의 maxScore 가 분모(configuredPositiveMax)에
// 남아 requiredScore=70 의 실효 문턱을 올리는 구조를 교정한다. flag ON 시 결손 maxScore 를
// 분모에서 제외하고 requiredScore 를 가용 분모 비례로 축소(절대 인상 안 함, 하한 0.7× clamp).
// 불변식 #6 완결(점수 중립화 + 분모 제외). ADR-0644 로 default ON 승격 —
// explicit `=false` kill-switch 로 passed/scoreGap byte-identical(레거시 70 고정) 복귀(ENV 1줄 즉시 롤백).
// ───────────────────────────────────────────────────────────────────────────
// default ON (explicit `=false` 로 비활성, ADR-0644). `!== 'false'` (ADR-0157 정합 —
// 미설정·`'true'`·기타값 = ON, 정확히 `'false'` 만 kill-switch OFF). ENV 1줄 즉시 롤백.
export function isGate1DenominatorNormalizationEnabled(): boolean {
  return process.env.GATE1_DENOMINATOR_NORMALIZATION_ENABLED !== 'false';
}

// ───────────────────────────────────────────────────────────────────────────
// (ADR-0646 배선 수리 → ADR-0647 default ON flip) — Gate1 VOLUME_LIQUIDITY 입력 배선 복구 스위치
//
// volumeLiquidityScore 가 avgVolume 을 `avgVolume`/`quote.avgVolume`/`quoteFeatures.avgVolume`
// 에서만 읽어, 시스템 카논 필드인 `avgVolume20d`(index.ts:91·quote.avgVolume20d) 와
// `symbolFeatures.avgVolume20d`/`volumeRatio` 가 적재돼 있어도 ratio 분기에 도달하지 못해
// 전 종목 0 점으로 붕괴(RAW_AVAILABLE_SCORE_NOT_PROMOTED). flag ON 시 이미 존재하는
// raw volume 필드(avgVolume20d/volumeRatio/volume)를 정식 입력으로 소비해 기존 ratio 공식
// 으로 점수를 복원한다. 신규 fetch 0·신규 점수 공식 0·maxScore 12 무변경. 진짜 결손 종목은
// 0 graceful(불변식 #6). ADR-0646 으로 OFF 머지 후 운영자 효과 확인(8/24 종목 점수 기여,
// Gate1 finalScoreAvg 54.1→59.8) → ADR-0647 로 default ON 승격. `=false` kill-switch=byte-identical OFF 복귀.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Gate1 VOLUME_LIQUIDITY 입력 배선 복구 스위치. default ON since ADR-0647 (explicit `=false` 로
 * 비활성, ADR-0157 거울 — opt-IN `=== 'true'` 의 거울 대칭 opt-OUT `!== 'false'`). 미설정·임의값 = ON,
 * 정확히 `'false'` 만 kill-switch OFF. `=false` 1줄 즉시 byte-equivalent 롤백.
 * 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용한다.
 */
export function isGate1VolumeLiquidityWiringEnabled(): boolean {
  return process.env.GATE1_VOLUME_LIQUIDITY_WIRING_ENABLED !== 'false';
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0648 (배선) → ADR-0649 default ON flip — 눌림목 진입 레인 + 과열 가드 + RRR-우선 (Balanced 프리셋)
//
// breakoutMomentumEvaluator 에 레인 B(눌림목: 20일 고점 직하 되돌림 + MA20 추세 유지 +
// 거래량 마름)와 레인 C 과열 가드(price/high5d > 1.06 추격 거부)를 추가하고, 눌림목 레인
// FIRED 후보에 Gate3 RRR ≥ 2.0 하한을 정합한다. ADR-0648 으로 default OFF 도입(byte-identical)
// 후 운영자(silverlh614) "default on" 승인 → ADR-0649 로 default ON 승격. 현 engineMode=SHADOW_ONLY
// 라 live 주문 0 안전창에서 실제 레인 shadow forward-return 수집(hypothetical 대신 실 레인 점화).
// explicit `=false` kill-switch=byte-identical OFF(단일 강/약 돌파 레인) 복귀.
// ───────────────────────────────────────────────────────────────────────────

/**
 * 눌림목 진입 레인 활성 스위치. default ON since ADR-0649 (explicit `=false` 로 비활성,
 * ADR-0157 거울 — opt-IN `=== 'true'` 의 거울 대칭 opt-OUT `!== 'false'`). 미설정·임의값 = ON,
 * 정확히 `'false'` 만 kill-switch OFF. `=false` 1줄 즉시 byte-equivalent 롤백(단일 레인).
 * 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용한다.
 */
export function isPullbackEntryLaneEnabled(): boolean {
  return process.env.GATE_PULLBACK_ENTRY_LANE_ENABLED !== 'false';
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0650 — 눌림목 레인 forward-return 관측 라인 활성 스위치 (default OFF)
//
// 스캔-시점 force-ON stamp 를 forward-return 성숙 대상 관측 row 로 영속(D1)하고,
// PULLBACK_LANE sourceType 으로 forward 1D/3D/5D 를 성숙(D2)시키며, /gate_audit 에
// 눌림목 vs 추격 비교를 표시(D4)하는 관측 라인 전체를 게이트한다. 관측 전용·
// executionImpact=NONE — flag OFF=byte-equivalent(row 영속 0·source 0·진입/Gate 무변경).
// stamp *집계* 산출(pullbackLaneShadowAdr0648)은 flag 무관 force-ON 유지(현 동작 무변경).
// ───────────────────────────────────────────────────────────────────────────

/**
 * 눌림목 레인 forward-return 관측 활성 스위치. default OFF (ADR-0157 opt-IN `=== 'true'`).
 * 미설정·임의값 = OFF, 정확히 `'true'` 만 활성. ENV 1줄 즉시 byte-equivalent 롤백.
 * 게이트 대상: D1 관측 row 영속 + D2 PULLBACK_LANE source enabled. 관측 전용·executionImpact=NONE.
 * 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용한다.
 */
export function isPullbackLaneForwardObservationEnabled(): boolean {
  return process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED === 'true';
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0651 W2 — Leader 랭킹 TR param 정합 활성 스위치 (default OFF / SHADOW_OFF)
//
// leader institutional-net-buy 를 검증된 외국인 investor 응답(sort='1')에서
// orgn_ntby_qty>0 파생으로 정합 + volume `fid_div_cls_code:'0'` 보정. leader 발굴
// 종목 구성을 바꾸므로 ENV flag 뒤에 둔다(ADR-0157 opt-IN `=== 'true'` default OFF).
// OFF = 기존 kisRankingClient TR_SPECS param byte-identical. 랭킹=발굴 전용·
// executionImpact=NONE — LIVE 매매 무영향. 신규 KIS 호출 0(기존 investor 응답 재사용).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Leader 랭킹 param 정합 활성 스위치. default OFF (ADR-0157 opt-IN `=== 'true'`).
 * 미설정·임의값 = OFF, 정확히 `'true'` 만 활성. ENV 1줄 즉시 byte-identical 롤백.
 * 게이트 대상: institutional-net-buy(검증된 외국인 sort='1' param) + volume div_cls 보정.
 * 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용한다.
 */
export function isLeaderRankingParamFixEnabled(): boolean {
  return process.env.LEADER_RANKING_PARAM_FIX_ENABLED === 'true';
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0652 — Leader/Screener 랭킹 endpoint 문자열 정정 활성 스위치 (default ON / kill-switch)
//
// KIS 공식 GitHub(koreainvestment/open-trading-api) 1:1 검증 결과, 현재 leader/screener
// 랭킹 endpoint 문자열이 bare 404 를 유발한다(검증된 결함):
//   - volume          → path 가 /ranking/volume (오) → /quotations/volume-rank (정)
//   - market-cap      → tr_id FHPST01720000/scr 20172 (오) → FHPST01740000/scr 20174 (정)
//   - institutional   → /ranking/investor+FHPST01600000 (KIS 미존재 → 404) →
//                       /quotations/foreign-institution-total + FHPTJ04400000 (정)
// 현 endpoint 가 100% broken(404) 이므로 default ON kill-switch(`!== 'false'`). `=false` 시
// 즉시 구(broken) 문자열로 byte-identical 롤백. 랭킹=발굴/관측 전용·engineMode SHADOW_ONLY —
// executionImpact=NONE(LIVE 매매 무영향). endpoint-fix ON 시 institutional-net-buy 는
// foreign-institution-total 로 마이그레이션되며 ADR-0651 W2 sort param 분기를 supersede 한다.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Leader/Screener 랭킹 endpoint 정정 활성 스위치. default ON (kill-switch `!== 'false'`).
 * 정확히 `'false'` 만 OFF(구 broken 문자열로 byte-identical 롤백), 그 외 모두 ON.
 * 게이트 대상: volume path · market-cap trId+scr · institutional foreign-institution-total 전환.
 * 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용한다.
 */
export function isLeaderRankingEndpointFixEnabled(): boolean {
  return process.env.LEADER_RANKING_ENDPOINT_FIX_ENABLED !== 'false';
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0655 — Gate2 재무 위험종목 선별 (FUNDAMENTAL_QUALITY 점수 페널티) 활성 스위치
//            (default OFF / SHADOW_OFF)
//
// Gate2 FUNDAMENTAL_QUALITY 축이 재무 위험종목을 점수 페널티로 강등한다(하드차단 아님):
//   - ICR < 1 (이자보상배율 — 영업이익으로 이자비용 미충당) → 위험 trigger 1
//   - 부채비율 > 200% (KIS stability-ratio lblt_rate, 한국 시장 통념상 과다) → 위험 trigger 2
// 위험 1건 → FUNDAMENTAL_QUALITY score ≤ 30(WEAK) / 2건 → ≤ 15(CRITICAL).
//
// 불변식 #6 보존: 재무 위험/결손은 데이터 해석이며 bearish market signal 이 아니다 —
//   entryHardBlock=false(점수 cap 만), marketSignal=false, executionImpact=NONE.
//   임계 입력 결손(ICR/부채비율 null) 시 페널티 미적용(graceful) — 결손 ≠ 위험.
//
// explicit `=false` (kill-switch) = buildFundamentalAxis 현행 score 산출 byte-identical(cap 미적용).
// ON 이어도 위험 trigger 0개 종목은 byte-identical(scoreCap=null). ENV 1줄 즉시 롤백.
// ADR-0656 default OFF→ON flip(opt-OUT `!== 'false'`, ADR-0157 거울·ADR-0645/0647/0649 동일 패턴):
//   운영자 승인으로 ADR-0655 가 OFF byte-identical 로 출하한 재무위험 페널티를 default ON 승격.
// 현 engineMode=SHADOW_ONLY 라 live 주문 0 — explicit `=false` 1줄 kill-switch 롤백 상시 가능.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Gate2 재무 위험 페널티 활성 스위치. default ON (ADR-0656 flip, opt-OUT `!== 'false'`).
 * 미설정·임의값 = ON(위험종목 FUNDAMENTAL_QUALITY score-cap 적용), 정확히 `'false'` 만 OFF(kill-switch).
 * 게이트 대상: ICR<1 / 부채비율>200% trigger → FUNDAMENTAL_QUALITY score-cap(30/15).
 * 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용한다. entryHardBlock=false·불변식 #6.
 */
export function isGate2FinancialRiskPenaltyEnabled(): boolean {
  return process.env.GATE2_FINANCIAL_RISK_PENALTY_ENABLED !== 'false';
}
