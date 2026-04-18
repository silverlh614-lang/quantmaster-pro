/**
 * intradayYieldTicker.ts — Intraday Pipeline Yield Live (IPYL)
 *
 * qualityScorecard.ts는 장마감 1회만 돈다. 그 사이 장중 빈 스캔이 터져도 어느 단계가
 * 막혔는지 즉시 알 길이 없었다. 이 모듈은 30분마다 scanTracer + Stage1 캐시를 근거로
 * Discovery / Gate / Signal Yield를 계산해 런타임 캐시에 보관한다.
 *
 *   Discovery Yield = watchlistCount / universeScanned
 *   Gate Yield      = gatePassed / gateReached
 *   Signal Yield    = buyExecuted / gatePassed
 *
 * /api/health/pipeline 응답에 intradayYield 블록으로 merge되어 UI의 3개 막대(초록/노랑/
 * 빨강) 티커를 실시간으로 갱신한다. scanTracer가 이미 trace를 쌓고 있으므로 여기선
 * summarize 주기만 당기면 된다 — 장중 병목 식별 지연을 수 시간에서 30분 이내로 압축.
 */

import fs from 'fs';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { loadTodayScanTraces, summarizeScanTraces } from '../trading/scanTracer.js';
import { STAGE1_CACHE_FILE, ensureDataDir } from '../persistence/paths.js';

export interface IntradayYieldSnapshot {
  /** ISO — 스냅샷 생성 시각 */
  computedAt: string;
  /** %, 0~100 */
  discoveryYield: number;
  gateYield: number;
  signalYield: number;
  /** 각 단계별 분자/분모 원시값 (디버깅 표시용) */
  counts: {
    universeScanned: number;
    watchlistCount:  number;
    scanCandidates:  number;
    gateReached:     number;
    gatePassed:      number;
    buyExecuted:     number;
  };
  /** 상태 신호등 — UI 초록/노랑/빨강 매핑 */
  status: {
    discovery: 'green' | 'yellow' | 'red' | 'gray';
    gate:      'green' | 'yellow' | 'red' | 'gray';
    signal:    'green' | 'yellow' | 'red' | 'gray';
  };
}

// ── 런타임 캐시 ──────────────────────────────────────────────────────────────
let _snapshot: IntradayYieldSnapshot | null = null;

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

function pctSafe(num: number, denom: number): number {
  if (denom <= 0) return 0;
  return Math.round((num / denom) * 1000) / 10;
}

function classify(
  pct: number,
  numerator: number,
  thresholds: { green: number; yellow: number },
): 'green' | 'yellow' | 'red' | 'gray' {
  // 분자가 0이고 분모가 있으면 red. 둘 다 0이면 gray(아직 데이터 없음).
  if (numerator === 0 && pct === 0) return 'gray';
  if (pct >= thresholds.green)  return 'green';
  if (pct >= thresholds.yellow) return 'yellow';
  return 'red';
}

interface Stage1CacheData {
  cachedAt: string;
  candidates: Array<{ code: string; name: string }>;
}

function loadUniverseCount(): number {
  ensureDataDir();
  const defaultUniverse = parseInt(process.env.STOCK_UNIVERSE_SIZE ?? '220', 10);
  if (!fs.existsSync(STAGE1_CACHE_FILE)) return defaultUniverse;
  try {
    // stage1-cache 는 후보 수이지 유니버스 크기가 아니므로 env 기본값 유지.
    return defaultUniverse;
  } catch {
    return defaultUniverse;
  }
}

// ── 메인 계산 ────────────────────────────────────────────────────────────────

/**
 * 현재까지의 오늘치 scanTracer + 워치리스트 상태로 3단계 yield를 계산한다.
 * cron이 30분마다 호출하며, 수동 호출(/api/health/pipeline first-hit)에도 사용된다.
 */
export function computeIntradayYield(): IntradayYieldSnapshot {
  const universeScanned = loadUniverseCount();
  const watchlistCount  = loadWatchlist().length;

  const traces   = loadTodayScanTraces();
  const summary  = summarizeScanTraces(traces);

  const scanCandidates = summary.totalCandidates;
  const gateReached    = scanCandidates - summary.yahooFail;
  const gatePassed     = Math.max(0, gateReached - summary.gateFail);
  const buyExecuted    = summary.buyExecuted;

  const discoveryYield = pctSafe(watchlistCount, universeScanned);
  const gateYield      = pctSafe(gatePassed,     gateReached);
  const signalYield    = pctSafe(buyExecuted,    gatePassed);

  const snapshot: IntradayYieldSnapshot = {
    computedAt: new Date().toISOString(),
    discoveryYield,
    gateYield,
    signalYield,
    counts: { universeScanned, watchlistCount, scanCandidates, gateReached, gatePassed, buyExecuted },
    status: {
      discovery: classify(discoveryYield, watchlistCount, { green: 10, yellow: 3 }),
      gate:      classify(gateYield,      gatePassed,     { green: 30, yellow: 10 }),
      signal:    classify(signalYield,    buyExecuted,    { green: 20, yellow: 5 }),
    },
  };

  _snapshot = snapshot;
  return snapshot;
}

/**
 * 캐시된 스냅샷 반환. 없으면 즉시 계산한다.
 * /api/health/pipeline에서 사용.
 */
export function getCachedIntradayYield(): IntradayYieldSnapshot {
  if (_snapshot) return _snapshot;
  return computeIntradayYield();
}

/**
 * 스케줄러가 호출하는 주기 tick. 캐시 갱신 + 로그 1줄.
 */
export function tickIntradayYield(): void {
  const s = computeIntradayYield();
  console.log(
    `[IPYL] Discovery ${s.discoveryYield}% (${s.status.discovery}) | ` +
    `Gate ${s.gateYield}% (${s.status.gate}) | ` +
    `Signal ${s.signalYield}% (${s.status.signal})`,
  );
}

/** 테스트·진단용. */
export function resetIntradayYieldCache(): void {
  _snapshot = null;
}
