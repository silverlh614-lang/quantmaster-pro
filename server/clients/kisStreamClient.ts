/**
 * kisStreamClient.ts — KIS WebSocket 실시간 호가 구독 클라이언트
 *
 * KIS OpenAPI H0STCNT0 TR(체결가) WebSocket을 구독하여 인메모리 가격 맵을 유지한다.
 * signalScanner가 Yahoo Finance 폴링 대신 이 맵을 참조하면:
 *   - 수분 지연 → 실시간 (타이밍 조건 품질 향상)
 *   - REST API 호출 수 80% 절감
 *   - Yahoo Finance는 초기 스크리닝용 전일 기본 데이터(PER, 재무)로만 유지
 *
 * KIS WebSocket 프로토콜:
 *   1. POST /oauth2/Approval → approval_key 발급
 *   2. wss://ops.koreainvestment.com:21443/tryitout/H0STCNT0 연결
 *   3. 구독 메시지 전송 → 체결 데이터 스트리밍 수신
 */

import WebSocket from 'ws';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

// ─── 인메모리 실시간 가격 맵 ─────────────────────────────────────────────────

interface RealtimeQuote {
  price: number;         // 현재 체결가
  volume: number;        // 누적 거래량
  change: number;        // 전일 대비
  changePct: number;     // 전일 대비율
  dayOpen: number;       // 시가
  dayHigh: number;       // 고가
  dayLow: number;        // 저가
  prevClose: number;     // 전일 종가
  updatedAt: number;     // 최종 업데이트 타임스탬프 (ms)
}

const _priceMap = new Map<string, RealtimeQuote>();

/** 실시간 가격 맵에서 종목 현재가 조회. 미구독/만료 시 null */
export function getRealtimePrice(stockCode: string): number | null {
  const q = _priceMap.get(stockCode);
  if (!q) return null;
  // 5분 이상 업데이트 없으면 stale — null 반환하여 REST fallback 유도
  if (Date.now() - q.updatedAt > 5 * 60 * 1000) return null;
  return q.price;
}

/** 실시간 가격 맵에서 종목 전체 호가 조회. 미구독/만료 시 null */
export function getRealtimeQuote(stockCode: string): RealtimeQuote | null {
  const q = _priceMap.get(stockCode);
  if (!q) return null;
  if (Date.now() - q.updatedAt > 5 * 60 * 1000) return null;
  return { ...q };
}

/** 현재 구독 중인 종목 수 */
export function getSubscribedCount(): number { return _priceMap.size; }

/** 전체 가격 맵 스냅샷 (디버깅/API 용) */
export function getPriceMapSnapshot(): Record<string, RealtimeQuote> {
  const snap: Record<string, RealtimeQuote> = {};
  for (const [code, q] of _priceMap) snap[code] = { ...q };
  return snap;
}

// ─── WebSocket 연결 관리 ─────────────────────────────────────────────────────

let _ws: WebSocket | null = null;
let _approvalKey: string | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
// OPEN 직후 즉시 _reconnectCount 를 0 으로 돌리면, 30~40초 만에 1006 으로 끊기는
// 플랩 상황에서 백오프가 영영 3초에 고정된다 (로그에 '3초 → 3초 → 3초' 패턴).
// 안정 유지 시간이 누적된 뒤에만 카운터를 리셋하기 위한 타이머.
let _stableResetTimer: ReturnType<typeof setTimeout> | null = null;
let _subscribedCodes = new Set<string>();
let _isConnecting = false;
let _reconnectCount = 0;
const MAX_RECONNECT = 10;
const RECONNECT_BASE_DELAY = 3000; // 3초 시작, 지수 백오프 → 3/6/12/24/48s ... (6회차 상한)
const STABLE_RESET_AFTER_MS = 60_000; // OPEN 후 이 시간 이상 유지돼야 reconnectCount 를 0 으로 리셋
// 구독 메시지 간격(ms). 41개를 한꺼번에 쏘면 KIS 서버가 1006 으로 강제 종료하므로 순차 전송.
const SUBSCRIBE_THROTTLE_MS = 100;
/**
 * KIS 실시간 시세 단일 세션 구독 한도.
 * KIS 계정당 41종목이 하드 리밋 — 초과 시 서버가 code=1006 으로 강제 종료한다.
 * 41 에 근접시키면 signalScanner.subscribeStock() 동적 구독 + 워치독 재시작 경합으로
 * 1006 강제 종료가 빈발하여, 하드 리밋보다 11 낮은 30 을 운영 한도로 사용한다.
 * (SWING 10 + CATALYST 5 + MOMENTUM 15 = 30 — 워치리스트 총합과 일치)
 */
