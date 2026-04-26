// @responsibility weeklyConditionScorecard 알림 모듈
/**
 * weeklyConditionScorecard.ts — 주간 조건 성과 리포트 (IDEA 6)
 *
 * 지난 7일 귀인 레코드로 27개 조건별 평균수익률/승률을 재계산해
 * Top3 / Bottom3 / 다음주 주목 조건을 DM+채널로 브로드캐스트한다.
 *
 * 데이터 소스:
 *   - attributionRepo.loadAttributionRecords() — 거래별 27조건 점수 스냅샷
 *   - attributionAnalyzer.analyzeAttribution() — 조건별 집계
 *   - watchlistRepo.loadWatchlist() — 현재 후보 종목이 공유하는 조건 추출
 *
 * 스케줄: 매주 월요일 08:10 KST (weekly calibration 08:00 KST 직후)
 */
import { loadAttributionRecords } from '../persistence/attributionRepo.js';
import { analyzeAttribution, CONDITION_NAMES, type ConditionAttribution } from '../learning/attributionAnalyzer.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { sendTelegramBroadcast } from './telegramClient.js';
import { channelHeader, CHANNEL_SEPARATOR, kstMMDD } from './channelFormatter.js';

function isoWeekLabel(d: Date = new Date()): string {
  // ISO week number (간이 계산) — "Wnn" 포맷.
  const target = new Date(d.getTime());
  target.setUTCHours(0, 0, 0, 0);
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `W${weekNo.toString().padStart(2, '0')}`;
}

function fmtPctSigned(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

// ── 주간 필터 + 랭킹 ─────────────────────────────────────────────────────────

interface ScorecardInputs {
  weeklyTotalTrades: number;
  weeklyWins: number;
  top3Winners: ConditionAttribution[];
  bottom3Losers: ConditionAttribution[];
  nextWeekFocus: Array<{ conditionName: string; watchlistCount: number }>;
}

function buildInputs(): ScorecardInputs | null {
  const now = Date.now();
  const weekAgo = now - 7 * 86_400_000;
  const all = loadAttributionRecords();
  const weekly = all.filter(r => new Date(r.closedAt).getTime() > weekAgo);

  if (weekly.length < 3) return null; // 표본 미달 — 스킵

  const analysis = analyzeAttribution(weekly);
  // 거래가 존재한 조건만 유의미
  const active = analysis.filter(a => a.totalTrades >= 2);

  const top3Winners = [...active]
    .sort((a, b) => (b.avgReturn * b.totalTrades) - (a.avgReturn * a.totalTrades))
    .slice(0, 3);

  const bottom3Losers = [...active]
    .filter(a => a.avgReturn < 0 || a.recommendation === 'DECREASE_WEIGHT' || a.recommendation === 'SUSPEND')
    .sort((a, b) => a.avgReturn - b.avgReturn)
    .slice(0, 3);

  // 다음주 주목 조건 — 현재 워치리스트의 conditionKeys 빈도 집계
  const watchlist = loadWatchlist();
  const conditionKeyCount = new Map<string, number>();
  for (const w of watchlist) {
    if (!w.conditionKeys) continue;
    for (const key of w.conditionKeys) {
      conditionKeyCount.set(key, (conditionKeyCount.get(key) ?? 0) + 1);
    }
  }
  const nextWeekFocus = Array.from(conditionKeyCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, count]) => ({ conditionName: key, watchlistCount: count }));

  const wins = weekly.filter(r => r.isWin).length;

  return {
    weeklyTotalTrades: weekly.length,
    weeklyWins: wins,
    top3Winners,
    bottom3Losers,
    nextWeekFocus,
  };
}

// ── 메시지 조립 ──────────────────────────────────────────────────────────────

function formatScorecard(inputs: ScorecardInputs): string {
  const { weeklyTotalTrades, weeklyWins, top3Winners, bottom3Losers, nextWeekFocus } = inputs;
  const winRate = weeklyTotalTrades > 0 ? Math.round((weeklyWins / weeklyTotalTrades) * 100) : 0;

  const header = channelHeader({
    icon: '📈',
    title: '주간 조건 성과 리포트',
    suffix: `${isoWeekLabel()} · ${kstMMDD()}`,
  });

  const summaryLine =
    `이번 주 결산 ${weeklyTotalTrades}건\n` +
    `  → 수익 ${weeklyWins}건 / 손실 ${weeklyTotalTrades - weeklyWins}건 (승률 ${winRate}%)`;

  const winnersBlock = top3Winners.length > 0
    ? '\n<b>🏆 기여도 상위 조건</b>\n' +
      top3Winners.map((c, i) => {
        const medal = ['🥇','🥈','🥉'][i] ?? '•';
        return `  ${medal} ${c.conditionName} — 기여 ${fmtPctSigned(c.avgReturn)} (${c.totalTrades}건)`;
      }).join('\n')
    : '\n<b>🏆 기여도 상위 조건</b>: 표본 부족';

  const losersBlock = bottom3Losers.length > 0
    ? '\n\n<b>⚠️ 성과 저조 조건</b>\n' +
      bottom3Losers.map(c => {
        const mark = c.recommendation === 'SUSPEND' ? '❌'
                   : c.recommendation === 'DECREASE_WEIGHT' ? '⚠️' : '⚠️';
        return `  ${mark} ${c.conditionName} — ${fmtPctSigned(c.avgReturn)} (${c.totalTrades}건, ${c.recommendation})`;
      }).join('\n')
    : '';

  const focusBlock = nextWeekFocus.length > 0
    ? '\n\n<b>📋 다음 주 주목 조건</b>\n' +
      nextWeekFocus.map(f =>
        `  • ${CONDITION_NAMES[Number(f.conditionName)] ?? f.conditionName} — 워치리스트 ${f.watchlistCount}개 해당`
      ).join('\n')
    : '';

  return [header, summaryLine, winnersBlock + losersBlock + focusBlock, CHANNEL_SEPARATOR].join('\n');
}

// ── 메인 엔트리 ──────────────────────────────────────────────────────────────

export async function sendWeeklyConditionScorecard(): Promise<void> {
  try {
    const inputs = buildInputs();
    if (!inputs) {
      console.log('[WeeklyScorecard] 주간 표본 3건 미만 — 발송 스킵');
      return;
    }

    const message = formatScorecard(inputs);
    const today = new Date().toISOString().slice(0, 10);

    await sendTelegramBroadcast(message, {
      priority: 'NORMAL',
      tier: 'T2_REPORT',
      category: 'weekly_condition_scorecard',
      dedupeKey: `weekly_scorecard:${today}`,
      disableChannelNotification: true,
    });

    console.log(`[WeeklyScorecard] 발송 완료 — ${inputs.weeklyTotalTrades}건 분석`);
  } catch (e) {
    console.error('[WeeklyScorecard] 발송 실패:', e instanceof Error ? e.message : e);
  }
}
