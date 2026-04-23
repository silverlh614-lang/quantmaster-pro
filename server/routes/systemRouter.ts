// server/routes/systemRouter.ts
// 시스템 라우터 — server.ts에서 분리
// 포함 대상: GET /health, GET /emergency-status, POST /emergency-stop,
//            POST /emergency-reset, POST /daily-loss, POST /send-email,
//            POST /telegram/webhook, POST /telegram/test
import { Router, Request, Response } from 'express';
// Phase 5-⑩: 이메일 채널 제거 — /send-email 는 410 Gone 을 반환한다.
import {
  getEmergencyStop, setEmergencyStop,
  getDailyLossPct, setDailyLoss,
} from '../state.js';
import { cancelAllPendingOrders, checkDailyLossLimit } from '../emergency.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { handleTelegramWebhook } from '../telegram/webhookHandler.js';
import { getApiUsageStats, getGeminiCircuitStats, getGeminiRuntimeState, getBudgetState } from '../clients/geminiClient.js';
import { getDartCircuitStats } from '../clients/dartFinancialClient.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { computeFocusCodes } from '../screener/watchlistManager.js';
import { getLastRejectionLog } from '../screener/stockScreener.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import { getVixGating } from '../trading/vixGating.js';
import { getFomcProximity } from '../trading/fomcCalendar.js';
import { getLastScanAt } from '../orchestrator/adaptiveScanScheduler.js';
import { loadGateAudit } from '../persistence/gateAuditRepo.js';
import { getCacheEntry, setCacheEntry, getAiCacheSnapshot } from '../persistence/aiCacheRepo.js';
import { buildRagIndex, queryRag, generateAdvice, getRagStats } from '../rag/localRag.js';
import { loadShadowTrades, getRemainingQty } from '../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';
import { getKisTokenRemainingHours } from '../clients/kisClient.js';
import { getKrxOpenApiStatus, isKrxOpenApiHealthy } from '../clients/krxOpenApi.js';
import { getLastBuySignalAt, getLastScanSummary } from '../trading/signalScanner.js';
import { getStreamStatus } from '../clients/kisStreamClient.js';
import { getYahooHealthSnapshot } from '../trading/marketDataRefresh.js';
import { DATA_DIR } from '../persistence/paths.js';
import { getCachedIntradayYield } from '../alerts/intradayYieldTicker.js';
import fs from 'fs';

const router = Router();

// ─────────────────────────────────────────────────────────────
// 아이디어 7: Health Check + Keep-Alive
// ─────────────────────────────────────────────────────────────
const serverStart = new Date().toISOString();

router.get('/health', (_req: Request, res: Response) => {
  // Railway 가 자동 주입하는 커밋 SHA. 로컬/기타 환경은 GIT_COMMIT_SHA fallback.
  const commitSha = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? 'unknown';
  res.json({
    status: 'ok',
    commit: commitSha.slice(0, 7),
    emergencyStop: getEmergencyStop(),
    dailyLossPct: getDailyLossPct(),
    autoTradeEnabled: process.env.AUTO_TRADE_ENABLED === 'true',
    mode: process.env.AUTO_TRADE_MODE ?? 'SHADOW',
    kisIsReal: process.env.KIS_IS_REAL === 'true',
    uptime: process.uptime(),
    startedAt: serverStart,
    circuitBreakers: {
      gemini: getGeminiCircuitStats(),
      dart: getDartCircuitStats(),
    },
    geminiRuntime: getGeminiRuntimeState(),
  });
});

// ─────────────────────────────────────────────────────────────
// 아이디어 9: 비상 정지 API
// ─────────────────────────────────────────────────────────────

router.get('/emergency-status', (_req: Request, res: Response) => {
  res.json({ emergencyStop: getEmergencyStop(), dailyLossPct: getDailyLossPct() });
});

