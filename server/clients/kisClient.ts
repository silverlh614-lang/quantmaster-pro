/**
 * @responsibility KIS 토큰·HTTP·주문·실계좌 데이터 단일 통로 + 하드/소프트 회로차단
 *
 * PR-21: 404 는 소프트 카운터(10회·2분 쿨다운), 5xx/403 은 하드(3회·10분). 기존
 * 3회 404→10분 차단 정책이 정상 조회까지 차단하던 부작용 제거.
 */
// 기존 server/clients/kisClient.ts + src/server/clients/kisClient.ts 통합

import { sendTelegramAlert, escapeHtml } from '../alerts/telegramClient.js';
import { getTradingMode } from '../state.js';
import { scheduleKisCall, type KisApiPriority } from './kisRateLimiter.js';
import { assertModeCompatible } from './kisModeGuard.js';
import { validateExternalPayload } from '../utils/schemaSentinel.js';
import { kisInquirePriceSchema } from './externalSchemas.js';
import {
  isEndpointBlacklisted as _isBlacklisted,
  recordEndpoint404 as _recordBlacklist404,
  resetEndpoint404Counter as _resetBlacklistCounter,
  resetKisEndpointBlacklist as _resetBlacklistAll,
} from '../persistence/kisEndpointBlacklistRepo.js';
export type { KisApiPriority } from './kisRateLimiter.js';
export { getRateLimiterStats } from './kisRateLimiter.js';
export { ModeIncompatibleError, assertModeCompatible } from './kisModeGuard.js';

export const KIS_IS_REAL = process.env.KIS_IS_REAL === 'true';
export const KIS_BASE    = KIS_IS_REAL
  ? 'https://openapi.koreainvestment.com:9443'
  : 'https://openapivts.koreainvestment.com:29443';
export const BUY_TR_ID   = KIS_IS_REAL ? 'TTTC0802U' : 'VTTC0802U';
export const SELL_TR_ID  = KIS_IS_REAL ? 'TTTC0801U' : 'VTTC0801U';
export const CCLD_TR_ID  = KIS_IS_REAL ? 'TTTC8001R' : 'VTTC8001R';

// 실주문 송신 허용 조건 — 실 서버 키 + 런타임 모드 LIVE 가 모두 참이어야 한다.
// killSwitch 가 런타임에서 SHADOW 로 강등하거나 env 에 AUTO_TRADE_MODE=SHADOW 가
// 걸려 있는 경우, KIS_IS_REAL=true 여도 실TR 을 송신하면 안 된다.
function isLiveOrderAllowed(): boolean {
  return KIS_IS_REAL && getTradingMode() === 'LIVE';
}

let cachedToken: { token: string; expiry: number } | null = null;
// Single-flight: 동시 토큰 갱신 요청을 하나로 합쳐 OAuth2 엔드포인트 중복 호출을 방지.
// 시장 스크리너·AI 분석이 병렬로 여러 KIS 호출을 날릴 때 캐시가 비어 있으면
// N개의 동시 `/oauth2/tokenP` 요청이 발생해 KIS가 남용으로 간주할 수 있다.
let inFlightMainTokenRefresh: Promise<string> | null = null;

/**
 * KIS 토큰 응답에서 안전한 오류 정보만 추출. 원본 응답에는 `access_token`·
 * `approval_key` 등 비밀이 섞일 수 있으므로 raw JSON을 로그/에러에 포함하지
 * 않고 표준 OAuth 오류 필드만 꺼내 쓴다.
 */
function sanitizeTokenErrorInfo(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'no response body';
  const r = raw as Record<string, unknown>;
  const code = typeof r.error === 'string' ? r.error
    : typeof r.rt_cd === 'string' ? r.rt_cd
    : typeof r.msg_cd === 'string' ? r.msg_cd
    : 'unknown';
  const desc = typeof r.error_description === 'string' ? r.error_description
    : typeof r.msg1 === 'string' ? r.msg1
    : 'no description';
  return `${code}: ${desc}`;
}

// ─── 실계좌 데이터 전용 클라이언트 설정 ───────────────────────────────────────
// 모의계좌 앱키 → 자동매매 주문 집행 (안전한 테스트)
// 실계좌 앱키   → 시장 데이터 조회만 (거래량 순위, 현재가, 투자자 수급 등)
// 주문은 모의계좌로, 데이터는 실계좌 키로 가져오는 하이브리드 구조

const REAL_DATA_BASE = 'https://openapi.koreainvestment.com:9443';

/** 실계좌 데이터 전용 키가 설정되어 있는지 여부 */
export const HAS_REAL_DATA_CLIENT =
  !!(process.env.KIS_REAL_DATA_APP_KEY && process.env.KIS_REAL_DATA_APP_SECRET);

let cachedRealDataToken: { token: string; expiry: number } | null = null;
let inFlightRealDataTokenRefresh: Promise<string> | null = null;

// ─── 토큰 관리 ──────────────────────────────────────────────────────────────

/** KIS 기본 URL 반환 (기존 server/ 호환) */
export function getKisBase(): string { return KIS_BASE; }

export async function refreshKisToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiry) return cachedToken.token;
  if (inFlightMainTokenRefresh) return inFlightMainTokenRefresh;

  inFlightMainTokenRefresh = (async () => {
    try {
      const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          appkey: process.env.KIS_APP_KEY,
          appsecret: process.env.KIS_APP_SECRET,
        }),
      });
      const data = await res.json() as { access_token?: string };
      if (!data.access_token) {
        throw new Error(`KIS 토큰 갱신 실패 (status=${res.status}): ${sanitizeTokenErrorInfo(data)}`);
      }
      cachedToken = { token: data.access_token, expiry: Date.now() + 23 * 60 * 60 * 1000 };
      console.log('[KIS] 토큰 갱신 완료');
      return cachedToken.token;
    } finally {
      inFlightMainTokenRefresh = null;
    }
  })();

  return inFlightMainTokenRefresh;
}

/** refreshKisToken 호환 별칭 (기존 server/ 호환) */
export const getKisToken = refreshKisToken;

/** 토큰 만료까지 남은 시간(시간 단위). 토큰 미발급 시 0 반환 */
export function getKisTokenRemainingHours(): number {
  if (!cachedToken) return 0;
  return Math.floor((cachedToken.expiry - Date.now()) / 1000 / 60 / 60);
}

/** 토큰 캐시 강제 초기화 — 401 감지 시 또는 외부 수동 갱신 시 사용 */
export function invalidateKisToken(): void {
  cachedToken = null;
  cachedRealDataToken = null;
  console.log('[KIS] 토큰 캐시 강제 초기화');
}

// ─── 실계좌 데이터 전용 토큰 관리 ────────────────────────────────────────────

