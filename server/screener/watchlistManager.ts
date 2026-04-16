/**
 * watchlistManager.ts — 워치리스트 자동 정리 + 3-섹션 구조 관리
 *
 * 3-섹션 구조 (Track A/B 대체):
 *   SWING     — 스윙 주도주: Gate 상위 + 임계값 초과 → 실제 매수 대상 (최대 10개)
 *   CATALYST  — 촉매 기반: DART 공시 / 내부자 매수 (최대 3개)
 *   MOMENTUM  — 모멘텀 관찰: AUTO 발굴 후보풀 (최대 20개, 매매 안 함)
 *
 * 실시간 품질 경쟁:
 *   섹션이 가득 찼을 때 신규 종목의 gateScore가 기존 최저보다 높으면
 *   기존 최저 종목을 밀어내고 신규 종목이 입성한다 (tryEvictWeakest).
 *
 * 매일 16:00 KST (장마감 후) 실행:
 *   1. expiresAt 초과 항목 자동 제거
 *   2. entryFailCount >= 3인 항목 제거 (진입 실패 종목 정리)
 *   3. MOMENTUM → SWING 승격: Gate Score 상위 + 임계값 초과
 *   4. 섹션별 최대 개수 유지 (gateScore 낮은 것부터 제거, MANUAL 보호)
 */

import { loadWatchlist, saveWatchlist, type WatchlistEntry, type WatchlistSection } from '../persistence/watchlistRepo.js';

// ── 섹션별 상수 ───────────────────────────────────────────────────────────────

/** SWING 섹션 — 최대 매수 대상 수 (8→10 확대: 공시 축소분을 우량 종목에 재배분) */
export const SWING_MAX_SIZE       = 10;
/** CATALYST 섹션 — 최대 촉매 종목 수 (5→3 축소: 공시 비중은 크지 않으므로 핵심만 유지) */
export const CATALYST_MAX_SIZE    = 3;
/** MOMENTUM 섹션 — 최대 관찰 후보 수 */
export const MOMENTUM_MAX_SIZE    = 20;

/** CATALYST 포지션 축소 계수 (표준의 60%) */
export const CATALYST_POSITION_FACTOR = 0.6;
/** CATALYST 고정 손절 비율 (-5%) */
export const CATALYST_FIXED_STOP_PCT  = -0.05;

/** SWING → 만료 기간: 7영업일 */
export const SWING_EXPIRE_DAYS     = 7;
/** CATALYST → 만료 기간: 3일 */
export const CATALYST_EXPIRE_DAYS  = 3;
/** MOMENTUM → 만료 기간: 2영업일 */
export const MOMENTUM_EXPIRE_DAYS  = 2;

/** SWING 승격 Gate Score 임계값 — 이 점수 이상이면 MOMENTUM에서 SWING으로 승격 */
export const SWING_GATE_THRESHOLD = 8;

export const MAX_ENTRY_FAIL_COUNT = 3;

/** @deprecated MAX_CANDIDATE_POOL → MOMENTUM_MAX_SIZE 으로 교체. 하위 호환용. */
export const MAX_CANDIDATE_POOL = MOMENTUM_MAX_SIZE;
/** @deprecated FOCUS_LIST_SIZE → SWING_MAX_SIZE 으로 교체. 하위 호환용. (8→10 확대됨) */
export const FOCUS_LIST_SIZE   = SWING_MAX_SIZE;
/** @deprecated FOCUS_GATE_THRESHOLD → SWING_GATE_THRESHOLD 으로 교체. 하위 호환용. */
export const FOCUS_GATE_THRESHOLD = SWING_GATE_THRESHOLD;
/** @deprecated MAX_WATCHLIST → MOMENTUM_MAX_SIZE 으로 교체. 하위 호환용. */
export const MAX_WATCHLIST = MOMENTUM_MAX_SIZE;

/**
 * entryPrice 드리프트 임계값 (%).
 * 현재가가 entryPrice 대비 이 비율 이상 상승했으면 워치리스트 갱신/제거 대상.
 */
export const ENTRY_PRICE_DRIFT_PCT = 10;

/**
 * entryPrice 대비 현재가 드리프트 판정.
 *
 *  - AUTO 항목: 10% 이상 올랐으면 'REMOVE' (발굴 시점 대비 너무 멀리 상승)
 *  - MANUAL 항목: 'UPDATE' (사용자 확신 종목 → entryPrice를 현재가로 트레일 업)
 *  - 그 외 또는 미도달: 'KEEP'
 */
