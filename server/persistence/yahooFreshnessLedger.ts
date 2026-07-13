// @responsibility 종목별 Yahoo 시세 갱신 신뢰도 영속 ledger (ADR-0255)
/**
 * yahooFreshnessLedger.ts — 종목별 Yahoo dataQuality 추적 SSOT.
 *
 * 사용자 5/6 보고: 코스닥 일부 바이오 종목 (예: 298060 SCM라이프사이언스)
 * Yahoo 갱신 지연이 만성적. 종목별 신뢰도 영속하여 (1) 운영자 진단
 * (/health_full ADR-0258 후속) + (2) 향후 ADR-0253 KIS 시계열 자동 합성
 * 라우팅 입력 마련.
 *
 * 본 PR: 추적 + 진단 API 만 (자동 라우팅 X). 호출자 (yahooSymbolResolver)
 * 가 fetch 결과마다 updateYahooFreshness 호출 → ledger 갱신.
 *
 * 신뢰도 분류 (ADR-0255 §3):
 *   - TRUSTED: consecutiveStaleCount 0 — 정상
 *   - DEGRADED: consecutiveStaleCount 2~4 — 가끔 stale (KIS 보완 권장)
 *   - UNRELIABLE: consecutiveStaleCount ≥ 5 — 빈번 stale (KIS-first 후보)
 *
 * 영속: atomic write tmp→rename + 손상 JSON 빈 객체 fallback + ENV 우회.
 */

import fs from 'fs';
import { YAHOO_FRESHNESS_LEDGER_FILE, ensureDataDir } from './paths.js';
import type { YahooQuoteExtended } from '../screener/adapters/yahooQuoteAdapter.js';

type YahooFreshnessReliability = 'TRUSTED' | 'DEGRADED' | 'UNRELIABLE';

interface YahooFreshnessRecord {
  code: string;
  symbol: string;
  lastFreshAt: string | null;        // 마지막으로 dataQuality='OK' 였던 시각 (ISO)
  consecutiveStaleCount: number;     // 연속 stale 카운터
  totalStaleCount: number;           // 누적 stale 횟수 (rolling 30회 카운트)
  totalFetchCount: number;           // 누적 fetch 횟수 (rolling 30회 카운트)
  reliability: YahooFreshnessReliability;
  updatedAt: string;                  // 마지막 갱신 시각 (ISO)
}

interface YahooFreshnessStore {
  schemaVersion: 1;
  records: Record<string, YahooFreshnessRecord>;
}

const ROLLING_WINDOW_SAMPLES = 30;
const DEGRADED_THRESHOLD = 2;
const UNRELIABLE_THRESHOLD = 5;

function isLedgerDisabled(): boolean {
  return process.env.YAHOO_FRESHNESS_LEDGER_DISABLED === 'true';
}

let _store: YahooFreshnessStore | null = null;

function loadStore(): YahooFreshnessStore {
  if (_store) return _store;
  ensureDataDir();
  if (!fs.existsSync(YAHOO_FRESHNESS_LEDGER_FILE)) {
    _store = { schemaVersion: 1, records: {} };
    return _store;
  }
  try {
    const raw = fs.readFileSync(YAHOO_FRESHNESS_LEDGER_FILE, 'utf8');
    const parsed = JSON.parse(raw) as YahooFreshnessStore;
    if (!parsed || typeof parsed !== 'object' || !parsed.records) {
      _store = { schemaVersion: 1, records: {} };
      return _store;
    }
    _store = parsed;
    return _store;
  } catch {
    _store = { schemaVersion: 1, records: {} };
    return _store;
  }
}

function persistStore(store: YahooFreshnessStore): void {
  ensureDataDir();
  const tmp = `${YAHOO_FRESHNESS_LEDGER_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, YAHOO_FRESHNESS_LEDGER_FILE);
}

function classifyReliability(consecutiveStaleCount: number): YahooFreshnessReliability {
  if (consecutiveStaleCount >= UNRELIABLE_THRESHOLD) return 'UNRELIABLE';
  if (consecutiveStaleCount >= DEGRADED_THRESHOLD) return 'DEGRADED';
  return 'TRUSTED';
}

/**
 * Yahoo fetch 결과를 ledger 에 반영.
 *
 * - quote=null 또는 dataQuality='STALE_BASE' → consecutiveStaleCount++
 * - quote.dataQuality='OK' → consecutiveStaleCount=0 + lastFreshAt 갱신
 *
 * ENV `YAHOO_FRESHNESS_LEDGER_DISABLED=true` 시 no-op.
 */
export function updateYahooFreshness(
  code: string,
  symbol: string,
  quote: YahooQuoteExtended | null,
  now: Date = new Date(),
): void {
  if (isLedgerDisabled()) return;

  const store = loadStore();
  const existing = store.records[code];
  const record: YahooFreshnessRecord = existing ?? {
    code,
    symbol,
    lastFreshAt: null,
    consecutiveStaleCount: 0,
    totalStaleCount: 0,
    totalFetchCount: 0,
    reliability: 'TRUSTED',
    updatedAt: now.toISOString(),
  };

  // Rolling 30 sample 카운터 (totalFetchCount 가 30 도달 시 비례 감쇠).
  if (record.totalFetchCount >= ROLLING_WINDOW_SAMPLES) {
    record.totalStaleCount = Math.floor(record.totalStaleCount * 0.9);
    record.totalFetchCount = Math.floor(record.totalFetchCount * 0.9);
  }
  record.totalFetchCount += 1;

  const isFresh = quote !== null && quote.dataQuality === 'OK';
  if (isFresh) {
    record.consecutiveStaleCount = 0;
    record.lastFreshAt = now.toISOString();
  } else {
    record.consecutiveStaleCount += 1;
    record.totalStaleCount += 1;
  }

  record.reliability = classifyReliability(record.consecutiveStaleCount);
  record.symbol = symbol; // 최근 사용 symbol 갱신
  record.updatedAt = now.toISOString();

  store.records[code] = record;
  try {
    persistStore(store);
  } catch (e) {
    console.warn(`[yahooFreshnessLedger] persist 실패 (code=${code}):`, e);
  }
}

/** 진단 — 신뢰도 분포 요약 (예: /health_full 응답). */
export function summarizeFreshnessLedger(): {
  totalCodes: number;
  trusted: number;
  degraded: number;
  unreliable: number;
  unreliableSymbols: string[];
} {
  const store = loadStore();
  let trusted = 0;
  let degraded = 0;
  let unreliable = 0;
  const unreliableSymbols: string[] = [];
  for (const r of Object.values(store.records)) {
    if (r.reliability === 'TRUSTED') trusted += 1;
    else if (r.reliability === 'DEGRADED') degraded += 1;
    else {
      unreliable += 1;
      unreliableSymbols.push(`${r.code} (${r.symbol})`);
    }
  }
  return {
    totalCodes: trusted + degraded + unreliable,
    trusted,
    degraded,
    unreliable,
    unreliableSymbols: unreliableSymbols.sort(),
  };
}
