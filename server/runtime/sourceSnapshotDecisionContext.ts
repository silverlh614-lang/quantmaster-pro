// @responsibility ADR-0535 read-model contract projecting canonical regime/execution/scoring authorities into one diagnostic object for operator screens.

/**
 * ADR-0535 — Regime Authority Hierarchy / SourceSnapshotDecisionContext (READ-MODEL ONLY).
 *
 * 이 모듈은 *타입 계약*만 정의한다. 빌더 구현(`buildSourceSnapshotDecisionContext`)은
 * engine-dev 가 별도 파일에서 채운다(아래 입력 계약 `SourceSnapshotDecisionContextInput` 사용).
 *
 * READ-MODEL ONLY: 기존 정본 소스 위의 타입 투영(projection)일 뿐, 어떤 계산도 바꾸지 않는다.
 *   - server/runtime/executionPermissionResolver.ts (ExecutionPermissionResolution) — 실행 권한 정본
 *   - server/trading/regime/regimeResolver.ts (ResolvedRegimeSnapshot) — raw/effective/display/riskOverride 정본
 *   - server/trading/regime/gate0RegimeView.ts (Gate0RegimeView) — legacyEffective(deprecated) 라벨
 *   - server/trading/sizing/regimePositionPolicy.ts (RegimePositionPolicy) — exposure/maxPositions/positionCap
 *
 * 5단계 권한 위계(verbatim, ADR-0535 §Decision):
 *   1. 최종 주문 권한        = ExecutionPolicy(ExecutionPermissionResolution). 실주문 가능 여부를 단독 결정.
 *   2. 운영자 톱라인 표시 권한 = displayRegime (예: SHADOW_ONLY).
 *   3. 스코어링/사이징/Kelly  = effectiveRegime (예: R3_EARLY / R5_CAUTION). 실주문 권한을 직접 결정하지 않음.
 *   4. 시장 원시 상태        = rawRegime. 순수 시장 국면이지 주문 권한 근거가 아님.
 *   5. legacyEffectiveRegime = 진단/비교 전용. deprecated=true, usedForDecision=false. Gate/스코어/사이징/권한에 절대 미투입.
 *
 * 핵심 원칙: "R3_EARLY/R5_CAUTION 은 시장/스코어링 레짐, SHADOW_ONLY 는 실행/표시 정책이다.
 *            최종 주문 권한은 레짐 이름이 아니라 ExecutionPolicySnapshot 이 결정한다."
 */

/**
 * 운영자 화면용 4값 DISPLAY 라벨. resolver 의 2값 finalExecutionPolicy
 * (`'LIVE_ORDER_ALLOWED' | 'SHADOW_AND_DIAGNOSTIC_ONLY'`)와 별개의 *파생 표시 필드*다.
 * resolver 시그니처는 바꾸지 않는다.
 *
 * 매핑 규칙(구현은 engine-dev 담당, 본 모듈은 union + 규칙 문서화만 한다):
 *   - resolver.finalExecutionPolicy === 'LIVE_ORDER_ALLOWED'            → 'LIVE_ALLOWED'
 *   - resolver.finalExecutionPolicy === 'SHADOW_AND_DIAGNOSTIC_ONLY'    → 'SHADOW_AND_DIAGNOSTIC_ONLY' (그대로)
 *   - displayRegime/engineMode === 'SELL_ONLY'                          → 'SELL_ONLY'
 *   - engineMode === 'OBSERVE_ONLY'                                     → 'OBSERVE_ONLY'
 * SELL_ONLY / OBSERVE_ONLY 는 표시 세분화일 뿐, resolver 상으로는 여전히 비-LIVE 정책이며
 * liveEntryAllowed=false 를 보장해야 한다(ADR-0535 불변식 #2).
 */
export type FinalExecutionPolicyDisplayLabel =
  | 'LIVE_ALLOWED'
  | 'SHADOW_AND_DIAGNOSTIC_ONLY'
  | 'SELL_ONLY'
  | 'OBSERVE_ONLY';

/**
 * 시장/스코어링 레짐 권위(위계 2~5단계). 모든 값은 정본 RegimeResolver 출력에서 투영된다.
 * legacyEffectiveRegime 은 진단/비교 전용이며 결정에 절대 사용되지 않는다.
 */
