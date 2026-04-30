// @responsibility Data Trust 3-tier 정책 SSOT — 출처/용도 매핑 단일 진실
/**
 * dataTrustLayer.ts (ADR-0114) — 데이터 출처 신뢰도 3-tier 정책 SSOT.
 *
 * 사용자 분석 §"Yahoo 신뢰도 계층화" 직접 반영.
 *
 * Tier 1 — TRUTH (reconciliation_anchor)
 *   KIS_REAL_QUOTE / KIS_DAILY / KRX_OPENAPI / DART_FILING
 *   → 분쟁 시 *진실*. LIVE 매매 / 포지션 정합 / corporate action.
 *
 * Tier 2 — INDICATOR (derivation_input)
 *   YAHOO_FINANCE / NAVER_MOBILE / NAVER_FINANCE / GOOGLE_SEARCH
 *   → 기술 지표 / 차트 / 백테스트 / 스크리닝 입력. LIVE 결정에 직접 사용 금지.
 *
 * Tier 3 — INTERPRETATION (narrative_only)
 *   GEMINI_AI
 *   → 서술 / 회고 / Pre-Mortem 만. 가격/수치 결정 *절대 불가*.
 *
 * 통합 ADR — 0011/0015/0064/0094/0095/0098 의 부분 정책을 단일 SSOT 로 격상.
 */

export type DataTrustTier = 1 | 2 | 3;

export type TrustedSource =
  // Tier 1 — TRUTH
  | 'KIS_REAL_QUOTE'
  | 'KIS_DAILY'
  | 'KRX_OPENAPI'
  | 'DART_FILING'
  // Tier 2 — INDICATOR
  | 'YAHOO_FINANCE'
  | 'NAVER_MOBILE'
  | 'NAVER_FINANCE'
  | 'GOOGLE_SEARCH'
  // Tier 3 — INTERPRETATION
  | 'GEMINI_AI';

export type TrustedUse =
  // Tier 1 only
  | 'LIVE_TRADING'
  | 'POSITION_RECONCILE'
  | 'CORPORATE_ACTION'
  // Tier 1 + 2
  | 'SCREENING'
  | 'BACKTEST'
  | 'CHART_UI'
  // Tier 1 + 2 + 3
  | 'NARRATIVE'
  | 'REFLECTION'
  | 'PRE_MORTEM';

interface TierEntry {
  tier: DataTrustTier;
  sources: readonly TrustedSource[];
  role: 'reconciliation_anchor' | 'derivation_input' | 'narrative_only';
  allowedUse: readonly TrustedUse[];
}

/** ADR-0114 SSOT — 모든 호출자가 단일 진실 사용. */
export const DATA_TRUST_LAYER: Record<'TRUTH' | 'INDICATOR' | 'INTERPRETATION', TierEntry> = {
  TRUTH: {
    tier: 1,
    sources: ['KIS_REAL_QUOTE', 'KIS_DAILY', 'KRX_OPENAPI', 'DART_FILING'] as const,
    role: 'reconciliation_anchor',
    allowedUse: [
      'LIVE_TRADING',
      'POSITION_RECONCILE',
      'CORPORATE_ACTION',
      'SCREENING',
      'BACKTEST',
      'CHART_UI',
      'NARRATIVE',
      'REFLECTION',
      'PRE_MORTEM',
    ] as const,
  },
  INDICATOR: {
    tier: 2,
    sources: ['YAHOO_FINANCE', 'NAVER_MOBILE', 'NAVER_FINANCE', 'GOOGLE_SEARCH'] as const,
    role: 'derivation_input',
    allowedUse: [
      'SCREENING',
      'BACKTEST',
      'CHART_UI',
      'NARRATIVE',
      'REFLECTION',
      'PRE_MORTEM',
    ] as const,
  },
  INTERPRETATION: {
    tier: 3,
    sources: ['GEMINI_AI'] as const,
    role: 'narrative_only',
    allowedUse: ['NARRATIVE', 'REFLECTION', 'PRE_MORTEM'] as const,
  },
};

