/**
 * @responsibility 워치리스트를 SWING/CATALYST/MOMENTUM 섹션으로 분류 — buyList·intradayBuyList 구성
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 중 후보 선정 단계. 매크로 게이팅 통과 후,
 * 종목별 평가 루프 진입 전에 실행되는 후보 선정 로직을 모은다:
 *   - computeFocusCodes(watchlist) → liveFocusCodes
 *   - assignSection(w, liveFocusCodes) → SWING/CATALYST/MOMENTUM
 *   - AUTO_SHADOW_FROM_MOMENTUM 플래그에 따른 buyList 확장
 *   - loadIntradayWatchlist().filter(intradayReady) → intradayBuyList
 *   - forceBuyCodes 병합
 */

export interface CandidateSelectInput {
  forceBuyCodes?: string[];
}

export interface SectionedCandidates {
  /** SWING/CATALYST + (옵션) MOMENTUM Shadow 학습 후보 */
  buyList: unknown[];
  swingList: unknown[];
  catalystList: unknown[];
  momentumList: unknown[];
  intradayBuyList: unknown[];
  watchlistMutated: boolean;
}

/**
 * 워치리스트 → 섹션 분류된 후보 목록 변환.
 * Phase 3 마이그레이션에서 ServerWatchlistEntry 타입 정합성 회복 예정.
 */
export function selectCandidates(_input: CandidateSelectInput): SectionedCandidates {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — candidateSelect)',
  );
}
