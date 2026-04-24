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
import { sendSuggestAlert } from './suggestNotifier.js';
import {
  SUGGEST_MIN_SAMPLE_KELLY_SURFACE,
  SUGGEST_KELLY_CI_THRESHOLD,
  SUGGEST_KELLY_DELTA_THRESHOLD,
} from './suggestThresholds.js';

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
    '━━━━━━━━━━━━━━━━',
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
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`✅ 수렴(1%p 이하 한계효용): ${r.convergedCells.length}개`);
  lines.push(`🔶 샘플 더 필요(≥2%p 효용): ${r.highPriorityCells.length}개`);
  if (r.highPriorityCells.length > 0) {
    const top = r.highPriorityCells[0];
    lines.push(`   → 우선순위: ${top.signalType}·${top.regime} (+10샘플 시 ±${(top.pHalfWidth*100).toFixed(1)}%p → ±${((top.pHalfWidth - top.marginalPrecisionGainForNext10)*100).toFixed(1)}%p)`);
  }
  return lines.join('\n');
}

/**
 * Suggest 판정 — (signalType × regime) 각 셀에 대해 sample≥20 & CI 폭(pHalfWidth)≤0.10 이 충족되고,
 * 추정 Kelly* 와 현재 운용 Kelly(currentKellyBy[signalType]) 의 절대 괴리 ≥ 0.5 이면
 * 가장 큰 괴리 1건만 suggest 한다.
 *
 * @param currentKellyBy signalType → 현재 운용 Kelly 배율(0~1). 빈 객체면 no-op.
 * @returns suggest 발동 여부.
 */
export async function evaluateKellySurfaceSuggestion(
  currentKellyBy: Record<string, number>,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    if (!currentKellyBy || Object.keys(currentKellyBy).length === 0) return false;
    const report = computeKellySurface();
    const ranked = report.cells
      .filter(c => c.samples >= SUGGEST_MIN_SAMPLE_KELLY_SURFACE)
      .filter(c => Number.isFinite(c.pHalfWidth) && c.pHalfWidth <= SUGGEST_KELLY_CI_THRESHOLD)
      .filter(c => typeof currentKellyBy[c.signalType] === 'number')
      .map(c => {
        const current = currentKellyBy[c.signalType];
        const delta = Math.abs(c.kellyStar - current);
        return { cell: c, current, delta };
      })
      .filter(x => x.delta >= SUGGEST_KELLY_DELTA_THRESHOLD)
      .sort((a, b) => b.delta - a.delta);

    if (ranked.length === 0) return false;

    const top = ranked[0];
    const day = now.toISOString().slice(0, 10);
    return await sendSuggestAlert({
      moduleKey: 'kellySurface',
      signature: `kellySurface-${top.cell.signalType}-${top.cell.regime}-${day}`,
      title: `${top.cell.signalType}·${top.cell.regime} Kelly 추정치 괴리`,
      rationale:
        `n=${top.cell.samples} · p=${(top.cell.p * 100).toFixed(0)}% (±${(top.cell.pHalfWidth * 100).toFixed(1)}%p) · ` +
        `b=${top.cell.b.toFixed(2)} · Kelly*=${(top.cell.kellyStar * 100).toFixed(1)}%`,
      currentValue: `Kelly=${(top.current * 100).toFixed(1)}%`,
      suggestedValue: `Kelly≈${(top.cell.kellyStar * 100).toFixed(1)}% (|Δ|=${(top.delta * 100).toFixed(1)}%p)`,
      threshold:
        `샘플≥${SUGGEST_MIN_SAMPLE_KELLY_SURFACE} & CI≤${(SUGGEST_KELLY_CI_THRESHOLD * 100).toFixed(0)}%p & |Δ|≥${(SUGGEST_KELLY_DELTA_THRESHOLD * 100).toFixed(0)}%p`,
    });
  } catch (e) {
    console.warn(
      '[kellySurfaceMap] evaluateSuggestion 실패:',
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}
