// @responsibility 텔레그램 강제 명령용 임시 FORCE_MARKET env 토글 SSOT — 장외 강제 스캔/워치리스트 수집
/**
 * forceMarketGuard.ts — 장외 강제 명령(`/scan_force`, `/refresh_watchlist`) 진입점
 *
 * 사용 패턴: `await withForcedMarket(async () => { ... })` 안에서 시장 게이트 우회 필요한
 * 작업을 실행. 진입 시 `process.env.DATA_FETCH_FORCE_MARKET='true'` 설정 → finally 블록에서
 * 원래 값(또는 미설정) 복구. 예외 발생해도 env 영구 오염 차단.
 *
 * 동시 실행 가드: 동일 시점에 두 명령이 겹치면 외부 명령이 먼저 unset 해서 내부 명령이
 * 도중에 게이트 차단 당할 수 있다. 호출자(텔레그램 명령 핸들러)가 60s rate-limit 으로
 * 인간 운영자 동시 호출을 차단하므로 본 모듈은 단순 try/finally 로 충분.
 *
 * Boundary:
 *   - marketClock.isMarketOpen / isMarketDataPublished 의 env override 와 정합
 *   - signalScanner / autoPopulateWatchlist 본체 무수정 — 호출자만 wrap
 */

const FORCE_KEY = 'DATA_FETCH_FORCE_MARKET';

/**
 * fn 실행 동안 FORCE_MARKET=true 강제 적용. 종료 시 원래 값 복구.
 *
 * @param fn 강제 시장 컨텍스트로 실행할 async 작업
 * @returns fn 의 반환값 (또는 throw)
 */
export async function withForcedMarket<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env[FORCE_KEY];
  process.env[FORCE_KEY] = 'true';
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env[FORCE_KEY];
    } else {
      process.env[FORCE_KEY] = prev;
    }
  }
}

/** 현재 FORCE_MARKET 활성 여부 — 진단용 read-only. */
export function isForcedMarketActive(): boolean {
  return process.env[FORCE_KEY] === 'true';
}
