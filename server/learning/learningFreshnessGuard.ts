// @responsibility ADR-0173 §5 LearningFreshnessGuard — 학습 데이터 시간 감쇠 + regime 불일치 SSOT
/**
 * learningFreshnessGuard.ts (ADR-0173 §5) — Phase 1 SSOT (호출자 0건 dead code).
 *
 * 학습 데이터 (lessons) 의 시간 감쇠 + regime 불일치 감쇠 정책 단일 진입점.
 *
 * 결정 트리 우선순위 (다중 조건 동시 충족 시 곱셈 결합):
 *   1. ENV `LEARNING_FRESHNESS_GUARD_ENABLED !== 'true'` → 입력 그대로 (no-op)
 *   2. ageDays NaN / Infinity / 음수 → 입력 그대로 (안전 fallback)
 *   3. ageDays > 30 → `weight = 0` (만료, 절대 규칙)
 *   4. ageDays > 14 → `weight × 0.3` (감쇠)
 *   5. lesson.regime && currentRegime && lesson.regime !== currentRegime → `weight × 0.5`
 *
 * 다중 조건 동시 (예: 14일 + regime 불일치) → 0.3 × 0.5 = 0.15 (곱셈 결합).
 *
 * 외부 의존성 0 — 순수 함수 (fs/외부 API/zustand store 미사용).
 *
 * Phase 1 dead code — Phase 3 ReflectionInjectionBus wiring 별도 PR (ENV `=true` 활성화 후).
 *
 * 적용 대상 5 lesson 타입 (Phase 3 결합):
 *   - recentReflections / conditionLessons / biasHeatmap / counterfactualLessons / gateAttributionLessons
 */

// ─── 타입 SSOT ────────────────────────────────────────────────────────────────

/**
 * 학습 lesson 메타데이터 — 호출자 측 추가 필드 자유 (T extends LessonWithMeta).
 *
 * weight: 0~1 정규화 권장 (정책상 강제 안 함)
 * ageDays: lesson 생성 후 경과 일수
 * regime: lesson 생성 시점 시장 레짐 (옵셔널 — 둘 다 정의 시에만 비교)
 */
export interface LessonWithMeta {
  weight: number;
  ageDays: number;
  regime?: string;
}

export interface FreshnessDatedLessonMeta {
  date?: string;
  generatedAt?: string;
  savedAt?: string;
  regime?: string | null;
}

// ─── 상수 SSOT ────────────────────────────────────────────────────────────────

/** ageDays > 14 시 감쇠 비율 — 사용자 §5 명세. */
export const FRESHNESS_DECAY_14D_RATIO = 0.3;
/** ageDays > 30 시 만료값 — 사용자 §5 명세. */
export const FRESHNESS_EXPIRY_30D = 0;
/** lesson.regime !== currentRegime 시 감쇠 비율 — 사용자 §5 명세. */
export const REGIME_MISMATCH_RATIO = 0.5;
/** 감쇠 임계 — 14일 초과. */
export const FRESHNESS_DECAY_AGE_DAYS = 14;
/** 만료 임계 — 30일 초과. */
export const FRESHNESS_EXPIRY_AGE_DAYS = 30;

// ─── ENV 헬퍼 ─────────────────────────────────────────────────────────────────

/**
 * ENV `LEARNING_FRESHNESS_GUARD_ENABLED=true` 정확 비교.
 *   - `'1'` / `'TRUE'` / 임의 truthy 모두 거부
 *   - default OFF — Phase 3 wiring 후 운영자 명시 활성화 의무
 */
export function isFreshnessGuardEnabled(): boolean {
  return process.env.LEARNING_FRESHNESS_GUARD_ENABLED === 'true';
}

export function ageDaysFromDateLike(
  dateLike: string | undefined | null,
  now: Date = new Date(),
): number | null {
  if (!dateLike) return null;
  const ms = Date.parse(dateLike.length === 10 ? `${dateLike}T00:00:00Z` : dateLike);
  const nowMs = now.getTime();
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return null;
  return Math.floor((nowMs - ms) / (24 * 60 * 60 * 1000));
}

export function freshnessWeightFromMeta(
  meta: FreshnessDatedLessonMeta,
  currentRegime?: string,
  now: Date = new Date(),
): number {
  const ageDays = ageDaysFromDateLike(meta.generatedAt ?? meta.savedAt ?? meta.date, now);
  if (ageDays === null) return 1;
  return applyFreshnessDecay(
    {
      weight: 1,
      ageDays,
      regime: typeof meta.regime === 'string' ? meta.regime : undefined,
    },
    currentRegime,
    now,
  ).weight;
}

export function applyFreshnessDecayToNeutralWeightedRecord<T extends Record<string, number>>(
  weights: T,
  meta: FreshnessDatedLessonMeta,
  currentRegime?: string,
  now: Date = new Date(),
): T {
  const freshnessWeight = freshnessWeightFromMeta(meta, currentRegime, now);
  if (freshnessWeight === 1) return weights;

  const adjusted: Record<string, number> = {};
  for (const [key, value] of Object.entries(weights)) {
    const n = Number(value);
    adjusted[key] = Number.isFinite(n) ? 1 + (n - 1) * freshnessWeight : value;
  }
  return adjusted as T;
}

// ─── 진입점 ───────────────────────────────────────────────────────────────────

/**
 * lesson 의 weight 에 시간 감쇠 + regime 불일치 감쇠 적용.
 *
 * 호출자 코드 (Phase 3 ReflectionInjectionBus wiring 시):
 * ```typescript
 * const adjustedLessons = recentReflections.map(l =>
 *   applyFreshnessDecay(l, currentMarketRegime),
 * );
 * ```
 *
 * @param lesson - LessonWithMeta 호환 객체 (호출자 추가 필드 보존)
 * @param currentRegime - 현재 시장 레짐 (옵셔널 — 양쪽 정의 시에만 비교)
 * @param now - 비교 기준 시각 (테스트 주입). 기본 현재 시각 — 본 PR 에서는 ageDays 가 입력값이라 사용 안 함.
 * @returns 입력 type 보존된 새 객체 (T extends LessonWithMeta)
 */
export function applyFreshnessDecay<T extends LessonWithMeta>(
  lesson: T,
  currentRegime?: string,
  now?: Date,
): T {
  void now; // 시그니처 호환 — ageDays 가 입력값이라 본 PR 사용 안 함

  // ENV OFF → 입력 그대로 (no-op)
  if (!isFreshnessGuardEnabled()) {
    return lesson;
  }

  const { ageDays } = lesson;

  // 안전 fallback — NaN / Infinity / 음수 → no-op
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    return lesson;
  }

  let weight = lesson.weight;

  // 1. 만료 (ageDays > 30) — 절대 규칙, 다른 조건 무시
  if (ageDays > FRESHNESS_EXPIRY_AGE_DAYS) {
    return { ...lesson, weight: FRESHNESS_EXPIRY_30D };
  }

  // 2. 감쇠 (ageDays > 14)
  if (ageDays > FRESHNESS_DECAY_AGE_DAYS) {
    weight = weight * FRESHNESS_DECAY_14D_RATIO;
  }

  // 3. regime 불일치 (둘 다 정의 시에만)
  if (
    typeof lesson.regime === 'string' &&
    lesson.regime.length > 0 &&
    typeof currentRegime === 'string' &&
    currentRegime.length > 0 &&
    lesson.regime !== currentRegime
  ) {
    weight = weight * REGIME_MISMATCH_RATIO;
  }

  return { ...lesson, weight };
}
