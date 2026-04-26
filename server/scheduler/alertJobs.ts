/**
 * @responsibility 외부 시그널 알림 cron(DART / Bear Regime / IPS / MHS / DXY / 섹터 ETF / ADR 갭 / 장전 방향 카드)을 등록한다.
 *
 * 오케스트레이터와 독립적으로 동작 (AUTO_TRADE_ENABLED 무관).
 * PR-B-2 ADR-0043: 평일 KR 영업일 의존 cron 은 TRADING_DAY_ONLY,
 * IPS·DXY 인트라데이·ACK 폐루프 등 24/7 글로벌 cron 은 ALWAYS_ON.
 */
import { scheduledJob } from './scheduleGuard.js';
import { fastDartCheck, pollDartDisclosures } from '../alerts/dartPoller.js';
import { pollBearRegime } from '../alerts/bearRegimeAlert.js';
import { pollIpsAlert } from '../alerts/ipsAlert.js';
import { pollMhsMorningAlert } from '../alerts/mhsAlert.js';
import { runAdrGapScan } from '../alerts/adrGapCalculator.js';
import { runPreMarketSignal } from '../alerts/preMarketSignal.js';
import { runDxyMonitor, runDxyIntradayMonitor } from '../alerts/dxyMonitor.js';
import { runSectorEtfMomentumScan } from '../alerts/sectorEtfMomentum.js';
import { tickIntradayYield } from '../alerts/intradayYieldTicker.js';
import { sweepPendingAcks } from '../alerts/ackTracker.js';
import { checkForeignFlowLeadingAlert } from '../alerts/foreignFlowLeadingAlert.js';
import { runHolidayResumeAlert } from '../trading/holidayResumeAlert.js';
import { runMacroDigest } from '../alerts/macroDigestReport.js';
import { runWeeklySelfCritique } from '../alerts/weeklySelfCritiqueReport.js';

