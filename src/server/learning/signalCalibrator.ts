import { getRecommendations } from './recommendationTracker.js';
import { loadConditionWeights, saveConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { callGemini } from '../clients/geminiClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

/**
 * 월간 추천 통계를 분석하여 조건별 가중치(condition-weights.json)를 자동 조정.
 * - 각 조건의 WIN률 < 40% → 가중치 10% 감소
 * - WIN률 > 65% → 가중치 10% 증가
 * - 가중치 범위: 0.3 ~ 1.8
 * - Gemini에게 월간 통계 입력 → 오탐 조건 분석 리포트 생성 (googleSearch 없음)
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

  // 조건별 WIN/LOSS 집계
  const condStats: Record<string, { wins: number; total: number }> = {};
  for (const rec of resolved) {
    for (const key of (rec.conditionKeys ?? [])) {
      if (!condStats[key]) condStats[key] = { wins: 0, total: 0 };
      condStats[key].total++;
      if (rec.status === 'WIN') condStats[key].wins++;
    }
  }

  const weights = loadConditionWeights();
  const adjustments: string[] = [];

  for (const [key, stat] of Object.entries(condStats)) {
    if (stat.total < 3) continue; // 샘플 부족 → 보정 안 함
    const winRate = stat.wins / stat.total;
    const prev = weights[key as keyof typeof weights] ?? 1.0;

    if (winRate < 0.40) {
      weights[key as keyof typeof weights] = parseFloat(Math.max(0.3, prev * 0.9).toFixed(2));
      adjustments.push(`${key}: ${prev.toFixed(2)} → ${weights[key as keyof typeof weights]} (WIN률 ${(winRate * 100).toFixed(0)}% 낮음)`);
    } else if (winRate > 0.65) {
      weights[key as keyof typeof weights] = parseFloat(Math.min(1.8, prev * 1.1).toFixed(2));
      adjustments.push(`${key}: ${prev.toFixed(2)} → ${weights[key as keyof typeof weights]} (WIN률 ${(winRate * 100).toFixed(0)}% 높음)`);
    }
  }

  if (adjustments.length > 0) {
    saveConditionWeights(weights);
    console.log(`[Calibrator] 가중치 조정: ${adjustments.join(' | ')}`);
  } else {
    console.log('[Calibrator] 가중치 변경 없음 — 현재 설정 유지');
  }

  // Gemini 메타 분석 (googleSearch 없음)
  const statsBlock = Object.entries(condStats)
    .map(([k, v]) => `${k}: ${v.wins}승/${v.total}건 (WIN률 ${((v.wins / v.total) * 100).toFixed(0)}%)`)
    .join(', ');

  const geminiPrompt = [
    '당신은 한국 주식 퀀트 시스템의 신호 품질 분석 AI입니다.',
    `아래는 ${month} 월간 Gate 조건별 적중률 통계입니다.`,
    '어떤 조건이 오탐을 많이 냈는지 분석하고, 트레이더에게 개선 방향을 1~3문장으로 한국어로 제안하세요.',
    '외부 검색 불필요. 주어진 데이터만 분석하세요.',
    '',
    `=== ${month} 조건별 통계 ===`,
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