export const MAX_SUBSCRIPTIONS = 30;

// ─── 디버그: 연결 이벤트 이력 (최근 20건 유지) ──────────────────────────────
interface StreamEvent {
  ts: string;      // ISO timestamp
  event: string;   // 'CONNECT' | 'OPEN' | 'CLOSE' | 'ERROR' | 'RECONNECT' | 'PONG_TIMEOUT' | 'STOP'
  detail: string;
}
const _eventLog: StreamEvent[] = [];
function logStreamEvent(event: string, detail: string): void {
  const entry: StreamEvent = { ts: new Date().toISOString(), event, detail };
  _eventLog.push(entry);
  if (_eventLog.length > 20) _eventLog.shift();
  console.log(`[KIS-WS] [${entry.event}] ${entry.detail}`);
}

let _lastPongAt = 0; // PONG 수신 시각 (ms)

const KIS_WS_URL_REAL = 'ws://ops.koreainvestment.com:21000';
const KIS_WS_URL_VTS  = 'ws://ops.koreainvestment.com:31000';

function getWsUrl(): string {
  return process.env.KIS_IS_REAL === 'true' ? KIS_WS_URL_REAL : KIS_WS_URL_VTS;
}

// ─── 승인키 발급 ─────────────────────────────────────────────────────────────

