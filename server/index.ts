/// <reference types="node" />
import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dns from "dns";
import { createHash } from "crypto";
import dotenv from "dotenv";
import { tradingOrchestrator } from "./orchestrator/tradingOrchestrator.js";
import { sendTelegramAlert, setTelegramBotCommands } from "./alerts/telegramClient.js";
import { DATA_DIR, verifyVolumeMount } from "./persistence/paths.js";

// Railway/외부 API(fetch) IPv6 라우팅 이슈 방어: IPv4 lookup 우선.
// Phase 5-⑩ 이메일 채널 제거 후에도 DART·KIS·Yahoo 등 외부 HTTP 호출에 유효.
dns.setDefaultResultOrder('ipv4first');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// 설정 불일치 조기 감지: LIVE 모드인데 실계좌 TR ID가 꺼져 있으면 즉시 중단
if (process.env.AUTO_TRADE_MODE === 'LIVE' && process.env.KIS_IS_REAL !== 'true') {
  throw new Error(
    '설정 불일치: AUTO_TRADE_MODE=LIVE 이지만 KIS_IS_REAL이 true가 아닙니다. ' +
    '모의계좌에 실주문이 나가는 것을 막기 위해 서버를 종료합니다.'
  );
}

// ─── VTS 모드: Mock KIS 클라이언트 주입 ──────────────────────────────────────
// AUTO_TRADE_MODE === 'VTS'이면 실 KIS API 호출 없이 전체 파이프라인이 작동하도록
// 가상 데이터를 반환하는 Mock 클라이언트를 주입한다.
// startServer() 내부에서 스케줄러 기동 전에 await하므로 레이스 컨디션 없음.
async function initVtsMockIfNeeded(): Promise<void> {
  if (process.env.AUTO_TRADE_MODE !== 'VTS') return;
  const { createMockKisOverrides } = await import('./clients/mockKisClient.js');
  const { setKisClientOverrides } = await import('./clients/kisClient.js');
  setKisClientOverrides(createMockKisOverrides());
  console.log('[VTS] Mock KIS 클라이언트 주입 완료 — 실 API 호출 없이 전체 파이프라인 작동');
}

// ─────────────────────────────────────────────────────────────
// 아이디어 9: 서버사이드 비상 정지 모듈 (Circuit Breaker)
// 브라우저를 닫아도 서버 메모리에서 플래그 유지
// → 공유 상태를 server/state.ts로 분리
// ─────────────────────────────────────────────────────────────
import {
  isEmergencyStopped,
  setDailyLoss,
} from './state.js';
import kisRouter from './routes/kisRouter.js';
import krxRouter from './routes/krxRouter.js';
import marketDataRouter from './routes/marketDataRouter.js';
import aiUniverseRouter from './routes/aiUniverseRouter.js';
import dartRouter from './routes/dartRouter.js';
import autoTradeRouter from './routes/autoTradeRouter.js';
import systemRouter from './routes/systemRouter.js';
import failurePatternRouter from './routes/failurePatternRouter.js';
import diagnosticRouter from './routes/diagnosticRouter.js';
import operatorRouter from './routes/operatorRouter.js';
import monitoringCertRouter from './routes/monitoringCertRouter.js';
import userWatchlistRouter from './routes/userWatchlistRouter.js';
import { startScheduler } from './scheduler/index.js';
import { resolveStaticAssetsPath } from './staticAssets.js';
import { globalErrorHandler } from './utils/apiResponse.js';
import { installGlobalErrorHandlers, setCurrentBootId } from './utils/globalErrorHandlers.js';
import { startBoot, markBootReady, markCleanShutdown } from './persistence/bootManifest.js';
import { errorsSince, recordPersistentError } from './persistence/persistentErrorLog.js';


export { isEmergencyStopped, setDailyLoss };


