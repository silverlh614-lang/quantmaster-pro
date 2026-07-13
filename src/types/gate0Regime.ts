// @responsibility Gate0 매크로 레짐 정본 계약과 legacy 진단 라벨 타입을 정의한다.
import type { RegimeLevel } from './core';

/**
 * ADR-0531: Gate0 정본 출처 식별자 — 정본은 단 하나.
 * canonical = resolveRegimeSnapshot()의 ResolvedRegimeSnapshot.effectiveRegime.
 */
type Gate0CanonicalSource = 'REGIME_RESOLVER_SNAPSHOT';

/**
 * ADR-0531: legacy effectiveRegime(regimeBridge transitionState)는 표시 전용.
 * deprecated/notUsedForDecision literal 로 의사결정 차단을 컴파일 타임에 강제한다.
 */
interface Gate0LegacyRegimeDisplay {
  readonly legacyEffective: RegimeLevel | string;
  readonly deprecated: true;
  readonly notUsedForDecision: true;
  readonly source: 'REGIME_BRIDGE_TRANSITION_STATE';
}

/**
 * ADR-0531: 정본 레짐 + 그 보조 의미. 소비처는 본 view 만 읽는다.
 * marketSignal: false literal — 데이터 결손이 bearish 로 변환되지 않게 강제(불변식 #6).
 */
export interface Gate0RegimeView {
  readonly source: Gate0CanonicalSource;
  readonly effectiveRegime: RegimeLevel | string;
  readonly displayRegime: string;
  readonly detectedRegime: string;
  readonly riskOverride: string;
  readonly providerIssue: boolean;
  readonly marketSignal: false;
  readonly legacy?: Gate0LegacyRegimeDisplay;
}

/**
 * ADR-0530: VKOSPI 값 1건의 신뢰 상태 — L1 원천이라도 sanity 실패 시 강등.
 * 값 자체는 보정/0치환하지 않고 신뢰 상태만 분류한다(불변식 #6: null≠0).
 */
export type VkospiTrustState =
  | 'TRUSTED'
  | 'UNTRUSTED_IMPLAUSIBLE'
  | 'UNTRUSTED_STALE'
  | 'MISSING';

/**
 * ADR-0530: VKOSPI stale/implausible 신뢰 판정 결과.
 * R6-recovery vkospiOk 판정에서 격리 여부(guardTriggered)를 결정한다.
 */
export interface VkospiSanityVerdict {
  readonly trustState: VkospiTrustState;
  readonly vkospi: number | null;
  readonly vix: number | null;
  readonly vixDivergence: number | null;
  readonly kospiDayReturn: number | null;
  readonly guardTriggered: boolean;
  readonly providerIssue: boolean;
  readonly marketSignal: false;
  readonly reasons: readonly string[];
}
