import { loadConditionWeights, saveConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { loadAttributionRecords } from '../persistence/attributionRepo.js';
import { analyzeAttribution, serverConditionKey } from './attributionAnalyzer.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { loadWalkForwardState } from './walkForwardValidator.js';
import {
  loadPromptBoosts,
  savePromptBoosts,
  clampBoost,
  type PromptConditionBoost,
} from '../persistence/promptBoostRepo.js';

/**
 * 월간 귀인 분석 기반 캘리브레이션.
 *
 * 기존(추천 트래커 conditionKeys 기반) → 교체:
 *   attributionRepo 의 ServerAttributionRecord (conditionScores 1~27) 를 읽어
 *   analyzeAttribution() 로 완전 분석 후 서버 condition-weights.json 조정.
 *
 * 아이디어 2 — 시간 감쇠 (Temporal Decay):
 *   analyzeAttribution 내부에서 최근 30일/이전 30일 분리로 추이 반영.
 *
 * 아이디어 3 — Sharpe 기반 캘리브레이션:
 *   INCREASE_WEIGHT: WR > 65% & Sharpe > 1.2
 *   DECREASE_WEIGHT: WR < 45% or Sharpe < 0.5
 *   SUSPEND:         WR < 35% & Sharpe < 0.3
 *
 * 가중치 범위: 0.1 ~ 1.8
 */
export async function calibrateSignalWeights(): Promise<void> {
  // 아이디어 4: 워크포워드 과최적화 동결 상태 확인
  const wfState = loadWalkForwardState();
  if (wfState) {
    console.log(`[Calibrator] 워크포워드 동결 중 — 조정 건너뜀 (사유: ${wfState.reason})`);
    return;
  }

  const records = loadAttributionRecords();

  if (records.length < 10) {
    console.log(`[Calibrator] 귀인 레코드 부족 (${records.length}건 < 10) — 보정 건너뜀`);
    return;
  }

  const analysis = analyzeAttribution(records);
  const weights  = loadConditionWeights();
  const adjustments: string[] = [];

  // 아이디어 1 (Phase 1): 클라이언트 전용 조건 21개도 Gemini 프롬프트 boost로 학습 반영
  const promptBoosts: PromptConditionBoost = loadPromptBoosts();
  const boostAdjustments: string[] = [];

  for (const attr of analysis) {
    const key = serverConditionKey(attr.conditionId);

    if (!key) {
      // ── 서버 미매핑 조건(21개): Gemini 프롬프트 boost 경로로 학습 피드백 ──
      if (attr.totalTrades < 5) continue; // 샘플 부족 — 1.0 유지

      const prevBoost = promptBoosts[attr.conditionId] ?? 1.0;
      let   nextBoost = prevBoost;

      switch (attr.recommendation) {
        case 'INCREASE_WEIGHT':
          nextBoost = clampBoost(prevBoost * 1.10);
          break;
        case 'DECREASE_WEIGHT':
          nextBoost = clampBoost(prevBoost * 0.92);
          break;
        case 'SUSPEND':
          nextBoost = 0.5; // 최저값 = 프롬프트에서 사실상 무시
          break;
        case 'MAINTAIN':
        default:
          // 점진적 평균회귀 — 장기 무변동 조건 1.0으로 수렴
          nextBoost = clampBoost(prevBoost + (1.0 - prevBoost) * 0.1);
          break;
      }

      if (Math.abs(nextBoost - prevBoost) > 0.01) {
        promptBoosts[attr.conditionId] = nextBoost;
        boostAdjustments.push(
          `${attr.conditionName}: ${prevBoost.toFixed(2)}→${nextBoost.toFixed(2)} ` +
          `(WIN ${(attr.winRate * 100).toFixed(0)}%·SR ${attr.sharpe.toFixed(2)})`,
        );
      }
      continue;
    }

    const prev = weights[key] ?? 1.0;
    let   next = prev;

    switch (attr.recommendation) {
      case 'INCREASE_WEIGHT':
        next = Math.min(1.8, prev * 1.15);   // 최대 15% 상향
        break;
      case 'DECREASE_WEIGHT':
        next = Math.max(0.3, prev * 0.87);   // 최대 13% 하향
        break;
      case 'SUSPEND':
        next = 0.1;                           // 사실상 비활성화
        break;
      case 'MAINTAIN':
      default:
        break;
    }

    if (Math.abs(next - prev) > 0.01) {
      weights[key] = parseFloat(next.toFixed(2));
      adjustments.push(
        `${attr.conditionName}: ${prev.toFixed(2)}→${next.toFixed(2)} ` +
        `(WIN률 ${(attr.winRate * 100).toFixed(0)}%, Sharpe ${attr.sharpe.toFixed(2)}, ${attr.recentTrend})`,
      );
    }
  }

  if (adjustments.length > 0) {
    saveConditionWeights(weights);
    console.log(`[Calibrator] 가중치 조정: ${adjustments.join(' | ')}`);
  } else {
    console.log('[Calibrator] 가중치 변경 없음 — 현재 설정 유지');
  }

  if (boostAdjustments.length > 0) {
    savePromptBoosts(promptBoosts);
    console.log(
      `[Calibrator] 클라이언트 조건 Gemini boost 조정 ${boostAdjustments.length}건: ` +
      boostAdjustments.join(' | '),
    );
  } else {
    console.log('[Calibrator] 클라이언트 조건 boost 변경 없음');
  }

  // ── 텔레그램 월간 리포트 ──
  const month = new Date().toISOString().slice(0, 7);

  // 전체 27조건 중 샘플이 있는 것만 필터링하여 상위/하위 3개 선별
  const withSamples = analysis.filter((a) => a.totalTrades >= 3);
  const topWin  = [...withSamples].sort((a, b) => b.winRate - a.winRate).slice(0, 3);
  const topLoss = [...withSamples].sort((a, b) => a.winRate - b.winRate).slice(0, 3);

  // 레짐별 최강 조건 (가장 높은 단일 레짐 winRate 기준)
  const regimeStar = withSamples
    .flatMap((a) =>
      Object.entries(a.byRegime)
        .filter(([, v]) => v.count >= 3)
        .map(([regime, v]) => ({ conditionName: a.conditionName, regime, ...v })),
    )
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 3);

  const regimeStarText = regimeStar.length > 0
    ? regimeStar
        .map((r) => `  • [${r.regime}] ${r.conditionName}: WIN ${(r.winRate * 100).toFixed(0)}% (${r.count}건)`)
        .join('\n')
    : '  데이터 부족';

  const trendChanges = withSamples
    .filter((a) => a.recentTrend !== 'STABLE')
    .map((a) => `  • ${a.conditionName}: ${a.recentTrend} (최근 ${(a.recentWinRate * 100).toFixed(0)}% vs 이전 ${(a.historicalWinRate * 100).toFixed(0)}%)`)
    .join('\n');

  await sendTelegramAlert(
    `🔬 <b>[귀인 분석 월간 리포트] ${month}</b>\n\n` +
    `📊 분석 레코드: ${records.length}건\n\n` +
    `📈 <b>최고 기여 조건 Top 3</b>\n` +
    topWin.map((c) =>
      `  • ${c.conditionName}: WIN ${(c.winRate * 100).toFixed(0)}%, Sharpe ${c.sharpe.toFixed(2)} (${c.totalTrades}건)`
    ).join('\n') + '\n\n' +
    `📉 <b>허위신호 조건 Top 3</b>\n` +
    topLoss.map((c) =>
      `  • ${c.conditionName}: WIN ${(c.winRate * 100).toFixed(0)}%, 권고: ${c.recommendation}`
    ).join('\n') + '\n\n' +
    `🏆 <b>레짐별 최강 조건</b>\n${regimeStarText}\n\n` +
    (trendChanges ? `📊 <b>추이 변화 감지</b>\n${trendChanges}\n\n` : '') +
    `⚙️ <b>서버 가중치 조정 ${adjustments.length}건</b>\n` +
    (adjustments.length > 0 ? adjustments.slice(0, 5).join('\n') : '  변경 없음') +
    (boostAdjustments.length > 0
      ? `\n\n🧠 <b>Gemini 프롬프트 boost 조정 ${boostAdjustments.length}건 (클라이언트 조건)</b>\n` +
        boostAdjustments.slice(0, 5).join('\n')
      : '')
  ).catch(console.error);
}

// ── 공유 유틸 ────────────────────────────────────────────────────────────────

/**
 * 시간 감쇠 가중치 (regimeAwareCalibrator / conditionAuditor 에서도 사용).
 * 60일 반감기 지수 감쇠 — 최근 거래가 6개월 전보다 약 3배 높은 영향.
 */
export function timeWeight(signalTime: string): number {
  const ageDays = (Date.now() - new Date(signalTime).getTime()) / 86_400_000;
  return Math.exp(-ageDays / 60);
}

/**
 * 조건별 Sharpe 비율.
 * mean / std(returns). 수익률이 2개 미만이면 0 반환.
 */
export function calcConditionSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const m        = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - m) ** 2, 0) / returns.length;
  const std      = Math.sqrt(variance);
  return std > 0 ? m / std : 0;
}
