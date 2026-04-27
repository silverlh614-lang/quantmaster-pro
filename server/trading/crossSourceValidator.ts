/**
 * @responsibility 다중 소스 교차 검증 SSOT — primary vs secondary 격차 임계 분기 (ADR-0071)
 *
 * 사용자 보고 (2026-04-27): /regime 메시지 USD/KRW 1,380 표시되지만 실제 시장 1,474.
 * 신선도 라인은 ✅ 0.4h (PR-2 ADR-0058) 인데 *값 자체가 stale*. 원인:
 * macroState.usdKrw 가 Yahoo `KRW=X` 단일 소스 — Yahoo 가 어떤 이유로 stale 값을
 * 반환해도 교차 검증 0.
 *
 * 본 모듈은 같은 지표의 두 독립 소스 (예: Yahoo `KRW=X` + ECOS `fetchLatestUsdKrw`)
 * 격차를 % 단위로 계산해 임계 초과 시 secondary 우선 + 운영자 경보.
 *
 * 정책:
 *   - 격차 ≥ critical 임계 (default 5%) → CRITICAL: secondary 우선 + diverged=true
 *   - 격차 ≥ warn 임계 (default 3%) → WARNING: secondary 우선 + warning 메시지
 *   - 그 외 → primary 우선 (intraday 신선도 우수, 정상 운영)
 *
 * secondary=null 시 항상 primary 사용 (fallback 안전 — ECOS_API_KEY 미설정 등).
 * primary=null + secondary 있음 → secondary 사용 (한쪽이라도 있으면 좋음).
 * 둘 다 null → selected=null, diverged=false (호출자가 미수집 처리).
 *
 * 외부 의존성 0 — 순수 함수.
 */

export interface CrossSourceThresholds {
  /** 격차 ≥ 본 % → WARNING + secondary 우선. default 3. */
  warnPct: number;
  /** 격차 ≥ 본 % → CRITICAL + secondary 우선 + diverged=true. default 5. */
  criticalPct: number;
}

export const DEFAULT_DIVERGENCE_THRESHOLDS: CrossSourceThresholds = {
  warnPct: 3,
  criticalPct: 5,
};

export type DivergenceTier = 'AGREED' | 'WARN' | 'CRITICAL' | 'PRIMARY_ONLY' | 'SECONDARY_ONLY' | 'NO_DATA';

export interface CrossSourceResult {
  /** Primary 소스 (예: Yahoo intraday). null 이면 미수집/실패. */
  primary: number | null;
  /** Secondary 소스 (예: ECOS 한국은행 공식). null 이면 미수집/실패. */
  secondary: number | null;
  /** 정책 분기 후 선택된 값. 둘 다 null 이면 null. */
  selected: number | null;
  /** 어느 소스가 선택됐는지 (UI/디버깅). */
  selectedSource: 'PRIMARY' | 'SECONDARY' | null;
  /** 격차 % (|primary - secondary| / secondary × 100). 한쪽 null 이면 null. */
  divergencePct: number | null;
  /** 분기 결과 tier. */
  tier: DivergenceTier;
  /** 격차 임계 초과 (CRITICAL) 여부 — 운영자 알림 트리거. */
  diverged: boolean;
  /** 한국어 경고/사유 메시지. AGREED 면 빈 문자열. */
  message: string;
  /** 사용된 임계값 (디버깅). */
  thresholds: CrossSourceThresholds;
}

/**
 * 격차 % 계산 — secondary 가 분모. secondary=0 또는 NaN → null.
 *
 * 환율·금리 같은 양수 값에 한정. 음수 값(예: yield curve 스프레드) 사용 시 호출자가
 * 절댓값 비교로 별도 분기.
 */
export function computeDivergencePct(primary: number | null, secondary: number | null): number | null {
  if (primary === null || secondary === null) return null;
  if (!Number.isFinite(primary) || !Number.isFinite(secondary)) return null;
  if (secondary === 0) return null;
  const pct = Math.abs(primary - secondary) / Math.abs(secondary) * 100;
  return parseFloat(pct.toFixed(3));
}

