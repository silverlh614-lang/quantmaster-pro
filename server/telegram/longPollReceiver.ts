// @responsibility 공개 URL 없는 로컬 운영에서 Telegram getUpdates 롱폴링으로 받은 업데이트를 webhook 핸들러에 전달한다.
// server/telegram/longPollReceiver.ts
//
// Railway 는 공개 HTTPS URL 로 webhook 을 받았다. 로컬 PC 에는 공개 URL 이 없으므로
// TELEGRAM_POLLING_ENABLED=true 일 때 webhook 을 해제하고 getUpdates 롱폴링으로 수신한다.
// 명령·버튼 처리 경로는 handleTelegramWebhook 하나로 유지한다(채팅 ID 검증 포함).
import type { Request, Response } from 'express';

const POLL_TIMEOUT_SEC = 30;
const MAX_BACKOFF_MS = 60_000;

export interface TelegramUpdate {
  update_id: number;
  [key: string]: unknown;
}

export type TelegramUpdateDispatcher = (update: TelegramUpdate) => Promise<void>;

export interface LongPollOptions {
  token: string;
  dispatch: TelegramUpdateDispatcher;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export function isTelegramPollingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TELEGRAM_POLLING_ENABLED === 'true';
}

/** webhook 핸들러를 express 없이 호출한다 — 핸들러는 req.body 와 res.sendStatus 만 쓴다. */
export async function dispatchToWebhookHandler(update: TelegramUpdate): Promise<void> {
  const { handleTelegramWebhook } = await import('./webhookHandler.js');
  const req = { body: update } as unknown as Request;
  const res = { sendStatus: () => res } as unknown as Response;
  await handleTelegramWebhook(req, res);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function callTelegram(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; ok: boolean; result?: unknown; description?: string }> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  return { status: res.status, ok: res.ok && json.ok === true, result: json.result, description: json.description };
}

/**
 * 롱폴링 루프. signal 이 abort 되거나 토큰이 거부(401/404)되면 종료한다.
 * 네트워크 오류·409(다른 수신자 존재)는 지수 백오프 후 재시도한다.
 */
export async function runTelegramLongPolling(options: LongPollOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? console;
  const { token, dispatch, signal } = options;

  // webhook 이 걸려 있으면 getUpdates 가 409 로 거부된다. 대기 중 업데이트는 보존한다.
  const del = await callTelegram(fetchImpl, token, 'deleteWebhook', { drop_pending_updates: false }, 10_000, signal)
    .catch((e: unknown) => ({ status: 0, ok: false, description: e instanceof Error ? e.message : String(e) }));
  if (del.ok) log.log('[TelegramPolling] webhook 해제 확인 — getUpdates 롱폴링 수신 시작');
  else log.warn(`[TelegramPolling] deleteWebhook 실패(status=${del.status}): ${del.description ?? 'unknown'} — 폴링은 계속 시도`);

  let offset: number | undefined;
  let backoffMs = 1_000;

  while (!signal?.aborted) {
    let response: Awaited<ReturnType<typeof callTelegram>>;
    try {
      response = await callTelegram(
        fetchImpl,
        token,
        'getUpdates',
        { timeout: POLL_TIMEOUT_SEC, allowed_updates: ['message', 'callback_query'], ...(offset !== undefined ? { offset } : {}) },
        (POLL_TIMEOUT_SEC + 15) * 1_000,
        signal,
      );
    } catch (e: unknown) {
      if (signal?.aborted) break;
      log.warn(`[TelegramPolling] getUpdates 네트워크 오류 — ${backoffMs}ms 후 재시도:`, e instanceof Error ? e.message : e);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      continue;
    }

    if (response.status === 401 || response.status === 404) {
      log.error(`[TelegramPolling] 봇 토큰 거부(status=${response.status}) — 롱폴링 중단. TELEGRAM_BOT_TOKEN 확인 필요`);
      return;
    }
    if (!response.ok) {
      log.warn(`[TelegramPolling] getUpdates 실패(status=${response.status}): ${response.description ?? 'unknown'} — ${backoffMs}ms 후 재시도`);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      continue;
    }

    backoffMs = 1_000;
    const updates = Array.isArray(response.result) ? (response.result as TelegramUpdate[]) : [];
    for (const update of updates) {
      if (typeof update?.update_id !== 'number') continue;
      offset = update.update_id + 1;
      // webhook 과 같이 업데이트마다 독립 처리 — 긴 명령이 다음 수신을 막지 않는다.
      void dispatch(update).catch((e: unknown) => {
        log.error(`[TelegramPolling] update ${update.update_id} 처리 실패:`, e instanceof Error ? e.message : e);
      });
    }
  }
  log.log('[TelegramPolling] 롱폴링 종료');
}

let activeController: AbortController | null = null;

/** 서버 부팅 시 1회 호출. 비활성·토큰 미설정이면 아무것도 하지 않는다. */
export function startTelegramLongPollingIfEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isTelegramPollingEnabled(env)) return false;
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.warn('[TelegramPolling] TELEGRAM_POLLING_ENABLED=true 이지만 TELEGRAM_BOT_TOKEN 미설정 — 수신 비활성');
    return false;
  }
  if (activeController) return true;
  activeController = new AbortController();
  void runTelegramLongPolling({ token, dispatch: dispatchToWebhookHandler, signal: activeController.signal })
    .catch((e: unknown) => console.error('[TelegramPolling] 루프 비정상 종료:', e instanceof Error ? e.message : e))
    .finally(() => { activeController = null; });
  return true;
}

export function stopTelegramLongPolling(): void {
  activeController?.abort();
}
