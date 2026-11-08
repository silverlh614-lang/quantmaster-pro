// @responsibility longPollReceiver 의 webhook 해제·offset 진행·토큰 거부 종료·비활성 기본값 회귀 테스트.
import { describe, it, expect, vi } from 'vitest';

import { isTelegramPollingEnabled, runTelegramLongPolling, type TelegramUpdate } from './longPollReceiver.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const quietLog = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('longPollReceiver', () => {
  it('is disabled unless TELEGRAM_POLLING_ENABLED=true', () => {
    expect(isTelegramPollingEnabled({})).toBe(false);
    expect(isTelegramPollingEnabled({ TELEGRAM_POLLING_ENABLED: 'false' })).toBe(false);
    expect(isTelegramPollingEnabled({ TELEGRAM_POLLING_ENABLED: 'true' })).toBe(true);
  });

  it('deletes the webhook, dispatches updates and advances the offset', async () => {
    const controller = new AbortController();
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    const dispatched: number[] = [];
    let getUpdatesCount = 0;

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const method = String(url).split('/').pop() ?? '';
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ method, body });
      if (method === 'deleteWebhook') return jsonResponse(200, { ok: true, result: true });
      getUpdatesCount += 1;
      if (getUpdatesCount === 1) {
        return jsonResponse(200, { ok: true, result: [{ update_id: 10, message: { text: '/a' } }, { update_id: 11, message: { text: '/b' } }] });
      }
      controller.abort();
      return jsonResponse(200, { ok: true, result: [] });
    }) as unknown as typeof fetch;

    await runTelegramLongPolling({
      token: 'test-token',
      fetchImpl,
      signal: controller.signal,
      log: quietLog,
      dispatch: async (update: TelegramUpdate) => { dispatched.push(update.update_id); },
    });

    expect(calls[0]).toEqual({ method: 'deleteWebhook', body: { drop_pending_updates: false } });
    expect(calls[1].method).toBe('getUpdates');
    expect(calls[1].body.offset).toBeUndefined();
    expect(calls[2].body.offset).toBe(12);
    expect(dispatched).toEqual([10, 11]);
  });

  it('stops when the bot token is rejected', async () => {
    const dispatch = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/deleteWebhook')) return jsonResponse(401, { ok: false, description: 'Unauthorized' });
      return jsonResponse(401, { ok: false, description: 'Unauthorized' });
    }) as unknown as typeof fetch;

    await runTelegramLongPolling({ token: 'bad', fetchImpl, dispatch, log: quietLog });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(dispatch).not.toHaveBeenCalled();
    expect(quietLog.error).toHaveBeenCalled();
  });

  it('backs off and retries after a conflict response', async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    let getUpdatesCount = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/deleteWebhook')) return jsonResponse(200, { ok: true, result: true });
      getUpdatesCount += 1;
      if (getUpdatesCount <= 2) return jsonResponse(409, { ok: false, description: 'Conflict' });
      controller.abort();
      return jsonResponse(200, { ok: true, result: [] });
    }) as unknown as typeof fetch;

    await runTelegramLongPolling({
      token: 't',
      fetchImpl,
      signal: controller.signal,
      log: quietLog,
      sleep: async (ms) => { sleeps.push(ms); },
      dispatch: async () => undefined,
    });

    expect(sleeps).toEqual([1_000, 2_000]);
  });
});
