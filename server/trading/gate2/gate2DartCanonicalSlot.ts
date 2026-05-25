// @responsibility ADR-0529 DART 정본 슬롯 single-source — collector slot build(cache-first 위임) + read-site resolve(슬롯 우선·기존 경로 fallback).

import { getGate2ExternalCacheRecord } from './gate2ExternalCache.js';
import { cleanSymbol } from './gate2ExternalDataProvider/helpers.js';
import type { Gate2DartEvaluationFinancials } from './gate2ExternalDataProvider/types.js';
import type { SymbolDartFinancialsSlot } from '../sourceSnapshot/symbolSnapshotData.js';

/**
 * cache-first read 단일 통로(getGate2DartFinancialsForEvaluation)에 동적 import 로 위임한다.
 *
 * 정적 import 회피 이유: 경량 collector(symbolDataCollector)가 heavy gate2 provider 그래프(KIS http 인접 모듈)를
 * 정적으로 끌어오면 안 된다 — flag ON + 실제 위임 시점에만 모듈 로드 (불변식 #1 robustness + SRP 격리).
 * provider 는 cache-first SSOT 라 module 캐시 이후 즉시 반환 (추가 quota 0, byte-equivalent).
 */
async function getDartEvaluationSingleSource(
  symbol: string,
): Promise<Gate2DartEvaluationFinancials | null> {
  const { getGate2DartFinancialsForEvaluation } = await import('./gate2ExternalDataProvider.js');
  return getGate2DartFinancialsForEvaluation(symbol);
}

/**
 * ADR-0529 방식 B(cached-reference): collector 가 종목 수집 시 채우는 DART 정본 슬롯을 구성한다.
 *
 * 절대 계약:
 *   - 새 DART HTTP fetch 를 신설하지 않는다 — 기존 cache-first 단일 통로만 위임.
 *   - cache hit 면 외부호출 0 (기존 함수가 cache 레코드 반환). miss 면 기존 함수 정책대로 ≤1 fetch (신규 quota 0).
 *   - cacheHit 판정은 위임 전 cache 레코드 존재(confidence ≠ MISSING)로 확정 — 부작용 없이 read-only 검사.
 *   - 슬롯 payload financials 는 기존 Gate2DartEvaluationFinancials 그대로 (byte-equivalent).
 *
 * 실패/부재 시 cadence='MISSING' 슬롯을 반환한다 (호출자 try/catch 격리 — 불변식 #1 collect/scan 무중단).
 */
export async function buildSymbolDartFinancialsSlot(symbol: string): Promise<SymbolDartFinancialsSlot> {
  const fetchedAt = new Date().toISOString();
  // cache-first 위임 전, cache 레코드 존재 여부로 cacheHit/source 를 read-only 로 확정한다.
  // (getGate2DartFinancialsForEvaluation 의 cache hit 분기 조건과 동일 — 동일 SSOT 판정.)
  const cached = getGate2ExternalCacheRecord(symbol);
  const cacheHit = Boolean(
    cached?.projection?.financialSnapshot?.confidence &&
      cached.projection.financialSnapshot.confidence !== 'MISSING',
  );

  const financials = await getDartEvaluationSingleSource(symbol);
  if (!financials) {
    return {
      financials: null,
      cadence: 'MISSING',
      source: 'NONE',
      cacheHit: false,
      fetchedAt,
    };
  }

  return {
    financials,
    cadence: 'QUARTERLY_CACHED',
    source: cacheHit ? 'GATE2_EXTERNAL_CACHE' : 'DART',
    cacheHit,
    fetchedAt,
  };
}

/**
 * ADR-0529 byte-equivalent read 정합: read site 가 DART 재무를 얻는 단일 진입점.
 *
 * 우선순위:
 *   1. flag ON(USE_UNIFIED_SOURCE_SNAPSHOT=true) AND 정본 슬롯의 financials non-null → 슬롯 financials 사용 (외부호출 0).
 *   2. 그 외(flag OFF / 슬롯 부재 / 슬롯 financials null) → 기존 getGate2DartFinancialsForEvaluation(code) fallback (회귀 0).
 *
 * 슬롯도 fallback 도 동일 cache-first 함수가 값 출처이므로 DART 값·Gate2 판정 byte-equivalent.
 * (PER dedup synthesizePerOutputFromSnapshotQuote 와 동형 패턴.)
 */
export async function resolveDartFinancialsForEvaluation(
  code: string,
  slot?: SymbolDartFinancialsSlot | null,
): Promise<Gate2DartEvaluationFinancials | null> {
  if (unifiedSnapshotEnabled() && slot && slot.financials) {
    return slot.financials;
  }
  return getDartEvaluationSingleSource(code);
}

/**
 * 정본 슬롯 read 게이트 — USE_UNIFIED_SOURCE_SNAPSHOT=true 시에만 슬롯을 신뢰한다.
 * OFF 시 기존 독립 경로 100% 유지 (PER dedup gate2PerReuseSnapshotEnabled 와 동일 토글).
 */
function unifiedSnapshotEnabled(): boolean {
  return process.env.USE_UNIFIED_SOURCE_SNAPSHOT === 'true';
}

/** read site 가 candidate code 로 정본 슬롯을 조회하기 위한 보조 — cleanSymbol 정규화 일치 보장. */
export function lookupDartSlot(
  perSymbol: Readonly<Record<string, SymbolDartFinancialsSlot | undefined>> | undefined,
  code: string,
): SymbolDartFinancialsSlot | null {
  if (!perSymbol) return null;
  return perSymbol[code] ?? perSymbol[cleanSymbol(code)] ?? null;
}
