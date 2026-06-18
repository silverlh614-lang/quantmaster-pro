// @responsibility ADR-0624 D4 — shadow-즉시·live-게이트 학습 조건가중치 승격 resolver + provider 등록(/promote_learning 전용).
/**
 * learningWeightPromotionApply.ts (ADR-0624 D4 — SHADOW→LIVE 학습 승격)
 *
 * shadow/candidate 학습 가중치(loadCandidateConditionWeights)를 live 조건가중치 provider 로 승격.
 * 안전 모델 (D1 'shadow 기본 작동·LIVE 만 게이트' 동형):
 *   1. provider 등록 = operator 1회 확인(/promote_learning apply). 미등록(기본) → null → byte-identical.
 *   2. **shadow/paper 모드(getTradingMode()!=='LIVE') → apply 만으로 즉시 반영**(실돈 영향 0).
 *      **LIVE 모드 → ENV LEARNING_WEIGHT_PROMOTION_ENABLED=true 필수**(paper→live 자동차단·불변식 #7 backstop).
 *   3. DEFAULT_CONDITION_WEIGHTS 기준 [×CLAMP_LO,×CLAMP_HI]·CORE_FLOOR 하한 clamp — pathological 값 차단.
 *
 * register/unregister 는 서버 기동 자동배선 안 함 — 명령 전용. revert 로 즉시 해제(byte-identical).
 * getTradingMode 표준 가드(preflight/dryRunScanner/twoBarBepGate 등과 동일 — ADR-0626 패턴).
 */
import { DEFAULT_CONDITION_WEIGHTS, type ConditionWeights } from '../quantFilter.js';
import {
  loadCandidateConditionWeights,
  registerLearnedConditionWeightProvider,
} from '../persistence/conditionWeightsRepo.js';
import { isLearningWeightPromotionEnabled } from './weightPromotionFlag.js';
import { getTradingMode } from '../state.js';

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
  tradingMode: string;
  hasCandidate: boolean;
  applied: boolean;
  regime: string;
  changes: LearningWeightPromotionChange[];
}

/**
 * 조건가중치 학습 승격 resolver.
 * LIVE 모드 + ENV master OFF → null(#7 backstop). shadow/paper → 등록만으로 적용.
 * candidate 없음 → null(파일 직독 byte-identical). 충족 시 DEFAULT 기준 창으로 clamp.
 * 테스트는 injected.candidate 로 디스크 I/O 우회.
 */
export function resolveLearnedConditionWeights(
  regime?: string,
  injected?: { candidate?: Partial<ConditionWeights> | null },
): Partial<ConditionWeights> | null {
  // LIVE 실행 모드에서만 ENV master 필수(paper→live 자동차단). shadow/paper 는 등록(operator apply)만으로 충분.
  if (getTradingMode() === 'LIVE' && !isLearningWeightPromotionEnabled()) return null;
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
    tradingMode: getTradingMode(),
    hasCandidate: !!candidate,
    applied: promotionApplied,
    regime,
    changes,
  };
}
