/**
 * @responsibility KIS 주·실계좌 OAuth 토큰 단일 통로 — 캐시·single-flight·강제 갱신
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 토큰 라이프사이클 격리.
 * 두 토큰 캐시 (cachedToken / cachedRealDataToken) 와 invalidateKisToken 을 같은 모듈에
 * 두어 invalidate 가 둘 다 reset 하는 결합 보존.
 *
 * ADR-0147 — 디스크 영속 hydrate. 모듈 로드 시 `data/kis-tokens.json` 에서 캐시 hydrate
 * → 재부팅 시 23h TTL 안이면 OAuth2 호출 없이 재사용. 정기 cron (KST 08:30 / 20:30) 갱신
 * 후 디스크 영속 → 다음 재부팅도 신선. `KIS_TOKEN_PERSIST_DISABLED=true` ENV 시 영속 비활성
 * (legacy 동작 — 매 재부팅마다 OAuth2 호출).
 */

import { KIS_BASE, REAL_DATA_BASE, HAS_REAL_DATA_CLIENT } from './constants.js';
import {
  loadKisTokens,
  persistKisToken,
  clearKisTokens,
  type PersistedToken,
} from '../../persistence/kisTokenRepo.js';

function isPersistDisabled(): boolean {
  return process.env.KIS_TOKEN_PERSIST_DISABLED === 'true';
}

let cachedToken: { token: string; expiry: number } | null = null;
// Single-flight: 동시 토큰 갱신 요청을 하나로 합쳐 OAuth2 엔드포인트 중복 호출을 방지.
// 시장 스크리너·AI 분석이 병렬로 여러 KIS 호출을 날릴 때 캐시가 비어 있으면
// N개의 동시 `/oauth2/tokenP` 요청이 발생해 KIS가 남용으로 간주할 수 있다.
let inFlightMainTokenRefresh: Promise<string> | null = null;

let cachedRealDataToken: { token: string; expiry: number } | null = null;
let inFlightRealDataTokenRefresh: Promise<string> | null = null;

/**
 * 모듈 로드 시 1회 hydrate — 재부팅 시 디스크 영속 토큰을 메모리 캐시로 복원.
 * KIS_TOKEN_PERSIST_DISABLED=true ENV 시 skip.
 */
function hydrateFromDisk(): void {
  if (isPersistDisabled()) return;
  try {
    const bundle = loadKisTokens();
    if (bundle.main) {
      cachedToken = { token: bundle.main.token, expiry: bundle.main.expiry };
      console.log('[KIS] 토큰 hydrate (main) — 재부팅 시 OAuth2 호출 차단 (ADR-0147)');
    }
    if (bundle.realData) {
      cachedRealDataToken = { token: bundle.realData.token, expiry: bundle.realData.expiry };
      console.log('[KIS] 토큰 hydrate (realData) — 재부팅 시 OAuth2 호출 차단 (ADR-0147)');
    }
  } catch (e) {
    console.warn('[KIS] hydrate 실패 (cron 시점에 자동 갱신 예정):', e);
  }
}

// 모듈 초기 로드 시 1회 자동 hydrate
hydrateFromDisk();

/**
 * 갱신된 토큰을 디스크에 영속화. `KIS_TOKEN_PERSIST_DISABLED=true` 시 skip.
 * persist 실패는 비동기 / 비차단 — OAuth2 갱신 자체는 이미 성공.
 */
function persistTokenSafe(slot: 'main' | 'realData', token: string, expiry: number): void {
  if (isPersistDisabled()) return;
  const persisted: PersistedToken = {
    token,
    expiry,
    issuedAt: new Date().toISOString(),
  };
  try {
    persistKisToken(slot, persisted);
  } catch (e) {
    console.warn(`[KIS] 토큰 영속 실패 (${slot}, 메모리 캐시는 유효):`, e);
  }
}

/** 테스트 전용 — 메모리 캐시 강제 초기화 (디스크 영향 없음) */
export function __resetKisAuthCacheForTests(): void {
  cachedToken = null;
  cachedRealDataToken = null;
  inFlightMainTokenRefresh = null;
  inFlightRealDataTokenRefresh = null;
}

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

// ─── 토큰 관리 ──────────────────────────────────────────────────────────────

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
      const expiry = Date.now() + 23 * 60 * 60 * 1000;
      cachedToken = { token: data.access_token, expiry };
      persistTokenSafe('main', data.access_token, expiry);
      console.log('[KIS] 토큰 갱신 완료 (디스크 영속, ADR-0147)');
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
  // 디스크 영속도 함께 삭제 — 다음 호출 시 OAuth2 강제 재발급 (ADR-0147)
  if (!isPersistDisabled()) {
    try {
      clearKisTokens();
    } catch (e) {
      console.warn('[KIS] 디스크 토큰 삭제 실패 (메모리 캐시는 초기화됨):', e);
    }
  }
  console.log('[KIS] 토큰 캐시 + 디스크 영속 강제 초기화 (ADR-0147)');
}

// ─── 실계좌 데이터 전용 토큰 관리 ────────────────────────────────────────────

/** 실계좌 데이터 전용 토큰 갱신. 실계좌 키 미설정 시 에러 */
export async function refreshRealDataToken(): Promise<string> {
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
      const expiry = Date.now() + 23 * 60 * 60 * 1000;
      cachedRealDataToken = { token: data.access_token, expiry };
      persistTokenSafe('realData', data.access_token, expiry);
      console.log('[KIS-RealData] 실계좌 데이터 전용 토큰 갱신 완료 (디스크 영속, ADR-0147)');
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
  // 디스크 영속도 함께 삭제 — refreshKisToken/refreshRealDataToken 이 새 토큰으로 재영속 (ADR-0147)
  if (!isPersistDisabled()) {
    try {
      clearKisTokens();
    } catch (e) {
      console.warn('[KIS] 디스크 토큰 삭제 실패 (forceRefresh 진행):', e);
    }
  }

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
