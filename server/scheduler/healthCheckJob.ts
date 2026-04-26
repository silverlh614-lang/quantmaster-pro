/**
 * @responsibility 파이프라인 헬스체크(09:05 KST)와 새벽 자가진단(02:00 KST)을 실행해 Telegram 점검 요약을 푸시한다.
 */
import { scheduledJob } from './scheduleGuard.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { getDailyLossPct, getEmergencyStop } from '../state.js';
import { getKisTokenRemainingHours } from '../clients/kisClient.js';
import { getStreamStatus } from '../clients/kisStreamClient.js';
import { getKrxOpenApiStatus, isKrxOpenApiHealthy } from '../clients/krxOpenApi.js';
import { getLastScanAt } from '../orchestrator/adaptiveScanScheduler.js';
import { getLastBuySignalAt, getLastScanSummary } from '../trading/signalScanner.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { runPipelineDiagnosis } from '../trading/pipelineDiagnosis.js';
import { getLearningInterval } from '../learning/adaptiveLearningClock.js';
import { loadLearningState } from '../learning/learningState.js';

function toKstHm(ts: number): string {
  return new Date(ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
}

type YahooStatus = 'OK' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

function classifyYahoo(summary: ReturnType<typeof getLastScanSummary>): YahooStatus {
  if (!summary || summary.candidates === 0) return 'UNKNOWN';
  if (summary.yahooFails === summary.candidates) return 'DOWN';
  if (summary.yahooFails > summary.candidates * 0.5) return 'DEGRADED';
  return 'OK';
}

function computeVerdict(args: {
  emergencyStop: boolean;
  dailyLossPct: number;
  dailyLossLimit: number;
  watchlistLen: number;
  autoEnabled: boolean;
  autoMode: string;
  kisHours: number;
  lastScanTs: number;
  yahooStatus: YahooStatus;
  krxHealthy: boolean;
  krxConfigured: boolean;
}): string {
  const { emergencyStop, dailyLossPct, dailyLossLimit, watchlistLen, autoEnabled, autoMode, kisHours, lastScanTs, yahooStatus, krxHealthy, krxConfigured } = args;
  if (emergencyStop) return '🔴 EMERGENCY_STOP';
  if (dailyLossPct >= dailyLossLimit) return '🔴 DAILY_LOSS_LIMIT';
  if (watchlistLen === 0) return '🔴 WATCHLIST_EMPTY';
  if (!autoEnabled) return '🟡 AUTO_TRADE_DISABLED';
  if (autoMode === 'LIVE' && kisHours === 0) return '🟡 KIS_TOKEN_EXPIRED';
  if (!krxConfigured) return '🟡 KRX_NOT_CONFIGURED';
  if (!krxHealthy) return '🟡 KRX_UNHEALTHY';
  if (!lastScanTs) return '🟡 SCANNER_IDLE';
  if (yahooStatus === 'DOWN') return '🟡 YAHOO_DOWN';
  return '🟢 OK';
}

function formatKrxStatus(krxStatus: ReturnType<typeof getKrxOpenApiStatus>, healthy: boolean): string {
  if (!krxStatus.authKeyConfigured) return '⚠️ AUTH_KEY 미설정';
  if (!krxStatus.enabled) return '⚠️ DISABLED';
  if (!healthy) return `❌ 서킷 ${krxStatus.circuitState} (실패 ${krxStatus.failures}회)`;
  return `✅ 서킷 ${krxStatus.circuitState}`;
}

function computeLearningStatus(): { status: string; evalLagLbl: string; calibLagLbl: string; heldLbl: string; clock: ReturnType<typeof getLearningInterval> } {
  const learning = loadLearningState();
  const clock = getLearningInterval();
  const evalTs = learning.lastEvalAt ? new Date(learning.lastEvalAt).getTime() : 0;
  const calibTs = learning.lastCalibAt ? new Date(learning.lastCalibAt).getTime() : 0;
  const evalLagHrs = evalTs ? (Date.now() - evalTs) / 3_600_000 : Infinity;
  const calibLagDays = calibTs ? (Date.now() - calibTs) / 86_400_000 : Infinity;
  const calibStaleAt = clock.calibrateTriggerDays + 7;
  const status =
    !evalTs ? '⚪ EVAL_NEVER' :
    evalLagHrs > 30 ? '🔴 EVAL_STALE' :
    !calibTs ? '⚪ CALIB_NEVER' :
    calibLagDays > calibStaleAt ? '🔴 CALIB_STALE' :
    calibLagDays > clock.calibrateTriggerDays ? '🟡 CALIB_DUE' : '🟢 OK';
  const evalLagLbl = evalTs ? `${evalLagHrs.toFixed(0)}h전` : '미실행';
  const calibLagLbl = calibTs ? `${calibLagDays.toFixed(0)}일전` : '미실행';
  const heldLbl = learning.tradingHoldUntil && Date.now() < new Date(learning.tradingHoldUntil).getTime()
    ? ' | ⛔ 신규진입 홀드중' : '';
  return { status, evalLagLbl, calibLagLbl, heldLbl, clock };
}

async function runPipelineHealthCheck(): Promise<void> {
  try {
    const watchlist = loadWatchlist();
    const shadows = loadShadowTrades();
    const emergencyStop = getEmergencyStop();
    const dailyLossPct = getDailyLossPct();
    const dailyLossLimit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
    const autoEnabled = process.env.AUTO_TRADE_ENABLED === 'true';
    const autoMode = process.env.AUTO_TRADE_MODE ?? 'SHADOW';
    const kisHours = getKisTokenRemainingHours();
    const lastScanTs = getLastScanAt();
    const lastBuyTs = getLastBuySignalAt();
    const scanSummary = getLastScanSummary();
    const activeTrades = shadows.filter((s) => isOpenShadowStatus(s.status)).length;
    const yahooStatus = classifyYahoo(scanSummary);
    const krxStatus = getKrxOpenApiStatus();
    const krxHealthy = isKrxOpenApiHealthy();

    const verdict = computeVerdict({
      emergencyStop, dailyLossPct, dailyLossLimit, watchlistLen: watchlist.length,
      autoEnabled, autoMode, kisHours, lastScanTs, yahooStatus,
      krxHealthy, krxConfigured: krxStatus.authKeyConfigured,
    });
    const lastScanAt = lastScanTs > 0 ? toKstHm(lastScanTs) : '미실행';
    const lastBuyAt = lastBuyTs > 0 ? toKstHm(lastBuyTs) : '없음';
    const learning = computeLearningStatus();
    const streamStatus = getStreamStatus();

    await sendTelegramAlert(
      `🩺 <b>[파이프라인 헬스체크] 09:05 KST</b>\n` +
      `판정: ${verdict}\n` +
      `─────────────────────\n` +
      `워치리스트: ${watchlist.length}개 | 활성 포지션: ${activeTrades}개\n` +
      `자동매매: ${autoEnabled ? '✅ 켜짐' : '❌ 꺼짐'} (${autoMode})\n` +
      `KIS 토큰: ${kisHours > 0 ? `✅ ${kisHours}시간 남음` : '❌ 만료'}\n` +
      `KRX OpenAPI: ${formatKrxStatus(krxStatus, krxHealthy)}\n` +
      `Yahoo: ${yahooStatus === 'OK' ? '✅' : yahooStatus === 'DEGRADED' ? '⚠️ 부분장애' : yahooStatus === 'DOWN' ? '❌ 불가' : '?'}\n` +
      `마지막 스캔: ${lastScanAt} | 마지막 신호: ${lastBuyAt}\n` +
      `일일손실: ${dailyLossPct.toFixed(1)}% / 한도 ${dailyLossLimit}%\n` +
      `비상정지: ${emergencyStop ? '🛑 활성' : '✅ 해제'}\n` +
      `실시간호가: ${streamStatus.connected ? `✅ ${streamStatus.subscribedCount}종목` : '❌ 미연결'}\n` +
      `학습엔진: ${learning.status} (평가 ${learning.evalLagLbl} / 캘리브레이션 ${learning.calibLagLbl})${learning.heldLbl}\n` +
      `학습클럭: ${learning.clock.mode} (L4 트리거 ${learning.clock.calibrateTriggerDays}일) — ${learning.clock.reason}`,
    ).catch(console.error);
  } catch (e) {
    console.error('[Scheduler] 파이프라인 헬스체크 전송 실패:', e);
  }
}

async function runSelfDiagnosis(): Promise<void> {
  try {
    const diagnosis = await runPipelineDiagnosis();
    if (!diagnosis.hasCriticalIssue && diagnosis.warnings.length === 0) {
      console.log('[Scheduler] 새벽 자가진단 이상 없음');
      return;
    }
    const sections: string[] = [];
    if (diagnosis.issues.length > 0) {
      sections.push(`🚨 <b>치명 이슈 (${diagnosis.issues.length}건)</b>\n` + diagnosis.issues.map((i) => `• ${i}`).join('\n'));
    }
    if (diagnosis.warnings.length > 0) {
      sections.push(`⚠️ <b>경고 (${diagnosis.warnings.length}건)</b>\n` + diagnosis.warnings.map((w) => `• ${w}`).join('\n'));
    }
    await sendTelegramAlert(
      `🩺 <b>[새벽 자가진단] ${diagnosis.checkedAt}</b>\n\n` +
      sections.join('\n\n') +
      (diagnosis.hasCriticalIssue ? '\n\n→ 오늘 장 시작 전 조치 필요' : ''),
    ).catch(console.error);
  } catch (e) {
    console.error('[Scheduler] 새벽 자가진단 실패:', e);
  }
}

export function registerHealthCheckJobs(): void {
  // 평일 KST 09:05 (UTC 00:05) Telegram 자동 전송. PR-B-2: TRADING_DAY_ONLY.
  scheduledJob('5 0 * * 1-5', 'TRADING_DAY_ONLY', 'pipeline_health_check',
    runPipelineHealthCheck, { timezone: 'UTC' });

  // 평일 KST 02:00 (UTC 17:00) 파이프라인 치명 이슈 조기 감지.
  // PR-B-2: TRADING_DAY_ONLY — KRX 공휴일에 진단 무의미.
  scheduledJob('0 17 * * 0-4', 'TRADING_DAY_ONLY', 'self_diagnosis',
    runSelfDiagnosis, { timezone: 'UTC' });
}
