/// <reference types="node" />
import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import cron from "node-cron";
import {
  tradingOrchestrator,
  fastDartCheck,
  pollDartDisclosures,
  pollBearRegime,
  pollMhsMorningAlert,
  pollIpsAlert,
  generateWeeklyReport,
  sendWatchlistBriefing,
  sendIntradayCheckIn,
  sendTelegramAlert,
} from "./src/server/autoTradeEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// ─────────────────────────────────────────────────────────────
// 아이디어 9: 서버사이드 비상 정지 모듈 (Circuit Breaker)
// 브라우저를 닫아도 서버 메모리에서 플래그 유지
// → 공유 상태를 server/state.ts로 분리
// ─────────────────────────────────────────────────────────────
import {
  getEmergencyStop,
  isEmergencyStopped,
  setDailyLoss,
} from './server/state.js';
import kisRouter from './server/routes/kisRouter.js';
import marketDataRouter from './server/routes/marketDataRouter.js';
import dartRouter from './server/routes/dartRouter.js';
import autoTradeRouter from './server/routes/autoTradeRouter.js';
import systemRouter from './server/routes/systemRouter.js';
import { checkDailyLossLimit } from './server/emergency.js';

export { isEmergencyStopped, setDailyLoss };


async function startServer() {
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
  // KIS API Proxy  → server/routes/kisRouter.ts 로 분리
  // ─────────────────────────────────────────────────────────────
  app.use('/api/kis', kisRouter);

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

  // ─── 아이디어 1: 오케스트레이터 상태 조회 ────────────────────────────────────
  app.get('/api/orchestrator/state', (_req: Request, res: Response) => {
    res.json(tradingOrchestrator.getStatus());
  });

  // ─── Vite middleware (dev) / Static file serving (prod) ───────────────────
  // IMPORTANT: This must come AFTER all API routes so the catch-all '*'
  // doesn't intercept /api/* requests in production.
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // vite.config.ts outDir: 'build' 기준으로 탐색, dist도 폴백으로 확인
    const candidates = [
      path.join(__dirname, 'build'),
      path.join(process.cwd(), 'build'),
      path.join(__dirname, 'dist'),
      path.join(process.cwd(), 'dist'),
      __dirname,
    ];
    const distPath = candidates.find(p => fs.existsSync(path.join(p, 'index.html'))) ?? candidates[0];
    console.log(`Serving static files from: ${distPath}`);

    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // ─── Graceful shutdown (Railway SIGTERM 대응) ─────────────────────────
    const shutdown = (signal: string) => {
      console.log(`[Server] ${signal} 수신 — graceful shutdown 시작`);
      server.close(() => {
        console.log('[Server] HTTP 서버 종료 완료');
        process.exit(0);
      });
      // 10초 내 종료되지 않으면 강제 종료
      setTimeout(() => { process.exit(0); }, 10_000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // ─── 아이디어 1: TradingDayOrchestrator — 장 사이클 State Machine ────────
    // 두 cron으로 전체 KST 거래일(08:00~17:00)을 커버합니다.
    // ① UTC 23:xx (= KST Mon-Fri 08:xx, 동시호가/장 전 준비) — Sun-Thu UTC
    cron.schedule('*/5 23 * * 0-4', async () => {
      if (getEmergencyStop()) { console.warn('[Orchestrator] 비상 정지 — tick 건너뜀'); return; }
      await tradingOrchestrator.tick().catch(console.error);
      if (process.env.AUTO_TRADE_ENABLED === 'true') {
        await checkDailyLossLimit().catch(console.error);
      }
    }, { timezone: 'UTC' });

    // ② UTC 00:xx~08:xx (= KST Mon-Fri 09:xx~17:xx, 장중/마감/리포트) — Mon-Fri UTC
    cron.schedule('*/5 0-8 * * 1-5', async () => {
      if (getEmergencyStop()) { console.warn('[Orchestrator] 비상 정지 — tick 건너뜀'); return; }
      await tradingOrchestrator.tick().catch(console.error);
      if (process.env.AUTO_TRADE_ENABLED === 'true') {
        await checkDailyLossLimit().catch(console.error);
      }
    }, { timezone: 'UTC' });

    // 아이디어 6: DART 공시 30분 폴링 — 장중 08:30~18:00 KST (UTC 23:30~09:00)
    // 오케스트레이터와 독립 실행 (AUTO_TRADE_ENABLED 무관)
    cron.schedule('*/30 23,0,1,2,3,4,5,6,7,8,9 * * 1-5', async () => {
      await pollDartDisclosures().catch(console.error);
    }, { timezone: 'UTC' });

    // 아이디어 11: DART 고속 폴링 — 장중 1분 간격, 고영향 키워드 즉시 반응
    // UTC 23:xx (KST 08:xx) + UTC 00-09 (KST 09-18) 커버
    cron.schedule('* 23 * * 0-4', async () => {
      await fastDartCheck().catch(console.error);
    }, { timezone: 'UTC' });
    cron.schedule('* 0-9 * * 1-5', async () => {
      await fastDartCheck().catch(console.error);
    }, { timezone: 'UTC' });

    // 아이디어 10: Bear Regime Push 알림 — 15분 간격 폴링, 장중 KST 08:00~17:00
    // UTC 23:xx (KST 08:xx) + UTC 00-08 (KST 09-17) 커버
    cron.schedule('*/15 23 * * 0-4', async () => {
      await pollBearRegime().catch(console.error);
    }, { timezone: 'UTC' });
    cron.schedule('*/15 0-8 * * 1-5', async () => {
      await pollBearRegime().catch(console.error);
    }, { timezone: 'UTC' });

    // 아이디어 11: IPS 변곡점 경보 — 15분 간격 24/7 폴링 (장 외 시간 포함)
    cron.schedule('*/15 * * * *', async () => {
      await pollIpsAlert().catch(console.error);
    }, { timezone: 'UTC' });

    // 아이디어 8: MHS 임계값 모닝 알림 — 평일 오전 09:00 KST (UTC 00:00 Mon-Fri)
    // RED 레짐(MHS < 40) 또는 GREEN 레짐 전환(MHS ≥ 70) 시 즉시 Telegram 알림
    cron.schedule('0 0 * * 1-5', async () => {
      await pollMhsMorningAlert().catch(console.error);
    }, { timezone: 'UTC' });

    // 주간 리포트 — 매주 금요일 16:30 KST (UTC 07:30)
    cron.schedule('30 7 * * 5', async () => {
      await generateWeeklyReport().catch(console.error);
    }, { timezone: 'UTC' });

    // 장 시작 전 워치리스트 브리핑 — 평일 08:50 KST (UTC 23:50, 일~목 UTC)
    cron.schedule('50 23 * * 0-4', async () => {
      await sendWatchlistBriefing().catch(console.error);
    }, { timezone: 'UTC' });

    // 장중 중간 점검 — 오전 11:30 KST (UTC 02:30, 월~금 UTC)
    cron.schedule('30 2 * * 1-5', async () => {
      await sendIntradayCheckIn('midday').catch(console.error);
    }, { timezone: 'UTC' });

    // 마감 전 점검 — 오후 14:00 KST (UTC 05:00, 월~금 UTC)
    cron.schedule('0 5 * * 1-5', async () => {
      await sendIntradayCheckIn('preclose').catch(console.error);
    }, { timezone: 'UTC' });

    console.log('[AutoTrade] 오케스트레이터 + DART 폴링 + Bear Regime 알림 + MHS 모닝 알림 + IPS 변곡점 경보 가동 완료');

    // 아이디어 12: 서버 기동 시 Telegram 알림 (fire-and-forget)
    sendTelegramAlert(
      `🟢 <b>[QuantMaster Pro] 서버 기동</b>\n` +
      `시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST\n` +
      `모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? '🟡 Shadow' : '🔴 LIVE'}\n` +
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

startServer();