async function fetchApprovalKey(): Promise<string> {
  const isReal = process.env.KIS_IS_REAL === 'true';
  const base = isReal
    ? 'https://openapi.koreainvestment.com:9443'
    : 'https://openapivts.koreainvestment.com:29443';

  const res = await fetch(`${base}/oauth2/Approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIS_APP_KEY,
      secretkey: process.env.KIS_APP_SECRET,
    }),
  });

  const data = await res.json() as { approval_key?: string };
  if (!data.approval_key) {
    throw new Error(`KIS 승인키 발급 실패: ${JSON.stringify(data)}`);
  }

  console.log('[KIS-WS] 승인키 발급 완료');
  return data.approval_key;
}

// ─── H0STCNT0 체결 데이터 파싱 ──────────────────────────────────────────────
// KIS 실시간 체결 메시지 포맷: 파이프(|) 구분 필드
// 0=유가증권단축종목코드, 1=주식체결시간, 2=주식현재가, ...

function parseH0STCNT0(body: string): void {
  // 메시지 형태: "0|H0STCNT0|001|005930^..." (헤더 | TR | 건수 | 데이터)
  // 또는 plain pipe-separated body 직접 전송
  const parts = body.split('|');
  if (parts.length < 4) return;

  // 실제 데이터는 마지막 파트에 '^' 구분 필드로 들어옴
  const dataStr = parts[parts.length - 1];
  const fields = dataStr.split('^');
  if (fields.length < 20) return;

  const stockCode = fields[0];          // 종목코드
  const price     = parseInt(fields[2], 10);  // 현재가
  const change    = parseInt(fields[4], 10);  // 전일대비
  const changePct = parseFloat(fields[5]);    // 전일대비율
  const volume    = parseInt(fields[13], 10); // 누적거래량
  const dayOpen   = parseInt(fields[7], 10);  // 시가
  const dayHigh   = parseInt(fields[8], 10);  // 고가
  const dayLow    = parseInt(fields[9], 10);  // 저가
  const prevClose = price - change;           // 전일종가 = 현재가 - 대비

  if (!stockCode || price <= 0) return;

  _priceMap.set(stockCode, {
    price,
    volume,
    change,
    changePct,
    dayOpen: dayOpen > 0 ? dayOpen : price,
    dayHigh: dayHigh > 0 ? dayHigh : price,
    dayLow: dayLow > 0 ? dayLow : price,
    prevClose: prevClose > 0 ? prevClose : price,
    updatedAt: Date.now(),
  });
}

// ─── WebSocket 연결/구독 ─────────────────────────────────────────────────────

function buildSubscribeMsg(stockCode: string): string {
  return JSON.stringify({
    header: {
      approval_key: _approvalKey,
      custtype: 'P',
      tr_type: '1',       // 1=구독, 2=해제
      'content-type': 'utf-8',
    },
    body: {
      input: {
        tr_id: 'H0STCNT0',   // 실시간 체결가
        tr_key: stockCode,
      },
    },
  });
}

function buildUnsubscribeMsg(stockCode: string): string {
  return JSON.stringify({
    header: {
      approval_key: _approvalKey,
      custtype: 'P',
      tr_type: '2',
      'content-type': 'utf-8',
    },
    body: {
      input: {
        tr_id: 'H0STCNT0',
        tr_key: stockCode,
      },
    },
  });
}

/** WebSocket 연결 시작 */
async function connectWebSocket(): Promise<void> {
  // 중복 connect 방지: _isConnecting 플래그뿐 아니라 _ws 가 이미 OPEN 또는
  // CONNECTING 상태면 즉시 반환. 워치독 cron + scheduleReconnect 가 거의 동시에
  // 발화하는 경우 기존 OPEN 체크만으로는 핸드셰이크 중인 소켓을 중복 생성할 수 있다.
  if (_isConnecting) return;
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
  _isConnecting = true;

  try {
    if (!_approvalKey) {
      _approvalKey = await fetchApprovalKey();
    }

    const wsUrl = getWsUrl();
    logStreamEvent('CONNECT', `연결 시도: ${wsUrl} (구독 ${_subscribedCodes.size}종목)`);

    _ws = new WebSocket(wsUrl);

    _ws.onopen = async () => {
      logStreamEvent('OPEN', `연결 성공 — 구독 종목 ${_subscribedCodes.size}개 재등록`);
      _isConnecting = false;
      _lastPongAt = Date.now();

      // OPEN 직후 reconnectCount 를 0 으로 되돌리지 않는다:
      // 1006 으로 수초 만에 다시 끊기는 플랩 상황에서는 백오프가 3초에 고정되어
      // 서버 쪽에서 세션 차단/레이트리밋을 유발한다. STABLE_RESET_AFTER_MS 만큼
      // 끊김 없이 유지된 뒤에만 안정적으로 간주해 카운터를 초기화한다.
      if (_stableResetTimer) clearTimeout(_stableResetTimer);
      _stableResetTimer = setTimeout(() => {
        if (_reconnectCount > 0) {
          logStreamEvent('STABLE', `${STABLE_RESET_AFTER_MS / 1000}s 이상 안정 유지 — reconnectCount 리셋 (${_reconnectCount} → 0)`);
        }
        _reconnectCount = 0;
        _stableResetTimer = null;
      }, STABLE_RESET_AFTER_MS);

      // 이 onopen 에 결합된 ws 참조를 스냅샷: 순차 전송 도중 _ws 가 교체될 수 있다
      // (onclose → scheduleReconnect → 새 소켓). 스냅샷으로 송신하면 구 소켓에
      // 남은 송신이 신 소켓에 섞여 들어가는 것을 방지한다.
      const ws = _ws!;

      // 기존 구독 종목 재등록 — 서버가 41개 일괄 폭주를 code=1006 으로 강제종료하므로
      // 100ms 간격 순차 전송 (41개 × 100ms ≈ 4.1s). 장 시작 수초의 초기 지연은 수용.
      for (const code of _subscribedCodes) {
        if (ws.readyState !== WebSocket.OPEN) break;
        ws.send(buildSubscribeMsg(code));
        await new Promise((r) => setTimeout(r, SUBSCRIBE_THROTTLE_MS));
      }

      // Heartbeat: KIS 서버는 PINGPONG 프레임을 주기적으로 push 하므로 클라이언트가
      // 능동적으로 애플리케이션 레벨 PING 을 보낼 필요가 없다. onmessage 의 PINGPONG
      // echo-back 으로 _lastPongAt 이 갱신되며, 여기서는 좀비 커넥션 감지 + RFC 6455
      // control-frame ping (프록시/LB idle keepalive) 이중 안전망만 수행한다.
      if (_heartbeatTimer) clearInterval(_heartbeatTimer);
      _heartbeatTimer = setInterval(() => {
        if (_ws && _ws.readyState === WebSocket.OPEN) {
          // PONG 3분 이상 미수신 → 좀비 커넥션으로 간주, 강제 종료
          if (_lastPongAt > 0 && Date.now() - _lastPongAt > 3 * 60 * 1000) {
            logStreamEvent('PONG_TIMEOUT', `마지막 PONG: ${new Date(_lastPongAt).toISOString()} — 좀비 커넥션 강제 종료`);
            _ws.close(4000, 'PONG_TIMEOUT');
            return;
          }
          try { _ws.ping(); } catch { /* ignore */ }
        }
      }, 20_000);
    };

    // RFC 6455 control-frame pong 수신 핸들러 (프록시/LB keepalive 확인용).
    _ws.on('pong', () => {
      _lastPongAt = Date.now();
    });

    _ws.onmessage = (event) => {
      const msg = typeof event.data === 'string' ? event.data : '';
      // KIS 서버 주도 PINGPONG: 반드시 '{"header"' 필터보다 먼저 처리한다.
      // 서버가 push 한 {"header":{"tr_id":"PINGPONG",...}} 를 그대로 되돌려주지
      // 않으면 세션이 끊긴다 (KIS 공식 프로토콜).
      if (msg.startsWith('{"header"') && msg.includes('"PINGPONG"')) {
        _lastPongAt = Date.now();
        try { _ws?.send(msg); } catch { /* ignore */ }
        return;
      }
      if (msg === 'PONG') {
        _lastPongAt = Date.now();
        return;
      }
      if (msg.startsWith('{"header"')) return; // 구독/해제 응답 헤더 무시
      // H0STCNT0 체결 데이터 파싱
      if (msg.includes('H0STCNT0')) {
        parseH0STCNT0(msg);
      }
    };

    _ws.onerror = (event: any) => {
      const detail = event?.error?.message || event?.message || event?.error?.code || 'unknown';
      logStreamEvent('ERROR', `WebSocket 오류 — readyState=${_ws?.readyState}, detail=${detail}`);
      _isConnecting = false;
      // non-101 핸드셰이크 거부 / 네트워크 오류 → 승인키가 만료되었을 가능성이 있다.
      // onclose가 이어서 호출되므로 다음 재연결 시 새 키를 발급받도록 캐시를 무효화한다.
      if (typeof detail === 'string' && /101|network|handshake|401|403/i.test(detail)) {
        _approvalKey = null;
      }
    };

    _ws.onclose = (event) => {
      logStreamEvent('CLOSE', `code=${event.code}, reason=${event.reason || '(없음)'}, wasClean=${event.wasClean}`);
      _isConnecting = false;
      _ws = null;
      if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
      // 안정 상태로 전환되기 전에 끊겼다면 카운터 리셋을 취소해 백오프가 실제로 커지도록 한다.
      if (_stableResetTimer) { clearTimeout(_stableResetTimer); _stableResetTimer = null; }
      scheduleReconnect();
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logStreamEvent('ERROR', `연결 실패: ${errMsg}`);
    _isConnecting = false;
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  // KIS 서버는 15:20 이후 실시간 데이터 송출을 종료하므로 재연결해도 즉시 끊긴다.
  // 장외 시간(KST 09:00 이전 / 15:20 이후)에는 재연결 루프를 끊어 좀비 재시도/알림 폭주를 방지한다.
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const kstHour = kstNow.getUTCHours();
  const kstMin = kstNow.getUTCMinutes();
  const afterClose = kstHour > 15 || (kstHour === 15 && kstMin >= 20);
  const beforeOpen = kstHour < 9;
  if (afterClose || beforeOpen) {
    logStreamEvent('STOP', `장마감/장외 시간 (KST ${String(kstHour).padStart(2, '0')}:${String(kstMin).padStart(2, '0')}) — 재연결 생략`);
    return;
  }

  if (_reconnectCount >= MAX_RECONNECT) {
    logStreamEvent('STOP', `최대 재연결 ${MAX_RECONNECT}회 초과 — 스트리밍 중단, REST 폴백`);
    sendTelegramAlert(
      `🔌 <b>[KIS WebSocket] 실시간 호가 연결 실패</b>\n` +
      `최대 재연결 ${MAX_RECONNECT}회 초과 — REST 폴백으로 작동 중\n` +
      `수동 재시작 필요`,
      { priority: 'HIGH' },
    ).catch(console.error);
    return;
  }

  // 연속 실패 2회 이상 → 승인키 만료/회전 가능성 → 재발급 강제
  if (_reconnectCount >= 2) _approvalKey = null;

  const base = RECONNECT_BASE_DELAY * Math.pow(2, Math.min(_reconnectCount, 6));
  const jitter = Math.floor(Math.random() * 1000); // 0~1s jitter: 썬더링허드 방지
  const delay = base + jitter;
  _reconnectCount++;
  logStreamEvent('RECONNECT', `재연결 예정 (${_reconnectCount}/${MAX_RECONNECT}) — ${(delay / 1000).toFixed(0)}초 후`);
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => connectWebSocket(), delay);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * KIS 실시간 호가 WebSocket을 시작하고 지정 종목들을 구독한다.
 * 장 시작 전 호출하여 watchlist 전체를 구독해 두면 장중 실시간 가격 사용 가능.
 *
 * 재시작 시맨틱:
 *   - 명시적 호출(오퍼레이터 · 스케줄러 워치독)은 `_reconnectCount` 를 리셋한다.
 *     MAX_RECONNECT 소진 후에는 `scheduleReconnect()` 가 조기 반환하므로
 *     리셋하지 않으면 env 변경(KIS_IS_REAL=true) 후에도 영영 복귀하지 못한다.
 *   - 승인키도 함께 무효화해 다음 연결 시 새 키를 발급받는다.
 */
export async function startKisStream(stockCodes: string[]): Promise<void> {
  if (!process.env.KIS_APP_KEY) {
    console.warn('[KIS-WS] KIS_APP_KEY 미설정 — 실시간 스트림 건너뜀');
    return;
  }

  // KIS 단일 세션 구독 한도(41) 초과 시 서버가 1006 으로 강제 종료한다.
  // 호출부에서 이미 우선순위 정렬을 마친 상태라고 가정하고, 여기서는 방어적으로 상한만 적용한다.
  const accepted = stockCodes.slice(0, MAX_SUBSCRIPTIONS);
  if (stockCodes.length > MAX_SUBSCRIPTIONS) {
    logStreamEvent(
      'LIMIT',
      `요청 ${stockCodes.length}종목 → 상한 ${MAX_SUBSCRIPTIONS} 으로 절삭 (초과 ${stockCodes.length - MAX_SUBSCRIPTIONS}개 미구독)`,
    );
  }

  _subscribedCodes.clear();
  for (const code of accepted) {
    _subscribedCodes.add(code.padStart(6, '0'));
  }

  const isReal = process.env.KIS_IS_REAL === 'true';
  if (_reconnectCount >= MAX_RECONNECT) {
    logStreamEvent('RESET', `재연결 카운트(${_reconnectCount}) 리셋 — 명시적 재시작, 모드=${isReal ? 'LIVE' : 'VTS'}`);
  }
  _reconnectCount = 0;
  _approvalKey = null;
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }

  await connectWebSocket();
  console.log(`[KIS-WS] 실시간 스트림 시작 — ${_subscribedCodes.size}개 종목 구독 (모드=${isReal ? 'LIVE' : 'VTS'})`);
}

/** 장중 종목 추가 구독 (이미 연결된 WebSocket에 구독 추가).
 *  구독 상한(MAX_SUBSCRIPTIONS) 초과 시 조용히 무시하여 KIS 1006 강제 종료를 방지한다.
 *  반환값: 구독 수행 여부.
 */
export function subscribeStock(stockCode: string): boolean {
  const code = stockCode.padStart(6, '0');
  if (_subscribedCodes.has(code)) return true;
  if (_subscribedCodes.size >= MAX_SUBSCRIPTIONS) {
    logStreamEvent('LIMIT', `subscribeStock(${code}) 거부 — 이미 상한 ${MAX_SUBSCRIPTIONS} 도달`);
    return false;
  }
  _subscribedCodes.add(code);
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(buildSubscribeMsg(code));
  }
  return true;
}

/** 종목 구독 해제 */
export function unsubscribeStock(stockCode: string): void {
  const code = stockCode.padStart(6, '0');
  _subscribedCodes.delete(code);
  _priceMap.delete(code);
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(buildUnsubscribeMsg(code));
  }
}

/** 전체 구독 해제 + WebSocket 종료 */
export function stopKisStream(): void {
  console.log('[KIS-WS] 실시간 스트림 종료');
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  if (_stableResetTimer) { clearTimeout(_stableResetTimer); _stableResetTimer = null; }
  _reconnectCount = MAX_RECONNECT; // 재연결 방지
  if (_ws) {
    for (const code of _subscribedCodes) {
      try { _ws.send(buildUnsubscribeMsg(code)); } catch { /* ignore */ }
    }
    _ws.close();
    _ws = null;
  }
  _subscribedCodes.clear();
  _priceMap.clear();
  _approvalKey = null;
}

/** WebSocket 연결 상태 */
export function isStreamConnected(): boolean {
  return _ws !== null && _ws.readyState === WebSocket.OPEN;
}

/** 상태 요약 (API/모니터링 용) */
export function getStreamStatus(): {
  connected: boolean;
  subscribedCount: number;
  activePrices: number;
  reconnectCount: number;
  lastPongAt: string | null;
  recentEvents: StreamEvent[];
} {
  return {
    connected: isStreamConnected(),
    subscribedCount: _subscribedCodes.size,
    activePrices: _priceMap.size,
    reconnectCount: _reconnectCount,
    lastPongAt: _lastPongAt > 0 ? new Date(_lastPongAt).toISOString() : null,
    recentEvents: [..._eventLog],
  };
}
