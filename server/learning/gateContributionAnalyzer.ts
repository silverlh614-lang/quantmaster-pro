// @responsibility 게이트 차단 종목 사후 수익률 분석 SSOT (ADR-0324) — pure
/**
 * gateContributionAnalyzer.ts (ADR-0324) — 게이트 기여도 분석 (counterfactual).
 *
 * 사용자 5/6 명시 — 학습 데이터로 게이트의 실제 가치 검증.
 * 차단된 종목의 *그 후 가격 변화* 를 추적해 "게이트가 손실 회피인가, 기회 손실인가" 분류.
 *
 * 본 PR scope (Phase 1):
 *   - counterfactualShadow.loadCounterfactuals() read-only 분석
 *   - skipReason 패턴 별 winners/losers/neutral/unresolved 카운트
 *   - 순 분류 (POSITIVE/NEGATIVE/NEUTRAL/INSUFFICIENT_SAMPLE)
 *   - ENV `GATE_CONTRIBUTION_ANALYZER_DISABLED=true` 우회
 *   - cron + 텔레그램 알림 wiring 후속 PR 분리 (회귀 위험 격리)
 *
 * 입력:
 *   - CounterfactualEntry[] (counterfactualShadow.loadCounterfactuals() 영속)
 *   - skipReason 패턴 배열 (substring match — gate name 또는 SKIP/GATE_UNDER 등)
 *
 * 임계값:
 *   - WINNER_RETURN_THRESHOLD_PCT = 5  → return30d > 5% = 차단했지만 수익 종목
 *   - LOSER_RETURN_THRESHOLD_PCT  = -5 → return30d < -5% = 차단 정당화
 *   - DOMINANCE_RATIO = 1.5 → POSITIVE/NEGATIVE 분류 임계
 *   - MIN_RESOLVED_SAMPLE = 5 → 통계 신뢰도
 *
 * netClassification 의미:
 *   - POSITIVE — 게이트가 손실 회피에 기여 (losers > winners × 1.5)
 *   - NEGATIVE — 게이트가 알파 손실 (winners > losers × 1.5)
 *   - NEUTRAL — 균형 (대략 같은 비율)
 *   - INSUFFICIENT_SAMPLE — 표본 < 5
 */

import { loadCounterfactuals, type CounterfactualEntry } from './counterfactualShadow.js';

export const WINNER_RETURN_THRESHOLD_PCT = 5;
export const LOSER_RETURN_THRESHOLD_PCT = -5;
export const DOMINANCE_RATIO = 1.5;
export const MIN_RESOLVED_SAMPLE = 5;

export type GateContributionVerdict =
  | 'POSITIVE'
  | 'NEGATIVE'
  | 'NEUTRAL'
  | 'INSUFFICIENT_SAMPLE';

export interface GateContribution {
  /** skipReason substring 매칭 패턴 (예: 'GATE_UNDER', 'SECTOR_FULL', 'SKIP') */
  skipReasonPattern: string;
  /** 차단됐지만 +5% 이상 상승한 케이스 — 알파 손실 */
  blockedWinners: number;
  /** 차단되어 -5% 이하 하락 회피한 케이스 — 손실 회피 */
  blockedLosers: number;
  /** 차단 후 -5%~+5% 횡보 케이스 — 게이트 무관 */
  blockedNeutral: number;
  /** 30거래일 미경과 — return30d 부재 */
  blockedUnresolved: number;
  /** netClassification 분류 */
  verdict: GateContributionVerdict;
  /** 표본 합 (resolved 만) */
  resolvedSample: number;
}

/** ENV `GATE_CONTRIBUTION_ANALYZER_DISABLED=true` → 빈 배열 반환 (ADR-0157 정확 비교). */
export function isGateContributionAnalyzerDisabled(): boolean {
  return process.env.GATE_CONTRIBUTION_ANALYZER_DISABLED === 'true';
}

function classifyVerdict(
  winners: number,
  losers: number,
  resolvedSample: number,
): GateContributionVerdict {
  if (resolvedSample < MIN_RESOLVED_SAMPLE) return 'INSUFFICIENT_SAMPLE';
  // 양쪽 0 — 모두 NEUTRAL 횡보 → NEUTRAL 분류
  if (winners === 0 && losers === 0) return 'NEUTRAL';
  // POSITIVE — losers > winners × 1.5 (게이트 차단 정당)
  if (losers > winners * DOMINANCE_RATIO) return 'POSITIVE';
  // NEGATIVE — winners > losers × 1.5 (알파 손실 우세)
  if (winners > losers * DOMINANCE_RATIO) return 'NEGATIVE';
  return 'NEUTRAL';
}

/**
 * 단일 skipReason 패턴에 대한 게이트 기여도 분석.
 * @param entries counterfactualShadow.loadCounterfactuals() 결과
 * @param pattern skipReason substring (대소문자 sensitive)
 */
export function analyzeGateContribution(
  entries: CounterfactualEntry[],
  pattern: string,
): GateContribution {
  const matched = entries.filter(
    e => typeof e.skipReason === 'string' && e.skipReason.includes(pattern),
  );
  let blockedWinners = 0;
  let blockedLosers = 0;
  let blockedNeutral = 0;
  let blockedUnresolved = 0;
  for (const e of matched) {
    const ret = e.return30d;
    if (typeof ret !== 'number' || !Number.isFinite(ret)) {
      blockedUnresolved += 1;
      continue;
    }
    if (ret > WINNER_RETURN_THRESHOLD_PCT) blockedWinners += 1;
    else if (ret < LOSER_RETURN_THRESHOLD_PCT) blockedLosers += 1;
    else blockedNeutral += 1;
  }
  const resolvedSample = blockedWinners + blockedLosers + blockedNeutral;
  return {
    skipReasonPattern: pattern,
    blockedWinners,
    blockedLosers,
    blockedNeutral,
    blockedUnresolved,
    resolvedSample,
    verdict: classifyVerdict(blockedWinners, blockedLosers, resolvedSample),
  };
}

/**
 * 다수 skipReason 패턴에 대한 일괄 분석.
 * 호출자가 패턴 배열을 직접 전달 (예: ['GATE_UNDER', 'SECTOR_FULL', 'SKIP']).
 */
export function analyzeGateContributions(
  entries: CounterfactualEntry[],
  patterns: string[],
): GateContribution[] {
  if (isGateContributionAnalyzerDisabled()) return [];
  return patterns.map(p => analyzeGateContribution(entries, p));
}

/**
 * 영속 store 직접 read 변형 — counterfactualShadow.loadCounterfactuals() 호출.
 * 호출자(후속 PR cron) 의 단순화 헬퍼. 테스트 시 entries 직접 주입 권장.
 */
export function analyzeGateContributionsFromStore(patterns: string[]): GateContribution[] {
  if (isGateContributionAnalyzerDisabled()) return [];
  return analyzeGateContributions(loadCounterfactuals(), patterns);
}
