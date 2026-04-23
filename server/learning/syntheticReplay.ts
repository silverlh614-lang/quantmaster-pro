/**
 * syntheticReplay.ts — Idea 8 (reduced scope): Synthetic Replay on internal history.
 *
 * 원안은 "한국거래소 OpenAPI 10년 데이터 + 벡터 유사도로 현재 후보의 과거 유사 사례
 * N=100 추출". 외부 OpenAPI 10년 히스토리 확보·유지 비용이 크므로 현 단계는
 * **내부 누적 데이터** (RecommendationRecord × ServerShadowTrade) 에서만 유사도 매칭.
 *
 * 유사도 정의:
 *   - 각 샘플의 27-조건 스코어 벡터 (failurePatternDB 와 공유) 간 cosine 유사도.
 *   - 추가 필터: 동일 레짐 family 우선 (R1~R2 vs R3~R4 vs R5~R6).
 *
 * 출력:
 *   replayCandidate(conditionKeys, regime) → {
 *     samples: { stockCode, returnPct, similarity, resolvedAt }[],  // top-N
 *     meanReturn, medianReturn, winRate, sampleCount, confidenceBand,
 *   }
 *
 * 운영자 해석: "현재 후보 기술적 세팅이 과거 N건 중 어떤 분포로 결판났는가 → 진입 지수 라벨".
 */

import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';
import { buildEntryConditionScores } from './entryConditionScores.js';

const REGIME_FAMILY: Record<string, string> = {
  R1_TURBO:   'BULL',
  R2_BULL:    'BULL',
  R3_EARLY:   'NEUTRAL',
  R4_NEUTRAL: 'NEUTRAL',
  R5_CAUTION: 'BEAR',
  R6_DEFENSE: 'BEAR',
};

export const REPLAY_SIMILARITY_FLOOR = Number(process.env.REPLAY_SIMILARITY_FLOOR ?? '0.7');
export const REPLAY_TOP_N = Number(process.env.REPLAY_TOP_N ?? '100');

function cosineSimilarity(a: Record<number, number>, b: Record<number, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 1; i <= 27; i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface ReplaySample {
  stockCode: string;
  stockName: string;
  returnPct: number;
  similarity: number;
  regime: string;
  resolvedAt: string;
  status: 'WIN' | 'LOSS' | 'EXPIRED';
}

export interface ReplayResult {
  /** 매칭된 과거 샘플 (similarity 내림차순, 최대 REPLAY_TOP_N) */
  samples: ReplaySample[];
  meanReturn: number;
  medianReturn: number;
  winRate: number;
  sampleCount: number;
  /** 95% 신뢰구간 반폭 (standard error × 1.96) — 샘플 수 부족 시 ±∞ */
  confidenceHalfWidth: number;
  /** 신호 품질 라벨: 샘플 수·mean·winRate 기반 조합 */
  label: 'STRONG_EDGE' | 'WEAK_EDGE' | 'NEUTRAL' | 'AVOID' | 'INSUFFICIENT_DATA';
  rationale: string;
}

function classifyLabel(result: Omit<ReplayResult, 'label' | 'rationale'>): ReplayResult['label'] {
  if (result.sampleCount < 5) return 'INSUFFICIENT_DATA';
  if (result.meanReturn >= 5 && result.winRate >= 0.6) return 'STRONG_EDGE';
  if (result.meanReturn >= 2 && result.winRate >= 0.55) return 'WEAK_EDGE';
  if (result.meanReturn <= -2 || result.winRate <= 0.35) return 'AVOID';
  return 'NEUTRAL';
}

/**
 * 현재 후보의 conditionKeys + regime 을 과거 결판 난 RecommendationRecord 에 대해
 * 유사도 매칭. 내부 히스토리만 사용 (외부 API 확장 가능 지점).
 *
 * @param input.history 테스트용 히스토리 주입. 미주입 시 loadRecommendations().
 */
export function replayCandidate(input: {
  candidateConditionKeys: string[];
  candidateRegime?: string;
  history?: RecommendationRecord[];
}): ReplayResult {
  const history = input.history ?? getRecommendations();
  const candidateVec = buildEntryConditionScores(input.candidateConditionKeys);
  const candidateFamily = REGIME_FAMILY[input.candidateRegime ?? ''] ?? 'NEUTRAL';

  const scored: ReplaySample[] = [];
  for (const rec of history) {
    if (rec.status !== 'WIN' && rec.status !== 'LOSS' && rec.status !== 'EXPIRED') continue;
    if (typeof rec.actualReturn !== 'number' || !Number.isFinite(rec.actualReturn)) continue;
    const vec = buildEntryConditionScores(rec.conditionKeys);
    const sim = cosineSimilarity(candidateVec, vec);
    if (sim < REPLAY_SIMILARITY_FLOOR) continue;

    // 레짐 family 가중치 — 같은 family 면 +0.05 보너스 (유사도 동률 시 우선).
    const recFamily = REGIME_FAMILY[rec.entryRegime ?? ''] ?? 'NEUTRAL';
    const weightedSim = recFamily === candidateFamily ? sim + 0.05 : sim;

    scored.push({
      stockCode: rec.stockCode,
      stockName: rec.stockName,
      returnPct: rec.actualReturn,
      similarity: weightedSim,
      regime: rec.entryRegime ?? 'UNKNOWN',
      resolvedAt: rec.resolvedAt ?? rec.signalTime,
      status: rec.status,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  const samples = scored.slice(0, REPLAY_TOP_N);

  if (samples.length === 0) {
    return {
      samples: [], meanReturn: 0, medianReturn: 0, winRate: 0, sampleCount: 0,
      confidenceHalfWidth: Infinity,
      label: 'INSUFFICIENT_DATA',
      rationale: 'similarity ≥ floor 매칭 샘플 없음 — 내부 히스토리 부족',
    };
  }

  const returns = samples.map(s => s.returnPct);
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const sorted = [...returns].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const winRate = returns.filter(r => r > 0).length / returns.length;
  const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length;
  const stdErr = Math.sqrt(variance / returns.length);
  const confidenceHalfWidth = stdErr * 1.96;

  const partial = {
    samples,
    meanReturn: mean,
    medianReturn: median,
    winRate,
    sampleCount: samples.length,
    confidenceHalfWidth,
  };
  const label = classifyLabel(partial);
  const rationale =
    `n=${samples.length} · μ=${mean.toFixed(2)}% · win=${(winRate * 100).toFixed(0)}% · ` +
    `95% CI ±${confidenceHalfWidth.toFixed(2)}%`;

  return { ...partial, label, rationale };
}
