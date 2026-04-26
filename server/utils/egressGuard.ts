/**
 * @responsibility outbound HTTP 를 심볼별 시장 게이트로 차단하는 단일 관문
 *
 * Express 미들웨어는 HTTP 진입점만 커버하지만, 서버 내부에서 `fetch()` 를 직접
 * 호출하는 경로는 게이트를 우회한다. 본 모듈은 그 "최종 관문" 이다. 등록된 host
 * 패턴 에 대해 URL 에서 심볼을 추출하고 `isMarketOpenFor()` 로 판정, 시장이 닫혀
 * 있으면 504 synthetic Response 를 반환해 outbound 를 차단한다.
 *
 * 특징:
 *   - `fetch()` 와 동일한 signature — 기존 호출자는 이름만 바꿔도 된다.
 *   - 미등록 host(KIS/KRX/ECOS 등) 는 pass-through — 기존 경로 무영향.
 *   - EGRESS_GUARD_DISABLED=true — 긴급 롤백 스위치.
 *
 * 범위 out:
 *   - KRX/ECOS 같은 "심볼 파라미터 없는" 호출은 본 모듈 범위 밖 (resolveTradeDate +
 *     marketClock 이 이미 처리). 본 모듈은 심볼 중심 (Yahoo) 우선.
 */

import { classifySymbol, isMarketOpenFor, type MarketId } from './symbolMarketRegistry.js';

interface HostRule {
  /** host 매칭 정규식 — `url.host` 기준 */
  readonly pattern: RegExp;
  /** URL 에서 심볼 추출 — 반환 null 시 게이트 우회 (pass) */
  readonly extract: (url: URL) => string | null;
}

const YAHOO_CHART = /\/v[78]\/finance\/chart\/([^/?]+)/;
const YAHOO_QUOTE_SUMMARY = /\/v\d+\/finance\/quoteSummary\/([^/?]+)/;

function extractYahooSymbol(url: URL): string | null {
  const chart = url.pathname.match(YAHOO_CHART);
  if (chart) return safeDecode(chart[1]);
  const quote = url.pathname.match(YAHOO_QUOTE_SUMMARY);
  if (quote) return safeDecode(quote[1]);
  return null;
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

const HOST_RULES: ReadonlyArray<HostRule> = [
  // Yahoo Finance — query1/query2/finance 서브도메인
  { pattern: /^query[12]\.finance\.yahoo\.com$/, extract: extractYahooSymbol },
  { pattern: /(^|\.)finance\.yahoo\.com$/,       extract: extractYahooSymbol },
];

export interface EgressDecision {
  readonly action: 'pass' | 'skip';
  readonly symbol?: string;
  readonly market?: MarketId;
  readonly reason?: string;
}

/**
 * 호출자 의도 — EgressGuard 가 의도별 결정 매트릭스를 적용한다.
 *
 *   REALTIME   = 지금 시점 라이브 시세 (정규장만 통과) — PR-29 동작 = 본 타입 기본값
 *   HISTORICAL = T-1 이상 일봉/시계열 (시간대 무관 모든 시간 통과)
 *   OVERNIGHT  = 새벽 글로벌 스캔 (REALTIME + NYSE 애프터마켓 추가 통과)
 *
 * 결정 매트릭스 SSOT: ADR-0056 §Decision Matrix
 */
export type EgressIntent = 'REALTIME' | 'HISTORICAL' | 'OVERNIGHT';

// NYSE 애프터마켓 윈도우 — EST 16:00~20:00 (정규장 종료 직후 4시간)
// `symbolMarketRegistry.MARKETS.NYSE.tzOffsetHours` 는 EST 고정 (-5).
// EDT 기간엔 ±1h 수용 오차로 대응 (REALTIME 정규장도 동일 정책, ADR-0056 §Decision).
const NYSE_TZ_OFFSET_HOURS = -5;
const NYSE_AFTERHOURS_OPEN_MIN = 16 * 60;
const NYSE_AFTERHOURS_CLOSE_MIN = 20 * 60;

function isNyseAfterHours(now: Date): boolean {
  if (process.env.DATA_FETCH_FORCE_OFF === 'true') return false;
  if (process.env.DATA_FETCH_FORCE_MARKET === 'true') return true;
  const shifted = new Date(now.getTime() + NYSE_TZ_OFFSET_HOURS * 3_600_000);
  const day = shifted.getUTCDay();
  if (day < 1 || day > 5) return false; // 평일만
  const mins = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return mins >= NYSE_AFTERHOURS_OPEN_MIN && mins < NYSE_AFTERHOURS_CLOSE_MIN;
}

/** 순수 함수 — URL + 의도 + 현재 시각 → egress 판정. 단위 테스트가 공유. */
export function evaluateEgress(
  urlLike: string | URL,
  intent: EgressIntent = 'REALTIME',
  now: Date = new Date(),
): EgressDecision {
  let u: URL;
  try {
    u = typeof urlLike === 'string' ? new URL(urlLike) : urlLike;
  } catch {
    return { action: 'pass' }; // 잘못된 URL 은 게이트 대상 아님 — 원 fetch 가 에러 처리
  }
  for (const rule of HOST_RULES) {
    if (!rule.pattern.test(u.host)) continue;
    const symbol = rule.extract(u);
    if (!symbol) return { action: 'pass' };
    const market = classifySymbol(symbol);

    // 정규장 통과 — 모든 의도 동일
    if (isMarketOpenFor(symbol, now)) return { action: 'pass', symbol, market };

    // 정규장 외 — 의도별 추가 통과 결정
    if (intent === 'HISTORICAL') {
      return { action: 'pass', symbol, market, reason: 'historical bypass' };
    }
    if (intent === 'OVERNIGHT' && market === 'NYSE' && isNyseAfterHours(now)) {
      return { action: 'pass', symbol, market, reason: 'nyse afterhours' };
    }
    return { action: 'skip', symbol, market, reason: `${market} closed` };
  }
  return { action: 'pass' };
}

function createGatedResponse(decision: EgressDecision): Response {
  const body = JSON.stringify({
    gated: true,
    symbol: decision.symbol ?? null,
    market: decision.market ?? null,
    reason: decision.reason ?? 'market closed',
  });
  return new Response(body, {
    status: 503,
    statusText: 'Egress Gated',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Egress-Guard': 'market-closed',
    },
  });
}

