// @responsibility CH4 JOURNAL 주간 자기비판 리포트 — 일요일 19:00 KST 정기 발행
/**
 * weeklySelfCritiqueReport.ts — CH4 JOURNAL 주간 자기비판 리포트 (ADR-0041)
 *
 * 사용자 12 아이디어 중 11번 — "CH4 JOURNAL 주간 자기 비판 리포트, 일요일 19:00".
 * 페르소나 "보유 효과·후회 회피 경계" 의 자동화된 거울.
 *
 * 시간:
 *   - SUN 19:00 KST (UTC 10:00 일요일)
 *
 * 내용:
 *   - 주간 거래 결산 (fill 단위, PR-15~18 SSOT)
 *   - 주요 행동 편향 (3일 연속 ≥ 0.5, learningHistorySummary.escalatingBiases)
 *   - 손절 패턴 분포 (entryRegime × exitRuleTag) + 자동 권고 생성
 *   - 학습 실험 제안 활성/완료 카운트
 *   - 다음 주 점검 포인트 (편향 + 권고 결합)
 *
 * 절대 규칙:
 *   - 개별 종목 정보 절대 포함 금지 (CH4 JOURNAL 정체성: 메타 학습)
 *   - 잔고 키워드 누출 금지 (validate:sensitiveAlerts 자동 차단)
 *   - dispatchAlert(ChannelSemantic.JOURNAL) 단일 진입점만 사용
 */