/** 실계좌 데이터 전용 토큰 갱신. 실계좌 키 미설정 시 에러 */
async function refreshRealDataToken(): Promise<string> {
  if (cachedRealDataToken && Date.now() < cachedRealDataToken.expiry) return cachedRealDataToken.token;
  if (inFlightRealDataTokenRefresh) return inFlightRealDataTokenRefresh;

  inFlightRealDataTokenRefresh = (async () => {
    try {
      const res = await fetch(`${REAL_DATA_BASE}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          appkey: process.env.KIS_REAL_DATA_APP_KEY,
          appsecret: process.env.KIS_REAL_DATA_APP_SECRET,
        }),
      });
      const data = await res.json() as { access_token?: string };
      if (!data.access_token) {
        throw new Error(`KIS 실계좌 데이터 토큰 갱신 실패 (status=${res.status}): ${sanitizeTokenErrorInfo(data)}`);
      }
      cachedRealDataToken = { token: data.access_token, expiry: Date.now() + 23 * 60 * 60 * 1000 };
      console.log('[KIS-RealData] 실계좌 데이터 전용 토큰 갱신 완료');
      return cachedRealDataToken.token;
    } finally {
      inFlightRealDataTokenRefresh = null;
    }
  })();

  return inFlightRealDataTokenRefresh;
}

/** 실계좌 데이터 전용 토큰 잔여 시간 */
export function getRealDataTokenRemainingHours(): number {
  if (!cachedRealDataToken) return 0;
  return Math.floor((cachedRealDataToken.expiry - Date.now()) / 1000 / 60 / 60);
}

/**
 * 주·실계좌 KIS 토큰을 **강제로** 동시 갱신한다.
 *
 * 캐시 TTL(23h)과 cron 주기(24h) 사이의 1시간 공백을 없애기 위해, 상위 스케줄러가
 * 12시간 주기로 호출한다. invalidate 후 재발급이므로 "장중 lazy refresh" 경쟁은
 * 제거되고 토큰 교체 지점이 예측 가능해진다.
 *
 * - 주 토큰(KIS_APP_KEY) — 주문·잔고 전용
 * - 실계좌 데이터 토큰(KIS_REAL_DATA_APP_KEY) — 시장 데이터 전용 (미설정 시 스킵)
 *
 * 어느 한쪽이 실패해도 다른 쪽은 계속 시도한다(Promise.allSettled).
 */
export async function forceRefreshKisTokens(): Promise<{ main: boolean; realData: boolean | 'SKIPPED' }> {
  cachedToken = null;
  cachedRealDataToken = null;

  const mainTask = refreshKisToken();
  const realTask: Promise<string> | null = HAS_REAL_DATA_CLIENT ? refreshRealDataToken() : null;

  const [mainRes, realRes] = await Promise.allSettled([
    mainTask,
    realTask ?? Promise.resolve('SKIPPED'),
  ]);

  return {
    main: mainRes.status === 'fulfilled',
    realData: !realTask ? 'SKIPPED' : realRes.status === 'fulfilled',
  };
}

// ─── HTTP 헬퍼 (내부 raw + 외부 rate-limited) ──────────────────────────────

const _kisSleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * ADR-0014 — 5xx exponential backoff + 50% jitter.
 * - jitter 활성: retriesLeft=3 → 500~1500ms, 2 → 1000~3000ms, 1 → 2000~6000ms
 * - jitter 비활성 (KIS_RETRY_JITTER_DISABLED=true): 1000/2000/4000ms 고정 (회귀 비교용)
 */
const _kisBackoffDelayMs = (retriesLeft: number): number => {
  const base = Math.pow(2, 3 - retriesLeft) * 1000;
  if (process.env.KIS_RETRY_JITTER_DISABLED === 'true') return base;
  return Math.floor(base * 0.5 + Math.random() * base);
};

/**
 * ADR-0014 — 429 rate-limit 대기 + 0~500ms jitter.
 * 동시 호출이 KIS 게이트웨이 제한에 동시에 걸리면 동기화된 1초 대기 → 동시 재시도 폭주.
 * Jitter 로 재시도 시점을 분산.
 */
const _kis429DelayMs = (): number => {
  if (process.env.KIS_RETRY_JITTER_DISABLED === 'true') return 1000;
  return 1000 + Math.floor(Math.random() * 500);
};

/**
 * ADR-0014 — 재시도 자체를 무력화하는 긴급 스위치.
 * KIS 자체 장애로 인한 재시도 폭주를 즉시 차단해야 할 때 사용.
 */
const _isKisRetryEnabled = (): boolean => process.env.KIS_RETRY_DISABLED !== 'true';

/**
 * ADR-0014 — KIS POST 호출의 idempotency 분류.
 *
 * - 'unsafe' (default): 주문/취소 등 mutate 호출. 5xx 재시도 차단 — KIS 매칭엔진이
 *   주문을 받았는지 확인할 방법이 없어 재시도 시 중복 주문 위험.
 * - 'safe': read-only POST (현재 코드베이스에는 해당 없음, 향후 확장용).
 *
 * 401/429/네트워크 에러는 두 분류 모두 안전 재시도 — KIS 매칭엔진 미진입 확정.
 */
export type KisPostIdempotency = 'safe' | 'unsafe';

export interface KisPostOptions {
  /** 기본 'unsafe' (주문 안전 우선). 명시 안 하면 5xx 재시도 차단. */
  idempotency?: KisPostIdempotency;
}

// ─── 회로 차단기 (Circuit Breaker) ──────────────────────────────────────────
// KIS 서버가 특정 trId(예: TTTC8434R 잔고조회)에 대해 지속적으로 5xx를 반환할 때,
// 재시도 루프가 매 호출마다 최대 7초(1+2+4s)를 소비하고 rate-limiter 큐에 적체되어
// Railway 메모리/타임아웃 한도를 초과하고 SIGTERM을 유발하는 문제를 차단한다.
//
// 동작 (PR-21: 404 완화):
//   - trId별로 연속 실패 카운터 2개: 하드(5xx/403) + 소프트(404) 분리 관리.
//   - 하드 — CIRCUIT_THRESHOLD_HARD(3회) → CIRCUIT_COOLDOWN_HARD_MS(10분) 차단.
//   - 소프트 — CIRCUIT_THRESHOLD_SOFT(10회) → CIRCUIT_COOLDOWN_SOFT_MS(2분) 차단.
//   - KIS_LENIENT_404=true 이면 404 은 경고만 — 회로 절대 안 닫음.
//   - 개방 상태에서는 fetch 호출 자체를 건너뛰고 즉시 null 반환.
//   - 성공 응답(2xx) 시 두 카운터 모두 리셋 + 회로 복구.
//
// 404 완화 근거: KIS 실계좌 데이터(realDataKisGet) 에서 특정 trId 의 404 는
// 엔드포인트 영구 불일치뿐 아니라 일시 장애·종목 일시 미지원에서도 발생한다.
// 3회만 실패해도 10분 차단하던 기존 정책은 정상 조회까지 함께 죽였다.

const CIRCUIT_THRESHOLD_HARD = 3;         // 5xx, 403 — 자연 복구 어려움
const CIRCUIT_COOLDOWN_HARD_MS = 10 * 60 * 1000;
const CIRCUIT_THRESHOLD_SOFT = 10;        // 404 — 종종 일시적, 관대 정책
const CIRCUIT_COOLDOWN_SOFT_MS = 2 * 60 * 1000;
/** 레거시 호환 — 외부에서 import 하는 코드가 있을 수 있어 유지. */
const CIRCUIT_THRESHOLD = CIRCUIT_THRESHOLD_HARD;
const CIRCUIT_COOLDOWN_MS = CIRCUIT_COOLDOWN_HARD_MS;

function _lenient404(): boolean {
  return (process.env.KIS_LENIENT_404 ?? 'false').toLowerCase() === 'true';
}

interface CircuitState {
  /** 5xx/403 연속 실패 — 하드 실패 카운터 */
  hardFailures: number;
  /** 404 연속 실패 — 소프트 실패 카운터 */
  softFailures: number;
  /** 차단 만료 시각 (epoch ms). 0 = 차단 안 됨. */
  openUntil: number;
  /** 마지막 차단이 어느 경로로 왔는지 (로그용) */
  lastBlockedBy?: 'HARD' | 'SOFT';
}

const _circuitByTrId = new Map<string, CircuitState>();

function _getCircuit(trId: string): CircuitState {
  let state = _circuitByTrId.get(trId);
  if (!state) {
    state = { hardFailures: 0, softFailures: 0, openUntil: 0 };
    _circuitByTrId.set(trId, state);
  }
  return state;
}

/** 회로가 열려 있으면 true — 호출을 건너뛰어야 함 */
function _isCircuitOpen(trId: string): boolean {
  // ADR-0010: 영속 블랙리스트가 회로보다 우선. 24h 차단 윈도우 동안 즉시 true.
  if (_isBlacklisted(trId)) return true;
  const state = _circuitByTrId.get(trId);
  if (!state) return false;
  if (Date.now() < state.openUntil) return true;
  // 쿨다운 만료 — 반열림 상태로 전환(카운터는 유지하고 한 번 시도)
  if (state.openUntil > 0 && Date.now() >= state.openUntil) {
    state.openUntil = 0;
  }
  return false;
}

/**
 * 실패 기록. status 값에 따라 하드(5xx/403) 또는 소프트(404) 카운터를 증가시킨다.
 * 400/429 등은 호출자 측 파라미터·레이트 이슈라 회로 대상에서 제외한다.
 */
function _recordCircuitFailure(trId: string, status: number): void {
  const state = _getCircuit(trId);

  if (status === 404) {
    if (_lenient404()) {
      console.warn(`[KIS] ⚠️ 404 (${trId}) — KIS_LENIENT_404 모드: 회로 비활성`);
      return;
    }
    state.softFailures += 1;
    // ADR-0010: 영속 블랙리스트 카운터도 함께 누적 — 30분 윈도우/10회 누적 시 24h 차단.
    _recordBlacklist404(trId);
    if (state.softFailures >= CIRCUIT_THRESHOLD_SOFT) {
      state.openUntil = Date.now() + CIRCUIT_COOLDOWN_SOFT_MS;
      state.lastBlockedBy = 'SOFT';
      console.warn(
        `[KIS] 🟡 소프트 회로 차단 — ${trId} 404 ${state.softFailures}회 연속, ` +
        `${CIRCUIT_COOLDOWN_SOFT_MS / 60000}분간 호출 차단 (엔드포인트 일시 불가)`
      );
    } else {
      const remaining = CIRCUIT_THRESHOLD_SOFT - state.softFailures;
      console.warn(`[KIS] 404 (${trId}) — 소프트 카운트 ${state.softFailures}/${CIRCUIT_THRESHOLD_SOFT} (잔여 ${remaining}회)`);
    }
    return;
  }

  // 5xx / 403 — 하드 실패
  state.hardFailures += 1;
  if (state.hardFailures >= CIRCUIT_THRESHOLD_HARD) {
    state.openUntil = Date.now() + CIRCUIT_COOLDOWN_HARD_MS;
    state.lastBlockedBy = 'HARD';
    console.warn(
      `[KIS] 🚨 회로 차단 — ${trId} ${state.hardFailures}회 연속 ${status} 실패, ` +
      `${CIRCUIT_COOLDOWN_HARD_MS / 60000}분간 호출 차단`
    );
  }
}

function _recordCircuitSuccess(trId: string): void {
  // ADR-0010: 성공 시 영속 블랙리스트의 윈도우 카운터도 리셋(24h 차단 entry 는 만료 대기).
  _resetBlacklistCounter(trId);
  const state = _circuitByTrId.get(trId);
  if (!state) return;
  const hadFailure = state.hardFailures > 0 || state.softFailures > 0 || state.openUntil > 0;
  if (hadFailure) {
    console.log(
      `[KIS] ✅ 회로 복구 — ${trId} 정상 응답 ` +
      `(이전 hard ${state.hardFailures} / soft ${state.softFailures} 리셋)`
    );
  }
  state.hardFailures = 0;
  state.softFailures = 0;
  state.openUntil = 0;
  state.lastBlockedBy = undefined;
}

// ─── 테스트 전용 export (PR-21) ──────────────────────────────────────────────
// 런타임 코드 호출 대상이 아님 — 단위 테스트에서 회로 상태를 직접 조작한다.
export const __testOnly = {
  recordFailure: (trId: string, status: number) => _recordCircuitFailure(trId, status),
  recordSuccess: (trId: string) => _recordCircuitSuccess(trId),
  isOpen: (trId: string) => _isCircuitOpen(trId),
  // ADR-0014 재시도 안전성 테스트 — jitter 동작·재시도 스위치 검증용.
  backoffDelayMs: (retriesLeft: number) => _kisBackoffDelayMs(retriesLeft),
  rateLimit429DelayMs: () => _kis429DelayMs(),
  isRetryEnabled: () => _isKisRetryEnabled(),
};

/** 회로 차단기 상태 조회 (디버깅/모니터링용) */
export function getCircuitBreakerStats(): Array<{
  trId: string;
  /** 하드 실패 수 (5xx/403) */
  hardFailures: number;
  /** 소프트 실패 수 (404) */
  softFailures: number;
  /** 호환용 별칭 — hardFailures + softFailures 합. 레거시 UI 를 위해 유지. */
  consecutiveFailures: number;
  openFor: number;
  lastBlockedBy?: 'HARD' | 'SOFT';
}> {
  const now = Date.now();
  return Array.from(_circuitByTrId.entries()).map(([trId, state]) => ({
    trId,
    hardFailures: state.hardFailures,
    softFailures: state.softFailures,
    consecutiveFailures: state.hardFailures + state.softFailures,
    openFor: Math.max(0, state.openUntil - now),
    lastBlockedBy: state.lastBlockedBy,
  }));
}

/**
 * 모든 KIS 회로 차단을 즉시 해제 — 운영자용.
 *
 * 배경: 저녁 추천 스캔 시간대(KST 16~22)에 KIS 잔고/랭킹 TR 이 5xx 를 누적해
 * 회로가 닫힌 채로 들어가면 10분 cooldown 동안 후보 종목 호출이 모두 null 로
 * 떨어진다. /reset 비상 정지 해제로는 회로가 풀리지 않으므로 별도 경로 필요.
 *
 * @returns 해제 전 열려 있던 회로 수
 */
export function resetKisCircuits(): number {
  let openCount = 0;
  const now = Date.now();
  for (const state of _circuitByTrId.values()) {
    if (state.openUntil > now) openCount++;
  }
  _circuitByTrId.clear();
  // ADR-0010: 영속 블랙리스트도 함께 청소 (운영자 수동 복구).
  const blacklistCleared = _resetBlacklistAll();
  if (openCount > 0 || blacklistCleared > 0) {
    console.warn(
      `[KIS] 🔧 운영자 수동 회로 reset — 회로 ${openCount}개 + 블랙리스트 ${blacklistCleared}개 해제`
    );
  }
  return openCount;
}

/**
 * 내부 raw GET — 토큰 버킷 없이 직접 호출. 외부에서는 kisGet을 사용할 것.
 *
 * 재시도 정책 (retriesLeft 기본 3회):
 *   - 401 Unauthorized: 토큰 무효화 + 즉시 재시도
 *   - 429 Too Many Requests: 1초+jitter 대기 후 재시도
 *   - 5xx Server Error: 지수 백오프+jitter 후 재시도 (READ 안전)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _rawKisGet(
  trId: string, apiPath: string, params: Record<string, string>, retriesLeft = 3,
): Promise<any> {
  if (_isCircuitOpen(trId)) {
    console.warn(`[KIS] 회로 차단 상태 — ${trId} 호출 건너뜀 (cooldown 중)`);
    return null;
  }

  const token = await refreshKisToken();
  const url = `${KIS_BASE}${apiPath}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY!,
      appsecret: process.env.KIS_APP_SECRET!,
      tr_id: trId,
      custtype: 'P',
    },
  });

  const retryAllowed = retriesLeft > 0 && _isKisRetryEnabled();

  if (res.status === 401 && retryAllowed) {
    console.warn(`[KIS] 401 Unauthorized (${trId}) — 토큰 강제 갱신 후 재시도 (${retriesLeft}회 남음)`);
    invalidateKisToken();
    return _rawKisGet(trId, apiPath, params, retriesLeft - 1);
  }

  if (res.status === 429 && retryAllowed) {
    const delay = _kis429DelayMs();
    console.warn(`[KIS] 429 Rate Limit (${trId}) — ${delay}ms 대기 후 재시도 (${retriesLeft}회 남음)`);
    await _kisSleep(delay);
    return _rawKisGet(trId, apiPath, params, retriesLeft - 1);
  }

  if (res.status >= 500 && res.status < 600 && retryAllowed) {
    const delay = _kisBackoffDelayMs(retriesLeft);
    console.warn(`[KIS] ${res.status} (${trId}) 재시도 ${retriesLeft}회 남음, ${delay}ms 대기`);
    await _kisSleep(delay);
    return _rawKisGet(trId, apiPath, params, retriesLeft - 1);
  }

  if (!res.ok) {
    console.error(`[KIS] API 오류 ${res.status} (${trId})`);
    if (res.status >= 500 && res.status < 600) _recordCircuitFailure(trId, res.status);
    return null;
  }

  _recordCircuitSuccess(trId);
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * ADR-0014 — WRITE 5xx 실패 시 텔레그램 즉시 경보 (1회).
 *
 * 5xx 재시도를 차단했으므로 호출자가 실패를 즉시 인지해야 한다. 운영자는 KIS HTS 로
 * 실주문 상태를 직접 확인 후 수동 재실행 또는 /reconcile live 로 후속 조치.
 *
 * 텔레그램 송신 자체 실패는 무시 (재시도 폭주 방지).
 */
async function _alertUnsafeWriteFailure(
  trId: string, apiPath: string, status: number,
): Promise<void> {
  const msg =
    `🚨 <b>[KIS WRITE 5xx — 재시도 차단]</b>\n` +
    `TR: <code>${escapeHtml(trId)}</code>\n` +
    `Path: <code>${escapeHtml(apiPath)}</code>\n` +
    `Status: ${status}\n\n` +
    `중복 주문 위험으로 자동 재시도 없음.\n` +
    `KIS HTS 로 실주문 상태 확인 후 필요 시 수동 재실행 또는 ` +
    `<code>/reconcile live</code> 점검.`;
  try { await sendTelegramAlert(msg); } catch { /* swallow */ }
}

/**
 * 내부 raw POST — 토큰 버킷 없이 직접 호출. 외부에서는 kisPost를 사용할 것.
 *
 * ADR-0014 재시도 정책:
 *   - 401: 안전 재시도 (인증 거부, 매칭엔진 미진입)
 *   - 429: 안전 재시도 (게이트웨이 거부, 매칭엔진 미진입)
 *   - 5xx + idempotency='safe': 지수 백오프+jitter 재시도
 *   - 5xx + idempotency='unsafe': **재시도 차단** + 텔레그램 경보 (중복 주문 방지)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _rawKisPost(
  trId: string, apiPath: string, body: Record<string, string>,
  options: { idempotency: KisPostIdempotency } = { idempotency: 'unsafe' },
  retriesLeft = 3,
): Promise<any> {
  if (_isCircuitOpen(trId)) {
    console.warn(`[KIS] 회로 차단 상태 — ${trId} 호출 건너뜀 (cooldown 중)`);
    return null;
  }

  const token = await refreshKisToken();
  const res = await fetch(`${KIS_BASE}${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY!,
      appsecret: process.env.KIS_APP_SECRET!,
      tr_id: trId,
      custtype: 'P',
    },
    body: JSON.stringify(body),
  });

  const retryAllowed = retriesLeft > 0 && _isKisRetryEnabled();

  if (res.status === 401 && retryAllowed) {
    console.warn(`[KIS] 401 Unauthorized (${trId}) — 토큰 강제 갱신 후 재시도 (${retriesLeft}회 남음)`);
    invalidateKisToken();
    return _rawKisPost(trId, apiPath, body, options, retriesLeft - 1);
  }

  if (res.status === 429 && retryAllowed) {
    const delay = _kis429DelayMs();
    console.warn(`[KIS] 429 Rate Limit (${trId}) — ${delay}ms 대기 후 재시도 (${retriesLeft}회 남음)`);
    await _kisSleep(delay);
    return _rawKisPost(trId, apiPath, body, options, retriesLeft - 1);
  }

  if (res.status >= 500 && res.status < 600) {
    // ADR-0014: WRITE(unsafe) 는 5xx 후 재시도 차단 — KIS 가 받았는지 알 수 없어 중복 주문 위험.
    if (options.idempotency === 'unsafe') {
      console.error(
        `[KIS] ${res.status} WRITE 실패 (${trId}) — 재시도 차단 (중복 주문 방지). ` +
        `KIS 실주문 상태를 HTS 로 확인 필요.`
      );
      _recordCircuitFailure(trId, res.status);
      // 텔레그램 경보는 비동기로 발사 — 실패해도 호출자 흐름 차단하지 않음.
      void _alertUnsafeWriteFailure(trId, apiPath, res.status);
      return null;
    }
    if (retryAllowed) {
      const delay = _kisBackoffDelayMs(retriesLeft);
      console.warn(`[KIS] ${res.status} (${trId}) 재시도 ${retriesLeft}회 남음, ${delay}ms 대기`);
      await _kisSleep(delay);
      return _rawKisPost(trId, apiPath, body, options, retriesLeft - 1);
    }
  }

  if (!res.ok) {
    console.error(`[KIS] API 오류 ${res.status} (${trId})`);
    if (res.status >= 500 && res.status < 600) _recordCircuitFailure(trId, res.status);
    return null;
  }

  _recordCircuitSuccess(trId);
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Rate-limited KIS GET. 모든 외부 호출은 토큰 버킷을 통과한다.
 * @param priority 기본 MEDIUM. 매도 체결 확인은 HIGH, 잔고/데이터 조회는 LOW.
 */
export function kisGet(
  trId: string, apiPath: string, params: Record<string, string>,
  priority: KisApiPriority = 'MEDIUM',
) {
  assertModeCompatible(trId, KIS_IS_REAL ? 'LIVE' : 'VTS');
  return scheduleKisCall(priority, `GET ${trId}`, () => _rawKisGet(trId, apiPath, params));
}

/**
 * Rate-limited KIS POST. 모든 외부 호출은 토큰 버킷을 통과한다.
 *
 * ADR-0014: `options.idempotency` 기본 'unsafe' — 주문/취소 등 mutate 호출 보호.
 * 5xx 후 재시도가 중복 주문을 만들 수 있으므로 차단 + 텔레그램 경보. read-only POST 가
 * 추가될 경우 호출자가 명시적으로 `{ idempotency: 'safe' }` 전달.
 *
 * @param priority 기본 HIGH (주문 계열). 데이터 조회는 LOW.
 * @param options.idempotency 'unsafe' (기본) | 'safe'
 */
export function kisPost(
  trId: string, apiPath: string, body: Record<string, string>,
  priority: KisApiPriority = 'HIGH',
  options: KisPostOptions = {},
) {
  assertModeCompatible(trId, KIS_IS_REAL ? 'LIVE' : 'VTS');
  const idempotency = options.idempotency ?? 'unsafe';
  return scheduleKisCall(priority, `POST ${trId}`, () =>
    _rawKisPost(trId, apiPath, body, { idempotency }),
  );
}

// ─── 실계좌 데이터 전용 HTTP 헬퍼 ────────────────────────────────────────────
// 시장 데이터(거래량 순위, 현재가, 투자자 수급 등) 조회 전용.
// 실계좌 키 미설정 시 모의계좌 kisGet으로 자동 폴백.

/**
 * 실계좌 데이터 전용 GET 요청 (rate-limited).
 * KIS_REAL_DATA_APP_KEY 설정 시 실계좌 서버로, 미설정 시 기존 kisGet 폴백.
 */
export function realDataKisGet(trId: string, apiPath: string, params: Record<string, string>) {
  if (_overrides.realDataKisGet) return _overrides.realDataKisGet(trId, apiPath, params);
  if (!HAS_REAL_DATA_CLIENT) return kisGet(trId, apiPath, params, 'LOW');

  return scheduleKisCall('LOW', `REAL_GET ${trId}`, async () => {
    if (_isCircuitOpen(trId)) {
      console.warn(`[KIS-RealData] 회로 차단 상태 — ${trId} 호출 건너뜀 (cooldown 중)`);
      return null;
    }

    const doFetch = async (token: string) => fetch(
      `${REAL_DATA_BASE}${apiPath}?${new URLSearchParams(params)}`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          appkey: process.env.KIS_REAL_DATA_APP_KEY!,
          appsecret: process.env.KIS_REAL_DATA_APP_SECRET!,
          tr_id: trId,
          custtype: 'P',
        },
      },
    );

    let token = await refreshRealDataToken();
    let res = await doFetch(token);

    // 401 감지 → 실계좌 데이터 토큰 강제 무효화 후 1회 재시도
    if (res.status === 401) {
      console.warn(`[KIS-RealData] 401 Unauthorized (${trId}) — 토큰 강제 갱신 후 재시도`);
      cachedRealDataToken = null;
      token = await refreshRealDataToken();
      res = await doFetch(token);
    }

    if (!res.ok) {
      console.error(`[KIS-RealData] API 오류 ${res.status} (${trId})`);
      // 5xx(일시 장애) + 404/403(엔드포인트/권한 불일치 — 자연 복구 불가)은 회로 차단.
      // 400/429는 호출자 파라미터 조정·재시도로 해결 여지가 있어 카운팅에서 제외.
      if (
        (res.status >= 500 && res.status < 600)
        || res.status === 404
        || res.status === 403
      ) {
        _recordCircuitFailure(trId, res.status);
      }
      return null;
    }

    _recordCircuitSuccess(trId);
    const text = await res.text();
    if (!text.trim()) return null;
    try { return JSON.parse(text); } catch { return null; }
  });
}

