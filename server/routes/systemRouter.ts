// server/routes/systemRouter.ts
// 시스템 라우터 — server.ts에서 분리
// 포함 대상: GET /health, GET /emergency-status, POST /emergency-stop,
//            POST /emergency-reset, POST /daily-loss, POST /send-email,
//            POST /telegram/webhook, POST /telegram/test
import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import {
  getEmergencyStop, setEmergencyStop,
  getDailyLossPct, setDailyLoss,
} from '../state.js';
import { cancelAllPendingOrders, checkDailyLossLimit } from '../emergency.js';
import { sendTelegramAlert } from '../../src/server/autoTradeEngine.js';
import { handleTelegramWebhook } from '../telegram/webhookHandler.js';

const router = Router();

// ─────────────────────────────────────────────────────────────
// 아이디어 7: Health Check + Keep-Alive
// ─────────────────────────────────────────────────────────────
const serverStart = new Date().toISOString();

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    emergencyStop: getEmergencyStop(),
    dailyLossPct: getDailyLossPct(),
    autoTradeEnabled: process.env.AUTO_TRADE_ENABLED === 'true',
    mode: process.env.AUTO_TRADE_MODE ?? 'SHADOW',
    kisIsReal: process.env.KIS_IS_REAL === 'true',
    uptime: process.uptime(),
    startedAt: serverStart,
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

router.post('/send-email', async (req: Request, res: Response) => {
  const { email, subject, text, pdfBase64, filename } = req.body;

  if (!email || !pdfBase64) {
    return res.status(400).json({ error: "Email and PDF data are required" });
  }

  try {
    // Check if environment variables are set
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error("Email credentials missing in environment variables");
      return res.status(500).json({
        error: "이메일 서버가 설정되지 않았습니다.",
        details: "서버의 EMAIL_USER 또는 EMAIL_PASS 환경 변수가 누락되었습니다. AI Studio 설정에서 이를 추가해주세요.",
      });
    }

    // Create a transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: subject || "Stock Analysis Report",
      text: text || "Please find the attached stock analysis report.",
      attachments: [
        {
          filename: filename || "report.pdf",
          content: pdfBase64.split("base64,")[1],
          encoding: 'base64' as const,
        }
      ],
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: "Email sent successfully" });
  } catch (error: any) {
    console.error("Error sending email:", error);
    res.status(500).json({ error: "Failed to send email", details: error.message });
  }
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

export default router;
