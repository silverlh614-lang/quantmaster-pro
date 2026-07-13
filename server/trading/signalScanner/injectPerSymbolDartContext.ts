// @responsibility ADR-0529 — collector 가 채운 정본 DART 슬롯을 후보 객체에 carry(fetch 0). read site 가 슬롯 우선·기존 경로 fallback.

import { createTraceId, logVisibilityEvent, logger } from '../../utils/logger.js';
import type {
  SymbolSnapshotData,
  SymbolDartFinancialsSlot,
} from '../sourceSnapshot/symbolSnapshotData.js';

export interface DartContextInjectionStats {
  totalCandidates: number;
  uniqueSymbols: number;
  slotAttached: number;
  slotMissing: number;
}

/** 후보 객체에 carry 되는 정본 DART 슬롯 필드명. read site 는 이 키로 슬롯을 읽는다. */
export const CANDIDATE_DART_SLOT_KEY = '__dartFinancialsSlot';

interface CandidateWithDartSlot {
  [CANDIDATE_DART_SLOT_KEY]?: SymbolDartFinancialsSlot | null;
}

function normalizeSymbol(value: unknown): string {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits;
}

/**
 * 후보 배열에 정본 DART 슬롯을 carry 한다 (ADR-0529 방식 B).
 *
 * 절대 계약:
 *   - DART fetch 0 — collector 가 이미 채운 snapshotData[sym].dartFinancials 슬롯을 read-only 로 carry 만 한다.
 *   - snapshotData 부재(flag OFF / 수집 실패) 시 no-op — read site 가 기존 경로 fallback (회귀 0).
 *   - executionImpact=NONE — 슬롯은 read site 의 resolveDartFinancialsForEvaluation 입력일 뿐 결정 로직 0 변경.
 */
export function injectPerSymbolDartContext<T extends Record<string, unknown>>(
  candidates: T[],
  options?: { snapshotData?: Readonly<Record<string, SymbolSnapshotData>> },
): { candidates: T[]; stats: DartContextInjectionStats } {
  const stats: DartContextInjectionStats = {
    totalCandidates: candidates.length,
    uniqueSymbols: 0,
    slotAttached: 0,
    slotMissing: 0,
  };

  if (candidates.length === 0 || !options?.snapshotData) return { candidates, stats };

  const symbols = new Set(
    candidates.map((c) => normalizeSymbol((c.symbol ?? c.code) as unknown)).filter(Boolean),
  );
  stats.uniqueSymbols = symbols.size;

  for (const candidate of candidates) {
    const sym = normalizeSymbol((candidate.symbol ?? candidate.code) as unknown);
    if (!sym) continue;
    const slot = options.snapshotData[sym]?.dartFinancials ?? null;
    (candidate as T & CandidateWithDartSlot)[CANDIDATE_DART_SLOT_KEY] = slot;
    if (slot && slot.financials) stats.slotAttached++;
    else stats.slotMissing++;
  }

  const traceId = createTraceId('dart_ctx');
  try {
    logVisibilityEvent({
      visibility: 'DIAGNOSTIC',
      category: 'KIS',
      sourceCommand: '/scan',
      traceId,
      message:
        `[PER_SYMBOL_DART_CONTEXT_INJECTION] ` +
        `totalCandidates=${stats.totalCandidates} uniqueSymbols=${stats.uniqueSymbols} ` +
        `slotAttached=${stats.slotAttached} slotMissing=${stats.slotMissing} executionImpact=NONE`,
      summary: { ...stats, executionImpact: 'NONE' },
      details: { stats },
      level: 'info',
      executionImpact: 'NONE',
    });
  } catch (err) {
    logger.warn('[PER_SYMBOL_DART_CONTEXT] 진단 로그 실패', err instanceof Error ? err.message : String(err));
  }

  return { candidates, stats };
}

/** 후보 객체에서 carry 된 정본 DART 슬롯을 읽는다 (미부착 시 null). */
export function readCandidateDartSlot(candidate: unknown): SymbolDartFinancialsSlot | null {
  if (candidate && typeof candidate === 'object' && CANDIDATE_DART_SLOT_KEY in candidate) {
    return (candidate as CandidateWithDartSlot)[CANDIDATE_DART_SLOT_KEY] ?? null;
  }
  return null;
}