// ─── 현재가 조회 ────────────────────────────────────────────────────────────

// ─── 종목별 투자자 수급 조회 ─────────────────────────────────────────────────

export interface KisInvestorFlow {
  foreignNetBuy:      number;  // 외국인 당일 순매수량 (주)
  institutionalNetBuy: number; // 기관 당일 순매수량 (주)
  individualNetBuy:   number;  // 개인 당일 순매수량 (주)
  source: 'KIS_API';
}

// ─── Mock 오버라이드 시스템 ──────────────────────────────────────────────────
// VTS 모드에서 실 API 호출 없이 전체 파이프라인을 테스트할 수 있도록
// 데이터 조회 함수들을 오버라이드 가능하게 한다.
// 주문 함수(placeKisSellOrder 등)는 이미 Shadow 모드에서 실주문을 건너뛰므로 제외.

export interface KisClientOverrides {
  fetchCurrentPrice?: (code: string) => Promise<number | null>;
  fetchStockName?: (code: string) => Promise<string | null>;
  fetchAccountBalance?: () => Promise<number | null>;
  fetchKisHoldings?: () => Promise<KisHolding[] | null>;
  fetchKisInvestorFlow?: (code: string) => Promise<KisInvestorFlow | null>;
  realDataKisGet?: (trId: string, apiPath: string, params: Record<string, string>) => Promise<unknown>;
}