/**
 * 두 소스 격차 평가 SSOT.
 *
 * @param primary    1차 소스 (intraday 우선, 예: Yahoo KRW=X)
 * @param secondary  2차 소스 (공식 우선, 예: ECOS fetchLatestUsdKrw)
 * @param label      한국어 라벨 (메시지용, 예: 'USD/KRW')
 * @param thresholds 임계값 override
 */
export function evaluateCrossSource(
  primary: number | null,
  secondary: number | null,
  label: string,
  thresholds: CrossSourceThresholds = DEFAULT_DIVERGENCE_THRESHOLDS,
): CrossSourceResult {
  const { warnPct, criticalPct } = thresholds;

  // 둘 다 null
  if (primary === null && secondary === null) {
    return {
      primary: null,
      secondary: null,
      selected: null,
      selectedSource: null,
      divergencePct: null,
      tier: 'NO_DATA',
      diverged: false,
      message: `${label}: 양 소스 모두 미수집`,
      thresholds,
    };
  }

  // primary 만 있음
  if (primary !== null && secondary === null) {
    return {
      primary,
      secondary: null,
      selected: primary,
      selectedSource: 'PRIMARY',
      divergencePct: null,
      tier: 'PRIMARY_ONLY',
      diverged: false,
      message: `${label}: secondary 미수집 (primary ${primary} 사용)`,
      thresholds,
    };
  }

  // secondary 만 있음
  if (primary === null && secondary !== null) {
    return {
      primary: null,
      secondary,
      selected: secondary,
      selectedSource: 'SECONDARY',
      divergencePct: null,
      tier: 'SECONDARY_ONLY',
      diverged: false,
      message: `${label}: primary 미수집 (secondary ${secondary} 사용)`,
      thresholds,
    };
  }

  // 둘 다 있음 — 격차 계산
  const divergencePct = computeDivergencePct(primary, secondary);
  // 분모 0 / NaN 안전 fallback
  if (divergencePct === null) {
    return {
      primary,
      secondary,
      selected: secondary,  // 보수적 fallback (공식 우선)
      selectedSource: 'SECONDARY',
      divergencePct: null,
      tier: 'NO_DATA',
      diverged: false,
      message: `${label}: 격차 계산 불가 (secondary=${secondary})`,
      thresholds,
    };
  }

  if (divergencePct >= criticalPct) {
    return {
      primary,
      secondary,
      selected: secondary,  // CRITICAL 격차 시 공식 데이터 우선
      selectedSource: 'SECONDARY',
      divergencePct,
      tier: 'CRITICAL',
      diverged: true,
      message:
        `${label}: 격차 ${divergencePct.toFixed(2)}% (≥${criticalPct}%) — primary ${primary!.toFixed(2)}, secondary ${secondary!.toFixed(2)}. 공식 소스(secondary) 우선 사용.`,
      thresholds,
    };
  }

  if (divergencePct >= warnPct) {
    return {
      primary,
      secondary,
      selected: secondary,  // WARN 격차도 공식 우선 (보수적)
      selectedSource: 'SECONDARY',
      divergencePct,
      tier: 'WARN',
      diverged: false,  // CRITICAL 만 diverged=true (알림 트리거)
      message:
        `${label}: 격차 ${divergencePct.toFixed(2)}% (≥${warnPct}%) — primary ${primary!.toFixed(2)}, secondary ${secondary!.toFixed(2)}. 공식 소스 우선.`,
      thresholds,
    };
  }

  // AGREED — primary 우선 (intraday 신선도)
  return {
    primary,
    secondary,
    selected: primary,
    selectedSource: 'PRIMARY',
    divergencePct,
    tier: 'AGREED',
    diverged: false,
    message: '',
    thresholds,
  };
}

/** /health · 텔레그램 메시지용 한국어 라벨. */
export function formatDivergenceTier(tier: DivergenceTier): string {
  switch (tier) {
    case 'AGREED':         return '✅ 일치';
    case 'WARN':           return '🟡 격차 경고';
    case 'CRITICAL':       return '❌ 격차 임계 초과';
    case 'PRIMARY_ONLY':   return '🟡 primary 단독';
    case 'SECONDARY_ONLY': return '🟡 secondary 단독';
    case 'NO_DATA':        return '⚠️ 미수집';
  }
}