/** ENV 우회 — true 시 assertDataTrustLayer 가 throw 대신 console.warn 만. */
export function isDataTrustEnforcementDisabled(): boolean {
  return process.env.DATA_TRUST_ENFORCEMENT_DISABLED === 'true';
}

/**
 * source 가 어느 tier 인지 반환. 등록 안 된 source → null.
 */
export function getDataTrustTier(source: string): DataTrustTier | null {
  for (const entry of Object.values(DATA_TRUST_LAYER)) {
    if ((entry.sources as readonly string[]).includes(source)) {
      return entry.tier;
    }
  }
  return null;
}

/**
 * source 가 어느 카테고리(TRUTH/INDICATOR/INTERPRETATION)인지 반환.
 */
export function getDataTrustCategory(
  source: string,
): 'TRUTH' | 'INDICATOR' | 'INTERPRETATION' | null {
  for (const [category, entry] of Object.entries(DATA_TRUST_LAYER)) {
    if ((entry.sources as readonly string[]).includes(source)) {
      return category as 'TRUTH' | 'INDICATOR' | 'INTERPRETATION';
    }
  }
  return null;
}

export interface DataTrustViolationResult {
  ok: boolean;
  tier?: DataTrustTier;
  category?: 'TRUTH' | 'INDICATOR' | 'INTERPRETATION';
  reason?: string;
}

/**
 * source × intendedUse 조합이 정책에 부합하는지 판정.
 *
 * 위반 케이스:
 *   - source 미등록 → unknown_source
 *   - intendedUse 미허용 → use_not_allowed_for_tier
 *
 * 본 함수는 throw 안 함 — 호출자/테스트가 분기 결정.
 */
export function evaluateDataTrustViolation(
  source: string,
  intendedUse: string,
): DataTrustViolationResult {
  const category = getDataTrustCategory(source);
  if (!category) {
    return { ok: false, reason: 'unknown_source' };
  }
  const entry = DATA_TRUST_LAYER[category];
  const isAllowed = (entry.allowedUse as readonly string[]).includes(intendedUse);
  if (!isAllowed) {
    return {
      ok: false,
      tier: entry.tier,
      category,
      reason: `use_${intendedUse}_not_allowed_for_tier${entry.tier}_${category.toLowerCase()}`,
    };
  }
  return { ok: true, tier: entry.tier, category };
}

/**
 * 정책 enforcement — 위반 시 throw (ENV 우회 시 console.warn).
 *
 * 사용 예:
 *   assertDataTrustLayer('YAHOO_FINANCE', 'SCREENING');  // OK
 *   assertDataTrustLayer('YAHOO_FINANCE', 'LIVE_TRADING'); // throw
 *   assertDataTrustLayer('GEMINI_AI', 'LIVE_TRADING'); // throw
 */
export function assertDataTrustLayer(
  source: TrustedSource,
  intendedUse: TrustedUse,
): void {
  const result = evaluateDataTrustViolation(source, intendedUse);
  if (result.ok) return;

  const message =
    `[DataTrustLayer] 정책 위반: source='${source}' × use='${intendedUse}' — ` +
    `${result.reason ?? 'unknown'} (ADR-0114).`;

  if (isDataTrustEnforcementDisabled()) {
    console.warn(message);
    return;
  }
  throw new Error(message);
}

/** 등록된 모든 source 나열 (테스트/진단용). */
export function listAllTrustedSources(): TrustedSource[] {
  const all: TrustedSource[] = [];
  for (const entry of Object.values(DATA_TRUST_LAYER)) {
    all.push(...entry.sources);
  }
  return all;
}

/** 등록된 모든 intendedUse 나열. */
export function listAllTrustedUses(): TrustedUse[] {
  const set = new Set<TrustedUse>();
  for (const entry of Object.values(DATA_TRUST_LAYER)) {
    for (const u of entry.allowedUse) set.add(u);
  }
  return Array.from(set);
}
