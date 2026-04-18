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
 * 레짐별 반감기(일).
 *
 * 아이디어 4 (Phase 2) — 시장 속도에 학습 감쇠를 동기화한다.
 *   - R1_TURBO/R2_BULL: 변동이 빨라 최근 신호 편중 → 짧은 반감기
 *   - R4_NEUTRAL(기본): 기존 60일 유지
 *   - R5_CAUTION/R6_DEFENSE: 관측 기간이 길어야 하므로 긴 반감기
 *
 * 알 수 없는 레짐(빈값/오타)은 보수적으로 기본 60일.
 */
export const REGIME_HALFLIFE_DAYS: Record<string, number> = {
  R1_TURBO:   30,
  R2_BULL:    45,
  R3_EARLY:   50,
  R4_NEUTRAL: 60,
  R5_CAUTION: 75,
  R6_DEFENSE: 90,
};

export function regimeHalfLifeDays(regime?: string | null): number {
  if (!regime) return 60;
  return REGIME_HALFLIFE_DAYS[regime] ?? 60;
}

/**
 * 시간 감쇠 가중치 (regimeAwareCalibrator / conditionAuditor 에서도 사용).
 *
 * 기본 60일 반감기 지수 감쇠 — 최근 거래가 6개월 전보다 약 3배 높은 영향.
 * `regime` 을 전달하면 REGIME_HALFLIFE_DAYS 에 따라 반감기가 조정된다.
 */
export function timeWeight(signalTime: string, regime?: string | null): number {
  const ageDays  = (Date.now() - new Date(signalTime).getTime()) / 86_400_000;
  const halflife = regimeHalfLifeDays(regime);
  return Math.exp(-ageDays / halflife);
}

/**
 * 아이디어 5 (Phase 3) — 타이밍 민감 조건 식별.
 *
 * EXPIRED 이후 LATE_WIN 으로 재분류된 거래는 "신호는 맞았으나 타이밍이 어긋났다"
 * 는 의미다. 타이밍이 핵심 변수인 조건에 한해 기여도를 30% 감쇠하여 학습 시
 * "신호 정확성"과 "타이밍 정밀도"를 분리한다.
 *
 * 서버 매핑: momentum(18), turtle_high(20)
 * 클라이언트 ID: 20 터틀, 21 피보나치, 22 엘리엇, 26 다이버전스
 */
const TIMING_SENSITIVE_SERVER_KEYS = new Set(['momentum', 'turtle_high']);
const TIMING_SENSITIVE_CONDITION_IDS = new Set([18, 20, 21, 22, 26]);

export function isTimingSensitiveServerKey(key: string): boolean {
  return TIMING_SENSITIVE_SERVER_KEYS.has(key);
}

export function isTimingSensitiveConditionId(id: number): boolean {
  return TIMING_SENSITIVE_CONDITION_IDS.has(id);
}

/**
 * LATE_WIN 거래의 타이밍 조건 기여도를 감쇠하는 승률 가중치.
 * - lateWin=true AND 타이밍 조건 → 0.7
 * - 그 외 → 1.0
 */
export const LATE_WIN_TIMING_PENALTY = 0.7;

export function latePenaltyForServerKey(lateWin: boolean | undefined, key: string): number {
  return lateWin && isTimingSensitiveServerKey(key) ? LATE_WIN_TIMING_PENALTY : 1.0;
}

export function latePenaltyForConditionId(lateWin: boolean | undefined, id: number): number {
  return lateWin && isTimingSensitiveConditionId(id) ? LATE_WIN_TIMING_PENALTY : 1.0;
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
