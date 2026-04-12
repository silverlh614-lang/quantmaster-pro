import { getRecommendations } from './recommendationTracker.js';
import { loadConditionWeights, saveConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { callGemini } from '../clients/geminiClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

/**
 * 월간 추천 통계를 분석하여 조건별 가중치(condition-weights.json)를 자동 조정.
 *
 * 아이디어 2 — 시간 감쇠 (Temporal Decay):
 *   최근 거래일수록 높은 가중치 부여. 60일 반감기 지수 감쇠.
 *   기존 단순 wins/total → Σ(timeWeight × isWin) / Σ(timeWeight)
 *
 * 아이디어 3 — Sharpe 기반 캘리브레이션:
 *   WIN률 단독 판단 대신 조건별 위험 조정 수익률(Sharpe)을 1차 기준으로 사용.
 *   Sharpe > 1.0 → 상향 / Sharpe < 0.3 → 하향
 *   Sharpe가 중간 구간이면 시간 가중 WIN률로 보조 판단.
 *
 * 가중치 범위: 0.3 ~ 1.8
 */
export async function calibrateSignalWeights(): Promise<void> {
  const recs = getRecommendations();
  const month = new Date().toISOString().slice(0, 7);
  const resolved = recs.filter(
    (r) => r.signalTime.startsWith(month) &&
    r.status !== 'PENDING' &&
    r.conditionKeys && r.conditionKeys.length > 0
  );

  if (resolved.length < 10) {
    console.log(`[Calibrator] 학습 데이터 부족 (${resolved.length}건 < 10) — 보정 건너뜀`);
    return;
  }

  // 조건별 시간 가중 WIN 집계 + 수익률 배열 수집
  const condStats: Record<string, { wWins: number; wTotal: number; returns: number[] }> = {};
  for (const rec of resolved) {
    const tw = timeWeight(rec.signalTime);
    for (const key of rec.conditionKeys ?? []) {
      if (!condStats[key]) condStats[key] = { wWins: 0, wTotal: 0, returns: [] };
      condStats[key].wTotal += tw;
      if (rec.status === 'WIN') condStats[key].wWins += tw;
      if (rec.actualReturn !== undefined) condStats[key].returns.push(rec.actualReturn);
    }
  }

  const weights = loadConditionWeights();
  const adjustments: string[] = [];

  for (const [key, stat] of Object.entries(condStats)) {
    if (stat.wTotal < 1) continue; // 유효 샘플 없음

    const winRate = stat.wWins / stat.wTotal;          // 시간 가중 WIN률
    const sharpe  = calcConditionSharpe(stat.returns); // 조건별 Sharpe
    const prev    = weights[key as keyof typeof weights] ?? 1.0;

    let next = prev;

    if (sharpe > 1.0 || winRate > 0.65) {
      // 고성과: Sharpe 우수 또는 WIN률 높음 → 상향
      next = parseFloat(Math.min(1.8, prev * 1.1).toFixed(2));
    } else if (sharpe < 0.3 || winRate < 0.40) {
      // 저성과: Sharpe 불량 또는 WIN률 낮음 → 하향
      next = parseFloat(Math.max(0.3, prev * 0.9).toFixed(2));
    }

    if (next !== prev) {
      weights[key as keyof typeof weights] = next;
      adjustments.push(
        `${key}: ${prev.toFixed(2)}→${next} ` +
        `(WR:${(winRate * 100).toFixed(0)}% SR:${sharpe.toFixed(2)})`
      );
    }
  }

  if (adjustments.length > 0) {
    saveConditionWeights(weights);
    console.log(`[Calibrator] 가중치 조정: ${adjustments.join(' | ')}`);
  } else {
    console.log('[Calibrator] 가중치 변경 없음 — 현재 설정 유지');
  }

  // Gemini 메타 분석
  const statsBlock = Object.entries(condStats)
    .map(([k, v]) => {
      const wr = v.wTotal > 0 ? ((v.wWins / v.wTotal) * 100).toFixed(0) : '0';
      const sr = calcConditionSharpe(v.returns).toFixed(2);
      return `${k}: WR ${wr}% / Sharpe ${sr} (유효샘플 ${v.wTotal.toFixed(1)})`;
    })
    .join(', ');

  const geminiPrompt = [
    '당신은 한국 주식 퀀트 시스템의 신호 품질 분석 AI입니다.',
    `아래는 ${month} 월간 Gate 조건별 시간 가중 적중률(WR) 및 Sharpe 비율 통계입니다.`,
    '어떤 조건이 오탐을 많이 냈는지 분석하고, 트레이더에게 개선 방향을 1~3문장으로 한국어로 제안하세요.',
    '외부 검색 불필요. 주어진 데이터만 분석하세요.',
    '',
    `=== ${month} 조건별 통계 (시간 감쇠 적용) ===`,
    statsBlock,
    `총 해석 가능 추천: ${resolved.length}건`,
    adjustments.length > 0 ? `자동 조정: ${adjustments.join(' | ')}` : '자동 조정 없음',
  ].join('\n');

  const analysis = await callGemini(geminiPrompt);
  if (analysis) {
    await sendTelegramAlert(
      `🔬 <b>[Signal Calibrator] ${month} 자기학습 분석</b>\n\n${analysis}\n\n` +
      `<i>조정: ${adjustments.length > 0 ? adjustments.join(', ') : '없음'}</i>`
    ).catch(console.error);
  }
}

// ── 공유 유틸 ────────────────────────────────────────────────────────────────

/**
 * 아이디어 2: 시간 감쇠 가중치.
 * 60일 반감기 지수 감쇠 — 최근 거래가 6개월 전보다 약 3배 높은 영향.
 */
export function timeWeight(signalTime: string): number {
  const ageDays = (Date.now() - new Date(signalTime).getTime()) / 86_400_000;
  return Math.exp(-ageDays / 60);
}

/**
 * 아이디어 3: 조건별 Sharpe 비율.
 * mean / std(returns). 수익률이 2개 미만이면 0 반환.
 * Sharpe > 1.0 → 상향 / Sharpe < 0.3 → 하향
 */
export function calcConditionSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  return std > 0 ? mean / std : 0;
}
