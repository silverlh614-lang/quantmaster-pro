/**
 * @responsibility MarketDataHealthScore SSOT — 시장 데이터 품질 통합 점수 (ADR-0070)
 *
 * 사용자 진단 #5 후속 — 운영자가 시장 데이터 전체 품질을 한눈에 보는 0-100 점수 + tier.
 * macroState staleness (ADR-0068) + market-indicators staleFields (ADR-0069) + Yahoo
 * health + KIS circuit + KRX OpenAPI 5축을 가중평균.
 *
 * 점수 정책:
 *   - 시작 100점 (전부 정상)
 *   - macroState STALE_BLOCK / NO_DATA → -40점 (자동매매 차단 수준)
 *   - macroState STALE_WARN → -15점
 *   - indicators staleFields 1개 → -10점 / 3개 → -25점 / 5+ → -40점
 *   - Yahoo DOWN → -25점 / DEGRADED → -10점 / UNKNOWN → -5점
 *   - KIS 회로 OPEN → -20점 / 연속 실패 ≥ 3 → -10점
 *   - KRX 토큰 invalid → -15점 (configured 만 false 면 -5점, env 미설정은 운영 선택)
 *   - 점수 floor 0
 *
 * Tier:
 *   - score ≥ 85 → HEALTHY
 *   - 60 ≤ score < 85 → DEGRADED
 *   - score < 60 → CRITICAL
 *
 * 외부 호출 0 — 모두 read-only (HealthSnapshot + MacroStalenessResult + staleFields).
 */
import type { HealthSnapshot } from './diagnostics.js';
import { evaluateMacroStaleness, type MacroStalenessResult } from '../trading/macroStaleness.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';

/**
 * ADR-0071: divergence axis 차감 정책.
 *   - tier=CRITICAL (격차 ≥5%) → -25
 *   - tier=WARN     (격차 ≥3%) → -10
 *   - PRIMARY_ONLY / SECONDARY_ONLY → -5 (한쪽 소스 단독)
 *   - AGREED / NO_DATA / 미수집 → 0
 */
const DIVERGENCE_DEDUCTION: Record<string, number> = {
  CRITICAL: 25,
  WARN: 10,
  PRIMARY_ONLY: 5,
  SECONDARY_ONLY: 5,
};

export type MarketDataHealthTier = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export interface MarketDataHealthScore {
  /** 0-100 통합 점수. */
  score: number;
  tier: MarketDataHealthTier;
  /** 점수 차감 요인 별도 노출 (UI / 디버깅). */
  deductions: Array<{ axis: string; reason: string; deduction: number }>;
  /** 부가 진단 정보. */
  details: {
    macroStaleness: MacroStalenessResult;
    staleFieldCount: number;
    staleFields: string[];
    yahooStatus: string;
    kisCircuitOk: boolean;
    krxOk: boolean;
  };
}

/** Tier 분류 임계값 SSOT — 변경 시 ADR-0070 §2.2 갱신. */
export const MARKET_DATA_HEALTH_THRESHOLDS = {
  HEALTHY_MIN: 85,
  DEGRADED_MIN: 60,
} as const;

export function classifyMarketDataHealthTier(score: number): MarketDataHealthTier {
  if (!Number.isFinite(score)) return 'CRITICAL';
  const clamped = Math.max(0, Math.min(100, score));
  if (clamped >= MARKET_DATA_HEALTH_THRESHOLDS.HEALTHY_MIN) return 'HEALTHY';
  if (clamped >= MARKET_DATA_HEALTH_THRESHOLDS.DEGRADED_MIN) return 'DEGRADED';
  return 'CRITICAL';
}

/**
 * 통합 점수 계산. snapshot 인자 미전달 시 외부 호출 안 함 (test friendly).
 *
 * @param snapshot HealthSnapshot 부분 사용 (yahoo / kis circuit / krx)
 * @param staleFields /api/market-indicators 응답의 staleFields (서버 응답 헤더 또는 직접 전달)
 * @param now 시각 mock (테스트용)
 */
