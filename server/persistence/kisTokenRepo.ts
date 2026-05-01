/**
 * @responsibility KIS OAuth2 토큰 디스크 영속 SSOT — 재부팅 시 hydrate, 만료 자동 청소
 *
 * ADR-0147 — 재부팅 시 토큰 갱신 차단 정책. 부팅 시 무조건 `forceRefreshKisTokens()`
 * 호출하던 결함 (server/index.ts:427-430) 을 제거하고, 디스크 영속 토큰을 hydrate
 * 하는 정책으로 전환.
 *
 * 영속 파일: `data/kis-tokens.json` (DATA_DIR 안). `.gitignore` 등재 — 비밀 누출 차단.
 *
 * 호출자: server/clients/kisClient/auth.ts 단일 (절대 규칙 #2 kisClient 단일 통로).
 *
 * Atomic write (tmp → rename) — race 차단. 손상 JSON / 만료된 토큰 자동 fallback.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, chmodSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { KIS_TOKEN_FILE } from './paths.js';

export interface PersistedToken {
  /** OAuth2 access_token */
  token: string;
  /** epoch ms — 캐시 만료 시각 (TTL 23h 기준) */
  expiry: number;
  /** ISO 갱신 시각 (진단용) */
  issuedAt: string;
}

export interface PersistedTokenBundle {
  /** 주 토큰 (KIS_APP_KEY) — 주문/잔고 */
  main?: PersistedToken;
  /** 실계좌 데이터 토큰 (KIS_REAL_DATA_APP_KEY) — 시장 데이터 */
  realData?: PersistedToken;
  schemaVersion: 1;
}

const EMPTY_BUNDLE: PersistedTokenBundle = { schemaVersion: 1 };

/* ───────── 내부 헬퍼 ───────── */

function isValidPersistedToken(v: unknown): v is PersistedToken {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.token === 'string' &&
    o.token.length > 0 &&
    typeof o.expiry === 'number' &&
    Number.isFinite(o.expiry) &&
    typeof o.issuedAt === 'string'
  );
}

function isFresh(token: PersistedToken | undefined, now: number): token is PersistedToken {
  if (!token) return false;
  return now < token.expiry;
}

/* ───────── public API ───────── */

/**
 * 디스크에서 토큰 번들 로드. 파일 부재 / 손상 / schemaVersion 불일치 시 빈 번들 반환.
 *
 * 만료된 토큰은 자동 제거 (now 시점 vs expiry 비교).
 */
export function loadKisTokens(now: number = Date.now()): PersistedTokenBundle {
  if (!existsSync(KIS_TOKEN_FILE)) return EMPTY_BUNDLE;

  let raw: string;
  try {
    raw = readFileSync(KIS_TOKEN_FILE, 'utf-8');
  } catch {
    return EMPTY_BUNDLE;
  }

  if (!raw || raw.trim().length === 0) return EMPTY_BUNDLE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[kisTokenRepo] 손상된 토큰 파일 — 빈 번들 fallback');
    return EMPTY_BUNDLE;
  }

  if (!parsed || typeof parsed !== 'object') return EMPTY_BUNDLE;
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== 1) return EMPTY_BUNDLE;

  const main = isValidPersistedToken(obj.main) && isFresh(obj.main, now) ? obj.main : undefined;
  const realData =
    isValidPersistedToken(obj.realData) && isFresh(obj.realData, now) ? obj.realData : undefined;

  return { schemaVersion: 1, main, realData };
}

/**
 * 토큰 번들 디스크 저장. atomic write (tmp → rename).
 *
 * 비밀 누출 방지를 위해 파일 권한 0o600 명시 (best-effort, 일부 OS 무시).
 */
export function saveKisTokens(bundle: PersistedTokenBundle): void {
  const dir = dirname(KIS_TOKEN_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmp = `${KIS_TOKEN_FILE}.tmp`;
  const json = JSON.stringify({ ...bundle, schemaVersion: 1 }, null, 2);
  writeFileSync(tmp, json, { encoding: 'utf-8' });

  // best-effort: 토큰 파일 권한 0o600 (소유자 읽기/쓰기 only)
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // 일부 OS / 컨테이너 환경에서 chmod 무시 가능 — 영속화는 진행
  }

  renameSync(tmp, KIS_TOKEN_FILE);
}

/**
 * 단일 토큰 슬롯 갱신 (main 또는 realData) — 다른 슬롯 보존.
 */
export function persistKisToken(slot: 'main' | 'realData', token: PersistedToken): void {
  const current = loadKisTokens();
  const next: PersistedTokenBundle = {
    schemaVersion: 1,
    main: slot === 'main' ? token : current.main,
    realData: slot === 'realData' ? token : current.realData,
  };
  saveKisTokens(next);
}

/**
 * 토큰 파일 삭제 — 강제 invalidate 시.
 * 부재 시 silent skip.
 */
export function clearKisTokens(): void {
  if (existsSync(KIS_TOKEN_FILE)) {
    try {
      unlinkSync(KIS_TOKEN_FILE);
    } catch (e) {
      console.warn('[kisTokenRepo] 토큰 파일 삭제 실패:', e);
    }
  }
}

/**
 * 만료까지 남은 시간 (시간 단위). 부재 시 0.
 * 진단 / `/health` 표시용.
 */
export function getPersistedTokenRemainingHours(slot: 'main' | 'realData', now: number = Date.now()): number {
  const bundle = loadKisTokens(now);
  const token = slot === 'main' ? bundle.main : bundle.realData;
  if (!token) return 0;
  return Math.floor((token.expiry - now) / 1000 / 60 / 60);
}