let _overrides: KisClientOverrides = {};

/**
 * KIS 클라이언트 데이터 조회 함수를 mock으로 교체한다.
 * VTS 모드에서 실 API 호출 없이 전체 파이프라인을 작동시키는 핵심.
 */
export function setKisClientOverrides(overrides: KisClientOverrides): void {
  _overrides = overrides;
  console.log(`[KIS] 클라이언트 오버라이드 설정 완료: ${Object.keys(overrides).join(', ')}`);
}

/** 현재 오버라이드 설정 여부 */
export function hasKisClientOverrides(): boolean {
  return Object.keys(_overrides).length > 0;
}

// ─── 데이터 조회 함수 (오버라이드 가능) ────────────────────────────────────────

/**
 * FHKST01010300 — 주식현재가 투자자별 순매수 조회.
 * KIS_APP_KEY 미설정 시 null 반환. 실계좌/VTS 모두 지원.
 */
export async function fetchKisInvestorFlow(code: string): Promise<KisInvestorFlow | null> {
  if (_overrides.fetchKisInvestorFlow) return _overrides.fetchKisInvestorFlow(code);
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  try {
    const data = await realDataKisGet(
      'FHKST01010300',
      '/uapi/domestic-stock/v1/quotations/inquire-investor',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code.padStart(6, '0'),
      },
    );
    const out = (data as { output?: Record<string, string> } | null)?.output;
    if (!out) return null;
    return {
      foreignNetBuy:       parseInt(out.frgn_ntby_qty ?? '0', 10),
      institutionalNetBuy: parseInt(out.orgn_ntby_qty  ?? '0', 10),
      individualNetBuy:    parseInt(out.prsn_ntby_qty  ?? '0', 10),
      source: 'KIS_API',
    };
  } catch { return null; }
}

