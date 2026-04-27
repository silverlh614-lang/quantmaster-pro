// @responsibility kisRateLimiter 외부 클라이언트 모듈
/**
 * kisRateLimiter.ts — KIS API 전역 토큰 버킷 + 우선순위 큐
 *
 * 문제: pollSellFills(30초 setInterval)와 runAutoSignalScan이 동시에
 *       KIS API를 호출하여 Rate Limit 충돌을 일으킨다.
 *
 * 해결: 서버 전역 토큰 버킷(초당 15건, 여유 5건 확보)으로 모든 KIS 호출을
 *       직렬화하고 우선순위 큐로 관리한다.
 *
 * 우선순위:
 *   HIGH   — 매도 체결 확인 (pollSellFills, OCO 주문)
 *   MEDIUM — 매수 신호 스캔 (runAutoSignalScan, 현재가 조회)
 *   LOW    — 잔고 조회, 데이터 조회 (투자자 수급, 거래량 순위)
 */

export type KisApiPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface QueueItem<T> {
  priority: KisApiPriority;
  label: string;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
}

const PRIORITY_ORDER: Record<KisApiPriority, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

// ─── Token Bucket ─────────────────────────────────────────────────────────────

const MAX_TOKENS = 15;           // 초당 최대 15건 (KIS 20건/초 기준 여유 5건)
const REFILL_INTERVAL_MS = 1000; // 1초마다 리필

let _tokens = MAX_TOKENS;
let _lastRefillAt = Date.now();

function refillTokens(): void {
  const now = Date.now();
  const elapsed = now - _lastRefillAt;
  if (elapsed >= REFILL_INTERVAL_MS) {
    const refillCount = Math.floor(elapsed / REFILL_INTERVAL_MS) * MAX_TOKENS;
    _tokens = Math.min(MAX_TOKENS, _tokens + refillCount);
    _lastRefillAt = now;
  }
}

function tryConsumeToken(): boolean {
  refillTokens();
  if (_tokens > 0) {
    _tokens--;
    return true;
  }
  return false;
}

// ─── Priority Queue ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _queue: QueueItem<any>[] = [];
let _processing = false;

function enqueue<T>(item: QueueItem<T>): void {
  // 삽입 정렬: 같은 우선순위 내에서는 FIFO
  let insertAt = _queue.length;
  for (let i = 0; i < _queue.length; i++) {
    if (PRIORITY_ORDER[item.priority] < PRIORITY_ORDER[_queue[i].priority]) {
      insertAt = i;
      break;
    }
  }
  _queue.splice(insertAt, 0, item);
}

async function processQueue(): Promise<void> {
  if (_processing) return;
  _processing = true;

  while (_queue.length > 0) {
    if (!tryConsumeToken()) {
      // 토큰 소진 → 다음 리필까지 대기
      const waitMs = REFILL_INTERVAL_MS - (Date.now() - _lastRefillAt);
      await new Promise(r => setTimeout(r, Math.max(10, waitMs)));
      continue;
    }

    const item = _queue.shift()!;
    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    }
  }

  _processing = false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * KIS API 호출을 토큰 버킷 + 우선순위 큐를 통해 실행한다.
 * 모든 KIS HTTP 호출은 이 함수를 통해서만 발행해야 한다.
 *
 * @param priority  HIGH / MEDIUM / LOW
 * @param label     로깅용 라벨 (예: 'pollSellFills', 'fetchCurrentPrice')
 * @param fn        실제 KIS API 호출 함수
 */
export function scheduleKisCall<T>(
  priority: KisApiPriority,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    enqueue({ priority, label, fn, resolve, reject, enqueuedAt: Date.now() });
    processQueue().catch(console.error);
  });
}

// ─── 진단 / 모니터링 ─────────────────────────────────────────────────────────

export interface RateLimiterStats {
  availableTokens: number;
  maxTokens: number;
  queueLength: number;
  queueByPriority: Record<KisApiPriority, number>;
}

export function getRateLimiterStats(): RateLimiterStats {
  refillTokens();
  const byPriority: Record<KisApiPriority, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const item of _queue) {
    byPriority[item.priority]++;
  }
  return {
    availableTokens: _tokens,
    maxTokens: MAX_TOKENS,
    queueLength: _queue.length,
    queueByPriority: byPriority,
  };
}
