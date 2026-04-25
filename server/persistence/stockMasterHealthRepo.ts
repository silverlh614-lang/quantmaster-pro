/**
 * @responsibility 종목 마스터 소스별 health score (0-100) 영속 + rolling stats (ADR-0013)
 *
 * 운영자 가시성을 위한 SSOT. multiSourceStockMaster 가 source 별 시도/성공/실패를
 * 본 모듈에 기록하고, 텔레그램 /master 명령(후속 PR) 이 이 데이터를 그대로 표시.
 * 자동매매·AI 추천 진입점에는 영향 없음.
 */

import fs from 'fs';
import { STOCK_MASTER_HEALTH_FILE, ensureDataDir } from './paths.js';

export type StockMasterSource = 'KRX_CSV' | 'NAVER_LIST' | 'SHADOW_DB' | 'STATIC_SEED';

export interface SourceRunRecord {
  ts: number;
  ok: boolean;
  count?: number;
  reason?: string;
}

export interface SourceHealthState {
  source: StockMasterSource;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  lastCount: number;
  recentRuns: SourceRunRecord[];
}

export interface HealthStore {
  byCases: Record<StockMasterSource, SourceHealthState>;
  updatedAt: number;
}

const RECENT_RUNS_MAX = 20;
const STALE_SUCCESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

const SOURCES: StockMasterSource[] = ['KRX_CSV', 'NAVER_LIST', 'SHADOW_DB', 'STATIC_SEED'];

function emptyState(source: StockMasterSource): SourceHealthState {
  return {
    source,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    lastCount: 0,
    recentRuns: [],
  };
}

function emptyStore(): HealthStore {
  return {
    byCases: {
      KRX_CSV: emptyState('KRX_CSV'),
      NAVER_LIST: emptyState('NAVER_LIST'),
      SHADOW_DB: emptyState('SHADOW_DB'),
      STATIC_SEED: emptyState('STATIC_SEED'),
    },
    updatedAt: 0,
  };
}

let _store: HealthStore | null = null;

function loadFromDisk(): HealthStore {
  ensureDataDir();
  if (!fs.existsSync(STOCK_MASTER_HEALTH_FILE)) return emptyStore();
  try {
    const raw = fs.readFileSync(STOCK_MASTER_HEALTH_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HealthStore>;
    const store = emptyStore();
    if (parsed.byCases) {
      for (const src of SOURCES) {
        const incoming = (parsed.byCases as Record<string, SourceHealthState | undefined>)[src];
        if (incoming && typeof incoming === 'object') {
          store.byCases[src] = {
            source: src,
            successCount: Number(incoming.successCount) || 0,
            failureCount: Number(incoming.failureCount) || 0,
            consecutiveFailures: Number(incoming.consecutiveFailures) || 0,
            lastSuccessAt: typeof incoming.lastSuccessAt === 'number' ? incoming.lastSuccessAt : null,
            lastFailureAt: typeof incoming.lastFailureAt === 'number' ? incoming.lastFailureAt : null,
            lastFailureReason: typeof incoming.lastFailureReason === 'string' ? incoming.lastFailureReason : null,
            lastCount: Number(incoming.lastCount) || 0,
            recentRuns: Array.isArray(incoming.recentRuns) ? incoming.recentRuns.slice(-RECENT_RUNS_MAX) : [],
          };
        }
      }
    }
    store.updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0;
    return store;
  } catch (e) {
    console.warn('[StockMasterHealth] 디스크 로드 실패:', e instanceof Error ? e.message : e);
    return emptyStore();
  }
}

function saveToDisk(store: HealthStore): void {
  ensureDataDir();
  try {
    fs.writeFileSync(STOCK_MASTER_HEALTH_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.warn('[StockMasterHealth] 디스크 저장 실패:', e instanceof Error ? e.message : e);
  }
}

function getStore(): HealthStore {
  if (!_store) _store = loadFromDisk();
  return _store;
}

export function recordRun(
  source: StockMasterSource,
  result: { ok: boolean; count?: number; reason?: string },
  now: number = Date.now(),
): SourceHealthState {
  const store = getStore();
  const state = store.byCases[source];
  state.recentRuns.push({
    ts: now,
    ok: result.ok,
    count: result.count,
    reason: result.reason,
  });
  if (state.recentRuns.length > RECENT_RUNS_MAX) {
    state.recentRuns = state.recentRuns.slice(-RECENT_RUNS_MAX);
  }
  if (result.ok) {
    state.successCount++;
    state.consecutiveFailures = 0;
    state.lastSuccessAt = now;
    state.lastCount = result.count ?? state.lastCount;
  } else {
    state.failureCount++;
    state.consecutiveFailures++;
    state.lastFailureAt = now;
    state.lastFailureReason = result.reason ?? null;
  }
  store.updatedAt = now;
  saveToDisk(store);
  return state;
}

/**
 * Health score (0-100) 계산.
 * - Boot 직후(데이터 없음): 50 (UNKNOWN)
 * - consecutiveFailures × 5 점 차감 (최대 50)
 * - lastSuccess 가 7일 초과 stale: -30
 * - 최근 20건 실패율 > 50%: -20
 * - 한 번도 성공 없음: -20 (단, 시도 1회 이상)
 */
export function computeHealthScore(state: SourceHealthState, now: number = Date.now()): number {
  const totalRuns = state.successCount + state.failureCount;
  if (totalRuns === 0) return 50;

  let score = 100;
  score -= Math.min(50, state.consecutiveFailures * 5);

  if (state.lastSuccessAt === null) {
    score -= 20;
  } else if (now - state.lastSuccessAt > STALE_SUCCESS_THRESHOLD_MS) {
    score -= 30;
  }

  const recentFailures = state.recentRuns.filter((r) => !r.ok).length;
  if (state.recentRuns.length >= 4 && recentFailures / state.recentRuns.length > 0.5) {
    score -= 20;
  }

  return Math.max(0, Math.min(100, score));
}

export interface HealthSnapshot {
  source: StockMasterSource;
  score: number;
  state: SourceHealthState;
}

export function getHealthSnapshot(now: number = Date.now()): HealthSnapshot[] {
  const store = getStore();
  return SOURCES.map((src) => ({
    source: src,
    score: computeHealthScore(store.byCases[src], now),
    state: store.byCases[src],
  }));
}

export function getSourceHealth(source: StockMasterSource, now: number = Date.now()): HealthSnapshot {
  const state = getStore().byCases[source];
  return { source, score: computeHealthScore(state, now), state };
}

/**
 * 전체 health 의 가중 평균 — 운영자가 한 줄 요약을 보고 싶을 때.
 * KRX 가 primary 이므로 가중치 50%, Naver 30%, Shadow 15%, Seed 5%.
 */
export function computeOverallHealth(now: number = Date.now()): number {
  const weights: Record<StockMasterSource, number> = {
    KRX_CSV: 0.5,
    NAVER_LIST: 0.3,
    SHADOW_DB: 0.15,
    STATIC_SEED: 0.05,
  };
  const store = getStore();
  let weighted = 0;
  let totalW = 0;
  for (const src of SOURCES) {
    const w = weights[src];
    weighted += w * computeHealthScore(store.byCases[src], now);
    totalW += w;
  }
  return Math.round(weighted / totalW);
}

export const __testOnly = {
  reset(): void {
    _store = null;
    try { fs.unlinkSync(STOCK_MASTER_HEALTH_FILE); } catch { /* not present */ }
  },
  STALE_SUCCESS_THRESHOLD_MS,
  RECENT_RUNS_MAX,
};