/**
 * FHKST03030100 — 코스피 전체 투자자별 매매 동향 조회.
 * 외국인/기관/개인 전체 시장 순매수량을 반환한다.
 * KIS_APP_KEY 미설정 시 null 반환. 실계좌/VTS 모두 지원.
 */
export async function fetchKisMarketSupply(): Promise<{
  foreignNetBuy: number;
  institutionNetBuy: number;
  individualNetBuy: number;
} | null> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  try {
    const data = await realDataKisGet(
      'FHKST03030100',
      '/uapi/domestic-stock/v1/quotations/inquire-investor',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: '0001',
      },
    );
    const out = (data as { output?: Record<string, string> } | null)?.output;
    if (!out) return null;
    return {
      foreignNetBuy:     Number(out.frgn_ntby_qty ?? out.FRGN_NETBUY_QTY ?? 0),
      institutionNetBuy: Number(out.orgn_ntby_qty ?? out.INST_NETBUY_QTY ?? 0),
      individualNetBuy:  Number(out.prsn_ntby_qty ?? out.INDV_NETBUY_QTY ?? 0),
    };
  } catch (e) {
    console.error('[KIS] 코스피 전체 수급 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchCurrentPrice(code: string): Promise<number | null> {
  if (_overrides.fetchCurrentPrice) return _overrides.fetchCurrentPrice(code);
  const data = await realDataKisGet('FHKST01010100', '/uapi/domestic-stock/v1/quotations/inquire-price', {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: code,
  });
  // Tier 2 #5 — schemaSentinel 검증 (PR-52 follow-up wiring).
  // KIS inquire-price 응답이 NaN/undefined 로 깨져 학습 가중치까지 흘러드는 시나리오 차단.
  // 실패 시 null 반환 (기존 실패 경로와 동일) + 5분 차단 + 텔레그램 경보.
  const validated = validateExternalPayload('KIS', data, kisInquirePriceSchema, { context: { trId: 'FHKST01010100', code } });
  if (!validated) return null;
  const price = parseInt(validated.output.stck_prpr, 10);
  return price > 0 ? price : null;
}

// ─── 전일종가 조회 (preMarketGapProbe 전용) ────────────────────────────────────

/**
 * KIS 전일종가 응답 — ADR-0004 대체 경로에서 장전 갭 계산의 기준가로 사용.
 */
export interface PrevClose {
  stockCode:   string;
  prevClose:   number;
  /** KRX 영업일 (YYYY-MM-DD) — probe 가 staleness 판정에 사용. */
  tradingDate: string;
  /** 응답 수신 시각 (ISO). */
  fetchedAt:   string;
}

/**
 * KIS FHKST01010100 (주식현재가 시세) 응답의 `stck_sdpr`(전일종가) +
 * `stck_prdy_ctrt` 와 함께 조회되는 영업일 메타(base date) 를 합쳐 전일종가를 반환한다.
 *
 * FHKST01010100 는 현재가·전일종가·등락률을 한 번에 내려주므로 일봉 API
 * (FHKST03010100) 를 추가로 호출하지 않고 단일 라운드트립에 전일종가를 얻는다.
 * 영업일 필드는 응답에 명시적으로 없으므로 오늘 KST 를 tradingDate 로 가정하지
 * 않고 `inquire-daily-itemchartprice` 1봉을 fallback 으로 사용해 정확한 KRX
 * 영업일을 파악한다 — FHKST01010100 만으로 채워지지 않는 staleness 판정의
 * 데이터 소스.
 *
 * 실패 시 (KIS 미설정 · 회로차단 · 응답 파싱 실패) null. 호출자는 반드시
 * null-safe 처리.
 */
export async function fetchKisPrevClose(stockCode: string): Promise<PrevClose | null> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;

  const code = stockCode.padStart(6, '0');
  const nowIso = new Date().toISOString();

  // 1차: 현재가 조회에서 전일종가(stck_sdpr) 추출 — 가장 가볍고 빠른 경로.
  try {
    const data = await realDataKisGet(
      'FHKST01010100',
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code,
      },
    );
    const out = (data as { output?: Record<string, string> } | null)?.output;
    const prevClose = parseInt(out?.stck_sdpr ?? '0', 10);
    if (prevClose > 0) {
      // FHKST01010100 응답은 영업일 필드를 직접 포함하지 않는다.
      // 최근 1봉 일봉 조회로 정확한 KRX 영업일을 얻는다 (실패 시 오늘 KST 로 폴백).
      const tradingDate = await _fetchLatestKrxBusinessDate(code) ?? _kstDateStr();
      return { stockCode: code, prevClose, tradingDate, fetchedAt: nowIso };
    }
  } catch (err) {
    console.warn(
      `[KIS] fetchKisPrevClose ${code} FHKST01010100 실패:`,
      err instanceof Error ? err.message : err,
    );
  }

  // 2차: 일봉(FHKST03010100) 최근 1봉 fallback.
  try {
    const today = _kstDateStr().replace(/-/g, '');
    const startYmd = _kstDateStrOffset(-10).replace(/-/g, ''); // 최근 10일 범위면 충분
    const data = await realDataKisGet(
      'FHKST03010100',
      '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: startYmd,
        FID_INPUT_DATE_2: today,
        FID_PERIOD_DIV_CODE: 'D',
        FID_ORG_ADJ_PRC: '0',
      },
    );
    const output2 = (data as { output2?: Record<string, string>[] } | null)?.output2;
    const latest = Array.isArray(output2) ? output2[0] : undefined;
    const close = parseInt(latest?.stck_clpr ?? '0', 10);
    const ymd = latest?.stck_bsop_date ?? '';
    if (close > 0 && /^\d{8}$/.test(ymd)) {
      const tradingDate = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
      return { stockCode: code, prevClose: close, tradingDate, fetchedAt: nowIso };
    }
  } catch (err) {
    console.warn(
      `[KIS] fetchKisPrevClose ${code} FHKST03010100 fallback 실패:`,
      err instanceof Error ? err.message : err,
    );
  }

  return null;
}

