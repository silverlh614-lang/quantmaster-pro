/**
 * @responsibility 외부 시그널 알림 cron(DART / Bear Regime / IPS / MHS / DXY / 섹터 ETF / ADR 갭 / 장전 방향 카드)을 등록한다.
 *
 * 오케스트레이터와 독립적으로 동작 (AUTO_TRADE_ENABLED 무관).
 */
import cron from 'node-cron';
import { fastDartCheck, pollDartDisclosures } from '../alerts/dartPoller.js';
import { pollBearRegime } from '../alerts/bearRegimeAlert.js';
import { pollIpsAlert } from '../alerts/ipsAlert.js';
import { pollMhsMorningAlert } from '../alerts/mhsAlert.js';
import { runAdrGapScan } from '../alerts/adrGapCalculator.js';
import { runPreMarketSignal } from '../alerts/preMarketSignal.js';
import { runDxyMonitor } from '../alerts/dxyMonitor.js';
import { runSectorEtfMomentumScan } from '../alerts/sectorEtfMomentum.js';
import { tickIntradayYield } from '../alerts/intradayYieldTicker.js';
import { sweepPendingAcks } from '../alerts/ackTracker.js';

export function registerAlertJobs(): void {
  // DART 공시 30분 폴링 — 장중 08:30~18:00 KST (UTC 23:30~09:00)
  cron.schedule('*/30 23,0,1,2,3,4,5,6,7,8,9 * * 1-5', async () => {
    await pollDartDisclosures().catch(console.error);
  }, { timezone: 'UTC' });

  // DART 고속 폴링 — 장중 1분 간격, 고영향 키워드 즉시 반응.
  // UTC 23:xx (KST 08:xx) + UTC 00-09 (KST 09-18) 커버
  cron.schedule('* 23 * * 0-4', async () => { await fastDartCheck().catch(console.error); }, { timezone: 'UTC' });
  cron.schedule('* 0-9 * * 1-5', async () => { await fastDartCheck().catch(console.error); }, { timezone: 'UTC' });

  // Bear Regime Push 알림 — 15분 간격 폴링, 장중 KST 08:00~17:00
  cron.schedule('*/15 23 * * 0-4', async () => { await pollBearRegime().catch(console.error); }, { timezone: 'UTC' });
  cron.schedule('*/15 0-8 * * 1-5', async () => { await pollBearRegime().catch(console.error); }, { timezone: 'UTC' });

  // IPS 변곡점 경보 — 15분 간격 24/7 폴링 (장 외 시간 포함)
  cron.schedule('*/15 * * * *', async () => { await pollIpsAlert().catch(console.error); }, { timezone: 'UTC' });

  // MHS 임계값 모닝 알림 — 평일 오전 09:00 KST (UTC 00:00 Mon-Fri).
  // RED 레짐(MHS < 40) 또는 GREEN 레짐 전환(MHS ≥ 70) 시 즉시 Telegram 알림
  cron.schedule('0 0 * * 1-5', async () => { await pollMhsMorningAlert().catch(console.error); }, { timezone: 'UTC' });

  // ADR 역산 갭 모니터 — 평일 08:35 KST (UTC 23:35, 일~목).
  // 간밤 NY 종가 기반 한국 종목 이론 시가 역산 → |갭| ≥ 2% 시 Telegram 경보.
  cron.schedule('35 23 * * 0-4', async () => { await runAdrGapScan().catch(console.error); }, { timezone: 'UTC' });

  // 장전 방향 카드 (홍콩 30분 선행 모델) — 평일 08:30 KST (UTC 23:30, 일~목).
  // |score| ≥ 40 일 때만 선제 Telegram 경보.
  cron.schedule('30 23 * * 0-4', async () => { await runPreMarketSignal('OPEN_MINUS_30').catch(console.error); }, { timezone: 'UTC' });
  // 보조 — 평일 10:45 KST (UTC 01:45, 월~금). 항셍 개장 30분 후 라이브 반영 재계산.
  cron.schedule('45 1 * * 1-5', async () => { await runPreMarketSignal('HK_OPEN_PLUS_30').catch(console.error); }, { timezone: 'UTC' });

  // DXY 실시간 수급 방향 전환 모니터.
  // 미국 장 마감 직후 06:05 KST + 한국 장 직전 08:40 KST 재확인.
  cron.schedule('5 21 * * 0-4', async () => { await runDxyMonitor().catch(console.error); }, { timezone: 'UTC' });
  cron.schedule('40 23 * * 0-4', async () => { await runDxyMonitor().catch(console.error); }, { timezone: 'UTC' });

  // 미 섹터 ETF 30분봉 모멘텀 교차 스캔 — 평일 06:15 KST (UTC 21:15 일~목).
  cron.schedule('15 21 * * 0-4', async () => { await runSectorEtfMomentumScan().catch(console.error); }, { timezone: 'UTC' });

  // IPYL — 장중 30분마다 Pipeline Yield (Discovery/Gate/Signal) 스냅샷 갱신.
  // 평일 KST 09:00 ~ 15:30 (UTC 00:00 ~ 06:30) 커버. 런타임 캐시만 갱신 — Telegram 없음.
  cron.schedule('*/30 0-6 * * 1-5', () => {
    try { tickIntradayYield(); } catch (e) { console.error('[IPYL] tick 실패:', e); }
  }, { timezone: 'UTC' });

  // T1 ACK 폐루프 스윕 — 5분 간격. 30분 미확인 → 재발송, 60분 미확인 → 이메일 에스컬레이션.
  cron.schedule('*/5 * * * *', async () => {
    await sweepPendingAcks().catch(e =>
      console.error('[AckTracker] sweep 실패:', e instanceof Error ? e.message : e));
  }, { timezone: 'UTC' });
}