export function applyEntryPriceDrift(
  entry: WatchlistEntry,
  currentPrice: number,
): 'REMOVE' | 'UPDATE' | 'KEEP' {
  if (currentPrice <= 0 || entry.entryPrice <= 0) return 'KEEP';
  const driftPct = ((currentPrice - entry.entryPrice) / entry.entryPrice) * 100;
  if (driftPct < ENTRY_PRICE_DRIFT_PCT) return 'KEEP';
  return entry.addedBy === 'MANUAL' ? 'UPDATE' : 'REMOVE';
}

/**
 * SWING 섹션에 포함될 종목 코드 집합을 반환한다.
 * (기존 computeFocusCodes 대체 — 하위 호환 유지)
 *
 * 선정 기준 (OR):
 *   1. gateScore 상위 SWING_MAX_SIZE(8)개 (AUTO/DART 중)
 *   2. gateScore >= SWING_GATE_THRESHOLD(8) — 상위 8 밖이어도 포함
 * MANUAL 항목은 항상 SWING, DART(내부자 매수)는 항상 CATALYST.
 */
export function computeFocusCodes(list: WatchlistEntry[]): Set<string> {
  // DART/CATALYST 종목은 별도 섹션이므로 SWING 후보에서 제외
  const swingCandidates = list.filter((w) => w.addedBy !== 'MANUAL' && w.section !== 'CATALYST');
  const sorted = [...swingCandidates].sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0));
  const topN = sorted.slice(0, SWING_MAX_SIZE).map((w) => w.code);
  const aboveThreshold = swingCandidates
    .filter((w) => (w.gateScore ?? 0) >= SWING_GATE_THRESHOLD)
    .map((w) => w.code);
  return new Set([...topN, ...aboveThreshold]);
}

/**
 * WatchlistEntry의 section을 결정한다.
 * - MANUAL → SWING
 * - DART (또는 addedBy==='DART') → CATALYST
 * - AUTO + SWING 후보(focusCodes) → SWING
 * - 나머지 AUTO → MOMENTUM
 */
export function assignSection(
  entry: WatchlistEntry,
  focusCodes: Set<string>,
): WatchlistSection {
  if (entry.addedBy === 'MANUAL') return 'SWING';
  if (entry.addedBy === 'DART' || entry.section === 'CATALYST') return 'CATALYST';
  if (focusCodes.has(entry.code)) return 'SWING';
  return 'MOMENTUM';
}

/** section → 하위 호환 track 매핑 */
function sectionToTrack(section: WatchlistSection): 'A' | 'B' {
  return section === 'MOMENTUM' ? 'A' : 'B';
}

// ── 섹션별 최대 크기 맵 ─────────────────────────────────────────────────────
const SECTION_MAX: Record<WatchlistSection, number> = {
  SWING:    SWING_MAX_SIZE,
  CATALYST: CATALYST_MAX_SIZE,
  MOMENTUM: MOMENTUM_MAX_SIZE,
};

/**
 * 섹션이 가득 찼을 때 신규 종목이 기존 최저 gateScore 종목을 밀어내는 품질 경쟁.
 *
 * @param watchlist  현재 워치리스트 (in-place 수정됨)
 * @param newScore   신규 종목의 gateScore
 * @param section    대상 섹션
 * @returns evicted entry if successful, null if the new entry isn't good enough
 */
export function tryEvictWeakest(
  watchlist: WatchlistEntry[],
  newScore: number,
  section: WatchlistSection,
): WatchlistEntry | null {
  const maxSize = SECTION_MAX[section];
  const sectionEntries = watchlist.filter(w => w.section === section && w.addedBy !== 'MANUAL');

  if (sectionEntries.length < maxSize) return null; // 자리 있음 — eviction 불필요

  // MANUAL 항목은 보호: eviction 대상에서 제외
  const weakest = sectionEntries.reduce((min, w) =>
    (w.gateScore ?? 0) < (min.gateScore ?? 0) ? w : min,
  );

  if (newScore <= (weakest.gateScore ?? 0)) return null; // 신규가 더 약함 — 진입 불가

  // 최저 품질 종목 제거
  const idx = watchlist.findIndex(w => w.code === weakest.code);
  if (idx !== -1) {
    watchlist.splice(idx, 1);
    console.log(
      `[Watchlist] 품질 경쟁: ${section} 만석 → ` +
      `${weakest.name}(G${weakest.gateScore ?? 0}) 밀어냄 ← 신규(G${newScore})`,
    );
    return weakest;
  }
  return null;
}

