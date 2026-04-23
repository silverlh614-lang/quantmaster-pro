/**
 * kellySurfaceMap.ts — Idea 9: Kelly Surface Mapping (학습 목표 명시화).
 *
 * 학습 대상은 Kelly 공식의 (p, b):
 *   p = 승률, b = 평균 수익 / 평균 손실.
 *   Kelly* = (p(b+1) - 1) / b
 *
 * 신호 카테고리 (signalType × regime) 별로 (p, b) 추정치를 계산하고 표본 수에 따른
 * 신뢰구간 폭을 함께 보고한다. 다음 질문에 답한다:
 *   "이 카테고리에 샘플을 N개 더 쌓으면 ±k%p 에서 ±j%p 로 좁아진다.
 *    마진 효용이 사라지는 지점이 어디인가?"
 *
 * 추가 샘플의 한계 효용이 가시화되면 "언제 학습을 멈출지" 가 데이터로 결정된다.
 */

import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';

const DEFAULT_MIN_SAMPLE = 5;

export interface KellyCell {
  signalType: string;
  regime: string;
  samples: number;
  wins: number;
  losses: number;
  /** 승률 (0~1) */
  p: number;
  /** 평균 수익 / 평균 손실 — payoff ratio */
  b: number;
  /** Kelly*. p(b+1)-1)/b. b<=0 or samples 부족이면 0. */
  kellyStar: number;
  /** p 의 95% 신뢰구간 반폭 (Wilson approx). */
  pHalfWidth: number;
  /** 한계 효용 — 현재 샘플에 + addN 개 추가 시 pHalfWidth 축소분 (%p) */
  marginalPrecisionGainForNext10: number;
}

function wilsonHalfWidth(p: number, n: number, z = 1.96): number {
  if (n === 0) return 0.5;
  const denom = 1 + (z * z) / n;
  const radius = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n) / denom;
  return radius;
}

function buildCell(
  signalType: string,
  regime: string,
  recs: RecommendationRecord[],
): KellyCell | null {
  const closed = recs.filter(r => r.status === 'WIN' || r.status === 'LOSS');
  const n = closed.length;
  if (n < DEFAULT_MIN_SAMPLE) {
    return {
      signalType,
      regime,
      samples: n,
      wins: 0, losses: 0,
      p: 0, b: 0, kellyStar: 0,
      pHalfWidth: Infinity,
      marginalPrecisionGainForNext10: 0,
    };
  }

  const wins = closed.filter(r => r.status === 'WIN');
  const losses = closed.filter(r => r.status === 'LOSS');
  const p = wins.length / n;

  const avgWin = wins.length > 0
    ? wins.reduce((s, r) => s + (r.actualReturn ?? 0), 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((s, r) => s + (r.actualReturn ?? 0), 0)) / losses.length
    : 0;
  const b = avgLoss > 0 ? avgWin / avgLoss : 0;

  const kellyStar = b > 0 ? (p * (b + 1) - 1) / b : 0;

  const pHalfWidth = wilsonHalfWidth(p, n);
  const pHalfWidthAfter10 = wilsonHalfWidth(p, n + 10);
  const marginalGain = Math.max(0, pHalfWidth - pHalfWidthAfter10);

  return {
    signalType,
    regime,
    samples: n,
    wins: wins.length,
    losses: losses.length,
    p, b, kellyStar,
    pHalfWidth,
    marginalPrecisionGainForNext10: marginalGain,
  };
}

export interface KellySurfaceReport {
  cells: KellyCell[];
  overallSamples: number;
  /** 학습 정지 후보 — 한계 효용이 0.01(1%p) 미만으로 떨어진 cell 들 */
  convergedCells: KellyCell[];
  /** 샘플 더 필요 cell — 한계 효용 ≥ 0.02 */
  highPriorityCells: KellyCell[];
}

/**
 * 전체 recommendation history 를 (signalType × regime) 로 버킷팅 → Kelly surface.
 */
export function computeKellySurface(history?: RecommendationRecord[]): KellySurfaceReport {
  const data = history ?? getRecommendations();
  const sigTypes = ['STRONG_BUY', 'BUY'];
  const regimes = ['R1_TURBO', 'R2_BULL', 'R3_EARLY', 'R4_NEUTRAL', 'R5_CAUTION', 'R6_DEFENSE'];
  const cells: KellyCell[] = [];

  for (const sig of sigTypes) {
    for (const reg of regimes) {
      const bucket = data.filter(r => r.signalType === sig && r.entryRegime === reg);
      const cell = buildCell(sig, reg, bucket);
      if (cell) cells.push(cell);
    }
  }

  return {
    cells,
    overallSamples: data.length,
    convergedCells: cells.filter(c => c.samples >= 20 && c.marginalPrecisionGainForNext10 < 0.01),
    highPriorityCells: cells.filter(c => c.samples < 30 && c.marginalPrecisionGainForNext10 >= 0.02),
  };
}

export function formatKellySurface(report?: KellySurfaceReport): string {
  const r = report ?? computeKellySurface();
  const lines = [
    '🧮 <b>[Kelly Surface Map — (p, b) 학습 상태]</b>',
    `전체 추천: ${r.overallSamples}건`,
    '━━━━━━━━━━━━━━━━━━━━',
  ];
  const ranked = [...r.cells].sort((a, b) => b.samples - a.samples);
  for (const c of ranked) {
    if (c.samples === 0) continue;
    const p100 = (c.p * 100).toFixed(0);
    const ci = isFinite(c.pHalfWidth) ? `±${(c.pHalfWidth * 100).toFixed(1)}%p` : 'n/a';
    const kellyStr = c.kellyStar > 0 ? `Kelly*=${(c.kellyStar * 100).toFixed(1)}%` : 'Kelly*=0';
    lines.push(
      `${c.signalType}·${c.regime}: n=${c.samples} · p=${p100}% ${ci} · b=${c.b.toFixed(2)} · ${kellyStr}`,
    );
  }
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`✅ 수렴(1%p 이하 한계효용): ${r.convergedCells.length}개`);
  lines.push(`🔶 샘플 더 필요(≥2%p 효용): ${r.highPriorityCells.length}개`);
  if (r.highPriorityCells.length > 0) {
    const top = r.highPriorityCells[0];
    lines.push(`   → 우선순위: ${top.signalType}·${top.regime} (+10샘플 시 ±${(top.pHalfWidth*100).toFixed(1)}%p → ±${((top.pHalfWidth - top.marginalPrecisionGainForNext10)*100).toFixed(1)}%p)`);
  }
  return lines.join('\n');
}
