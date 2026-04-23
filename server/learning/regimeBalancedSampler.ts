/**
 * regimeBalancedSampler.ts — Idea 3: Stratified Sampling (레짐 균형 학습).
 *
 * 학습의 가장 큰 편향은 "최근 3개월 레짐에 전체 샘플이 쏠려 있다" 는 것. 이 모듈은
 * 레짐별 목표 샘플 수를 선언하고, 현재 보유 데이터의 레짐별 분포를 측정해 "부족한
 * 레짐 구간" 을 가시화한다. 실제 부족 구간 Walk-Forward 리플레이는 기존 인프라
 * (walkForwardValidator) 가 IS/OOS 분리에 이미 사용하므로 본 모듈은 "어느 레짐이
 * 얼마나 부족한가" 의 리포팅에 집중.
 *
 * 출력:
 *   - regimeCoverage(): 각 레짐별 현재 샘플 수 vs 목표, 부족 레짐 리스트
 *   - Telegram 카드용 포매터
 */

import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';

/** 레짐별 목표 샘플 수 — 통계적으로 유의한 비교를 위한 최소치. */
export const REGIME_SAMPLE_TARGETS: Record<string, number> = {
  R1_TURBO:   20,
  R2_BULL:    30,
  R3_EARLY:   25,
  R4_NEUTRAL: 30,
  R5_CAUTION: 20,
  R6_DEFENSE: 15,
};

export interface RegimeCoverageEntry {
  regime: string;
  target: number;
  current: number;
  deficit: number;         // max(0, target - current)
  oldestSignalDate?: string;
  newestSignalDate?: string;
}

export interface RegimeCoverageReport {
  entries: RegimeCoverageEntry[];
  totalSamples: number;
  totalTarget: number;
  totalDeficit: number;
  balanceRatio: number;   // totalSamples / totalTarget (1.0 = 완전 충족)
}

/**
 * 현재 누적 RecommendationRecord 를 기반으로 레짐별 커버리지를 계산.
 * status 가 PENDING 인 레코드도 샘플로 집계 (단, 수익률 기반 통계는 WIN/LOSS/EXPIRED 만 사용).
 */
export function regimeCoverage(records?: RecommendationRecord[]): RegimeCoverageReport {
  const data = records ?? getRecommendations();
  const entries: RegimeCoverageEntry[] = [];
  let totalSamples = 0;
  let totalTarget = 0;
  let totalDeficit = 0;

  for (const regime of Object.keys(REGIME_SAMPLE_TARGETS)) {
    const target = REGIME_SAMPLE_TARGETS[regime];
    const matched = data.filter(r => r.entryRegime === regime);
    const current = matched.length;
    const deficit = Math.max(0, target - current);
    const oldest = matched.reduce<string | undefined>(
      (min, r) => (!min || r.signalTime < min ? r.signalTime : min), undefined,
    );
    const newest = matched.reduce<string | undefined>(
      (max, r) => (!max || r.signalTime > max ? r.signalTime : max), undefined,
    );
    entries.push({ regime, target, current, deficit, oldestSignalDate: oldest, newestSignalDate: newest });
    totalSamples += current;
    totalTarget  += target;
    totalDeficit += deficit;
  }

  entries.sort((a, b) => b.deficit - a.deficit); // 부족 큰 순

  return {
    entries,
    totalSamples,
    totalTarget,
    totalDeficit,
    balanceRatio: totalTarget > 0 ? totalSamples / totalTarget : 0,
  };
}

/**
 * 후보 스캐너 호출 시 "이 후보가 속한 레짐이 현재 부족 레짐인가" 를 판정.
 * PROBING 슬롯 확장·Shadow 학습 우선도 결정 입력으로 사용 가능 (후크 지점).
 */
export function isUnderRepresentedRegime(regime: string, report?: RegimeCoverageReport): boolean {
  const r = report ?? regimeCoverage();
  const entry = r.entries.find(e => e.regime === regime);
  if (!entry) return false;
  return entry.deficit > 0 && entry.current < entry.target * 0.5;
}

export function formatRegimeCoverage(report?: RegimeCoverageReport): string {
  const r = report ?? regimeCoverage();
  const lines = [
    '📊 <b>[레짐 샘플 커버리지]</b>',
    `전체: ${r.totalSamples}/${r.totalTarget} (${(r.balanceRatio * 100).toFixed(0)}%)`,
    '━━━━━━━━━━━━━━━━━━━━',
  ];
  for (const e of r.entries) {
    const pct = e.target > 0 ? (e.current / e.target) * 100 : 0;
    const bar = pct >= 100 ? '🟢'
      : pct >= 75 ? '🟡'
      : pct >= 50 ? '🟠'
      : '🔴';
    lines.push(
      `${bar} ${e.regime}: ${e.current}/${e.target} ` +
      `(${pct.toFixed(0)}%)${e.deficit > 0 ? ` · 부족 ${e.deficit}` : ''}`,
    );
  }
  if (r.totalDeficit > 0) {
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push(`<i>총 부족 샘플 ${r.totalDeficit} — Walk-Forward replay 보충 권고</i>`);
  }
  return lines.join('\n');
}
