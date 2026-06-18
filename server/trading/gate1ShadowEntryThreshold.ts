// @responsibility ADR-0608 진입 임계 분기 순수 SSOT — SHADOW(paper) 진입만 regime-aware(getEffectiveGateThreshold), LIVE/ENV OFF 는 legacy(getMinGateScore) byte-equivalent 로 환원하는 minGateScore 결정 + entryThresholdMode 라벨 (default OFF).
/**
 * gate1ShadowEntryThreshold.ts — ADR-0608 D1/D2/D3 단일 결정점.
 *
 * 진입 임계가 매수/paper-fill 을 차단하는 단일 지점(evaluateEntryRevalidation:370)에
 * 주입할 minGateScore 를 LIVE vs SHADOW 로 분기한다. 본체(entryEngine) 무변경 —
 * 임계 결정 seam 만 이곳으로 격리한다.
 *
 * 분기 진리표:
 *   ENV ON && isShadow → { getEffectiveGateThreshold(regime), 'REGIME_AWARE_SHADOW' }
 *   그 외 (LIVE || ENV OFF) → { getMinGateScore(regime),       'LEGACY' }
 *
 * ADR-0624 D1: 진입 자유화 flag 2개(Gate1 점수·Gate3 타이밍) default ON(opt-out, `!== 'false'`).
 *   비상 kill-switch(`SHADOW_LIBERALIZATION_KILL='true'`) 발동 시 둘 다 OFF → byte-identical 롤백.
 *
 * 불변식:
 *   - LIVE 분기(isShadow=false)는 ENV 와 무관하게 항상 getMinGateScore(regime) 1:1 (byte-equivalent).
 *   - 순수 함수 — provider/store/now 호출 0. 실패 가능 분기 없음(상수·산술만) → 불변식 #1 liveness.
 *   - 임계 수치는 KIS L1 점수 기반(getEffectiveGateThreshold/getMinGateScore) — L4 미사용(#7).
 *   - 라벨은 학습 표본 분리용 — 청산 규칙·사이징·LIVE 판정에 영향 0(#8).
 *
 * import 제약: getMinGateScore(entryEngine)·getEffectiveGateThreshold(gateConfig)만.
 *   KIS 주문/autoTradeEngine/persistence import 금지(선례 regime/riskOnFastUpgrade.ts).
 */

import { getMinGateScore } from './entryEngine.js';
import { getEffectiveGateThreshold } from './gateConfig.js';

/**
 * ADR-0624 D1 비상 kill-switch SSOT — `=== 'true'` 일 때만 발동(미설정=정상 가동).
 * 발동 시 LIVE-안전 shadow 진입 자유화 flag 2개(Gate1 점수·Gate3 타이밍)를 **둘 다 OFF** 로
 * 강제 → 오늘의 byte-identical 동작으로 1줄 즉시 롤백. shadow 자유화의 유일한 off-switch.
 * (opt-in flag 2개 → 비상 OFF 1개로 knob 축소. live 경로는 isShadow=false 라 항상 무영향.)
 */
export function isShadowLiberalizationKilled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.SHADOW_LIBERALIZATION_KILL === 'true';
}

/**
 * ADR-0608/0624 D1 SHADOW 전용 regime-aware 진입 임계 활성화 여부 — **default ON(opt-out)**.
 * ADR-0157 정확 비교 패턴(`!== 'false'`): 미설정/임의값=ON, `='false'` 1줄 롤백.
 * ADR-0624 비상 kill-switch(`SHADOW_LIBERALIZATION_KILL='true'`) 발동 시 무조건 OFF.
 * OFF(kill 또는 `='false'`): resolveEntryMinGateScore 가 LIVE/SHADOW 모두 getMinGateScore →
 * 현행 진입 byte-equivalent. live(isShadow=false)는 ENV/kill 무관 항상 byte-equivalent.
 */
export function isGate1RegimeAwareShadowEntryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isShadowLiberalizationKilled(env)) return false;
  return env.GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED !== 'false';
}

/**
 * ADR-0619/0624 D1 Gate3 타이밍 완화(shadow pre-breakout 진입) 활성화 여부 — **default ON(opt-out)**.
 * ADR-0157 정확 비교 패턴(`!== 'false'`): 미설정/임의값=ON, `='false'` 1줄 롤백.
 * ADR-0624 비상 kill-switch(`SHADOW_LIBERALIZATION_KILL='true'`) 발동 시 무조건 OFF.
 * ADR-0608 Gate1 flag 와 **독립**(각각 `='false'` 가능)하나 kill-switch 1개로 둘 다 정지 가능.
 * OFF: shadowTimingBypass 항상 false → `(SKIP && !false)===SKIP` byte-identical.
 * live(isShadow=false)는 ENV/kill 무관 byte-identical.
 */
export function isShadowPrebreakoutEntryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isShadowLiberalizationKilled(env)) return false;
  return env.SHADOW_PREBREAKOUT_ENTRY_ENABLED !== 'false';
}

/**
 * ADR-0608/0619 진입 임계 모드 라벨 — SHADOW 표본 격리용(학습 표본 오염 방지).
 *   'REGIME_AWARE_SHADOW': ADR-0608 ENV ON && isShadow 로 regime-aware 점수 임계 완화 진입.
 *   'PREBREAKOUT_SHADOW' : ADR-0619 Gate3 타이밍 완화(BAND_MISS/MTAS_WEAK SKIP 우회) 진입. Gate1+Gate3 동시 완화 시 우선.
 *   'LEGACY'            : 기존 진입(LIVE 전부 + ENV OFF + SHADOW 의 legacy 임계 통과분). default/후방호환.
 * 라벨은 학습 분리용일 뿐 청산 규칙·사이징·LIVE 판정에 영향 0.
 */
export type EntryThresholdMode = 'LEGACY' | 'REGIME_AWARE_SHADOW' | 'PREBREAKOUT_SHADOW';

/**
 * ADR-0619 라벨 carry 우선순위 SSOT. Gate1(점수)·Gate3(타이밍) 완화가 동시에 적용된 진입은
 * 더 약한 신호(타이밍 면제)를 표본 리스크 상한으로 본다 → PREBREAKOUT_SHADOW 우선(보수 층화).
 * 우선순위: PREBREAKOUT_SHADOW > REGIME_AWARE_SHADOW > LEGACY.
 * 라벨은 학습 표본 분리 전용 — 청산·사이징·LIVE 판정 영향 0(불변식 #8).
 */
export function resolveEntryThresholdModeLabel(
  base: EntryThresholdMode | undefined,
  gate3Liberalized: boolean,
): EntryThresholdMode {
  if (gate3Liberalized) return 'PREBREAKOUT_SHADOW';
  return base ?? 'LEGACY';
}

export interface ResolveEntryMinGateScoreInput {
  /** RegimeLevel 문자열 (예 'R3_EARLY'). 미지원/미전달 → 하류 함수가 R4_NEUTRAL fallback. */
  regime?: string;
  /** stockShadowMode — true=SHADOW(paper) 진입 경로. buyListLoop loopInitializer 산출값을 배선. */
  isShadow: boolean;
}

export interface ResolveEntryMinGateScoreResult {
  /** evaluateEntryRevalidation 에 주입할 minGateScore (×1 scale). */
  minGateScore: number;
  /** 적용된 임계 모드 — buildBuyTrade 가 ServerShadowTrade.entryThresholdMode 로 스탬프. */
  entryThresholdMode: EntryThresholdMode;
}

/**
 * ADR-0608 진입 임계 단일 결정점 (SSOT).
 *
 * 분기 진리표:
 *   isGate1RegimeAwareShadowEntryEnabled() === true && input.isShadow === true
 *     → { minGateScore: getEffectiveGateThreshold(regime), entryThresholdMode: 'REGIME_AWARE_SHADOW' }
 *   그 외 (LIVE 경로 || ENV OFF)
 *     → { minGateScore: getMinGateScore(regime),           entryThresholdMode: 'LEGACY' }
 *
 * getMinGateScore 가 현재 getEffectiveGateThreshold 를 반환하므로 두 값은 현 시점 동일 가능 —
 * '분리 seam' 확보가 목적(향후 LEGACY 진입 임계 변경 시 SHADOW 독립 보존).
 */
export function resolveEntryMinGateScore(
  input: ResolveEntryMinGateScoreInput,
): ResolveEntryMinGateScoreResult {
  if (isGate1RegimeAwareShadowEntryEnabled() && input.isShadow) {
    return {
      minGateScore: getEffectiveGateThreshold(input.regime),
      entryThresholdMode: 'REGIME_AWARE_SHADOW',
    };
  }
  return {
    minGateScore: getMinGateScore(input.regime),
    entryThresholdMode: 'LEGACY',
  };
}