/** 오늘 KST 날짜 YYYY-MM-DD. */
function _kstDateStr(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 오늘 KST 기준 offsetDays 만큼 이동한 날짜 YYYY-MM-DD. offsetDays 는 음수 가능. */
function _kstDateStrOffset(offsetDays: number): string {
  const ms = Date.now() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 최근 KRX 영업일을 일봉 API 최신 1봉의 `stck_bsop_date` 에서 가져온다.
 * 실패 시 null — 호출자가 오늘 KST 로 폴백.
 */
async function _fetchLatestKrxBusinessDate(code: string): Promise<string | null> {
  try {
    const today = _kstDateStr().replace(/-/g, '');
    const startYmd = _kstDateStrOffset(-10).replace(/-/g, '');
    const data = await realDataKisGet(
      'FHKST03010100',
      '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: startYmd,
        FID_INPUT_DATE_2: today,
        FID_PERIOD_DIV_CODE: 'D',
        FID_ORG_ADJ_PRC: '0',
      },
    );
    const output2 = (data as { output2?: Record<string, string>[] } | null)?.output2;
    const latest = Array.isArray(output2) ? output2[0] : undefined;
    const ymd = latest?.stck_bsop_date ?? '';
    if (/^\d{8}$/.test(ymd)) return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    return null;
  } catch { return null; }
}

/**
 * KIS FHKST01010100 응답의 hts_kor_isnm 필드로 한국 종목명을 조회한다.
 * KIS 미설정 시 null 반환 — 호출자가 fallback 처리 필요.
 */
export async function fetchStockName(code: string): Promise<string | null> {
  if (_overrides.fetchStockName) return _overrides.fetchStockName(code);
  try {
    const data = await realDataKisGet('FHKST01010100', '/uapi/domestic-stock/v1/quotations/inquire-price', {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code.padStart(6, '0'),
    });
    const name = (data as { output?: Record<string, string> } | null)?.output?.hts_kor_isnm?.trim();
    return name && name.length > 0 ? name : null;
  } catch { return null; }
}

// ─── 계좌 잔고 조회 ─────────────────────────────────────────────────────────

// KIS 실계좌 서버는 평일 KST 02:00~07:00 에 정기 점검을 돌려 이 시간대 잔고 API
// (TTTC8434R / VTTC8434R) 호출은 HTTP 500 으로 반환된다. 또한 장마감 이후(16:00~)
// 에도 장외 조회라 잔고가 불안정해 재시도 스팸이 무의미하다.
// 따라서 KST 07:00~16:00 구간에서만 실호출하고, 그 외엔 최근 캐시값을 반환한다.
let _cachedBalance: number | null = null;

/**
 * 잔고 API 를 실제로 호출해도 되는 시각인지 — KST 07:00~15:59 만 true.
 * - 02:00~06:59: KIS 서버 정기 점검 (→ 500 반복)
 * - 16:00~: 장마감 이후 (→ 장외 조회, 불안정)
 *
 * KIS_ACCOUNT_BALANCE_DISABLE=true 이면 시간대와 무관하게 항상 false — KIS 서버가
 * 영업시간에도 TTTC8434R 을 계속 500 으로 반환하는 장애 상황에서 재시도 폭주와
 * 회로차단 로그 스팸을 막기 위한 Kill-switch.
 */
export function isKisBalanceQueryAllowed(now: Date = new Date()): boolean {
  if (process.env.KIS_ACCOUNT_BALANCE_DISABLE === 'true') return false;
  const kstHour = (now.getUTCHours() + 9) % 24;
  return kstHour >= 7 && kstHour < 16;
}

export async function fetchAccountBalance(): Promise<number | null> {
  if (_overrides.fetchAccountBalance) return _overrides.fetchAccountBalance();

  if (!isKisBalanceQueryAllowed()) return _cachedBalance;

  const trId = KIS_IS_REAL ? 'TTTC8434R' : 'VTTC8434R';
  const data = await kisGet(trId, '/uapi/domestic-stock/v1/trading/inquire-balance', {
    CANO: process.env.KIS_ACCOUNT_NO ?? '',
    ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '02',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '01',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: '',
  }, 'LOW');
  const cash = Number(data?.output2?.[0]?.dnca_tot_amt ?? 0);
  const balance = cash > 0 ? cash : null;
  if (balance !== null) _cachedBalance = balance;
  return balance;
}

// ─── KIS 보유 포지션 조회 (ADR-0015 — /reconcile live SSOT) ────────────────

/**
 * KIS 실잔고 보유 포지션 1건.
 *
 * `inquire-balance` 응답의 `output1[]` 각 row 에서 포지션 식별·재동기화에 필요한
 * 최소 필드만 정규화해 추출한다. 추가 필드(섹터/주문가능수량 등)가 필요하면 raw 응답에
 * 직접 접근하지 말고 본 인터페이스를 확장한다.
 */
export interface KisHolding {
  /** 종목코드 (6자리 zero-padded) */
  pdno: string;
  /** 종목명 (KIS 응답의 prdt_name) */
  prdtName: string;
  /** 보유 수량 — KIS 가 정답 (SSOT) */
  hldgQty: number;
  /** 매입 평단가 — KIS 가 사사오입 후 보관 (SSOT) */
  pchsAvgPric: number;
  /** 현재가 (KIS 응답의 prpr) — null 이면 장외/조회 실패 */
  prpr: number | null;
  /** 평가손익 (KIS 응답의 evlu_pfls_amt) */
  evluPflsAmt: number | null;
}

/**
 * KIS 실잔고에서 모든 보유 포지션을 가져온다.
 *
 * 페이지네이션 대응: KIS 는 100건 초과 시 CTX_AREA_FK100/NK100 으로 분할 응답한다.
 * 본 PR 범위에서는 1페이지(100건) 만 처리 — 자동매매 동시 보유 한도가 통상 한 자리수라
 * 페이지 누락이 실무 위험이 되지 않는다. 100건 초과 시 후속 PR 에서 페이지네이션 추가.
 *
 * 반환:
 *   - `null`  : KIS 미설정·점검시간(02~07)·회로차단·5xx 등으로 조회 불가
 *   - `[]`    : 조회 성공 + 보유 포지션 없음
 *   - 배열   : 보유 포지션 정규화 결과 (hldgQty>0 만 필터)
 */
export async function fetchKisHoldings(): Promise<KisHolding[] | null> {
  if (_overrides.fetchKisHoldings) return _overrides.fetchKisHoldings();

  if (!isKisBalanceQueryAllowed()) return null;
  if (!process.env.KIS_APP_KEY) return null;

  const trId = KIS_IS_REAL ? 'TTTC8434R' : 'VTTC8434R';
  const data = await kisGet(trId, '/uapi/domestic-stock/v1/trading/inquire-balance', {
    CANO: process.env.KIS_ACCOUNT_NO ?? '',
    ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '02',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '01',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: '',
  }, 'LOW');

  const output1 = (data as { output1?: Record<string, string>[] } | null)?.output1;
  if (!Array.isArray(output1)) return null;

  return output1
    .map((row): KisHolding => {
      const hldgQty = Number(row.hldg_qty ?? 0);
      const pchsAvgPric = Number(row.pchs_avg_pric ?? 0);
      const prprRaw = Number(row.prpr ?? 0);
      const evluRaw = Number(row.evlu_pfls_amt ?? 0);
      return {
        pdno: String(row.pdno ?? '').padStart(6, '0'),
        prdtName: String(row.prdt_name ?? '').trim(),
        hldgQty,
        pchsAvgPric,
        prpr: Number.isFinite(prprRaw) && prprRaw > 0 ? prprRaw : null,
        evluPflsAmt: Number.isFinite(evluRaw) ? evluRaw : null,
      };
    })
    .filter((h) => h.pdno.length === 6 && h.hldgQty > 0);
}

// ─── 실제 KIS 매도 주문 ─────────────────────────────────────────────────────
/**
 * KIS 현금 시장가 매수 주문 (서버 자동매매 전용).
 *
 * @returns 주문번호(ODNO) 또는 null (Shadow 모드·오류 시)
 */
export async function placeKisMarketBuyOrder(
  stockCode: string,
  quantity: number,
): Promise<string | null> {
  // Shadow 모드 방어막 — buyPipeline 이 이미 shadowMode 분기를 처리하지만,
  // 런타임 강등(killSwitch)·env 불일치(KIS_IS_REAL=true + AUTO_TRADE_MODE=SHADOW)
  // 상황에서 실TR 이 송신되는 것을 최종 차단한다.
  if (!isLiveOrderAllowed()) {
    console.warn(
      `[AutoTrade BUY Shadow] 🟡 ${stockCode} ${quantity}주 — ` +
      `KIS_IS_REAL=${KIS_IS_REAL} mode=${getTradingMode()} → 실주문 차단`,
    );
    return null;
  }

  const orderData = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
    CANO:            process.env.KIS_ACCOUNT_NO ?? '',
    ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
    PDNO:            stockCode.padStart(6, '0'),
    ORD_DVSN:        '01',  // 시장가
    ORD_QTY:         quantity.toString(),
    ORD_UNPR:        '0',
    SLL_BUY_DVSN_CD: '02',
    CTAC_TLNO:       '',
    MGCO_APTM_ODNO:  '',
    ORD_SVR_DVSN_CD: '0',
  });
  return (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO ?? null;
}