interface SourceSnapshotMarketRegimeView {
  /** 위계 4: 순수 시장 국면. 주문 권한 근거 아님. (RegimeResolver detectedRegime / diagnostics.rawRegime) */
  rawRegime: string;
  /** 위계 3: 스코어링/사이징/Kelly 권위. 실주문 권한을 직접 결정하지 않음. */
  effectiveRegime: string;
  /** 위계 2: 운영자 톱라인 표시 권위(예: SHADOW_ONLY). */
  displayRegime: string;
  /** R5/SHADOW_ONLY 등 위험 오버라이드 라벨. 없으면 null. */
  riskOverride: string | null;
  /** 표시용 정책 뷰(예: riskOverride 또는 displayRegime 파생). */
  policyView: string;
  /** 위계 5: legacy(transitionState) effective. 정본과 다를 때만 존재. */
  legacyEffectiveRegime?: string;
  /** legacy 값은 항상 deprecated. */
  legacyDeprecated?: boolean;
  /** legacy 값은 결정에 절대 사용되지 않음(리터럴 false). */
  legacyUsedForDecision: false;
  /** 정본 출처 표식(리터럴). */
  source: 'RegimeResolver.canonicalOutput';
}

/**
 * 위계 1: 최종 주문 권한. ExecutionPermissionResolution 에서 투영.
 * 실주문 가능 여부를 단독 결정하는 유일한 권위다(레짐 이름이 아님).
 */
interface SourceSnapshotExecutionPolicyView {
  /** 4값 DISPLAY 라벨(파생). resolver 2값과 별개. */
  finalExecutionPolicy: FinalExecutionPolicyDisplayLabel;
  /** 실매수 진입 허용. ExecutionPolicy 단독 권한(effectiveRegime 으로부터 true 될 수 없음 — 불변식 #1). */
  liveEntryAllowed: boolean;
  /** 실매도/청산 허용. */
  liveExitAllowed: boolean;
  /** 브로커 주문 라우팅 허용(SHADOW_ONLY display 면 false — 불변식 #3). */
  brokerOrderAllowed: boolean;
  brokerLiveOrderAllowed: boolean;
  brokerExitOrderAllowed: boolean;
  /** Shadow 매수(항상 살아 있어야 함 — 불변식 #2 보호 대상). */
  shadowBuyAllowed: boolean;
  /** Shadow 매도. */
  shadowSellAllowed: boolean;
  /** Shadow learning(불변식 #2 — 절대 멈추면 안 됨). resolver.shadowEvaluationAllowed 매핑. */
  shadowLearningAllowed: boolean;
  /** Counterfactual 평가 허용(resolver 상 항상 true). */
  counterfactualAllowed: boolean;
  /** 진단 평가 허용(resolver 상 항상 true). */
  diagnosticAllowed: boolean;
  /** live 차단 사유(resolver.liveBlockReason). */
  liveBlockReason?: string;
  /** 권한 산출 사유 라벨(resolver.executionPermissionReason). */
  executionPermissionReason?: string;
  /** 이번 패치 executionImpact 는 NONE. resolver.executionImpact 정규화 표시. */
  executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'LIVE_BLOCKED';
}

/**
 * 위계 3: 스코어링/사이징/Kelly 권위. effectiveRegime + ExecutionPermissionResolution
 * (scorePenalty/sizingMultiplier) + RegimePositionPolicy(exposure/maxPositions/positionCap)에서 투영.
 * 어떤 필드도 실주문 권한을 결정하지 않는다.
 */
interface SourceSnapshotScoringPolicyView {
  /** resolver.scorePenalty. */
  scorePenalty: number;
  /** resolver.sizingMultiplier. */
  sizingMultiplier: number;
  /** finalKellyMultiplier / kellyMultiplierFromRegime 정본 표시값. */
  kellyMultiplier: number;
  /** RegimePositionPolicy.maxGrossExposurePct. */
  exposureCap: number;
  /** RegimePositionPolicy.maxPositions. */
  maxPositions: number;
  /** RegimePositionPolicy.perPositionPct. */
  positionCap: number;
}

interface SourceSnapshotFreshnessPolicyView {
  snapshotFreshnessForLive: string;
  snapshotFreshnessForShadow: string;
  usableForLiveOrder: boolean;
  usableForBrokerOrder: boolean;
}

/**
 * SourceSnapshotDecisionContext — 모든 운영자 화면이 읽는 단일 진단 read-model.
 * 정본 계산은 바꾸지 않는다. 화면 간 동일 snapshotId ⟹ 동일 권위값을 보장하기 위한 SSOT 투영.
 */
export interface SourceSnapshotDecisionContext {
  snapshotId: string;
  asOf: string;
  ttlSec: number;
  regimeConstitution: SourceSnapshotMarketRegimeView;
  marketRegime: SourceSnapshotMarketRegimeView;
  executionPolicy: SourceSnapshotExecutionPolicyView;
  scoringPolicy: SourceSnapshotScoringPolicyView;
  freshnessPolicy: SourceSnapshotFreshnessPolicyView;
}

