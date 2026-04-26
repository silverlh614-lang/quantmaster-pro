/**
 * @responsibility 정기 리포트 cron(주간 요약 · 일일 픽 · 프리/인트라/포스트마켓 · 점검 브리핑 · 지표 갱신)을 등록한다.
 *
 * Phase 3: 참뮌 스펙 #5에 따라 아침·정오·장마감 3개의 "통합 슬롯" 으로 합쳐
 * 30분 이내 다건 발송되던 중복 인지 부담을 제거한다.
 *
 * PR-B-2 ADR-0037: 평일 영업일 의존 cron 은 TRADING_DAY_ONLY,
 * 주간 리포트(월/일요일)·Mutation Canary(매시간 24/7) 는 ALWAYS_ON / WEEKEND_MAINTENANCE.
 */
import { scheduledJob } from './scheduleGuard.js';
import {
  generateWeeklyReport,
  sendIntradayCheckIn,
  sendIntradayMarketReport,
  sendPostMarketReport,
  sendPreMarketReport,
  sendWatchlistBriefing,
} from '../alerts/reportGenerator.js';
import { refreshMarketRegimeVars } from '../trading/marketDataRefresh.js';
import { checkFomcProximityAlert } from '../trading/fomcCalendar.js';
import { generateDailyPickReport } from '../alerts/stockPickReporter.js';
import { resetKisCircuits } from '../clients/kisClient.js';
import { _resetKrxOpenApiBreaker } from '../clients/krxOpenApi.js';
import { generateQualityScorecard } from '../alerts/qualityScorecard.js';
import { sendScanReviewReport } from '../alerts/scanReviewReport.js';
import { sendPositionMorningCard } from '../alerts/positionMorningCard.js';
import { sendWeeklyConditionScorecard } from '../alerts/weeklyConditionScorecard.js';
import { sendSectorCycleDashboard } from '../alerts/sectorCycleDashboard.js';
import { sendNewHighMomentumScan } from '../alerts/newHighMomentumScanner.js';
import { sendWeeklyDeepAnalysis } from '../alerts/weeklyDeepAnalysis.js';
import { sendWeeklyQuantInsight } from '../alerts/weeklyQuantInsight.js';
import {
  sendDailyShadowProgress,
  sendSampleStallAlertIfNeeded,
} from '../alerts/shadowProgressBriefing.js';
import { sendWeeklyIntegrityReport } from '../alerts/weeklyIntegrityReport.js';
import { sendWeeklyHygieneAudit } from '../alerts/weeklyHygieneAudit.js';
import { runHourlyCanary } from '../learning/mutationCanary.js';
import { beginUnifiedBriefing, endUnifiedBriefing } from '../alerts/unifiedBriefing.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { flushInfoDailyDigest, flushSystemWeeklySummary } from '../alerts/alertRouter.js';

/** 통합 브리핑 래퍼 — 내부 report 함수 호출을 캡처해 단일 composite로 발송. */
async function runUnifiedBriefing(
  header: string,
  tier: 'T2_REPORT' | 'T3_DIGEST',
  steps: Array<() => Promise<void>>,
): Promise<void> {
  beginUnifiedBriefing(header, tier);
  try {
    for (const step of steps) {
      await step().catch((e: unknown) =>
        console.error(`[UnifiedBriefing] step 실패 (${header}):`, e instanceof Error ? e.message : e));
    }
  } finally {
    const composed = endUnifiedBriefing();
    if (composed) {
      await sendTelegramAlert(composed.message, { tier: composed.tier, category: 'unified_briefing' })
        .catch((e: unknown) => console.error(`[UnifiedBriefing] 전송 실패 (${header}):`, e instanceof Error ? e.message : e));
    }
  }
}