export function registerAlertJobs(): void {
  // DART 공시 30분 폴링 — 장중 08:30~18:00 KST. PR-B-2: TRADING_DAY_ONLY.
  scheduledJob('*/30 23,0,1,2,3,4,5,6,7,8,9 * * 1-5', 'TRADING_DAY_ONLY', 'dart_poll_30min',
    () => pollDartDisclosures(), { timezone: 'UTC' });

  // DART 고속 폴링 — 장중 1분 간격. UTC 23:xx + UTC 00-09 커버.
  scheduledJob('* 23 * * 0-4', 'TRADING_DAY_ONLY', 'dart_fast_check_pre',
    () => fastDartCheck(), { timezone: 'UTC' });
  scheduledJob('* 0-9 * * 1-5', 'TRADING_DAY_ONLY', 'dart_fast_check',
    () => fastDartCheck(), { timezone: 'UTC' });

  // Bear Regime Push 알림 — 15분 간격 폴링, 장중 KST 08:00~17:00.
  scheduledJob('*/15 23 * * 0-4', 'TRADING_DAY_ONLY', 'bear_regime_pre',
    () => pollBearRegime(), { timezone: 'UTC' });
  scheduledJob('*/15 0-8 * * 1-5', 'TRADING_DAY_ONLY', 'bear_regime',
    () => pollBearRegime(), { timezone: 'UTC' });

  // IPS 변곡점 경보 — 15분 간격 24/7 폴링 (장 외 시간 포함).
  // PR-B-2: ALWAYS_ON — 변곡점은 KR 휴장 무관 글로벌 신호.
  scheduledJob('*/15 * * * *', 'ALWAYS_ON', 'ips_alert',
    () => pollIpsAlert(), { timezone: 'UTC' });

  // MHS 임계값 모닝 알림 — 평일 오전 09:00 KST (UTC 00:00 Mon-Fri).
  scheduledJob('0 0 * * 1-5', 'TRADING_DAY_ONLY', 'mhs_morning_alert',
    () => pollMhsMorningAlert(), { timezone: 'UTC' });

  // ADR 역산 갭 모니터 — 평일 08:35 KST (UTC 23:35, 일~목).
  scheduledJob('35 23 * * 0-4', 'TRADING_DAY_ONLY', 'adr_gap_scan',
    () => runAdrGapScan(), { timezone: 'UTC' });

  // 외국인 수급 선행 경보 — 평일 07:30 KST (UTC 22:30, 일~목).
  scheduledJob('30 22 * * 0-4', 'TRADING_DAY_ONLY', 'foreign_flow_leading',
    () => checkForeignFlowLeadingAlert(), { timezone: 'UTC' });

  // 장전 방향 카드 (홍콩 30분 선행 모델) — 평일 08:30 KST (UTC 23:30, 일~목).
  scheduledJob('30 23 * * 0-4', 'TRADING_DAY_ONLY', 'pre_market_card',
    () => runPreMarketSignal('OPEN_MINUS_30'), { timezone: 'UTC' });
  // 보조 — 평일 10:45 KST (UTC 01:45, 월~금).
  scheduledJob('45 1 * * 1-5', 'TRADING_DAY_ONLY', 'pre_market_card_hk',
    () => runPreMarketSignal('HK_OPEN_PLUS_30'), { timezone: 'UTC' });

  // DXY 실시간 수급 방향 전환 모니터 — 미국 장 마감 직후 + 한국 장 직전.
  // PR-B-2: ALWAYS_ON — DXY 는 글로벌 (KR 휴장 무관).
  scheduledJob('5 21 * * 0-4', 'ALWAYS_ON', 'dxy_us_close',
    () => runDxyMonitor(), { timezone: 'UTC' });
  scheduledJob('40 23 * * 0-4', 'ALWAYS_ON', 'dxy_kr_open',
    () => runDxyMonitor(), { timezone: 'UTC' });

  // P3-7: DXY 인트라데이 모니터 — US 장 시간대 5분 간격.
  // PR-B-2: ALWAYS_ON — US 장은 KR 휴장 무관 (NYSE 게이트는 dxyMonitor 내부).
  //   ▸ 주간 cron '*/5 13-23 * * 1-5' = UTC 월~금 13~23시 = KST 월~금 22시 ~ 토 08시
  //   ▸ 야간 cron '*/5 0-5 * * 2-6'   = UTC 화~토 00~05시 = KST 화~토 09~14시
  scheduledJob('*/5 13-23 * * 1-5', 'ALWAYS_ON', 'dxy_intraday_us_session',
    () => runDxyIntradayMonitor(), { timezone: 'UTC' });
  scheduledJob('*/5 0-5 * * 2-6', 'ALWAYS_ON', 'dxy_intraday_lunch',
    () => runDxyIntradayMonitor(), { timezone: 'UTC' });

  // 미 섹터 ETF 30분봉 모멘텀 교차 스캔 — 평일 06:15 KST (UTC 21:15 일~목).
  // PR-B-2: ALWAYS_ON — 미국 ETF (KR 휴장 무관).
  scheduledJob('15 21 * * 0-4', 'ALWAYS_ON', 'sector_etf_momentum',
    () => runSectorEtfMomentumScan(), { timezone: 'UTC' });

  // IPYL — 장중 30분마다 Pipeline Yield 스냅샷 갱신.
  // PR-B-2: TRADING_DAY_ONLY — 평일 KST 09:00~15:30 장중 캐시 갱신.
  scheduledJob('*/30 0-6 * * 1-5', 'TRADING_DAY_ONLY', 'intraday_yield_tick', () => {
    try { tickIntradayYield(); } catch (e) { console.error('[IPYL] tick 실패:', e); }
  }, { timezone: 'UTC' });

  // T1 ACK 폐루프 스윕 — 5분 간격. 30분 미확인 → 재발송.
  // PR-B-2: ALWAYS_ON — ACK 트래킹은 24/7 (KR 휴장 무관).
  scheduledJob('*/5 * * * *', 'ALWAYS_ON', 'ack_sweep',
    () => sweepPendingAcks(), { timezone: 'UTC' });

  // PR-C ADR-0044 — 연휴 복귀 보수 매매 모드 알림. 평일 09:05 KST (UTC 00:05 월~금).
  // PR-B-2: TRADING_DAY_ONLY — 활성 정책은 함수 내부에서 결정, 비활성 시 silent.
  scheduledJob('5 0 * * 1-5', 'TRADING_DAY_ONLY', 'holiday_resume_alert',
    () => runHolidayResumeAlert(), { timezone: 'UTC' });

  // PR-X4 (ADR-0040) — CH3 REGIME 매크로 다이제스트 1일 2회 정기 발행.
  // PR-B-2: TRADING_DAY_ONLY — KR 영업일에만 발송 (KR 매크로 컨텍스트).
  // PRE_OPEN  KST 08:30 (UTC 23:30 일~목) — 장 시작 30분 전.
  // POST_CLOSE KST 16:00 (UTC 07:00 월~금) — 한국 장 마감 30분 후.
  scheduledJob('30 23 * * 0-4', 'TRADING_DAY_ONLY', 'macro_digest_pre_open',
    () => runMacroDigest('PRE_OPEN'), { timezone: 'UTC' });
  scheduledJob('0 7 * * 1-5', 'TRADING_DAY_ONLY', 'macro_digest_post_close',
    () => runMacroDigest('POST_CLOSE'), { timezone: 'UTC' });

  // PR-X5 (ADR-0041) — CH4 JOURNAL 주간 자기비판 리포트.
  // PR-B-2: WEEKEND_MAINTENANCE — 일요일 KST 19:00 (UTC 10:00 일요일).
  scheduledJob('0 10 * * 0', 'WEEKEND_MAINTENANCE', 'weekly_self_critique',
    () => runWeeklySelfCritique(), { timezone: 'UTC' });
}