export async function cleanupWatchlist(): Promise<void> {
  const watchlist = loadWatchlist();
  const now = new Date();

  // 1. 만료 항목 제거
  const afterExpiry = watchlist.filter((w) => {
    if (w.expiresAt && new Date(w.expiresAt) < now) {
      console.log(`[Watchlist] 만료 제거: ${w.name}(${w.code}) (만료: ${w.expiresAt})`);
      return false;
    }
    return true;
  });

  // 2. 진입 실패 횟수 초과 항목 제거
  const afterFailPrune = afterExpiry.filter((w) => {
    if ((w.entryFailCount ?? 0) >= MAX_ENTRY_FAIL_COUNT) {
      console.log(
        `[Watchlist] 진입실패 제거: ${w.name}(${w.code}) [${w.addedBy}] (실패 ${w.entryFailCount}회)`,
      );
      return false;
    }
    return true;
  });

  // 3. 3-섹션 갱신: SWING(매수대상) / CATALYST(촉매단기) / MOMENTUM(관찰전용)
  const focusCodes = computeFocusCodes(afterFailPrune);
  const withSection = afterFailPrune.map((w) => {
    const section = assignSection(w, focusCodes);
    return {
      ...w,
      section,
      isFocus: section === 'SWING',
      track: sectionToTrack(section),
    };
  });

  const swingCount    = withSection.filter((w) => w.section === 'SWING').length;
  const catalystCount = withSection.filter((w) => w.section === 'CATALYST').length;
  const momentumCount = withSection.filter((w) => w.section === 'MOMENTUM').length;

  // 4. 섹션별 최대 개수 초과 시 gateScore 낮은 것부터 제거 (품질 기반 정리)
  //    기존 addedAt(등록일) 기준은 역선택 유발: 좋은 종목이 오래 살아남는 게 아니라
  //    최근에 들어온 종목이 살아남아 gateScore 높은 종목이 먼저 잘리는 문제가 있었음
  let cleaned = withSection;

  // CATALYST 섹션 초과 시 gateScore 낮은 것부터 제거
  const catalystEntries = cleaned.filter((w) => w.section === 'CATALYST');
  if (catalystEntries.length > CATALYST_MAX_SIZE) {
    const catalystSorted = [...catalystEntries].sort(
      (a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0),
    );
    const catalystKeep = new Set(catalystSorted.slice(0, CATALYST_MAX_SIZE).map(w => w.code));
    const removed = catalystEntries.filter(w => !catalystKeep.has(w.code));
    cleaned = cleaned.filter((w) => w.section !== 'CATALYST' || catalystKeep.has(w.code));
    console.log(
      `[Watchlist] CATALYST 초과 제거: ${catalystEntries.length}개 → ${CATALYST_MAX_SIZE}개` +
      ` (제거: ${removed.map(w => `${w.name}(G${w.gateScore ?? 0})`).join(', ')})`,
    );
  }

  // MOMENTUM 섹션 초과 시 gateScore 낮은 것부터 제거
  const momentumEntries = cleaned.filter((w) => w.section === 'MOMENTUM');
  if (momentumEntries.length > MOMENTUM_MAX_SIZE) {
    const momentumSorted = [...momentumEntries].sort(
      (a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0),
    );
    const momentumKeep = new Set(momentumSorted.slice(0, MOMENTUM_MAX_SIZE).map(w => w.code));
    const removed = momentumEntries.filter(w => !momentumKeep.has(w.code));
    cleaned = cleaned.filter((w) => w.section !== 'MOMENTUM' || momentumKeep.has(w.code));
    console.log(
      `[Watchlist] MOMENTUM 초과 제거: ${momentumEntries.length}개 → ${MOMENTUM_MAX_SIZE}개` +
      ` (제거: ${removed.map(w => `${w.name}(G${w.gateScore ?? 0})`).join(', ')})`,
    );
  }

  if (
    cleaned.length !== watchlist.length ||
    cleaned.some((w) => {
      const orig = watchlist.find((o) => o.code === w.code);
      return orig === undefined || orig.isFocus !== w.isFocus || orig.section !== w.section;
    })
  ) {
    saveWatchlist(cleaned);
    console.log(
      `[Watchlist] 정리 완료: ${watchlist.length}개 → ${cleaned.length}개 ` +
      `(SWING ${swingCount}개 / CATALYST ${catalystCount}개 / MOMENTUM ${momentumCount}개)`,
    );
  } else {
    console.log(
      `[Watchlist] 정리 불필요 (${watchlist.length}개 유지, ` +
      `SWING ${swingCount}개 / CATALYST ${catalystCount}개 / MOMENTUM ${momentumCount}개)`,
    );
  }
}