router.post('/emergency-stop', async (_req: Request, res: Response) => {
  setEmergencyStop(true);
  console.error('[EMERGENCY] 수동 비상 정지 발동!');
  await cancelAllPendingOrders().catch(console.error);
  res.json({ status: 'STOPPED', stoppedAt: new Date().toISOString() });
});

router.post('/emergency-reset', (req: Request, res: Response) => {
  const secret = process.env.EMERGENCY_RESET_SECRET;
  if (secret && req.body?.secret !== secret) {
    return res.status(403).json({ error: '인증 실패' });
  }
  setEmergencyStop(false);
  setDailyLoss(0);
  console.log('[EMERGENCY] 비상 정지 해제 — 자동매매 재개');
  res.json({ status: 'RESUMED' });
});

// ─── 아이디어 7: Telegram 양방향 봇 Webhook ────────────────────────────────────
// Railway 엔드포인트 등록: POST /api/telegram/webhook
// Telegram Bot API에서 setWebhook → https://<RAILWAY_URL>/api/telegram/webhook
router.post('/telegram/webhook', handleTelegramWebhook);

// 일일 손실 외부 업데이트 (프론트엔드에서 Shadow 결과 집계 후 호출)
router.post('/daily-loss', (req: Request, res: Response) => {
  const { pct } = req.body;
  if (typeof pct === 'number') {
    setDailyLoss(pct);
    checkDailyLossLimit().catch(console.error);
  }
  res.json({ ok: true, dailyLossPct: getDailyLossPct() });
});

// Phase 5-⑩: 이메일 엔드포인트 폐기 — 레거시 클라이언트가 호출할 수 있으므로 410 Gone 반환.
router.post('/send-email', (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'Email channel removed',
    details: 'Phase 5-⑩: 이메일 채널 제거. Telegram 통합 채널로 전환되었습니다.',
  });
});

// ─────────────────────────────────────────────────────────────
// 아이디어 12: Telegram 알림 테스트
// ─────────────────────────────────────────────────────────────

