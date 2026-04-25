/**
 * @responsibility 종목 마스터 4-tier fallback orchestrator + 검증 + 경보 (ADR-0013)
 *
 * AI 추천 universe 발굴이 본 모듈을 통해서만 종목 마스터를 갱신하도록 보장한다.
 * Tier 1 KRX → Tier 2 Naver → Tier 3 Shadow → Tier 4 Seed. 각 시도 결과는
 * stockMasterHealthRepo 에 기록되어 운영자가 source 별 신뢰도를 추적할 수 있다.
 */

import {
  setStockMaster,
  getMasterSize,
  fetchKrxMasterEntries,
  validateMasterPayload,
  type StockMasterEntry,
} from '../persistence/krxStockMasterRepo.js';
import {
  recordRun,
  getSourceHealth,
  getHealthSnapshot,
  computeOverallHealth,
  type StockMasterSource,
} from '../persistence/stockMasterHealthRepo.js';
import {
  loadShadowMaster,
  updateShadowMaster,
} from '../persistence/shadowMasterDb.js';
import { fetchNaverMarketLeaders } from '../clients/naverStockListClient.js';
import { getStockMasterSeed } from '../data/stockMasterSeed.js';
import { isKstWeekend } from '../utils/marketClock.js';

/** 검증 임계 — KRX 가 정상이면 ~2,700 이지만 Naver 폴백은 ~400 까지만 가능. */
const KRX_MIN_VALID_ENTRIES = 2000;
const NAVER_MIN_VALID_ENTRIES = 200;
const SEED_MIN_ACCEPTABLE = 50;

/** 텔레그램 경보 hook — server/index.ts 에서 부팅 시 등록. */
export type MasterAlertHook = (level: 'WARN' | 'CRITICAL', message: string, dedupeKey: string) => void;
let _alertHook: MasterAlertHook | null = null;
export function setMasterAlertHook(hook: MasterAlertHook | null): void {
  _alertHook = hook;
}

function alert(level: 'WARN' | 'CRITICAL', message: string, dedupeKey: string): void {
  if (_alertHook) {
    try { _alertHook(level, message, dedupeKey); } catch { /* hook 실패는 silent */ }
  }
}

export type MasterRefreshOutcome =
  | { source: StockMasterSource; ok: true; count: number; usedFallback: boolean }
  | { source: 'NONE'; ok: false; reason: string };

export interface MultiSourceRefreshResult {
  finalSource: StockMasterSource | 'NONE';
  finalCount: number;
  usedFallback: boolean;
  attempts: Array<{
    source: StockMasterSource;
    ok: boolean;
    count: number;
    reason?: string;
  }>;
}

interface TierResult {
  ok: boolean;
  entries: StockMasterEntry[];
  reason?: string;
}

async function tryKrx(): Promise<TierResult> {
  const r = await fetchKrxMasterEntries();
  if (!r.ok) {
    return { ok: false, entries: [], reason: r.reason ?? 'UNKNOWN' };
  }
  const v = validateMasterPayload(r.entries, KRX_MIN_VALID_ENTRIES);
  if (!v.valid) {
    return { ok: false, entries: [], reason: `VALIDATION_${v.reason}_${v.detail ?? ''}` };
  }
  return { ok: true, entries: r.entries };
}

async function tryNaver(): Promise<TierResult> {
  try {
    const entries = await fetchNaverMarketLeaders();
    if (entries.length === 0) {
      return { ok: false, entries: [], reason: 'EMPTY' };
    }
    // Naver 는 시총 상위 ~400 만 — KRX 보다 낮은 임계 적용.
    const v = validateMasterPayload(entries, NAVER_MIN_VALID_ENTRIES);
    if (!v.valid) {
      return { ok: false, entries: [], reason: `VALIDATION_${v.reason}_${v.detail ?? ''}` };
    }
    return { ok: true, entries };
  } catch (e) {
    return { ok: false, entries: [], reason: e instanceof Error ? e.message : String(e) };
  }
}

function tryShadow(): TierResult {
  const snap = loadShadowMaster();
  if (!snap || snap.entries.length === 0) {
    return { ok: false, entries: [], reason: 'NO_SHADOW' };
  }
  return { ok: true, entries: snap.entries };
}

function trySeed(): TierResult {
  const entries = getStockMasterSeed();
  if (entries.length < SEED_MIN_ACCEPTABLE) {
    return { ok: false, entries: [], reason: `SEED_TOO_SMALL_${entries.length}` };
  }
  return { ok: true, entries };
}

/**
 * 4-tier fallback 으로 마스터 갱신.
 *
 * 동작:
 * 1. KRX 시도 → 검증 통과 시 active + shadow 모두 갱신, 종료.
 * 2. KRX 실패/미검증 시 Naver 시도 → 통과 시 active + shadow 갱신, 종료.
 * 3. Naver 실패 시 Shadow 적용 → active 만 갱신 (shadow 자체는 갱신 X).
 * 4. Shadow 부재 시 Seed 적용 → active 만 갱신.
 *
 * @param options.skipNaver Naver tier 건너뜀 (테스트·진단용)
 * @param options.skipKrx   KRX tier 건너뜀 (테스트·진단용)
 */
