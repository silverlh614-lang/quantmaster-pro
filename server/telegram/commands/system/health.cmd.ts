// @responsibility: /health 명령 — 워치/포지션/KIS/Yahoo/DART/Gemini/Volume/스트림 8축 헬스체크 + verdict.
import { loadShadowTrades, getRemainingQty } from '../../../persistence/shadowTradeRepo.js';
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
import { getEmergencyStop, getDailyLossPct } from '../../../state.js';
import {
  getKisTokenRemainingHours,
  getRealDataTokenRemainingHours,
} from '../../../clients/kisClient.js';
import { getStreamStatus } from '../../../clients/kisStreamClient.js';
import { getGeminiRuntimeState } from '../../../clients/geminiClient.js';
import { getYahooHealthSnapshot } from '../../../trading/marketDataRefresh.js';
import { getLastScanAt } from '../../../orchestrator/adaptiveScanScheduler.js';
import {
  getLastBuySignalAt,
  getLastScanSummary,
  isOpenShadowStatus,
} from '../../../trading/signalScanner.js';
import { verifyVolumeMount } from '../../../persistence/paths.js';
import { guardedFetch } from '../../../utils/egressGuard.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const health: TelegramCommand = {
  name: '/health',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '파이프라인 헬스체크 (KIS/스캐너/토큰/Yahoo/DART/Gemini/Volume/Stream)',
  async execute({ reply }) {
    const watchlist = loadWatchlist();
    const shadows = loadShadowTrades();
    const emergencyStop = getEmergencyStop();
    const dailyLossPct = getDailyLossPct();
    const dailyLossLimit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
    const autoEnabled = process.env.AUTO_TRADE_ENABLED === 'true';
    const autoMode = process.env.AUTO_TRADE_MODE ?? 'SHADOW';
    const kisHours = getKisTokenRemainingHours();
    const realDataHours = getRealDataTokenRemainingHours();
    const lastScanTs = getLastScanAt();
    const lastScanAt =
      lastScanTs > 0
        ? new Date(lastScanTs).toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '미실행';
    const lastBuyTs = getLastBuySignalAt();
    const lastBuyAt =
      lastBuyTs > 0
        ? new Date(lastBuyTs).toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '없음';
    const scanSummary = getLastScanSummary();
    const activeTrades = shadows.filter(
      s => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0,
    ).length;
    const geminiRuntime = getGeminiRuntimeState();

    // Yahoo 집계 상태 — 우선순위:
    //   1) 최근 스캔 결과(scanSummary) 가 있고 후보가 1개라도 있었으면 → 후보 대비 실패율로 판정
    //   2) 그렇지 않으면(스캐너 idle 또는 candidates=0) → fetchDailyBars 의 last-success heartbeat 로 fallback
    //   3) heartbeat 도 없으면 → '?'/UNKNOWN
    // (이전엔 candidates=0 일 때 무조건 UNKNOWN 이라 운영자에게 '?' 가 자주 보였다.)
    const yh = getYahooHealthSnapshot();
    let yahooStatus: 'OK' | 'DEGRADED' | 'DOWN' | 'STALE' | 'UNKNOWN';
    if (scanSummary && scanSummary.candidates > 0) {
      if (scanSummary.yahooFails === scanSummary.candidates) yahooStatus = 'DOWN';
      else if (scanSummary.yahooFails > scanSummary.candidates * 0.5) yahooStatus = 'DEGRADED';
      else yahooStatus = 'OK';
    } else {
      yahooStatus = yh.status;
    }

    // ── 서브시스템 프로브 병렬 실행 (타임아웃 3초) ──────────────────────
    const volumeCheck = verifyVolumeMount();
    const probeTimeout = (ms: number) =>
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms));
    const withTimeout = <T,>(p: Promise<T>, ms = 3000) => Promise.race([p, probeTimeout(ms)]);
    const probes = await Promise.allSettled([
      withTimeout(
        guardedFetch(
          'https://query1.finance.yahoo.com/v7/finance/chart/^KS11?interval=1d&range=1d',
        ).then(r => (r.ok ? 'OK' : `HTTP ${r.status}`)),
      ),
      withTimeout(
        fetch(
          `https://opendart.fss.or.kr/api/list.json?crtfc_key=${process.env.DART_API_KEY ?? ''}&page_count=1`,
        ).then(async r => {
          if (!r.ok) return `HTTP ${r.status}`;
          const j = (await r.json()) as { status?: string };
          return j.status === '000' ? 'OK' : `status=${j.status}`;
        }),
      ),
    ]);
    const [yahooProbe, dartProbe] = probes;
    const probeLabel = (p: PromiseSettledResult<unknown>) =>
      p.status === 'fulfilled' ? `✅ ${p.value}` : `❌ ${(p.reason as Error).message}`;

    const uptimeHours = (process.uptime() / 3600).toFixed(1);
    const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    let verdict: string;
    if (emergencyStop) verdict = '🔴 EMERGENCY_STOP';
    else if (dailyLossPct >= dailyLossLimit) verdict = '🔴 DAILY_LOSS_LIMIT';
    else if (!volumeCheck.ok) verdict = '🔴 VOLUME_UNMOUNTED';
    else if (watchlist.length === 0) verdict = '🔴 WATCHLIST_EMPTY';
    else if (!autoEnabled) verdict = '🟡 AUTO_TRADE_DISABLED';
    else if (autoMode === 'LIVE' && kisHours === 0) verdict = '🟡 KIS_TOKEN_EXPIRED';
    else if (!lastScanTs) verdict = '🟡 SCANNER_IDLE';
    else if (yahooStatus === 'DOWN') verdict = '🟡 YAHOO_DOWN';
    else verdict = '🟢 OK';

    const ss = getStreamStatus();
    // Railway 가 자동 주입하는 배포 커밋. 실제 재배포 여부를 운영자가 즉시 확인 가능.
    const commitSha = (
      process.env.RAILWAY_GIT_COMMIT_SHA ??
      process.env.GIT_COMMIT_SHA ??
      'unknown'
    ).slice(0, 7);
    await reply(
      `🩺 <b>[파이프라인 헬스체크]</b> (uptime ${uptimeHours}h / mem ${memMB}MB / build ${commitSha})\n` +
      `판정: ${verdict}\n` +
      `─────────────────────\n` +
      `워치리스트: ${watchlist.length}개 | 활성 포지션: ${activeTrades}개\n` +
      `자동매매: ${autoEnabled ? '✅ 켜짐' : '❌ 꺼짐'} (${autoMode})\n` +
      `KIS 토큰: ${kisHours > 0 ? `✅ ${kisHours}시간 남음` : '❌ 만료'}` +
      (realDataHours > 0 ? ` | 실데이터: ✅ ${realDataHours}h` : '') +
      `\n` +
      `Yahoo probe: ${probeLabel(yahooProbe)}\n` +
      `DART probe: ${probeLabel(dartProbe)}\n` +
      `Gemini: ${geminiRuntime.status}${geminiRuntime.reason ? ` (${geminiRuntime.reason})` : ''}\n` +
      `Volume: ${volumeCheck.ok ? '✅ 마운트됨' : `❌ ${volumeCheck.error ?? '미마운트'}`}\n` +
      `Yahoo 집계: ${
        yahooStatus === 'OK'
          ? '✅'
          : yahooStatus === 'DEGRADED'
            ? '⚠️ 부분장애'
            : yahooStatus === 'STALE'
              ? `🟡 STALE (마지막 성공 ${
                  yh.lastSuccessAt > 0
                    ? new Date(yh.lastSuccessAt).toLocaleTimeString('ko-KR', {
                        timeZone: 'Asia/Seoul',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'N/A'
                })`
              : yahooStatus === 'DOWN'
                ? `❌ 불가 (연속 실패 ${yh.consecutiveFailures}회)`
                : '? 미수집'
      }\n` +
      `마지막 스캔: ${lastScanAt} | 마지막 신호: ${lastBuyAt}\n` +
      `일일손실: ${dailyLossPct.toFixed(1)}% / 한도 ${dailyLossLimit}%\n` +
      `비상정지: ${emergencyStop ? '🛑 활성' : '✅ 해제'}\n` +
      `실시간호가: ${ss.connected ? `✅ ${ss.subscribedCount}종목` : '❌ 미연결'}\n` +
      `─────────────────────\n` +
      `<i>/refresh_token — KIS 토큰 강제 갱신</i>`,
    );
  },
};

commandRegistry.register(health);

export default health;