router.post('/telegram/test', async (_req: Request, res: Response) => {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 미설정' });
  }
  try {
    await sendTelegramAlert(
      `✅ <b>[QuantMaster Pro] Telegram 연결 테스트</b>\n` +
      `서버 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST\n` +
      `모드: ${process.env.KIS_IS_REAL === 'true' ? '🔴 실거래' : '🟡 모의투자'}\n` +
      `비상정지: ${getEmergencyStop() ? '🛑 활성' : '✅ 해제'}`
    );
    res.json({ ok: true, message: 'Telegram 메시지 전송 완료' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Gemini API 일별 사용량 통계 ─────────────────────────────────────────────
// GET /api/system/api-usage — caller별 호출 횟수 + 토큰 수 (당일 기준)
router.get('/system/api-usage', (_req: Request, res: Response) => {
  const stats = getApiUsageStats();
  const total = Object.values(stats).reduce(
    (acc, s) => ({ count: acc.count + s.count, tokens: acc.tokens + s.tokens }),
    { count: 0, tokens: 0 }
  );
  // Idea 13: 월 예산 상태 동봉 (대시보드/디버깅용)
  const budget = getBudgetState();
  res.json({ date: new Date().toISOString().slice(0, 10), total, byCallers: stats, budget });
});

// ─── Idea 4: AI 응답 영속 캐시 (3층 백엔드) ─────────────────────────────────
// 클라이언트 aiClient는 메모리/localStorage 미스 시 이 엔드포인트로 폴백.
// 캐시 키는 모두 영숫자/하이픈/콜론/언더바만 허용 — 그 외는 400.

const SAFE_KEY_RE = /^[A-Za-z0-9_:\-.]{1,200}$/;

router.get('/system/ai-cache/:key', (req: Request, res: Response) => {
  const key = req.params.key;
  if (!SAFE_KEY_RE.test(key)) return res.status(400).json({ error: 'invalid key format' });
  const entry = getCacheEntry(key);
  if (!entry) return res.status(404).json({ hit: false });
  res.json({ hit: true, ...entry });
});

router.post('/system/ai-cache/:key', (req: Request, res: Response) => {
  const key = req.params.key;
  if (!SAFE_KEY_RE.test(key)) return res.status(400).json({ error: 'invalid key format' });
  const body = req.body ?? {};
  if (body.data === undefined) return res.status(400).json({ error: 'data field required' });
  const ttlMs = typeof body.ttlMs === 'number' && body.ttlMs > 0 ? body.ttlMs : undefined;
  setCacheEntry(key, body.data, ttlMs);
  res.json({ ok: true });
});

router.get('/system/ai-cache', (_req: Request, res: Response) => {
  res.json(getAiCacheSnapshot());
});

// ─── Idea 11: 로컬 RAG ────────────────────────────────────────────────────────
// data/knowledge/*.txt → text-embedding-004로 1회 임베딩 → 코사인 유사도 검색
// /api/system/rag/build : 인덱스 (재)빌드. 신규 청크만 증분 임베딩.
// /api/system/rag/stats : 인덱스 통계 (청크 수, 소스 파일, 마지막 빌드 시각)
// /api/system/rag/query?q=... : 상위 3개 청크 + 유사도 점수
// /api/system/rag/advice?topic=... : 템플릿 조립 결과 (Gemini 호출 없음)

router.post('/system/rag/build', async (_req: Request, res: Response) => {
  try {
    const result = await buildRagIndex();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/system/rag/stats', (_req: Request, res: Response) => {
  res.json(getRagStats());
});

router.get('/system/rag/query', async (req: Request, res: Response) => {
  const q = (req.query.q as string ?? '').trim();
  if (!q) return res.status(400).json({ error: 'q 쿼리 파라미터 필요' });
  const k = Math.max(1, Math.min(10, parseInt((req.query.k as string) ?? '3', 10) || 3));
  const hits = await queryRag(q, k);
  res.json({ q, k, hits: hits.map((h) => ({ source: h.chunk.source, score: h.score, snippet: h.chunk.content.slice(0, 300) })) });
});

router.get('/system/rag/advice', async (req: Request, res: Response) => {
  const topic = (req.query.topic as string ?? '').trim();
  if (!topic) return res.status(400).json({ error: 'topic 쿼리 파라미터 필요' });
  const advice = await generateAdvice(topic);
  res.json({ topic, advice, hasContent: advice.length > 0 });
});

// ─────────────────────────────────────────────────────────────
// 아이디어 10: 실시간 진단 대시보드 — "왜 매수 안 되는가" 엔드포인트
// ─────────────────────────────────────────────────────────────
router.get('/system/buy-audit', (_req: Request, res: Response) => {
  const watchlist = loadWatchlist();
  const focusCodes = computeFocusCodes(watchlist);
  const buyList = watchlist.filter(
    (w) => w.addedBy === 'MANUAL' || focusCodes.has(w.code),
  );

  const macroState = loadMacroState();
  const regime = getLiveRegime(macroState);
  const vixGating = getVixGating(macroState?.vix, macroState?.vixHistory);
  const fomcGating = getFomcProximity();

  const lastScanTs = getLastScanAt();
  const lastScanAt = lastScanTs > 0 ? new Date(lastScanTs).toISOString() : null;

  const rejectedStocks = getLastRejectionLog().slice(0, 50);

  res.json({
    watchlistCount: watchlist.length,
    focusCount: focusCodes.size,
    buyListCount: buyList.length,
    regime,
    vixGating: {
      noNewEntry: vixGating.noNewEntry,
      kellyMultiplier: vixGating.kellyMultiplier,
      reason: vixGating.reason,
    },
    fomcGating: {
      noNewEntry: fomcGating.noNewEntry,
      phase: fomcGating.phase,
      kellyMultiplier: fomcGating.kellyMultiplier,
      description: fomcGating.description,
      nextFomcDate: fomcGating.nextFomcDate,
      // FOMC 차단 해제 시점: FOMC 당일(DAY) 다음 날 KST 09:00 (장 시작)
      unblockAt: fomcGating.noNewEntry && fomcGating.nextFomcDate
        ? new Date(new Date(fomcGating.nextFomcDate).getTime() + 24 * 60 * 60 * 1000).toISOString()
        : null,
    },
    emergencyStop: getEmergencyStop(),
    lastScanAt,
    rejectedStocks,
  });
});

// ─────────────────────────────────────────────────────────────
// 아이디어 11: Gate 조건 통과율 히트맵 — 조건별 passed/failed 누적
// ─────────────────────────────────────────────────────────────
router.get('/system/gate-audit', (_req: Request, res: Response) => {
  res.json(loadGateAudit());
});

// ─────────────────────────────────────────────────────────────
// 아이디어 1: 전체 파이프라인 자가진단 헬스체크
// GET /api/health/pipeline
// ─────────────────────────────────────────────────────────────
router.get('/health/pipeline', (_req: Request, res: Response) => {
  const watchlist     = loadWatchlist();
  const shadows       = loadShadowTrades();
  const autoEnabled   = process.env.AUTO_TRADE_ENABLED === 'true';
  const autoMode      = process.env.AUTO_TRADE_MODE ?? 'SHADOW';
  const emergencyStop = getEmergencyStop();
  const dailyLossPct  = getDailyLossPct();
  const dailyLossLimit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
  const kisConfigured = !!process.env.KIS_APP_KEY;
  const kisTokenHours = getKisTokenRemainingHours();
  const kisTokenValid = kisConfigured && (autoMode !== 'LIVE' || kisTokenHours > 0);

  // KRX OpenAPI AUTH_KEY 상태 — 인증키 설정·서킷 상태·빌드된 base URL 까지 포함
  const krxStatus = getKrxOpenApiStatus();
  const krxTokenConfigured = krxStatus.authKeyConfigured;
  const krxTokenValid = isKrxOpenApiHealthy();
  const watchlistCount   = watchlist.length;
  const shadowTradeCount = shadows.filter(s => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0).length;

  // 볼륨 마운트: PERSIST_DATA_DIR 또는 기본 DATA_DIR 쓰기 가능 여부
  let railwayVolumeMount = false;
  try {
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    railwayVolumeMount = true;
  } catch { /* 쓰기 불가 */ }

  const lastScanTs = getLastScanAt();
  const lastScanAt = lastScanTs > 0
    ? new Date(lastScanTs).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
    : null;

  const lastBuyTs = getLastBuySignalAt();
  const lastBuySignalAt = lastBuyTs > 0
    ? new Date(lastBuyTs).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
    : null;

  const scanSummary = getLastScanSummary();
  // Yahoo 상태 결정 — UI '/'No scan history' 회피용 fallback 추가:
  //   1) 스캔 후보가 1개 이상이면: 후보 대비 yahooFails 비율로 판정 (기존 로직 유지)
  //   2) 그렇지 않으면: fetchDailyBars heartbeat 의 lastSuccessAt 으로 fallback
  //      → 스캐너가 idle 이거나 candidates=0 일 때도 Yahoo 자체는 살아있음을 표시
  const yh = getYahooHealthSnapshot();
  let yahooApiDetail: 'NO_SCAN_HISTORY' | 'NO_CANDIDATES' | 'HAS_CANDIDATES' | 'HEARTBEAT_OK' | 'HEARTBEAT_STALE' | 'HEARTBEAT_DOWN';
  let yahooApiStatus: 'UNKNOWN' | 'OK' | 'STALE' | 'DEGRADED' | 'DOWN';
  if (scanSummary && scanSummary.candidates > 0) {
    yahooApiDetail = 'HAS_CANDIDATES';
    yahooApiStatus = scanSummary.yahooFails === scanSummary.candidates ? 'DOWN'
      : scanSummary.yahooFails > scanSummary.candidates * 0.5 ? 'DEGRADED'
      : 'OK';
  } else if (yh.status === 'OK') {
    yahooApiDetail = 'HEARTBEAT_OK';
    yahooApiStatus = 'OK';
  } else if (yh.status === 'STALE') {
    yahooApiDetail = 'HEARTBEAT_STALE';
    yahooApiStatus = 'STALE';
  } else if (yh.status === 'DOWN') {
    yahooApiDetail = 'HEARTBEAT_DOWN';
    yahooApiStatus = 'DOWN';
  } else if (scanSummary && scanSummary.candidates === 0) {
    // 스캔은 돌았지만 후보가 없고, Yahoo 호출도 한 번도 없었던 (드문) 경우
    yahooApiDetail = 'NO_CANDIDATES';
    yahooApiStatus = 'OK';
  } else {
    yahooApiDetail = 'NO_SCAN_HISTORY';
    yahooApiStatus = 'UNKNOWN';
  }

  // verdict: 파이프라인 첫 번째 단절점 반환
  let verdict: string;
  if (emergencyStop)                           verdict = '🔴 EMERGENCY_STOP';
  else if (dailyLossPct >= dailyLossLimit)     verdict = '🔴 DAILY_LOSS_LIMIT';
  else if (watchlistCount === 0)               verdict = '🔴 WATCHLIST_EMPTY';
  else if (!autoEnabled)                       verdict = '🟡 AUTO_TRADE_DISABLED';
  else if (!kisConfigured)                     verdict = '🟡 KIS_NOT_CONFIGURED';
  else if (autoMode === 'LIVE' && !kisTokenValid) verdict = '🟡 KIS_TOKEN_EXPIRED';
  else if (!krxTokenConfigured)                verdict = '🟡 KRX_TOKEN_NOT_CONFIGURED';
  else if (!krxTokenValid)                     verdict = '🟡 KRX_TOKEN_UNHEALTHY';
  else if (!lastScanAt)                        verdict = '🟡 SCANNER_IDLE';
  else if (yahooApiStatus === 'DOWN')          verdict = '🟡 YAHOO_DOWN';
  else                                         verdict = '🟢 OK';

  // ── KIS WebSocket 실시간 스트림 상태 ──────────────────────────────────────
  const streamStatus = getStreamStatus();

  // ── IPYL: 장중 Pipeline Yield 스냅샷 ──────────────────────────────────────
  const intradayYield = getCachedIntradayYield();

  res.json({
    scheduler:           'OK',
    watchlistCount,
    shadowTradeCount,
    autoTradeEnabled:    autoEnabled,
    autoTradeMode:       autoMode,
    kisConfigured,
    kisTokenValid,
    kisTokenHoursLeft:   kisTokenHours,
    krxTokenConfigured,
    krxTokenValid,
    krxCircuitState:     krxStatus.circuitState,
    krxFailures:         krxStatus.failures,
    yahooApiStatus,
    yahooApiDetail,
    railwayVolumeMount,
    lastScanAt,
    lastBuySignalAt,
    dailyLossPct,
    dailyLossLimitReached: dailyLossPct >= dailyLossLimit,
    emergencyStop,
    lastScanSummary:     scanSummary,
    kisStream: {
      connected:       streamStatus.connected,
      subscribedCount: streamStatus.subscribedCount,
      activePrices:    streamStatus.activePrices,
      reconnectCount:  streamStatus.reconnectCount,
      lastPongAt:      streamStatus.lastPongAt,
      recentEvents:    streamStatus.recentEvents,
    },
    intradayYield,
    verdict,
  });
});

// ─────────────────────────────────────────────────────────────
// 아이디어 11 (Phase 5): 조건 학습 상태 시각화 API
// ─────────────────────────────────────────────────────────────

router.get('/learning/condition-state', async (_req: Request, res: Response) => {
  try {
    const [
      { loadConditionWeights },
      { loadPromptBoosts },
      { loadPhaseMap },
      { loadShadowRealDrift },
      { loadAttributionRecords },
      { analyzeAttribution, CONDITION_NAMES, serverConditionKey },
      { loadWeightHistory },
      { loadExperimentalConditions },
    ] = await Promise.all([
      import('../persistence/conditionWeightsRepo.js'),
      import('../persistence/promptBoostRepo.js'),
      import('../learning/phaseMapCalibrator.js'),
      import('../learning/shadowRealDriftDetector.js'),
      import('../persistence/attributionRepo.js'),
      import('../learning/attributionAnalyzer.js'),
      import('../persistence/weightHistoryRepo.js'),
      import('../persistence/experimentalConditionRepo.js'),
    ]);

    const weights  = loadConditionWeights();
    const boosts   = loadPromptBoosts();
    const phaseMap = loadPhaseMap();
    const drift    = loadShadowRealDrift();
    const history  = loadWeightHistory();
    const experimental = loadExperimentalConditions();

    // 조건 감사 상태(ACTIVE/PROBATION/SUSPENDED)
    let auditState: Record<string, { status: string; winRate: number; sharpe: number; totalTrades: number }> = {};
    try {
      const CONDITION_AUDIT_FILE = (await import('../persistence/paths.js')).CONDITION_AUDIT_FILE;
      if (fs.existsSync(CONDITION_AUDIT_FILE)) {
        const raw = JSON.parse(fs.readFileSync(CONDITION_AUDIT_FILE, 'utf-8')) as Record<string, unknown>;
        auditState = raw as typeof auditState;
      }
    } catch { /* audit state missing — 빈 객체 유지 */ }

    const attribution = analyzeAttribution(loadAttributionRecords());

    const conditions = attribution.map((a) => {
      const key = serverConditionKey(a.conditionId);
      const phaseEntry = phaseMap.entries[a.conditionId];
      return {
        conditionId:   a.conditionId,
        conditionName: a.conditionName,
        serverKey:     key,
        weight:        key ? ((weights as Record<string, number>)[key] ?? 1.0) : null,
        promptBoost:   key ? null : (boosts[a.conditionId] ?? 1.0),
        auditStatus:   key ? (auditState[key]?.status ?? 'ACTIVE') : 'CLIENT_SOFT',
        winRate:       a.winRate,
        sharpe:        a.sharpe,
        totalTrades:   a.totalTrades,
        recentTrend:   a.recentTrend,
        byRegime:      a.byRegime,
        bestPartners:  a.bestPartners,
        worstPartners: a.worstPartners,
        recommendation: a.recommendation,
        dangerRegimes: phaseEntry?.dangerRegimes ?? [],
      };
    });

    res.json({
      conditions,
      conditionNames: CONDITION_NAMES,
      drift: {
        shadowAvgReturn: drift.shadowAvgReturn,
        liveAvgReturn:   drift.liveAvgReturn,
        driftPct:        drift.driftPct,
        targetBoost:     drift.targetBoost,
        stopBoost:       drift.stopBoost,
        shadowCount:     drift.shadowCount,
        liveCount:       drift.liveCount,
        updatedAt:       drift.updatedAt,
      },
      weightHistory: history.slice(-6).map((s) => ({
        timestamp: s.timestamp,
        source:    s.source,
        weights:   s.weights,
      })),
      experimentalConditions: experimental.slice(-20),
      phaseMap: {
        updatedAt: phaseMap.updatedAt,
        dangerMatrix: Object.values(phaseMap.entries).map((e) => ({
          conditionId:   e.conditionId,
          conditionName: e.conditionName,
          dangerRegimes: e.dangerRegimes,
          regimeWinRates: e.regimeWinRates,
        })),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
