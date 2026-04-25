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

import { loadWatchlist, type WatchlistEntry } from '../../persistence/watchlistRepo.js';
import { loadIntradayWatchlist, type IntradayWatchlistEntry } from '../../persistence/intradayWatchlistRepo.js';
import { computeFocusCodes, assignSection } from '../../screener/watchlistManager.js';

export interface CandidateSelectInput {
  forceBuyCodes?: string[];
}

export interface SectionedCandidates {
  /** 원본 watchlist (mutated in place — section 필드가 갱신될 수 있음). */
  watchlist: WatchlistEntry[];
  /** SWING/CATALYST + (옵션) MOMENTUM Shadow 학습 후보 + forceBuyCodes */
  buyList: WatchlistEntry[];
  swingList: WatchlistEntry[];
  catalystList: WatchlistEntry[];
  momentumList: WatchlistEntry[];
  intradayBuyList: IntradayWatchlistEntry[];
  /** assignSection 이 한 항목이라도 section 을 바꿨으면 true. */
  watchlistMutated: boolean;
}

/**
 * 워치리스트 → 섹션 분류된 후보 목록.
 *
 * 원본 signalScanner.ts L314~360 동작과 동등 — watchlist 항목의 `section`
 * 필드를 in-place mutate 하고, AUTO_SHADOW_FROM_MOMENTUM 플래그·forceBuyCodes
 * 에 따라 buyList 를 확장한다. MOMENTUM 진단 로그는 본 함수가 송출.
 */
export function selectCandidates(input: CandidateSelectInput): SectionedCandidates {
  const watchlist = loadWatchlist();

  // 3-섹션 구조 — SWING/CATALYST만 매수 스캔, MOMENTUM은 관찰 전용
  // isFocus를 스캔 시점에 실시간 계산 (cleanupWatchlist은 16:00에만 실행되므로
  // 08:35에 추가된 AUTO 종목의 isFocus가 미설정 상태일 수 있음)
  const liveFocusCodes = computeFocusCodes(watchlist);
  const forceCodes = new Set(input.forceBuyCodes ?? []);

  // 실시간 section 할당 — section 이 변경된 항목이 있는지 추적
  let watchlistMutated = false;
  for (const w of watchlist) {
    const next = assignSection(w, liveFocusCodes);
    if (w.section !== next) watchlistMutated = true;
    w.section = next;
  }

  // Idea 1 — Shadow Portfolio 50 확장.
  // AUTO_SHADOW_FROM_MOMENTUM=true (기본) 이면 MOMENTUM 섹션을 buyList 에 포함시켜
  // 모든 후보에 대해 Shadow 가상 체결을 집행하고 학습 표본을 5배 확대한다. 실 자본
  // 경로 격리는 아래 per-stock `forceSectionShadow` 가 담당한다.
  const AUTO_SHADOW_FROM_MOMENTUM = process.env.AUTO_SHADOW_FROM_MOMENTUM !== 'false';
  const buyList = watchlist.filter(
    (w) =>
      w.section === 'SWING' ||
      w.section === 'CATALYST' ||
      (AUTO_SHADOW_FROM_MOMENTUM && w.section === 'MOMENTUM') ||
      forceCodes.has(w.code),
  );
  const swingList    = watchlist.filter((w) => w.section === 'SWING');
  const catalystList = watchlist.filter((w) => w.section === 'CATALYST');
  const momentumList = watchlist.filter((w) => w.section === 'MOMENTUM');

  // 진단 로그: MOMENTUM 처리 경로 — 플래그에 따라 학습/관찰 분기
  if (momentumList.length > 0) {
    const scope = AUTO_SHADOW_FROM_MOMENTUM ? 'Shadow 학습' : '관찰 전용';
    console.log(
      `[AutoTrade] MOMENTUM ${scope} ${momentumList.length}개: ` +
      momentumList.slice(0, 10).map((w) => `${w.name}(${w.code}) gate=${w.gateScore ?? 0}`).join(', ') +
      (momentumList.length > 10 ? ` ...외 ${momentumList.length - 10}개` : ''),
    );
  }

  // 장중 워치리스트: intradayReady=true 항목만 진입 후보
  const intradayBuyList = loadIntradayWatchlist().filter((w) => w.intradayReady === true);

  return {
    watchlist,
    buyList,
    swingList,
    catalystList,
    momentumList,
    intradayBuyList,
    watchlistMutated,
  };
}