/**
 * 매도 주문 결과. `outcome` 으로 3-상태를 명시적으로 구분하여 호출측이 Shadow 선반영 /
 * LIVE 체결 대기 / LIVE 접수 실패 분기를 정확히 수행할 수 있게 한다.
 *
 * - `SHADOW_ONLY`  : Shadow 모드 — 실주문 없이 가상 체결로 기록해도 안전.
 * - `LIVE_ORDERED` : LIVE 실주문 접수 성공, ODNO 발급됨 (체결은 CCLD 폴링 필요).
 * - `LIVE_FAILED`  : LIVE 모드였으나 접수 실패 (KIS 미설정 · API 예외 · ODNO null).
 *                    호출측은 Fill 선반영을 건너뛰고 중복 방지 플래그도 롤백해야 한다.
 */
export type SellOrderOutcome = 'SHADOW_ONLY' | 'LIVE_ORDERED' | 'LIVE_FAILED';

export interface SellOrderResult {
  ordNo: string | null;
  /** KIS 실주문이 성사됐는지 (LIVE 성공 시 true, SHADOW/실패 시 false) */
  placed: boolean;
  /** 호출측 분기의 진실 원천 — placed 보다 우선 사용 권장. */
  outcome: SellOrderOutcome;
  /** LIVE_FAILED 경우 사람이 읽을 수 있는 사유 */
  failureReason?: string;
}

