/**
 * @responsibility 정기 리포트 cron(주간 요약 · 일일 픽 · 프리/인트라/포스트마켓 · 점검 브리핑 · 지표 갱신)을 등록한다.
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
import {
  sendDailyShadowProgress,
  sendSampleStallAlertIfNeeded,
} from '../alerts/shadowProgressBriefing.js';
import { sendWeeklyIntegrityReport } from '../alerts/weeklyIntegrityReport.js';

export function registerReportJobs(): void {
  // 주간 리포트 — 매주 금요일 16:30 KST (UTC 07:30)
  cron.schedule('30 7 * * 5', async () => { await generateWeeklyReport().catch(console.error); }, { timezone: 'UTC' });

  // 일일 종목 픽 리포트 — 평일 16:30 KST (UTC 07:30). 구독자용 픽 채널.
  cron.schedule('30 7 * * 1-5', async () => { await generateDailyPickReport().catch(console.error); }, { timezone: 'UTC' });

  // 시장 지표 자동 갱신 — 평일 08:40 KST + 15:30 KST (장 마감 후).
  // KOSPI/SPX/DXY/USD-KRW Yahoo Finance → classifyRegime() 7축 갱신
  cron.schedule('40 23 * * 0-4', async () => { await refreshMarketRegimeVars().catch(console.error); }, { timezone: 'UTC' });
  cron.schedule('30 6 * * 1-5', async () => { await refreshMarketRegimeVars().catch(console.error); }, { timezone: 'UTC' });

  // 장 시작 전 워치리스트 브리핑 — 평일 08:50 KST. FOMC 근접도 경보도 함께 발송.
  cron.schedule('50 23 * * 0-4', async () => {
    await sendWatchlistBriefing().catch(console.error);
    await checkFomcProximityAlert().catch(console.error);
  }, { timezone: 'UTC' });

  // 장전 시장 브리핑 — 평일 08:30 KST.
  // 간밤 글로벌 시장 + MHS + USD/KRW + 섹터 경보 + AI 전망 요약
  cron.schedule('30 23 * * 0-4', async () => { await sendPreMarketReport().catch(console.error); }, { timezone: 'UTC' });

  // 장중 시장 현황 레포트 — 평일 12:00 KST (UTC 03:00).
  cron.schedule('0 3 * * 1-5', async () => { await sendIntradayMarketReport().catch(console.error); }, { timezone: 'UTC' });

  // 장마감 시장 요약 레포트 — 평일 15:35 KST (UTC 06:35).
  // KOSPI 종가 + 당일 거래 결과 + 월간 통계 + AI 내일 전망
  cron.schedule('35 6 * * 1-5', async () => { await sendPostMarketReport().catch(console.error); }, { timezone: 'UTC' });

  // 장중 중간 점검 — 오전 11:30 KST (UTC 02:30).
  cron.schedule('30 2 * * 1-5', async () => { await sendIntradayCheckIn('midday').catch(console.error); }, { timezone: 'UTC' });

  // 마감 전 점검 — 오후 14:00 KST (UTC 05:00).
  cron.schedule('0 5 * * 1-5', async () => { await sendIntradayCheckIn('preclose').catch(console.error); }, { timezone: 'UTC' });

  // 장마감 Pipeline Yield 스코어카드 — 평일 15:40 KST (UTC 06:40).
  // 4단계 수율 계산: Discovery → Gate → Signal → Trade
  cron.schedule('40 6 * * 1-5', async () => { await generateQualityScorecard().catch(console.error); }, { timezone: 'UTC' });

  // Phase 2.1 — 일일 Shadow 진행률 브리핑 (16:40 KST, UTC 07:40).
  // "얼마나 남았는지"를 매일 눈으로 확인 → 지루함으로 인한 시스템 손질 방지.
  cron.schedule('40 7 * * 1-5', async () => {
    await sendDailyShadowProgress().catch(console.error);
    // 같은 cron 사이클에서 표본 정체도 함께 점검 (쿨다운 1일이라 중복 스팸 없음)
    await sendSampleStallAlertIfNeeded().catch(console.error);
  }, { timezone: 'UTC' });

  // Phase 3.2 — 주간 무결성 리포트 (일요일 10:00 KST = 토 01:00 UTC).
  // 주간 신호 발생 패턴 · 조건 활성화 빈도 · 판단 로직 해시값 변동 여부 요약.
  cron.schedule('0 1 * * 0', async () => {
    await sendWeeklyIntegrityReport().catch(console.error);
  }, { timezone: 'UTC' });
}
