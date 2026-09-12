// @responsibility Verify Telegram test HTTP responses reflect delivery and never expose transport errors.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../state.js', () => ({}));
vi.mock('../emergency.js', () => ({}));
vi.mock('../telegram/webhookHandler.js', () => ({ handleTelegramWebhook: vi.fn() }));
vi.mock('../alerts/telegramClient.js', () => ({ sendTelegramPlainText: vi.fn() }));
vi.mock('../clients/geminiClient.js', () => ({}));
vi.mock('../clients/dartFinancialClient.js', () => ({}));
vi.mock('../persistence/watchlistRepo.js', () => ({}));
vi.mock('../screener/watchlistManager.js', () => ({}));
vi.mock('../screener/stockScreener.js', () => ({}));
vi.mock('../persistence/macroStateRepo.js', () => ({}));
vi.mock('../trading/regime/canonicalRegimeAccess.js', () => ({}));
vi.mock('../trading/vixGating.js', () => ({}));
vi.mock('../trading/fomcCalendar.js', () => ({}));
vi.mock('../orchestrator/adaptiveScanScheduler.js', () => ({}));
vi.mock('../persistence/gateAuditRepo.js', () => ({}));
vi.mock('../persistence/aiCacheRepo.js', () => ({}));
vi.mock('../rag/localRag.js', () => ({}));
vi.mock('../health/diagnostics.js', () => ({}));
vi.mock('../persistence/cacheCoherenceAuditor.js', () => ({}));

import router from './systemRouter.js';
import { sendTelegramPlainText } from '../alerts/telegramClient.js';

const route = router.stack.find(layer => layer.route?.path === '/telegram/test')?.route;
if (!route) throw new Error('Telegram test route missing');
const handler = route.stack[0]!.handle;

describe('POST /telegram/test', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

  async function run() {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await handler({} as Request, res as unknown as Response, vi.fn());
    return res;
  }

  function configured() {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '123');
  }

  it('rejects incomplete config without calling Telegram', async () => {
    configured();
    vi.stubEnv('TELEGRAM_CHAT_ID', ' ');
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sendTelegramPlainText).not.toHaveBeenCalled();
  });

  it('reports failure when transport returns no delivery ID', async () => {
    configured();
    vi.mocked(sendTelegramPlainText).mockResolvedValue(undefined);
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('confirms delivery only with the Telegram message ID', async () => {
    configured();
    vi.mocked(sendTelegramPlainText).mockResolvedValue(73);
    const res = await run();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, messageId: 73 }));
  });

  it('does not return a token-bearing transport exception', async () => {
    configured();
    vi.mocked(sendTelegramPlainText).mockRejectedValue(new Error('https://api.telegram.org/botsecret-token/sendMessage'));
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(502);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret-token');
  });
});