// 테스트용 fetch 주입 — 실제 네트워크 없이 pass-through 분기 검증
let _fetchImpl: typeof globalThis.fetch = ((...args: Parameters<typeof globalThis.fetch>) =>
  globalThis.fetch(...args)) as typeof globalThis.fetch;
export function __setFetchImplForTests(f: typeof globalThis.fetch): void { _fetchImpl = f; }
export function __resetFetchImplForTests(): void {
  _fetchImpl = ((...args: Parameters<typeof globalThis.fetch>) =>
    globalThis.fetch(...args)) as typeof globalThis.fetch;
}

/**
 * `fetch()` 대체 — 게이트 시 503 synthetic Response, 통과 시 native fetch 위임.
 * 기존 `if (!res.ok) return null` 패턴이 자연스럽게 null 폴백으로 흡수한다.
 */
export async function guardedFetch(
  input: string | URL,
  init?: RequestInit,
  intent: EgressIntent = 'REALTIME',
): Promise<Response> {
  if (process.env.EGRESS_GUARD_DISABLED === 'true') return _fetchImpl(input as string, init);
  const decision = evaluateEgress(
    typeof input === 'string' ? input : input.toString(),
    intent,
  );
  if (decision.action === 'skip') {
    // 1분 throttle 로 과다 로그 억제 (상징만 표시, 본체는 낮은 로그 레벨)
    _logThrottled(decision);
    return createGatedResponse(decision);
  }
  return _fetchImpl(input as string, init);
}

// 2026-04-25: 1분 throttle 은 5분 cron 에 의해 매 호출 통과되어 5분마다 로그가
// 찍히던 문제 해소. 30분 으로 확대 — 같은 (market,symbol) 의 반복 차단은 30분에
// 한 번만 표면화한다 (운영 신호로는 충분).
const _LOG_INTERVAL_MS = 30 * 60_000;
const _lastLogAt = new Map<string, number>();
function _logThrottled(decision: EgressDecision): void {
  const key = `${decision.market ?? '?'}:${decision.symbol ?? '?'}`;
  const now = Date.now();
  const prev = _lastLogAt.get(key) ?? 0;
  if (now - prev < _LOG_INTERVAL_MS) return;
  _lastLogAt.set(key, now);
  console.debug(`[EgressGuard] skip ${key} — ${decision.reason}`);
}

export function __resetLogThrottleForTests(): void { _lastLogAt.clear(); }
