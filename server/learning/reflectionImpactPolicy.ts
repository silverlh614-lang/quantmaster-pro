// @responsibility reflection 모듈 status 판정 SSOT — silent / deprecated 임계 정책 (ADR-0047 PR-Y2)
/**
 * reflectionImpactPolicy.ts — Reflection Module Half-Life 정책 SSOT
 *
 * 사용자 원안 임계:
 *   - 영향률 < 1% (180일) → 'deprecated' (실행 자체 스킵)
 *   - 영향률 < 5% (180일) → 'silent' (실행은 하되 CH4 출력 억제)
 *   - 그 외 → 'normal'
 *   - 신규 모듈 30일 grace period (평가 대상 외)
 *   - 표본 < 20건이면 'grace' (false positive 차단)
 *
 * ENV 롤백: LEARNING_REFLECTION_HALFLIFE_DISABLED=true → 모든 모듈 'normal' 강제.
 */

import { getModuleStats, type ModuleStats } from '../persistence/reflectionImpactRepo.js';

export type ModuleStatus = 'normal' | 'grace' | 'silent' | 'deprecated';

export interface ReflectionImpactPolicyOptions {
  /** 영향률 윈도우 (기본 180일) */
  windowDays?: number;
  /** 신규 모듈 grace period (기본 30일) */
  gracePeriodDays?: number;
  /** silent 임계 영향률 (기본 0.05 = 5%) */
  silentThreshold?: number;
  /** deprecated 임계 영향률 (기본 0.01 = 1%) */
  deprecatedThreshold?: number;
  /** 평가 대상 최소 표본 (기본 20건) */
  minSamples?: number;
}

const DEFAULT_OPTIONS: Required<ReflectionImpactPolicyOptions> = {
  windowDays: 180,
  gracePeriodDays: 30,
  silentThreshold: 0.05,
  deprecatedThreshold: 0.01,
  minSamples: 20,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isDisabled(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  return process.env.LEARNING_REFLECTION_HALFLIFE_DISABLED === 'true';
}

function parseDate(s: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00.000Z');
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * 모듈의 status 판정 — 결정 트리:
 *
 *   1. ENV 무력화 → 'normal'
 *   2. firstSeenAt 부재 또는 grace period 내 → 'grace'
 *   3. 윈도우 표본 < minSamples → 'grace'
 *   4. 영향률 < deprecatedThreshold → 'deprecated'
 *   5. 영향률 < silentThreshold → 'silent'
 *   6. 그 외 → 'normal'
 */
export function getModuleStatus(
  module: string,
  now: Date = new Date(),
  opts?: ReflectionImpactPolicyOptions,
): ModuleStatus {
  if (isDisabled()) return 'normal';

  const o = { ...DEFAULT_OPTIONS, ...(opts ?? {}) };
  const stats = getModuleStats(module, o.windowDays, now);

  // 1. firstSeenAt 부재 → 신규 모듈 (grace)
  if (!stats.firstSeenAt) return 'grace';

  // 2. grace period 내 → 평가 대상 외
  const firstDate = parseDate(stats.firstSeenAt);
  if (firstDate) {
    const ageDays = (now.getTime() - firstDate.getTime()) / DAY_MS;
    if (ageDays < o.gracePeriodDays) return 'grace';
  }

  // 3. 표본 부족 → grace (false positive 차단)
  if (stats.runs < o.minSamples) return 'grace';

  // 4~6. 임계 적용
  if (stats.impactRate < o.deprecatedThreshold) return 'deprecated';
  if (stats.impactRate < o.silentThreshold) return 'silent';
  return 'normal';
}

/** 알려진 모든 모듈의 status 일괄 반환 (진단·텔레메트리용) */
export interface ModuleStatusReport {
  module: string;
  status: ModuleStatus;
  impactRate: number;
  runs: number;
  meaningfulRuns: number;
  firstSeenAt: string | null;
  ageDays: number | null;
}

export function getAllModuleStatuses(
  modules: string[],
  now: Date = new Date(),
  opts?: ReflectionImpactPolicyOptions,
): ModuleStatusReport[] {
  return modules.map(m => {
    const stats = getModuleStats(m, opts?.windowDays ?? DEFAULT_OPTIONS.windowDays, now);
    const status = getModuleStatus(m, now, opts);
    let ageDays: number | null = null;
    if (stats.firstSeenAt) {
      const d = parseDate(stats.firstSeenAt);
      if (d) ageDays = Math.floor((now.getTime() - d.getTime()) / DAY_MS);
    }
    return {
      module: m,
      status,
      impactRate: stats.impactRate,
      runs: stats.runs,
      meaningfulRuns: stats.meaningfulRuns,
      firstSeenAt: stats.firstSeenAt,
      ageDays,
    };
  });
}

/**
 * Reflection 모듈 카탈로그 — `nightlyReflectionEngine` 가 실제 호출하는 13개.
 * 신규 모듈 추가 시 본 배열 + nightlyReflectionEngine wiring 동시 갱신.
 */
export const KNOWN_REFLECTION_MODULES = [
  'mainReflection',
  'personaRoundTable',
  'fiveWhy',
  'counterfactual',
  'conditionConfession',
  'regretQuantifier',
  'biasHeatmap',
  'experimentProposal',
  'narrativeGenerator',
  'manualExitReview',
  'metaDecisionJournal',
  'weeklyReflectionAudit',
  'reflectionGemini',
] as const;

export type KnownReflectionModule = (typeof KNOWN_REFLECTION_MODULES)[number];

export const REFLECTION_IMPACT_POLICY_CONSTANTS = {
  ...DEFAULT_OPTIONS,
} as const;

export { type ModuleStats };