export function computeMarketDataHealthScore(
  snapshot: Pick<HealthSnapshot, 'yahoo' | 'kisConfigured' | 'krxTokenConfigured' | 'krxTokenValid' | 'krxCircuitState' | 'krxFailures'>,
  staleFields: string[] = [],
  now: Date = new Date(),
): MarketDataHealthScore {
  const macro = loadMacroState();
  const macroStaleness = evaluateMacroStaleness(macro, now);

  let score = 100;
  const deductions: Array<{ axis: string; reason: string; deduction: number }> = [];

  // ── 1축: macroState staleness ──
  if (macroStaleness.tier === 'STALE_BLOCK' || macroStaleness.tier === 'NO_DATA') {
    score -= 40;
    deductions.push({ axis: 'macroState', reason: macroStaleness.reason, deduction: 40 });
  } else if (macroStaleness.tier === 'STALE_WARN') {
    score -= 15;
    deductions.push({ axis: 'macroState', reason: macroStaleness.reason, deduction: 15 });
  }

  // ── 2축: market-indicators staleFields ──
  const cnt = staleFields.length;
  if (cnt >= 5) {
    score -= 40;
    deductions.push({ axis: 'indicators', reason: `${cnt}개 stale`, deduction: 40 });
  } else if (cnt >= 3) {
    score -= 25;
    deductions.push({ axis: 'indicators', reason: `${cnt}개 stale`, deduction: 25 });
  } else if (cnt >= 1) {
    score -= 10;
    deductions.push({ axis: 'indicators', reason: `${cnt}개 stale`, deduction: 10 });
  }

  // ── 3축: Yahoo health ──
  const yahooStatus = snapshot.yahoo?.status ?? 'UNKNOWN';
  if (yahooStatus === 'DOWN') {
    score -= 25;
    deductions.push({ axis: 'yahoo', reason: 'DOWN', deduction: 25 });
  } else if (yahooStatus === 'DEGRADED') {
    score -= 10;
    deductions.push({ axis: 'yahoo', reason: 'DEGRADED', deduction: 10 });
  } else if (yahooStatus === 'UNKNOWN') {
    score -= 5;
    deductions.push({ axis: 'yahoo', reason: 'UNKNOWN (부팅 직후 또는 데이터 부족)', deduction: 5 });
  }

  // ── 4축: KIS 회로 ──
  // krxCircuitState 는 KRX 회로지만 KIS circuit 정보는 HealthSnapshot 에 직접 노출 안 됨
  // 임시: kisConfigured=false 만 차감 (LIVE 모드에서 KIS 미설정 시 데이터 수집 불가)
  const kisCircuitOk = snapshot.kisConfigured;
  if (!snapshot.kisConfigured) {
    score -= 5;
    deductions.push({ axis: 'kis', reason: 'KIS_APP_KEY 미설정', deduction: 5 });
  }

  // ── 6축: ADR-0071 — usdKrw 다중 소스 격차 ──
  // macroState.usdKrwDivergenceTier 가 CRITICAL/WARN 이면 차감.
  const macroAny = macro as Record<string, unknown> | null;
  const divergenceTier = typeof macroAny?.usdKrwDivergenceTier === 'string'
    ? (macroAny.usdKrwDivergenceTier as string)
    : null;
  if (divergenceTier && DIVERGENCE_DEDUCTION[divergenceTier] !== undefined) {
    const ded = DIVERGENCE_DEDUCTION[divergenceTier];
    score -= ded;
    const divPct = typeof macroAny?.usdKrwDivergencePct === 'number'
      ? macroAny.usdKrwDivergencePct
      : null;
    const reasonLabel =
      divergenceTier === 'CRITICAL' ? `USD/KRW 격차 임계 초과 (${divPct?.toFixed(2) ?? 'N/A'}%)` :
      divergenceTier === 'WARN'     ? `USD/KRW 격차 경고 (${divPct?.toFixed(2) ?? 'N/A'}%)` :
      divergenceTier === 'PRIMARY_ONLY'   ? 'USD/KRW secondary 미수집 (Yahoo 단독)' :
      'USD/KRW primary 미수집 (ECOS 단독)';
    deductions.push({ axis: 'divergence', reason: reasonLabel, deduction: ded });
  }

  // ── 5축: KRX OpenAPI ──
  let krxOk = true;
  if (!snapshot.krxTokenConfigured) {
    score -= 5;
    deductions.push({ axis: 'krx', reason: 'KRX 토큰 미설정', deduction: 5 });
    krxOk = false;
  } else if (!snapshot.krxTokenValid) {
    score -= 15;
    deductions.push({ axis: 'krx', reason: 'KRX 토큰 invalid', deduction: 15 });
    krxOk = false;
  } else if (snapshot.krxCircuitState === 'OPEN') {
    score -= 20;
    deductions.push({ axis: 'krx', reason: '회로 OPEN', deduction: 20 });
    krxOk = false;
  } else if (snapshot.krxFailures >= 3) {
    score -= 10;
    deductions.push({ axis: 'krx', reason: `연속 실패 ${snapshot.krxFailures}회`, deduction: 10 });
  }

  const finalScore = Math.max(0, score);
  const tier = classifyMarketDataHealthTier(finalScore);

  return {
    score: finalScore,
    tier,
    deductions,
    details: {
      macroStaleness,
      staleFieldCount: cnt,
      staleFields: [...staleFields],
      yahooStatus,
      kisCircuitOk,
      krxOk,
    },
  };
}

/** /health 텔레그램 메시지용 한국어 라벨. */
export function formatMarketDataHealthLine(score: MarketDataHealthScore): string {
  const tierIcon =
    score.tier === 'HEALTHY' ? '✅' :
    score.tier === 'DEGRADED' ? '🟡' : '❌';
  const tierLabel =
    score.tier === 'HEALTHY' ? '정상' :
    score.tier === 'DEGRADED' ? '저하' : '위험';
  if (score.deductions.length === 0) {
    return `${tierIcon} ${score.score}/100 (${tierLabel})`;
  }
  const topDeduction = score.deductions
    .slice()
    .sort((a, b) => b.deduction - a.deduction)
    [0];
  return `${tierIcon} ${score.score}/100 (${tierLabel}) — 주요: ${topDeduction.axis} ${topDeduction.reason} -${topDeduction.deduction}`;
}
