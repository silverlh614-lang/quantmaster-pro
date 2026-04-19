/**
 * @responsibility 체결·OCO·포트폴리오 리스크·거시-섹터 정렬 루프 cron과 매도 체결 폴링 setInterval 을 등록한다.
 *
 * 매도 체결 확인 폐루프는 cron 최소 단위(1분)보다 짧아 setInterval 로 구동한다.
 */
import cron from 'node-cron';
import { pollOcoConfirm } from '../trading/ocoConfirmLoop.js';
import { cancelAllActiveOco, pollOcoSurvival } from '../trading/ocoCloseLoop.js';
import { runOcoRecoveryRound } from '../trading/ocoRecoveryAgent.js';
import { SELL_POLL_INTERVAL, pollSellFills } from '../trading/fillMonitor.js';
import { runPortfolioRiskCheck } from '../trading/portfolioRiskEngine.js';
import { initMacroSyncDayOpen, macroSectorAlignmentCheck } from '../trading/macroSectorSync.js';

export function registerTradeFlowJobs(): void {
  // OCO 체결 확정 (30초) — 빠른 반대 주문 취소. 15분 pollOcoSurvival 은 안전망.
  // KST 09:00~15:30 = UTC 00:00~06:30 (Mon-Fri). node-cron 은 초 단위 cron 지원.
  cron.schedule('*/30 * 0-6 * * 1-5', async () => { await pollOcoConfirm().catch(console.error); }, { timezone: 'UTC' });

  // 포트폴리오 리스크 정기 점검 — 장중 15분 간격.
  // 허위 분산 경보, 베타 초과, 섹터 집중도를 정기 모니터링.
  cron.schedule('*/15 0-6 * * 1-5', async () => { await runPortfolioRiskCheck().catch(console.error); }, { timezone: 'UTC' });

  // OCO 생존 확인 폴링 — 장중 15분 간격. 한쪽 체결 시 다른쪽 자동 취소.
  cron.schedule('*/15 0-6 * * 1-5', async () => { await pollOcoSurvival().catch(console.error); }, { timezone: 'UTC' });

  // OCO 자동 복구 라운드 — 장중 5분 간격. FAILED 사이드 재등록(최대 3회 지수 백오프),
  // 한도 소진 시 시장가 강제 청산 fallback. 보호 주문 부재 노출 시간을 분 단위로 제한.
  cron.schedule('*/5 0-6 * * 1-5', async () => { await runOcoRecoveryRound().catch(console.error); }, { timezone: 'UTC' });

  // OCO 장마감 정리 — 15:20 KST (UTC 06:20). ACTIVE OCO 주문 쌍 전량 취소.
  cron.schedule('20 6 * * 1-5', async () => { await cancelAllActiveOco().catch(console.error); }, { timezone: 'UTC' });

  // 거시-섹터-종목 동기화 루프.
  // VIX 장중 +3% 급등 감지 → positionPct 20% 축소, 신규 진입 일시 중단.
  // 장 시작 초기화 — 09:00 KST (UTC 00:00): VIX 기준값 설정.
  cron.schedule('0 0 * * 1-5', async () => { await initMacroSyncDayOpen().catch(console.error); }, { timezone: 'UTC' });
  // 정렬 점검 — 장중 30분 간격, KST 09:30~15:00 (UTC 00:30~06:00).
  cron.schedule('0,30 0-5 * * 1-5', async () => {
    // UTC 00:00은 initMacroSyncDayOpen이 처리하므로 건너뜀 (최초 점검은 00:30 = KST 09:30)
    const now = new Date();
    if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) return;
    await macroSectorAlignmentCheck().catch(console.error);
  }, { timezone: 'UTC' });

  // 매도 체결 확인 폐루프 — 장중 30초 간격 (setInterval).
  // cron 최소 단위가 1분이므로 setInterval로 30초 간격 실행.
  let sellPollTimer: ReturnType<typeof setInterval> | null = null;

  cron.schedule('0 0 * * 1-5', () => {
    if (sellPollTimer) return;
    sellPollTimer = setInterval(() => {
      pollSellFills().catch(console.error);
    }, SELL_POLL_INTERVAL);
    console.log(`[Scheduler] 매도 체결 폴링 시작 (${SELL_POLL_INTERVAL / 1000}초 간격)`);
  }, { timezone: 'UTC' });

  cron.schedule('35 6 * * 1-5', () => {
    if (sellPollTimer) { clearInterval(sellPollTimer); sellPollTimer = null; }
    console.log('[Scheduler] 매도 체결 폴링 종료');
  }, { timezone: 'UTC' });
}