import { loadShadowTrades, aggregateFillStats, type ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { getLearningStatus, getLearningHistory } from '../learning/learningHistorySummary.js';
import type { BiasType } from '../learning/reflectionTypes.js';
import { dispatchAlert, ChannelSemantic } from './alertRouter.js';
import { channelHeader, CHANNEL_SEPARATOR } from './channelFormatter.js';

const BIAS_LABEL_KO: Record<BiasType, string> = {
  REGRET_AVERSION: '후회 회피',
  ENDOWMENT: '보유 효과',
  CONFIRMATION: '확신 편향',
  HERDING: '군중 추종',
  LOSS_AVERSION: '손실 회피',
  ANCHORING: '닻 내림',
  RECENCY: '최근성',
  OVERCONFIDENCE: '과신',
  SUNK_COST: '매몰 비용',
  FOMO: '기회 상실 공포',
};

/** 7일 전 KST 자정 ISO 문자열 (now 기준) */
function sevenDaysAgoKstIso(now: Date): string {
  const ms = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

/** 부호 + 소수점 % */
function fmtPctSigned(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return 'N/A';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/** 정수 + 천 단위 콤마 */
function fmtKrw(n: number): string {
  if (!Number.isFinite(n)) return 'N/A';
  return Math.round(n).toLocaleString();
}

/** 편향 평균 점수 → 등급 이모지 */
function biasEmoji(avg: number): string {
  if (avg >= 0.7) return '🔴';
  if (avg >= 0.5) return '🟡';
  return '🟢';
}

/** 상승/하락 매핑 — escalating bias 의 trend 표시 */
function biasDirection(scores: number[]): string {
  if (scores.length < 2) return '';
  const last = scores[scores.length - 1];
  const first = scores[0];
  if (last > first + 0.1) return '↗ 악화';
  if (last < first - 0.1) return '↘ 개선';
  return '→ 정체';
}

/** 손절 trade 분포 — entryRegime × exitRuleTag */
export interface StopPatternBucket {
  entryRegime: string;
  exitRuleTag: string;
  count: number;
}

/** 손절 trade 만 추출해 (regime, exitRule) 별 카운트 */
export function summarizeStopPatterns(trades: ServerShadowTrade[]): StopPatternBucket[] {
  const buckets = new Map<string, StopPatternBucket>();
  for (const t of trades) {
    if (t.status !== 'HIT_STOP') continue;
    const regime = t.entryRegime ?? '미상';
    const tag = t.exitRuleTag ?? '미상';
    const key = `${regime}::${tag}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, { entryRegime: regime, exitRuleTag: tag, count: 1 });
    }
  }
  // count 내림차순 정렬, 동률은 regime alphabetical
  return [...buckets.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.entryRegime.localeCompare(b.entryRegime);
  });
}

/** 손절 패턴 → 자동 권고 생성 */
export function buildStopPatternRecommendation(buckets: StopPatternBucket[], totalStops: number): string | null {
  if (buckets.length === 0 || totalStops === 0) return null;
  const top = buckets[0];
  if (top.count < 3) return null; // 통계적으로 의미 있으려면 최소 3건
  const pct = Math.round((top.count / totalStops) * 100);
  if (pct < 40) return null; // 분산되어 있으면 권고 보류

  // entryRegime 기반 권고
  if (top.entryRegime === 'R5_CAUTION' || top.entryRegime === 'R6_DEFENSE') {
    return `${top.entryRegime} 레짐 진입 후 손절 ${top.count}건 (${pct}%) — 해당 레짐에서 진입 임계값 +1점 강화 권고`;
  }
  if (top.exitRuleTag === 'HARD_STOP' || top.exitRuleTag === 'TRAILING_PROTECTIVE_STOP') {
    return `${top.exitRuleTag} 손절 ${top.count}건 (${pct}%) — 손절폭(ATR 배수) 검토 권고`;
  }
  if (top.exitRuleTag === 'CASCADE_FINAL' || top.exitRuleTag === 'CASCADE_HALF_SELL' || top.exitRuleTag === 'CASCADE_WARN_BLOCK') {
    return `캐스케이드 청산 ${top.count}건 (${pct}%) — 진입 시점 시장 모멘텀 검증 강화 권고`;
  }
  return `${top.entryRegime}/${top.exitRuleTag} 손절 ${top.count}건 (${pct}%) — 패턴 모니터링 권고`;
}

/**
 * 메시지 본문 생성 — 순수 함수, 외부 의존성 0 (테스트 가능).
 */
export interface WeeklySelfCritiqueInputs {
  weekStart: string; // 'YYYY-MM-DD' KST
  weekEnd: string;   // 'YYYY-MM-DD' KST
  fillStats: {
    fillCount: number;
    winFills: number;
    lossFills: number;
    weightedReturnPct: number;
    totalRealizedKrw: number;
    fullClosedCount: number;
    partialOnlyCount: number;
    uniqueTradeCount: number;
  };
  escalatingBiases: { bias: BiasType; recentScores: number[] }[];
  stopBuckets: StopPatternBucket[];
  totalStops: number;
  recommendation: string | null;
  experimentProposalsActive: number;
  experimentProposalsCompletedRecent: number;
  reflectionMissingDays: number;
}

export function formatWeeklySelfCritique(inputs: WeeklySelfCritiqueInputs, now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hh = kst.getUTCHours().toString().padStart(2, '0');
  const mm = kst.getUTCMinutes().toString().padStart(2, '0');

  const header = channelHeader({
    icon: '🔍',
    title: '주간 자기 비판',
    suffix: `${hh}:${mm} KST`,
  });

  const fs = inputs.fillStats;
  const tradesLine = fs.fillCount === 0
    ? '실현 fill 없음 (이번 주 매매 없음 또는 청산 없음)'
    : `실현 fill: ${fs.fillCount}건 (승 ${fs.winFills} / 패 ${fs.lossFills}) | 가중 P&L: ${fmtPctSigned(fs.weightedReturnPct)} | 실현: ${fmtKrw(fs.totalRealizedKrw)}원`;
  const partialLine = fs.fillCount === 0
    ? ''
    : `부분익절 ${fs.partialOnlyCount}건 / 전량청산 ${fs.fullClosedCount}건 (총 ${fs.uniqueTradeCount}개 trade)`;

  // 편향 섹션
  const biasLines: string[] = [];
  if (inputs.escalatingBiases.length === 0) {
    biasLines.push('  ✅ 3일 연속 ≥ 0.5 인 편향 없음 — 자기통제 정상');
  } else {
    for (const eb of inputs.escalatingBiases.slice(0, 3)) {
      const scores = eb.recentScores;
      const avg = scores.reduce((s, n) => s + n, 0) / Math.max(1, scores.length);
      const label = BIAS_LABEL_KO[eb.bias] ?? eb.bias;
      const trend = biasDirection(scores);
      biasLines.push(`  ${biasEmoji(avg)} ${label} 평균 ${avg.toFixed(2)} ${trend}`);
    }
  }

  // 손절 패턴 섹션
  const stopLines: string[] = [];
  if (inputs.totalStops === 0) {
    stopLines.push('  ✅ 이번 주 HIT_STOP 0건 — 손절 트리거 없음');
  } else {
    stopLines.push(`  총 손절 ${inputs.totalStops}건`);
    for (const b of inputs.stopBuckets.slice(0, 3)) {
      const pct = Math.round((b.count / inputs.totalStops) * 100);
      stopLines.push(`  • ${b.entryRegime} / ${b.exitRuleTag}: ${b.count}건 (${pct}%)`);
    }
  }

  const recommendationLine = inputs.recommendation
    ? `  → ${inputs.recommendation}`
    : '  → 통계적 권고 없음 (표본 부족 또는 분산)';

  // 실험 제안 섹션
  const experimentLine = `활성 ${inputs.experimentProposalsActive}건 / 최근 완료 ${inputs.experimentProposalsCompletedRecent}건`;

  // 다음 주 점검
  const nextWeekPoints: string[] = [];
  if (inputs.escalatingBiases.length > 0) {
    const top = inputs.escalatingBiases[0];
    nextWeekPoints.push(`  • ${BIAS_LABEL_KO[top.bias] ?? top.bias} 편향 모니터링`);
  }
  if (inputs.recommendation) {
    nextWeekPoints.push(`  • ${inputs.recommendation}`);
  }
  if (nextWeekPoints.length === 0) {
    nextWeekPoints.push('  • 현재 안정 — 운영 체계 유지');
  }

  // reflection 누락 경고
  const missingWarning = inputs.reflectionMissingDays >= 3
    ? `\n⚠️ <b>reflection 연속 누락 ${inputs.reflectionMissingDays}일</b> — nightlyReflectionEngine 점검 권고`
    : '';

  return [
    header,
    '',
    `📅 <b>주간 범위:</b> ${inputs.weekStart} ~ ${inputs.weekEnd} (KST)`,
    '',
    '📊 <b>주간 거래 결산</b>',
    `  ${tradesLine}`,
    partialLine ? `  ${partialLine}` : '',
    '',
    '💢 <b>주요 행동 편향 (3일 연속 ≥ 0.5)</b>',
    ...biasLines,
    '',
    '🛡️ <b>손절 패턴 분포</b>',
    ...stopLines,
    recommendationLine,
    '',
    `🧪 <b>학습 실험:</b> ${experimentLine}`,
    '',
    '📅 <b>다음 주 점검 포인트</b>',
    ...nextWeekPoints,
    missingWarning,
    CHANNEL_SEPARATOR,
    '<i>매주 일요일 19:00 KST 자동 발송 — 페르소나 자기통제 거울</i>',
  ].filter(Boolean).join('\n');
}

/** KST 'YYYY-MM-DD' */
function toKstDateStr(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * 7일치 거래 + 학습 이력 + 편향 누적 → dispatchAlert(JOURNAL).
 */
export async function runWeeklySelfCritique(now: Date = new Date()): Promise<void> {
  try {
    const fromIso = sevenDaysAgoKstIso(now);
    const toIso = now.toISOString();
    const trades = loadShadowTrades();

    // 1. 주간 fill 통계
    const fillStats = aggregateFillStats(trades, { fromIso, toIso });

    // 2. 학습 이력 — escalatingBiases (3일 연속 ≥ 0.5)
    const learningHistory = getLearningHistory(7, now);
    const escalatingBiases = learningHistory.escalatingBiases;

    // 3. 손절 패턴 — 7일 범위 내 청산된 HIT_STOP trade 만 (lastSell 이 범위 안)
    const fromMs = new Date(fromIso).getTime();
    const toMs = new Date(toIso).getTime();
    const weeklyStops = trades.filter((t) => {
      if (t.status !== 'HIT_STOP') return false;
      const lastSell = (t.fills ?? []).filter((f) => f.type === 'SELL').slice(-1)[0];
      const ts = lastSell?.confirmedAt ?? lastSell?.timestamp ?? t.signalTime;
      if (!ts) return false;
      const ms = new Date(ts).getTime();
      return ms >= fromMs && ms < toMs;
    });
    const stopBuckets = summarizeStopPatterns(weeklyStops);
    const totalStops = weeklyStops.length;
    const recommendation = buildStopPatternRecommendation(stopBuckets, totalStops);

    // 4. 학습 실험 제안 카운트
    const learningStatus = getLearningStatus(now);
    const experimentProposalsActive = learningStatus.experimentProposalsActive.length;
    const experimentProposalsCompletedRecent = learningStatus.experimentProposalsCompletedRecent.length;

    // 5. reflection 누락 일수
    const reflectionMissingDays = learningStatus.consecutiveMissingDays;

    // 6. 메시지 빌드
    const weekEnd = toKstDateStr(now);
    const weekStart = toKstDateStr(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));

    const message = formatWeeklySelfCritique({
      weekStart,
      weekEnd,
      fillStats: {
        fillCount: fillStats.fillCount,
        winFills: fillStats.winFills,
        lossFills: fillStats.lossFills,
        weightedReturnPct: fillStats.weightedReturnPct,
        totalRealizedKrw: fillStats.totalRealizedKrw,
        fullClosedCount: fillStats.fullClosedCount,
        partialOnlyCount: fillStats.partialOnlyCount,
        uniqueTradeCount: fillStats.uniqueTradeCount,
      },
      escalatingBiases,
      stopBuckets,
      totalStops,
      recommendation,
      experimentProposalsActive,
      experimentProposalsCompletedRecent,
      reflectionMissingDays,
    }, now);

    // ADR-0041: CH4 JOURNAL — 주간 자기비판.
    // VIBRATION_POLICY[SYSTEM] 모두 false (시간 격리, 정독용).
    await dispatchAlert(ChannelSemantic.JOURNAL, message, {
      priority: 'NORMAL',
      dedupeKey: `weekly_self_critique:${weekEnd}`,
    });

    console.log(`[WeeklySelfCritique] 발송 완료 — ${weekStart} ~ ${weekEnd} (실현 ${fillStats.fillCount}건 / 손절 ${totalStops}건)`);
  } catch (e) {
    console.error('[WeeklySelfCritique] 발송 실패:', e instanceof Error ? e.message : e);
  }
}
