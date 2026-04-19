/**
 * @responsibility 정기 리포트 cron(주간 요약 · 일일 픽 · 프리/인트라/포스트마켓 · 점검 브리핑 · 지표 갱신)을 등록한다.
 *
 * Phase 3: 참뮌 스펙 #5에 따라 아침·정오·장마감 3개의 "통합 슬롯" 으로 합쳐
 * 30분 이내 다건 발송되던 중복 인지 부담을 제거한다. 통합 슬롯 안에서 호출된
 * 각 report 함수의 sendTelegramAlert 는 unifiedBriefing이 버퍼로 흡수해
 * 단일 composite 메시지로 발송한다. T1/CRITICAL 은 자동 우회.
 */
import cron from 'node-cron';
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
import { generateQualityScorecard } from '../alerts/qualityScorecard.js';
import { sendScanReviewReport } from '../alerts/scanReviewReport.js';
import { sendPositionMorningCard } from '../alerts/positionMorningCard.js';
import { sendWeeklyConditionScorecard } from '../alerts/weeklyConditionScorecard.js';
import {
  sendDailyShadowProgress,
  sendSampleStallAlertIfNeeded,
} from '../alerts/shadowProgressBriefing.js';
import { sendWeeklyIntegrityReport } from '../alerts/weeklyIntegrityReport.js';
import { sendWeeklyHygieneAudit } from '../alerts/weeklyHygieneAudit.js';
import { runHourlyCanary } from '../learning/mutationCanary.js';
import { beginUnifiedBriefing, endUnifiedBriefing } from '../alerts/unifiedBriefing.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

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
  // Phase 4: 금요일 16:30 발송은 주말에 잊혀지는 문제가 있어 월요일 아침으로 이동.
  // "지난 주 움직임 + 이번 주 액션 아이템" narrative 형식.
  cron.schedule('0 23 * * 0', async () => { await generateWeeklyReport().catch(console.error); }, { timezone: 'UTC' });

  // 주간 조건 성과 스코어카드 — 매주 월요일 08:10 KST (UTC 일요일 23:10). IDEA 6.
  // 27조건 Top3/Bottom3 + 다음주 주목 조건 → DM+채널 브로드캐스트.
  cron.schedule('10 23 * * 0', async () => { await sendWeeklyConditionScorecard().catch(console.error); }, { timezone: 'UTC' });

  // 일일 종목 픽 리포트 — 평일 16:30 KST (UTC 07:30). 구독자용 픽 채널.
  cron.schedule('30 7 * * 1-5', async () => { await generateDailyPickReport().catch(console.error); }, { timezone: 'UTC' });

  // 오늘 스캔 회고 리포트 — 평일 16:40 KST (UTC 07:40). IDEA 1.
  // scanTracer + watchlist + shadowTrades 교차 → 탈락 상위 이유 + 내일 후보 → DM+채널 브로드캐스트.
  cron.schedule('40 7 * * 1-5', async () => { await sendScanReviewReport().catch(console.error); }, { timezone: 'UTC' });

  // 보유 포지션 Morning Card — 평일 09:05 KST (UTC 00:05). IDEA 4.
  // positionAggregator 생애주기 집계 → 활성 포지션별 현재가/손절/목표 격차 카드 → DM+채널.
  cron.schedule('5 0 * * 1-5', async () => { await sendPositionMorningCard().catch(console.error); }, { timezone: 'UTC' });

  // 시장 지표 자동 갱신 — 평일 08:40 KST + 15:30 KST (장 마감 후).
  // KOSPI/SPX/DXY/USD-KRW Yahoo Finance → classifyRegime() 7축 갱신. Telegram 없음.
  cron.schedule('40 23 * * 0-4', async () => { await refreshMarketRegimeVars().catch(console.error); }, { timezone: 'UTC' });
  cron.schedule('30 6 * * 1-5', async () => { await refreshMarketRegimeVars().catch(console.error); }, { timezone: 'UTC' });

  // ── Phase 3 통합 슬롯 ─────────────────────────────────────────────────────
  // 아침 브리핑 — 평일 08:45 KST (UTC 23:45, 일~목).
  // 기존 08:30 장전 + 08:50 워치리스트 + 08:50 FOMC 근접도를 1건으로 병합.
  cron.schedule('45 23 * * 0-4', async () => {
    await runUnifiedBriefing('🌅 아침 브리핑', 'T2_REPORT', [
      sendPreMarketReport,
      sendWatchlistBriefing,
      checkFomcProximityAlert,
    ]);
  }, { timezone: 'UTC' });

  // 정오 점검 — 평일 12:30 KST (UTC 03:30).
  // 기존 11:30 midday + 12:00 장중 현황 + 14:00 preclose를 1건으로 병합.
  cron.schedule('30 3 * * 1-5', async () => {
    await runUnifiedBriefing('🕛 정오 점검', 'T2_REPORT', [
      () => sendIntradayCheckIn('midday'),
      sendIntradayMarketReport,
      () => sendIntradayCheckIn('preclose'),
    ]);
  }, { timezone: 'UTC' });

  // 장마감 종합 — 평일 16:00 KST (UTC 07:00).
  // 기존 15:35 포스트 마켓 + 15:40 스코어카드 + 16:40 Shadow 진행률을 1건으로 병합.
  cron.schedule('0 7 * * 1-5', async () => {
    await runUnifiedBriefing('🌙 장마감 종합', 'T2_REPORT', [
      sendPostMarketReport,
      generateQualityScorecard,
      sendDailyShadowProgress,
      async () => { await sendSampleStallAlertIfNeeded(); },
    ]);
  }, { timezone: 'UTC' });

  // Phase 3.2 — 주간 무결성 리포트 (일요일 10:00 KST = 일 01:00 UTC).
  // 주간 신호 발생 패턴 · 조건 활성화 빈도 · 판단 로직 해시값 변동 여부 요약.
  // Phase 6 — 동일 슬롯에서 알림 감사 리포트도 함께 발송.
  cron.schedule('0 1 * * 0', async () => {
    await sendWeeklyIntegrityReport().catch(console.error);
    await sendWeeklyHygieneAudit().catch(console.error);
  }, { timezone: 'UTC' });

  // Phase 2차 C4 — Mutation Canary: 매시간 정각, 고정 입력 → 고정 출력 검증.
  // 판단 로직에 우발적 변경이 일어난 직후 ≤ 60분 내 CRITICAL 경보.
  cron.schedule('0 * * * *', async () => {
    await runHourlyCanary().catch(console.error);
  }, { timezone: 'UTC' });
}