/**
 * 정규화된 executionPolicy 입력 — 빌더가 executionPolicy 뷰를 투영하는 데 필요한 *정확한* 필드만 담는다.
 * (ADR-0535 engine-dev 정정) 어떤 호출처도 bare `ExecutionPermissionResolution` 를 들고 있지 않다:
 *   - 매크로 카드는 `EngineRuntimePolicy`(resolveEngineRuntimePolicy → 내부 resolveExecutionPermission)를 들고 있다.
 *     `EngineRuntimePolicy` 는 본 인터페이스를 구조적으로 만족하므로 그대로 전달 가능하다(정본 투영).
 *   - /scan_blockers 는 Gate0Decision + resolvePermissionView 결과를 본 형상으로 매핑한다.
 * 이는 재계산이 아니라 정본 권한 결과의 *투영(normalization)* 이다.
 */
export interface SourceSnapshotExecutionPolicyInput {
  /** resolver 2값 정책 라벨('LIVE_ORDER_ALLOWED' | 'SHADOW_AND_DIAGNOSTIC_ONLY'). */
  finalExecutionPolicy: string;
  liveEntryAllowed: boolean;
  liveExitAllowed: boolean;
  brokerOrderAllowed: boolean;
  brokerLiveOrderAllowed?: boolean;
  brokerExitOrderAllowed?: boolean;
  shadowBuyAllowed: boolean;
  shadowSellAllowed: boolean;
  shadowLearningAllowed: boolean;
  counterfactualAllowed: boolean;
  diagnosticAllowed: boolean;
  liveBlockReason?: string;
  executionPermissionReason?: string;
  /** EngineRuntimePolicy 의 4값('LIVE_ORDER_ALLOWED'/'LIVE_ORDER_BLOCKED' 포함) 또는 표시 3값. 빌더가 NONE 기준으로 정규화. */
  executionImpact: string;
  /** 'NORMAL'|'DEGRADED'|'SELL_ONLY'|'SHADOW_ONLY'|'OBSERVE_ONLY'. */
  engineMode: string;
  scorePenalty?: number;
  sizingMultiplier?: number;
  snapshotFreshnessForLive?: string;
  snapshotFreshnessForShadow?: string;
  usableForLiveOrder?: boolean;
  usableForBrokerOrder?: boolean;
}

/**
 * 빌더 입력 계약 — engine-dev 가 정본 소스들을 그대로 전달한다(READ-MODEL: 재계산 금지, 투영만).
 * 각 필드는 기존 정본 객체를 가리키며, 빌더는 이들로부터 SourceSnapshotDecisionContext 를 매핑한다.
 *
 * 매핑 출처(불변):
 *   - regimeSnapshot → marketRegime.{rawRegime(detectedRegime), effectiveRegime, displayRegime, riskOverride}
 *   - gate0View.legacy → marketRegime.{legacyEffectiveRegime, legacyDeprecated}
 *   - executionPolicy(정규화) → executionPolicy.* + scoringPolicy.{scorePenalty, sizingMultiplier}
 *   - regimePositionPolicy → scoringPolicy.{exposureCap, maxPositions, positionCap}
 *   - macroGateState(선택) → scan_blockers 측 미러값 정합/보강용(예: kellyMultiplier, brokerOrderAllowed)
 *
 * 두 호출처(매크로 카드 / scan_blockers)가 모두 공급 가능한 primitives 로 동작한다.
 * 빌더 본문은 engine-dev 가 구현한다(server/runtime/sourceSnapshotDecisionContextBuilder.ts).
 */
export interface SourceSnapshotDecisionContextInput {
  /** server/trading/regime/regimeResolver.ts resolveRegimeSnapshot() 결과(매크로 카드 측). 없으면 raw primitives 사용. */
  regimeSnapshot: import('../trading/regime/effectiveRegimeSnapshot.js').ResolvedRegimeSnapshot;
  /** server/trading/regime/gate0RegimeView.ts buildGate0RegimeView() 결과. */
  gate0View: import('../../src/types/gate0Regime.js').Gate0RegimeView;
  /** 정규화된 실행 권한 투영(EngineRuntimePolicy 가 구조적으로 만족; scan 측은 매핑). */
  executionPolicy: SourceSnapshotExecutionPolicyInput;
  /** server/trading/sizing/regimePositionPolicy.ts getRegimePositionPolicy() 결과. */
  regimePositionPolicy: import('../trading/sizing/regimePositionPolicy.js').RegimePositionPolicy;
  /** Kelly 표시값 정본(finalKellyMultiplier 우선). 없으면 빌더가 1 처리. */
  kellyMultiplier?: number;
  /**
   * 선택: scan_blockers 측 ScanSummary.macroGateState. 화면 간 정합 비교/보강 전용.
   * 정본은 위 객체들이며 macroGateState 는 표시 미러일 뿐 권위 출처가 아니다.
   */
  macroGateState?: import('../trading/signalScanner/scanDiagnostics/scanSummaryTypes.js').MacroGateState;
}