export async function refreshMultiSourceMaster(
  options: { skipKrx?: boolean; skipNaver?: boolean } = {},
): Promise<MultiSourceRefreshResult> {
  const attempts: MultiSourceRefreshResult['attempts'] = [];
  let final: { source: StockMasterSource; entries: StockMasterEntry[] } | null = null;
  let usedFallback = false;

  // Tier 1 — KRX
  if (!options.skipKrx) {
    if (isKstWeekend()) {
      attempts.push({ source: 'KRX_CSV', ok: false, count: 0, reason: 'WEEKEND' });
      // 주말은 일반 폴백 흐름이 아닌 disk-cache 보존 동작 — health 에는 silent (debug only).
    } else {
      const r = await tryKrx();
      attempts.push({ source: 'KRX_CSV', ok: r.ok, count: r.entries.length, reason: r.reason });
      recordRun('KRX_CSV', { ok: r.ok, count: r.entries.length, reason: r.reason });
      if (r.ok) {
        final = { source: 'KRX_CSV', entries: r.entries };
      } else if (consecutiveKrxFailures() >= 3) {
        const today = new Date().toISOString().slice(0, 10);
        alert(
          'CRITICAL',
          `KRX 종목 마스터 3회 연속 실패 — 최근 reason=${r.reason}. Naver/Shadow/Seed 폴백 사용 중.`,
          `master_source_alert:KRX_CSV:${today}`,
        );
      }
    }
  }

  // Tier 2 — Naver
  if (!final && !options.skipNaver) {
    const r = await tryNaver();
    attempts.push({ source: 'NAVER_LIST', ok: r.ok, count: r.entries.length, reason: r.reason });
    recordRun('NAVER_LIST', { ok: r.ok, count: r.entries.length, reason: r.reason });
    if (r.ok) {
      final = { source: 'NAVER_LIST', entries: r.entries };
      usedFallback = true;
    }
  }

  // Tier 3 — Shadow
  if (!final) {
    const r = tryShadow();
    attempts.push({ source: 'SHADOW_DB', ok: r.ok, count: r.entries.length, reason: r.reason });
    recordRun('SHADOW_DB', { ok: r.ok, count: r.entries.length, reason: r.reason });
    if (r.ok) {
      final = { source: 'SHADOW_DB', entries: r.entries };
      usedFallback = true;
    }
  }

  // Tier 4 — Seed
  if (!final) {
    const r = trySeed();
    attempts.push({ source: 'STATIC_SEED', ok: r.ok, count: r.entries.length, reason: r.reason });
    recordRun('STATIC_SEED', { ok: r.ok, count: r.entries.length, reason: r.reason });
    if (r.ok) {
      final = { source: 'STATIC_SEED', entries: r.entries };
      usedFallback = true;
      const today = new Date().toISOString().slice(0, 10);
      alert(
        'CRITICAL',
        `종목 마스터 — 모든 라이브 소스 실패, 정적 SEED ${r.entries.length}건 사용 중. KRX·Naver 점검 필요.`,
        `master_source_alert:SEED_FALLBACK:${today}`,
      );
    }
  }

  if (!final) {
    return {
      finalSource: 'NONE',
      finalCount: getMasterSize(),
      usedFallback: false,
      attempts,
    };
  }

  // active master 갱신
  setStockMaster(final.entries);

  // Tier 1/2 만 shadow 갱신 (Tier 3 은 자기 자신, Tier 4 는 seed → 오염 방지)
  if (final.source === 'KRX_CSV' || final.source === 'NAVER_LIST') {
    updateShadowMaster(final.source, final.entries);
  }

  return {
    finalSource: final.source,
    finalCount: final.entries.length,
    usedFallback,
    attempts,
  };
}

function consecutiveKrxFailures(): number {
  return getSourceHealth('KRX_CSV').state.consecutiveFailures;
}

/** 운영자 진단 — 현재 active master 의 상태 + 4 source health 요약. */
export interface MasterDiagnostic {
  activeCount: number;
  sources: Array<{ source: StockMasterSource; score: number; lastSuccessAt: number | null; consecutiveFailures: number }>;
  overallHealth: number;
}

export function getMasterDiagnostic(): MasterDiagnostic {
  const snapshots = getHealthSnapshot();
  return {
    activeCount: getMasterSize(),
    sources: snapshots.map((s) => ({
      source: s.source,
      score: s.score,
      lastSuccessAt: s.state.lastSuccessAt,
      consecutiveFailures: s.state.consecutiveFailures,
    })),
    overallHealth: computeOverallHealth(),
  };
}

export const __testOnly = {
  KRX_MIN_VALID_ENTRIES,
  NAVER_MIN_VALID_ENTRIES,
  SEED_MIN_ACCEPTABLE,
};
