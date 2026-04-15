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
let _subscribedCodes = new Set<string>();
let _isConnecting = false;
let _reconnectCount = 0;
const MAX_RECONNECT = 10;
const RECONNECT_BASE_DELAY = 3000; // 3초 시작, 지수 백오프

const KIS_WS_URL_REAL = 'wss://ops.koreainvestment.com:21443/tryitout/H0STCNT0';
const KIS_WS_URL_VTS  = 'wss://ops.koreainvestment.com:31443/tryitout/H0STCNT0';

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
  if (_isConnecting || (_ws && _ws.readyState === WebSocket.OPEN)) return;
  _isConnecting = true;

  try {
    if (!_approvalKey) {
      _approvalKey = await fetchApprovalKey();
    }

    const wsUrl = getWsUrl();
    console.log(`[KIS-WS] WebSocket 연결 시도: ${wsUrl}`);

    _ws = new WebSocket(wsUrl);

    _ws.onopen = () => {
      console.log(`[KIS-WS] 연결 성공 — 구독 종목 ${_subscribedCodes.size}개 재등록`);
      _isConnecting = false;
      _reconnectCount = 0;

      // 기존 구독 종목 재등록
      for (const code of _subscribedCodes) {
        _ws!.send(buildSubscribeMsg(code));
      }

      // Heartbeat: 60초 간격 PING
      if (_heartbeatTimer) clearInterval(_heartbeatTimer);
      _heartbeatTimer = setInterval(() => {
        if (_ws && _ws.readyState === WebSocket.OPEN) {
          _ws.send('PING');
        }
      }, 60_000);
    };

    _ws.onmessage = (event) => {
      const msg = typeof event.data === 'string' ? event.data : '';
      if (msg === 'PONG' || msg.startsWith('{"header"')) return; // 응답 헤더 무시
      // H0STCNT0 체결 데이터 파싱
      if (msg.includes('H0STCNT0')) {
        parseH0STCNT0(msg);
      }
    };

    _ws.onerror = (event) => {
      console.error('[KIS-WS] WebSocket 오류:', event);
      _isConnecting = false;
    };

    _ws.onclose = (event) => {
      console.warn(`[KIS-WS] WebSocket 종료 (code=${event.code}, reason=${event.reason})`);
      _isConnecting = false;
      _ws = null;
      if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
      scheduleReconnect();
    };
  } catch (err) {
    console.error('[KIS-WS] 연결 실패:', err instanceof Error ? err.message : err);
    _isConnecting = false;
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (_reconnectCount >= MAX_RECONNECT) {
    console.error(`[KIS-WS] 최대 재연결 횟수(${MAX_RECONNECT}) 초과 — 스트리밍 중단`);
    sendTelegramAlert(
      `🔌 <b>[KIS WebSocket] 실시간 호가 연결 실패</b>\n` +
      `최대 재연결 ${MAX_RECONNECT}회 초과 — REST 폴백으로 작동 중\n` +
      `수동 재시작 필요`,
      { priority: 'HIGH' },
    ).catch(console.error);
    return;
  }

  const delay = RECONNECT_BASE_DELAY * Math.pow(2, Math.min(_reconnectCount, 6));
  _reconnectCount++;
  console.log(`[KIS-WS] 재연결 예정 (${_reconnectCount}/${MAX_RECONNECT}) — ${(delay / 1000).toFixed(0)}초 후`);
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => connectWebSocket(), delay);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * KIS 실시간 호가 WebSocket을 시작하고 지정 종목들을 구독한다.
 * 장 시작 전 호출하여 watchlist 전체를 구독해 두면 장중 실시간 가격 사용 가능.
 */
export async function startKisStream(stockCodes: string[]): Promise<void> {
  if (!process.env.KIS_APP_KEY) {
    console.warn('[KIS-WS] KIS_APP_KEY 미설정 — 실시간 스트림 건너뜀');
    return;
  }

  for (const code of stockCodes) {
    _subscribedCodes.add(code.padStart(6, '0'));
  }

  await connectWebSocket();
  console.log(`[KIS-WS] 실시간 스트림 시작 — ${_subscribedCodes.size}개 종목 구독`);
}

/** 장중 종목 추가 구독 (이미 연결된 WebSocket에 구독 추가) */
export function subscribeStock(stockCode: string): void {
  const code = stockCode.padStart(6, '0');
  _subscribedCodes.add(code);
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(buildSubscribeMsg(code));
  }
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
} {
  return {
    connected: isStreamConnected(),
    subscribedCount: _subscribedCodes.size,
    activePrices: _priceMap.size,
    reconnectCount: _reconnectCount,
  };
}
