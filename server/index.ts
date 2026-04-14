/// <reference types="node" />
import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createHash } from "crypto";
import dotenv from "dotenv";
import { tradingOrchestrator } from "./orchestrator/tradingOrchestrator.js";
import { sendTelegramAlert, setTelegramBotCommands } from "./alerts/telegramClient.js";

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
import marketDataRouter from './routes/marketDataRouter.js';
import dartRouter from './routes/dartRouter.js';
import autoTradeRouter from './routes/autoTradeRouter.js';
import systemRouter from './routes/systemRouter.js';
import failurePatternRouter from './routes/failurePatternRouter.js';
import { startScheduler } from './scheduler.js';
import { resolveStaticAssetsPath } from './staticAssets.js';


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

  // ─────────────────────────────────────────────────────────────
  // 반실패 패턴 DB → server/routes/failurePatternRouter.ts 로 분리
  // (GET /api/failure-patterns, POST /api/failure-patterns/check,
  //  POST /api/failure-patterns/save)
  // ─────────────────────────────────────────────────────────────
  app.use('/api/failure-patterns', failurePatternRouter);

  // ─── 아이디어 1: 오케스트레이터 상태 조회 ────────────────────────────────────
  app.get('/api/orchestrator/state', (_req: Request, res: Response) => {
    res.json(tradingOrchestrator.getStatus());
  });

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

    // ─── cron 스케줄러 기동 ───────────────────────────────────────────────────
    startScheduler();

    console.log('[AutoTrade] 오케스트레이터 + DART 폴링 + Bear Regime 알림 + MHS 모닝 알림 + IPS 변곡점 경보 가동 완료');

    // Telegram 봇 명령어 메뉴 등록 (fire-and-forget)
    setTelegramBotCommands().catch(console.error);

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

startServer().catch((error) => {
  console.error('[Server] Failed to start:', error);
  process.exit(1);
});
