// @responsibility ADR-0624 D4 — flag-gated·clamped 학습 조건가중치 승격 resolver + provider 등록(operator-gated, default OFF byte-identical).
/**
 * learningWeightPromotionApply.ts (ADR-0624 D4 — SHADOW→LIVE 단일 확인 게이트의 조건가중치 절반)
 *
 * shadow/candidate 학습 가중치(loadCandidateConditionWeights)를 live 조건가중치 provider 로
 * 승격하는 유일한 경로. gateLearnedThresholdApply(Gate1 임계, ADR counterfacture Phase D)와 동형 3중 안전:
 *   1. ENV LEARNING_WEIGHT_PROMOTION_ENABLED=true (default OFF, ADR-0157 정확 비교) — 미설정 시 resolver 항상 null.
 *   2. candidate 파일에 학습 가중치가 존재해야 함(없으면 null → 파일 직독 byte-identical).
 *   3. DEFAULT_CONDITION_WEIGHTS 기준 [×CLAMP_LO, ×CLAMP_HI](CORE_FLOOR 하한) 창으로 clamp — pathological 값 차단.
 *
 * register/unregister 는 서버 기동 자동 호출 안 함 — /promote_learning 명령(operator 1회 확인) 전용.
 * 등록돼도 flag OFF 면 resolver 가 null → loadConditionWeights byte-identical(불변식 #7 paper→live 자동 차단 보존).
 */
import { DEFAULT_CONDITION_WEIGHTS, type ConditionWeights } from '../quantFilter.js';
import {
  loadCandidateConditionWeights,
  registerLearnedConditionWeightProvider,
} from '../persistence/conditionWeightsRepo.js';
import { isLearningWeightPromotionEnabled } from './weightPromotionFlag.js';

/** DEFAULT 기준 하한/상한 배수 + 절대 하한(0.30 floor) — pathological 가중치 차단. */
const CLAMP_LO = 0.4;
const CLAMP_HI = 2.0;
const CORE_FLOOR = 0.3;

function defaultWeight(key: string): number {
  const def = (DEFAULT_CONDITION_WEIGHTS as Record<string, number>)[key];
  return Number.isFinite(def) ? def : 1;
}

/** raw 가중치를 DEFAULT 기준 창으로 clamp. 비유한/음수/0 → default 로 복원. */
function clampWeight(key: string, raw: unknown): number {
  const base = defaultWeight(key);
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return base;
  const lo = Math.max(CORE_FLOOR, base * CLAMP_LO);
  const hi = base * CLAMP_HI;
  return Math.min(Math.max(raw, lo), hi);
}

export interface LearningWeightPromotionChange {
  key: string;
  from: number;
  candidate: number;
  clamped: number;
}

export interface LearningWeightPromotionPreview {
  flagEnabled: boolean;
  hasCandidate: boolean;
  applied: boolean;
  regime: string;
  changes: LearningWeightPromotionChange[];
}

/**
 * 조건가중치 학습 승격 resolver. flag OFF / candidate 없음 → null(호출자 파일 직독 byte-identical).
 * 충족 시 candidate 가중치를 DEFAULT 기준 창으로 clamp 한 Partial 반환.
 * 테스트는 injected.candidate 로 디스크 I/O 우회.
 */
export function resolveLearnedConditionWeights(
  regime?: string,
  injected?: { candidate?: Partial<ConditionWeights> | null },
): Partial<ConditionWeights> | null {
  if (!isLearningWeightPromotionEnabled()) return null;
  const candidate = injected && 'candidate' in injected
    ? injected.candidate ?? null
    : loadCandidateConditionWeights(regime ?? 'GLOBAL');
  if (!candidate) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(candidate)) {
    out[key] = clampWeight(key, raw);
  }
  return out as Partial<ConditionWeights>;
}

let promotionApplied = false;

/** /promote_learning apply 전용 — live 조건가중치 provider 등록(명시 operator 배선). */
export function registerLearningWeightPromotion(): void {
  registerLearnedConditionWeightProvider((regime) => resolveLearnedConditionWeights(regime));
  promotionApplied = true;
}

/** /promote_learning revert 전용 — provider 해제 → byte-identical. */
export function unregisterLearningWeightPromotion(): void {
  registerLearnedConditionWeightProvider(null);
  promotionApplied = false;
}

export function isLearningWeightPromotionApplied(): boolean {
  return promotionApplied;
}

/** 상태 surface 용 preview(승격하면 무엇이 바뀌는지) — 산출만, provider 등록 부작용 0. */
export function getLearningWeightPromotionPreview(regime = 'GLOBAL'): LearningWeightPromotionPreview {
  const candidate = loadCandidateConditionWeights(regime);
  const changes: LearningWeightPromotionChange[] = [];
  if (candidate) {
    for (const [key, raw] of Object.entries(candidate)) {
      changes.push({
        key,
        from: defaultWeight(key),
        candidate: typeof raw === 'number' ? raw : NaN,
        clamped: clampWeight(key, raw),
      });
    }
  }
  return {
    flagEnabled: isLearningWeightPromotionEnabled(),
    hasCandidate: !!candidate,
    applied: promotionApplied,
    regime,
    changes,
  };
}