async function startServer() {
  // ─── 기억 보완 회로: 부팅 매니페스트 기록 ────────────────────────────────
  // Volume 이 마운트돼 있으면 이전 세션이 정상 종료됐는지 여기서 판정된다.
  // (이전 엔트리 status='unknown' → 이번 시작에서 'crashed' 로 마감)
  const bootStartNs = Date.now();
  const bootInfo = startBoot();
  setCurrentBootId(bootInfo.current.bootId);

  // 전역 에러 포획 — 가장 먼저 설치해야 이후 모든 모듈 로드 중 예외도 잡는다.
  installGlobalErrorHandlers();

  // 이전 세션이 비정상 종료됐다면 → 그 세션 bootedAt 이후 에러 로그를 복기해
  // Telegram 으로 요약 보고. Volume 이 살아있다는 증거이기도 하다.
  if (bootInfo.previousCrashed && bootInfo.previous) {
    const since = bootInfo.previous.bootedAt;
    const prevErrors = errorsSince(since, 5);
    const snippet = prevErrors.length > 0
      ? prevErrors.map(e => `• [${e.severity}] ${e.source}: ${e.message}`).join('\n')
      : '(영속 로그에 기록된 에러 없음 — OOM/SIGKILL 추정)';
    sendTelegramAlert(
      `<b>[기억 보완] 이전 세션 비정상 종료 감지</b>\n` +
      `이전 bootId: <code>${bootInfo.previous.bootId}</code>\n` +
      `시작: ${since}\n` +
      `종료: (마감 기록 없음)\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${snippet}`,
      { priority: 'HIGH', dedupeKey: `prev_crash:${bootInfo.previous.bootId}`, category: 'boot_audit' },
    ).catch(() => { /* noop */ });
    console.warn(`[BootManifest] 이전 세션 (${bootInfo.previous.bootId}) 비정상 종료로 마감됨`);
  }
  console.log(`[BootManifest] bootId=${bootInfo.current.bootId} pid=${process.pid} mode=${bootInfo.current.tradeMode}`);

  // PR-7 #13: 부팅 시점 SHADOW BUY fill 레거시 백필 (1회성 멱등 마이그레이션).
  // 기존 shadow-trades.json 의 SHADOW 레코드 중 BUY fill 이 없는 trade 에 대해
  // `originalQuantity × shadowEntryPrice` 로 BUY fill 을 복원한다. 이후 모든
  // fill 기반 파생(getRemainingQty/syncPositionCache/computeShadowAccount) 이
  // 정상 작동한다. 재실행해도 이미 BUY fill 있는 trade 는 건너뛰어 안전.
  try {
    const { loadShadowTrades, saveShadowTrades, backfillShadowBuyFills } =
      await import('./persistence/shadowTradeRepo.js');
    const trades = loadShadowTrades();
    const n = backfillShadowBuyFills(trades);
    if (n > 0) {
      saveShadowTrades(trades);
      console.log(`[Boot] SHADOW BUY fill 백필 완료: ${n}건 — shadow-trades.json 저장`);
    } else {
      console.log('[Boot] SHADOW BUY fill 백필 대상 없음 (모든 SHADOW trade 정합)');
    }
  } catch (e) {
    console.error('[Boot] SHADOW BUY fill 백필 실패:', e instanceof Error ? e.message : e);
  }

  // PR-24 (ADR-0010): KIS 엔드포인트 영속 블랙리스트 로드 — 만료 entry 자동 청소.
  try {
    const { loadKisEndpointBlacklist } =
      await import('./persistence/kisEndpointBlacklistRepo.js');
    const active = loadKisEndpointBlacklist();
    if (active > 0) {
      console.log(`[Boot] KIS 엔드포인트 블랙리스트 로드: ${active}개 활성 entry`);
    }
  } catch (e) {
    console.error('[Boot] KIS 블랙리스트 로드 실패:', e instanceof Error ? e.message : e);
  }

  // AI 추천 외부 호출 예산 경보 — 2026-04 사용자 요청으로 enforcement 및 경보 비활성.
  // 사용자가 직접 실행하는 경로라 자동 차단·알림이 불필요. `aiCallBudgetRepo` 는 카운터만 유지.

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // API routes
  // ─────────────────────────────────────────────────────────────
  // 외부 시장 데이터 → server/routes/marketDataRouter.ts 로 분리
  // (ECOS, FRED, Yahoo Finance Historical, Market Indicators)
  // ─────────────────────────────────────────────────────────────
  app.use('/api', marketDataRouter);

  // ─────────────────────────────────────────────────────────────
  // AI 추천 universe — Google Search + Naver Finance (KIS/KRX 비의존)
  // ADR-0011 / PR-25-B
  // ─────────────────────────────────────────────────────────────
  app.use('/api/ai-universe', aiUniverseRouter);

  // ─────────────────────────────────────────────────────────────
  // KIS API Proxy  → server/routes/kisRouter.ts 로 분리
  // ─────────────────────────────────────────────────────────────
  app.use('/api/kis', kisRouter);

  // ─────────────────────────────────────────────────────────────
  // KRX-style 밸류에이션 (per/pbr/시가총액) — 실데이터는 KIS inquire-price 기반
  // ─────────────────────────────────────────────────────────────
  app.use('/api/krx', krxRouter);


  // ─────────────────────────────────────────────────────────────
  // DART 공시 API  → server/routes/dartRouter.ts 로 분리
  // ─────────────────────────────────────────────────────────────
  app.use('/api/dart', dartRouter);

  // ─────────────────────────────────────────────────────────────
  // 자동매매 라우터 → server/routes/autoTradeRouter.ts 로 분리
  // (/api/auto-trade/*, /api/macro/*, /api/shadow/*, /api/real-trade/*, /api/fss/*)
  // ─────────────────────────────────────────────────────────────
  app.use('/api', autoTradeRouter);

  // ─────────────────────────────────────────────────────────────
  // 시스템 라우터 → server/routes/systemRouter.ts 로 분리
  // (GET /health, GET /emergency-status, POST /emergency-stop,
  //  POST /emergency-reset, POST /daily-loss, POST /send-email,
  //  POST /telegram/webhook, POST /telegram/test)
  // ─────────────────────────────────────────────────────────────
  app.use('/api', systemRouter);

  // ─────────────────────────────────────────────────────────────
  // 반실패 패턴 DB → server/routes/failurePatternRouter.ts 로 분리
  // (GET /api/failure-patterns, POST /api/failure-patterns/check,
  //  POST /api/failure-patterns/save)
  // ─────────────────────────────────────────────────────────────
  app.use('/api/failure-patterns', failurePatternRouter);
  app.use('/api', diagnosticRouter);

  // ─────────────────────────────────────────────────────────────
  // 운용자 오버라이드 → server/routes/operatorRouter.ts
  // (POST /api/operator/override, GET /api/operator/override/status/history)
  // Telegram Decision Broker와 동일한 3택을 API로도 노출
  // ─────────────────────────────────────────────────────────────
  app.use('/api/operator', operatorRouter);

  // ─────────────────────────────────────────────────────────────
  // P2 #19 Monitoring Cert → server/routes/monitoringCertRouter.ts
  // (GET /api/monitoring-cert, GET /api/monitoring-cert/:stockCode)
  // 진입 판정을 편향·레짐·수동 빈도·냉각 상태로 객관화하는 통합 스냅샷.
  // ─────────────────────────────────────────────────────────────
  app.use('/api/monitoring-cert', monitoringCertRouter);

  // ─────────────────────────────────────────────────────────────
  // 사용자 관심종목 동기화 — 프론트 Zustand store ↔ 서버 영속화
  // (ADR 분리: 자동매매 워치리스트와 완전 독립)
  // ─────────────────────────────────────────────────────────────
  app.use(userWatchlistRouter);

  // ─── 아이디어 1: 오케스트레이터 상태 조회 ────────────────────────────────────
  app.get('/api/orchestrator/state', (_req: Request, res: Response) => {
    res.json(tradingOrchestrator.getStatus());
  });

  // ─── 글로벌 API 에러 핸들러 ───────────────────────────────────────────────
  // 라우터 등록 직후, Vite/static 미들웨어 등록 전에 장착하여 /api/* 만 envelope 화한다.
  // ZodError → 400, CircuitOpenError → 503, FetchRetryError → 502, 그 외 → 500
  app.use('/api', globalErrorHandler);

  // ─── Vite middleware (dev) / Static file serving (prod) ───────────────────
  // IMPORTANT: This must come AFTER all API routes so the catch-all '*'
  // doesn't intercept /api/* requests in production.
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const { distPath, hasIndexHtml } = resolveStaticAssetsPath(__dirname, process.cwd());
    console.log(`Serving static files from: ${distPath}`);

    const registerFallbackRoot = () => {
      console.warn('[Static] index.html not found. API routes remain available; root path returns status message.');
      app.get('/', (_req, res) => {
        res
          .status(200)
          .type('text/plain')
          .send('QuantMaster Pro server is running. Frontend build files are missing.');
      });
    };

    if (hasIndexHtml) {
      try {
        const indexHtmlPath = path.join(distPath, 'index.html');
        const [indexHtml, indexStats] = await Promise.all([
          fs.promises.readFile(indexHtmlPath, 'utf8'),
          fs.promises.stat(indexHtmlPath),
        ]);
        const indexEtag = `"${createHash('sha1').update(indexHtml).digest('hex')}"`;
        const indexLastModified = indexStats.mtime.toUTCString();
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
          if (req.headers['if-none-match'] === indexEtag) {
            return res.status(304).end();
          }
          res.set('ETag', indexEtag);
          res.set('Last-Modified', indexLastModified);
          res.type('html').send(indexHtml);
        });
      } catch (error) {
        console.warn('[Static] index.html became unavailable during startup. Serving fallback root.', error);
        registerFallbackRoot();
      }
    } else {
      registerFallbackRoot();
    }
  }

  // Railway Volume 마운트 검증 — 데이터 소실 위험을 기동 시 즉시 감지
  const volumeCheck = verifyVolumeMount();
  if (volumeCheck.ok) {
    console.log(`[Volume] ✅ 마운트 확인 (${DATA_DIR}): ${volumeCheck.timestamp}`);
  } else {
    console.error(`[Volume] ❌ 미마운트 (${DATA_DIR}): ${volumeCheck.error}`);
    sendTelegramAlert(
      `🚨 <b>[Railway Volume 미마운트]</b>\n` +
      `경로: ${DATA_DIR}\n` +
      `오류: ${volumeCheck.error}\n` +
      `재시작 시 shadow_trades·watchlist·dart·fss 데이터 전량 소실됩니다.`,
      { priority: 'CRITICAL', dedupeKey: 'volume_mount_fail' }
    ).catch(console.error);
  }

  // VTS Mock 주입은 HTTP 서버·스케줄러 기동 전에 동기적으로 완료
  await initVtsMockIfNeeded();

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // 부팅 완료 시점 기록 — 기억 보완 회로 (startupMs).
    markBootReady(bootInfo.current.bootId, Date.now() - bootStartNs);

    // ─── Graceful shutdown (Railway SIGTERM 대응) ─────────────────────────
    const shutdown = (signal: string) => {
      console.log(`[Server] ${signal} 수신 — graceful shutdown 시작`);
      // 기억 보완 회로: 정상 종료 마감 — 다음 부팅에서 'clean' 으로 관측된다.
      try { markCleanShutdown(bootInfo.current.bootId, signal); } catch { /* noop */ }
      // Idea 4: AI 캐시 강제 flush — debounce 타이머 대기 없이 디스크에 저장
      import('./persistence/aiCacheRepo.js')
        .then(({ flushAiCache }) => flushAiCache())
        .catch(() => { /* noop */ });
      server.close(() => {
        console.log('[Server] HTTP 서버 종료 완료');
        process.exit(0);
      });
      // 10초 내 종료되지 않으면 강제 종료
      setTimeout(() => { process.exit(0); }, 10_000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // ─── Phase 5: 엔진 스냅샷 복원 + 30초 주기 체크포인트 ────────────────────
    // app.listen 콜백은 동기라서 await 못 씀 — dynamic import 를 .then 체이닝.
    import('./persistence/engineSnapshotRepo.js')
      .then(({ restoreEngineSnapshot, startEngineSnapshotLoop }) => {
        restoreEngineSnapshot();
        startEngineSnapshotLoop();
        console.log('[AutoTrade] 엔진 스냅샷 체크포인트 루프 가동 (30s)');
      })
      .catch((e) => console.error('[AutoTrade] 엔진 스냅샷 초기화 실패:', e));

    // ─── cron 스케줄러 기동 ───────────────────────────────────────────────────
    startScheduler();

    // ─── KIS 토큰 기동 시 선행 갱신 ─────────────────────────────────────────────
    // cron 은 08:30 / 20:30 KST 에만 돌기 때문에, 재배포 직후·이 시점 사이에 서버가
    // 시작되면 사용자가 "주도주 분석 시작" 을 눌렀을 때 lazy-refresh 가 발동한다.
    // 부팅 시 1회 선행 갱신해 두면 첫 버튼 클릭에서 추가 OAuth2 요청이 없다.
    // fire-and-forget — 기동을 막지 않는다.
    import('./clients/kisClient.js')
      .then(({ forceRefreshKisTokens }) => forceRefreshKisTokens())
      .then((r) => console.log(`[KIS] 기동 시 토큰 선행 갱신 — main=${r.main}, realData=${r.realData}`))
      .catch((e) => console.warn('[KIS] 기동 시 토큰 선행 갱신 실패 (cron 이후 자동 복구):', e));

    console.log('[AutoTrade] 오케스트레이터 + DART 폴링 + Bear Regime 알림 + MHS 모닝 알림 + IPS 변곡점 경보 가동 완료');

    // 아이디어 2 — 워치리스트 부트스트랩: 장 중 재배포 감지 → 긴급 autoPopulate
    ;(async () => {
      const { loadWatchlist } = await import('./persistence/watchlistRepo.js');
      const { autoPopulateWatchlist } = await import('./screener/stockScreener.js');
      const kst = new Date(Date.now() + 9 * 3_600_000);
      const h = kst.getUTCHours(), m = kst.getUTCMinutes();
      const t = h * 100 + m, dow = kst.getUTCDay();
      const isTradingHour = dow >= 1 && dow <= 5 && t >= 900 && t <= 1530;
      if (loadWatchlist().length === 0 && isTradingHour) {
        console.warn('[Bootstrap] 장 중 재배포 감지 — 워치리스트 긴급 복구 시작');
        await autoPopulateWatchlist().catch(console.error);
        await sendTelegramAlert('⚠️ 재배포 감지 — 워치리스트 긴급 복구 완료').catch(console.error);
      }
    })().catch(console.error);

    // Telegram 봇 명령어 메뉴 등록 (fire-and-forget)
    setTelegramBotCommands()
      .then(async () => {
        const { runChannelHealthCheck } = await import('./alerts/alertRouter.js');
        const result = await runChannelHealthCheck();
        const ordered = ['TRADE', 'ANALYSIS', 'INFO', 'SYSTEM'] as const;
        const lines = ordered.map((category) => {
          const item = result[category];
          const icon = item.ok ? '✅' : '❌';
          const reason = item.reason ? ` (${item.reason})` : '';
          const enabled = item.enabled ? '' : ' [disabled]';
          const configured = item.configured ? '' : ' [unconfigured]';
          return `${category}: ${icon}${enabled}${configured}${reason}`;
        });
        await sendTelegramAlert(
          `🧪 <b>[Startup Channel Health]</b>\n` +
          `${lines.join('\n')}`,
          {
            priority: 'HIGH',
            dedupeKey: `startup_channel_health:${new Date().toISOString().slice(0, 10)}`,
            cooldownMs: 60_000,
            category: 'channel_health',
          },
        );
      })
      .catch(console.error);

    // 아이디어 12: 서버 기동 시 Telegram 알림 (fire-and-forget)
    sendTelegramAlert(
      `🟢 <b>[QuantMaster Pro] 서버 기동</b>\n` +
      `시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST\n` +
      `모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? '🟡 [SHADOW]' : '🔴 LIVE'}\n` +
      `KIS: ${process.env.KIS_IS_REAL === 'true' ? '실거래' : '모의투자'}`
    ).catch(console.error);

    // 아이디어 7-A: 14분 간격 자가 핑 — Railway 슬립 방지
    const selfUrl = process.env.RAILWAY_STATIC_URL ?? `http://localhost:${PORT}`;
    setInterval(async () => {
      try {
        await fetch(`${selfUrl}/api/health`);
      } catch {
        // 핑 실패는 무시 (서버 자체가 살아있으면 다음 핑에서 회복)
      }
    }, 14 * 60 * 1000);
    console.log(`[KeepAlive] 14분 간격 자가 핑 시작 → ${selfUrl}/api/health`);
  });
}

startServer().catch((error) => {
  console.error('[Server] Failed to start:', error);
  try { recordPersistentError('startServer', error, 'FATAL'); } catch { /* noop */ }
  process.exit(1);
});