export async function placeKisSellOrder(
  stockCode: string,
  stockName: string,
  quantity: number,
  reason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'EUPHORIA',
): Promise<SellOrderResult> {
  const emoji = reason === 'STOP_LOSS' ? '🔴' : reason === 'TAKE_PROFIT' ? '🟢' : '🌡️';
  const label = reason === 'STOP_LOSS' ? '손절' : reason === 'TAKE_PROFIT' ? '익절' : '과열부분매도';

  // Shadow 모드: 실주문 없이 로그 + Telegram만
  // KIS_IS_REAL=false(VTS) 또는 런타임 모드가 LIVE 가 아닐 때 모두 차단.
  if (!isLiveOrderAllowed()) {
    console.log(`[AutoTrade SELL Shadow] ${emoji} ${stockName}(${stockCode}) ${label} — ${quantity}주 (Shadow 모드, 실주문 없음, mode=${getTradingMode()})`);
    await sendTelegramAlert(
      `${emoji} <b>[SHADOW ${label}] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `수량: ${quantity}주 | 실주문 없음\n` +
      `⚠️ SHADOW 모드 — 실계좌 잔고 아님`
    ).catch(console.error);
    return { ordNo: null, placed: false, outcome: 'SHADOW_ONLY' };
  }

  if (!process.env.KIS_APP_KEY) {
    console.warn(`[AutoTrade] KIS 미설정 — ${stockName} 매도 건너뜀`);
    return { ordNo: null, placed: false, outcome: 'LIVE_FAILED', failureReason: 'KIS_APP_KEY 미설정' };
  }

  try {
    console.log(`[AutoTrade SELL] ${emoji} ${stockName}(${stockCode}) ${label} 매도 주문 — ${quantity}주`);

    const orderData = await kisPost(SELL_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
      CANO:            process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO:            stockCode.padStart(6, '0'),
      ORD_DVSN:        '01',   // 시장가 (즉시 체결 우선)
      ORD_QTY:         quantity.toString(),
      ORD_UNPR:        '0',
      SLL_BUY_DVSN_CD: '01',  // 01 = 매도
      CTAC_TLNO:       '',
      MGCO_APTM_ODNO:  '',
      ORD_SVR_DVSN_CD: '0',
    });

    const ordNo = (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO ?? null;
    console.log(`[AutoTrade SELL] ${emoji} ${stockName} ${label} 완료 — ODNO: ${ordNo}`);

    await sendTelegramAlert(
      `${emoji} <b>[${label}] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `수량: ${quantity}주 | 주문번호: ${ordNo ?? 'N/A'}`
    ).catch(console.error);

    if (ordNo === null) {
      return { ordNo: null, placed: false, outcome: 'LIVE_FAILED', failureReason: 'ODNO 미발급' };
    }
    return { ordNo, placed: true, outcome: 'LIVE_ORDERED' };
  } catch (err: unknown) {
    console.error(`[AutoTrade SELL] ${stockName} 매도 실패:`, err instanceof Error ? err.message : err);
    // 매도 실패는 치명적 → Telegram 긴급 알림
    await sendTelegramAlert(
      `🚨 <b>[긴급] ${escapeHtml(stockName)} ${label} 매도 실패!</b>\n` +
      `수동으로 즉시 매도하세요!\n` +
      `오류: ${escapeHtml(err instanceof Error ? err.message : String(err))}`
    ).catch(console.error);
    return {
      ordNo: null,
      placed: false,
      outcome: 'LIVE_FAILED',
      failureReason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── OCO 손절 지정가 매도 (체결 즉시 자동 등록) ─────────────────────────────────
/**
 * 매수 체결 확인 후 호출 — 손절 지정가 매도를 KIS에 즉시 등록.
 * exitEngine 주기적 모니터링과 별개로, 거래소 레벨 안전망 역할.
 *
 * @returns 주문번호(ODNO) 또는 null (Shadow 모드·오류 시)
 */
export async function placeKisStopLossLimitOrder(
  stockCode: string,
  stockName: string,
  quantity: number,
  stopPrice: number,
): Promise<string | null> {
  // Shadow 모드: 실주문 없이 로그 + Telegram만
  if (!isLiveOrderAllowed()) {
    console.log(`[StopLoss OCO] 🛡️ ${stockName}(${stockCode}) 손절 지정가 ${stopPrice.toLocaleString()}원 × ${quantity}주 (Shadow 모드, mode=${getTradingMode()})`);
    await sendTelegramAlert(
      `🛡️ <b>[SHADOW 손절 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `손절가: ${stopPrice.toLocaleString()}원 × ${quantity}주 | 실주문 없음\n` +
      `⚠️ SHADOW 모드 — 실계좌 잔고 아님`
    ).catch(console.error);
    return null;
  }

  if (!process.env.KIS_APP_KEY) {
    console.warn(`[StopLoss OCO] KIS 미설정 — ${stockName} 손절 주문 건너뜀`);
    return null;
  }

  try {
    console.log(`[StopLoss OCO] 🛡️ ${stockName}(${stockCode}) 손절 지정가 등록 — ${stopPrice.toLocaleString()}원 × ${quantity}주`);

    const orderData = await kisPost(SELL_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
      CANO:            process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO:            stockCode.padStart(6, '0'),
      ORD_DVSN:        '00',   // 지정가
      ORD_QTY:         quantity.toString(),
      ORD_UNPR:        stopPrice.toString(),
      SLL_BUY_DVSN_CD: '01',  // 01 = 매도
      CTAC_TLNO:       '',
      MGCO_APTM_ODNO:  '',
      ORD_SVR_DVSN_CD: '0',
    });

    const ordNo = (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO ?? null;
    console.log(`[StopLoss OCO] 🛡️ ${stockName} 손절 등록 완료 — ${stopPrice.toLocaleString()}원 ODNO: ${ordNo}`);

    await sendTelegramAlert(
      `🛡️ <b>[손절 주문 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `손절가: ${stopPrice.toLocaleString()}원 × ${quantity}주\n` +
      `주문번호: ${ordNo ?? 'N/A'}`
    ).catch(console.error);

    return ordNo;
  } catch (err: unknown) {
    console.error(`[StopLoss OCO] ${stockName} 손절 주문 실패:`, err instanceof Error ? err.message : err);
    await sendTelegramAlert(
      `🚨 <b>[긴급] ${escapeHtml(stockName)} 손절 주문 등록 실패!</b>\n` +
      `수동으로 손절 주문을 등록하세요!\n` +
      `오류: ${escapeHtml(err instanceof Error ? err.message : String(err))}`
    ).catch(console.error);
    return null;
  }
}

// ─── OCO 익절 지정가 매도 (체결 즉시 자동 등록) ─────────────────────────────────
/**
 * 매수 체결 확인 후 호출 — 익절 지정가 매도를 KIS에 즉시 등록.
 * placeKisStopLossLimitOrder와 쌍으로 등록되어 OCO 완결 루프를 구성.
 *
 * @returns 주문번호(ODNO) 또는 null (Shadow 모드·오류 시)
 */
export async function placeKisTakeProfitLimitOrder(
  stockCode: string,
  stockName: string,
  quantity: number,
  targetPrice: number,
): Promise<string | null> {
  if (!isLiveOrderAllowed()) {
    console.log(`[TakeProfit OCO] 🎯 ${stockName}(${stockCode}) 익절 지정가 ${targetPrice.toLocaleString()}원 × ${quantity}주 (Shadow 모드, mode=${getTradingMode()})`);
    await sendTelegramAlert(
      `🎯 <b>[SHADOW 익절 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `익절가: ${targetPrice.toLocaleString()}원 × ${quantity}주 | 실주문 없음\n` +
      `⚠️ SHADOW 모드 — 실계좌 잔고 아님`
    ).catch(console.error);
    return null;
  }

  if (!process.env.KIS_APP_KEY) {
    console.warn(`[TakeProfit OCO] KIS 미설정 — ${stockName} 익절 주문 건너뜀`);
    return null;
  }

  try {
    console.log(`[TakeProfit OCO] 🎯 ${stockName}(${stockCode}) 익절 지정가 등록 — ${targetPrice.toLocaleString()}원 × ${quantity}주`);

    const orderData = await kisPost(SELL_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
      CANO:            process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO:            stockCode.padStart(6, '0'),
      ORD_DVSN:        '00',   // 지정가
      ORD_QTY:         quantity.toString(),
      ORD_UNPR:        targetPrice.toString(),
      SLL_BUY_DVSN_CD: '01',  // 01 = 매도
      CTAC_TLNO:       '',
      MGCO_APTM_ODNO:  '',
      ORD_SVR_DVSN_CD: '0',
    });

    const ordNo = (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO ?? null;
    console.log(`[TakeProfit OCO] 🎯 ${stockName} 익절 등록 완료 — ${targetPrice.toLocaleString()}원 ODNO: ${ordNo}`);

    await sendTelegramAlert(
      `🎯 <b>[익절 주문 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `익절가: ${targetPrice.toLocaleString()}원 × ${quantity}주\n` +
      `주문번호: ${ordNo ?? 'N/A'}`
    ).catch(console.error);

    return ordNo;
  } catch (err: unknown) {
    console.error(`[TakeProfit OCO] ${stockName} 익절 주문 실패:`, err instanceof Error ? err.message : err);
    await sendTelegramAlert(
      `🚨 <b>[긴급] ${escapeHtml(stockName)} 익절 주문 등록 실패!</b>\n` +
      `수동으로 익절 주문을 등록하세요!\n` +
      `오류: ${escapeHtml(err instanceof Error ? err.message : String(err))}`
    ).catch(console.error);
    return null;
  }
}

// ─── KIS 주문 취소 (OCO one-cancels-other용) ────────────────────────────────
/**
 * 기존 미체결 주문을 취소한다. OCO에서 한 쪽 체결 시 다른 쪽 자동 취소에 사용.
 *
 * @returns true = 취소 성공 또는 이미 체결됨, false = 취소 실패
 */
export async function cancelKisOrder(
  stockCode: string,
  ordNo: string,
  quantity: number,
): Promise<boolean> {
  if (!KIS_IS_REAL || !process.env.KIS_APP_KEY) return false;

  try {
    const cancelTrId = KIS_IS_REAL ? 'TTTC0803U' : 'VTTC0803U';
    await kisPost(cancelTrId, '/uapi/domestic-stock/v1/trading/order-rvsecncl', {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      KRX_FWDG_ORD_ORGNO: '',
      ORGN_ODNO: ordNo,
      ORD_DVSN: '00',
      RVSE_CNCL_DVSN_CD: '02',  // 02 = 취소
      ORD_QTY: quantity.toString(),
      ORD_UNPR: '0',
      QTY_ALL_ORD_YN: 'Y',
      PDNO: stockCode.padStart(6, '0'),
    });
    console.log(`[KIS] 주문 취소 완료: ${stockCode} ODNO=${ordNo}`);
    return true;
  } catch (err) {
    console.error(`[KIS] 주문 취소 실패 ODNO=${ordNo}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