export function registerReportJobs(): void {
  // 주간 캘리브레이션 리포트 — 매주 월요일 08:00 KST (UTC 일요일 23:00).
  // PR-B-2: ALWAYS_ON — 월요일이 KRX 공휴일이어도 주간 누적 리포트 가치 있음.
  scheduledJob('0 23 * * 0', 'ALWAYS_ON', 'weekly_report',
    () => generateWeeklyReport(), { timezone: 'UTC' });

  // 주간 조건 성과 스코어카드 — 매주 월요일 08:10 KST.
  scheduledJob('10 23 * * 0', 'ALWAYS_ON', 'weekly_condition_scorecard',
    () => sendWeeklyConditionScorecard(), { timezone: 'UTC' });

  // 저녁 추천 사이클 직전 회로 자동 reset — 평일 KST 16:25.
  scheduledJob('25 7 * * 1-5', 'TRADING_DAY_ONLY', 'circuit_auto_reset', () => {
    const cleared = resetKisCircuits();
    try { _resetKrxOpenApiBreaker(); } catch { /* noop */ }
    if (cleared > 0) {
      console.log(`[Scheduler] 저녁 사이클 회로 자동 reset — KIS ${cleared}개 해제 + KRX 함께 reset`);
    }
  }, { timezone: 'UTC' });

  // 일일 종목 픽 리포트 — 평일 16:30 KST.
  scheduledJob('30 7 * * 1-5', 'TRADING_DAY_ONLY', 'daily_pick_report',
    () => generateDailyPickReport(), { timezone: 'UTC' });

  // 오늘 스캔 회고 리포트 — 평일 16:40 KST.
  scheduledJob('40 7 * * 1-5', 'TRADING_DAY_ONLY', 'scan_retrospective',
    () => sendScanReviewReport(), { timezone: 'UTC' });

  // 보유 포지션 Morning Card — 평일 09:05 KST.
  scheduledJob('5 0 * * 1-5', 'TRADING_DAY_ONLY', 'morning_position_card',
    () => sendPositionMorningCard(), { timezone: 'UTC' });

  // 섹터 사이클 대시보드 — 평일 14:30 KST.
  scheduledJob('30 5 * * 1-5', 'TRADING_DAY_ONLY', 'sector_cycle_dashboard',
    () => sendSectorCycleDashboard(), { timezone: 'UTC' });

  // 52주 신고가 모멘텀 스캔 — 평일 16:05 KST.
  scheduledJob('5 7 * * 1-5', 'TRADING_DAY_ONLY', 'high_52w_scan',
    () => sendNewHighMomentumScan(), { timezone: 'UTC' });

  // 주간 심층 분석 카드 — 매주 수요일 15:00 KST.
  scheduledJob('0 6 * * 3', 'TRADING_DAY_ONLY', 'weekly_deep_analysis',
    () => sendWeeklyDeepAnalysis(), { timezone: 'UTC' });

  // 주간 퀀트 인사이트 — 매주 금요일 17:00 KST.
  scheduledJob('0 8 * * 5', 'TRADING_DAY_ONLY', 'weekly_quant_insight',
    () => sendWeeklyQuantInsight(), { timezone: 'UTC' });

  // 시장 지표 자동 갱신 — 평일 08:40 KST + 15:30 KST.
  scheduledJob('40 23 * * 0-4', 'TRADING_DAY_ONLY', 'market_regime_refresh_morning',
    () => refreshMarketRegimeVars(), { timezone: 'UTC' });
  scheduledJob('30 6 * * 1-5', 'TRADING_DAY_ONLY', 'market_regime_refresh_close',
    () => refreshMarketRegimeVars(), { timezone: 'UTC' });

  // ── Phase 3 통합 슬롯 ─────────────────────────────────────────────────────
  // 아침 브리핑 — 평일 08:45 KST.
  scheduledJob('45 23 * * 0-4', 'TRADING_DAY_ONLY', 'morning_briefing', async () => {
    await runUnifiedBriefing('🌅 아침 브리핑', 'T2_REPORT', [
      sendPreMarketReport,
      sendWatchlistBriefing,
      checkFomcProximityAlert,
    ]);
  }, { timezone: 'UTC' });

  // 정오 점검 — 평일 12:30 KST.
  scheduledJob('30 3 * * 1-5', 'TRADING_DAY_ONLY', 'lunch_briefing', async () => {
    await runUnifiedBriefing('🕛 정오 점검', 'T2_REPORT', [
      () => sendIntradayCheckIn('midday'),
      sendIntradayMarketReport,
      () => sendIntradayCheckIn('preclose'),
    ]);
  }, { timezone: 'UTC' });

  // 장마감 종합 — 평일 16:00 KST.
  scheduledJob('0 7 * * 1-5', 'TRADING_DAY_ONLY', 'eod_briefing', async () => {
    await runUnifiedBriefing('🌙 장마감 종합', 'T2_REPORT', [
      sendPostMarketReport,
      generateQualityScorecard,
      sendDailyShadowProgress,
      async () => { await sendSampleStallAlertIfNeeded(); },
    ]);
  }, { timezone: 'UTC' });

  // 주간 무결성 리포트 (일요일 10:00 KST). PR-B-2: WEEKEND_MAINTENANCE.
  scheduledJob('0 1 * * 0', 'WEEKEND_MAINTENANCE', 'weekly_integrity_report', async () => {
    await sendWeeklyIntegrityReport().catch(console.error);
    await sendWeeklyHygieneAudit().catch(console.error);
  }, { timezone: 'UTC' });

  // INFO 채널 일일 다이제스트 flush (평일 15:35 KST).
  scheduledJob('35 6 * * 1-5', 'TRADING_DAY_ONLY', 'info_digest_flush',
    () => flushInfoDailyDigest(), { timezone: 'UTC' });

  // SYSTEM 채널 주간 요약 flush (금요일 17:00 KST).
  scheduledJob('0 8 * * 5', 'TRADING_DAY_ONLY', 'system_weekly_flush',
    () => flushSystemWeeklySummary(), { timezone: 'UTC' });

  // Mutation Canary: 매시간 정각.
  // PR-B-2: ALWAYS_ON — 판단 로직 변경 감시는 24/7.
  scheduledJob('0 * * * *', 'ALWAYS_ON', 'hourly_canary',
    () => runHourlyCanary(), { timezone: 'UTC' });
}
