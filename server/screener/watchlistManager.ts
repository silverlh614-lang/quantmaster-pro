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
/**
 * CATALYST 섹션 — 최대 촉매 종목 수.
 * Phase 4-⑤: 3 → 5 확장. 동시 4건 이상 촉매가 기각되던 "CATALYST 만석 + 기존 종목이 더
 * 우수" 부조리(심플랫폼·동양·우리이앤엘·엘에스일렉트릭 사례)를 해소.
 * MOMENTUM 을 20 → 18 로 축소해 총 용량은 유지.
 */
export const CATALYST_MAX_SIZE    = 5;
/**
 * MOMENTUM 섹션 — 최대 관찰 후보 수.
 *
 * 15 → 50 (Idea 1: Shadow Portfolio 50 확장).
 * MOMENTUM 은 `AUTO_SHADOW_FROM_MOMENTUM` 가 켜져 있을 때 자동 Shadow 체결 경로로
 * 흘러가 학습 표본을 주당 50관측치 → 250관측치 (5배) 로 확장한다. 실 자본 영향은 0:
 * 섹션 기반 강제 SHADOW 모드 + orderableCash/slot 예약 제외로 LIVE 핫패스와 격리된다.
 *
 * WebSocket 구독은 MAX_SUBSCRIPTIONS(30) 을 초과하는 부분은 `subscribeStock` 이
 * 조용히 절삭하므로 1006 강제 종료 위험은 없다 (MOMENTUM 은 on-demand fetch 폴백).
 */
export const MOMENTUM_MAX_SIZE    = 50;

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

/**
 * SWING 승격 Gate Score 임계값.
 *
 * 참고: computeFocusCodes 는 더 이상 이 임계값으로 MOMENTUM→SWING 자동 승격을
 * 수행하지 않는다 (워치리스트 진입 바닥이 gateScore >= 18 이어서 임계 8 을 무조건 통과 →
 * 모든 AUTO 항목이 SWING 으로 덮어씌워지고 MOMENTUM 이 0 으로 전멸하던 회귀 버그를 유발).
 * 현재는 수동 승격/진단 용도로만 export 된다.
 */
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
 *
 * 선정 기준:
 *   - universeScanner 가 STRONG_BUY(CONFIRMED_STRONG_BUY 컨플루언스) 시그널로
 *     section='SWING' 으로 등록한 AUTO 종목을 gateScore 상위 SWING_MAX_SIZE 개까지 포함.
 *   - section 미지정 레거시 항목도 포함해 초기 분류 전 공백을 메운다.
 *
 * 제외 기준:
 *   - MANUAL — assignSection 에서 항상 SWING 으로 직행.
 *   - CATALYST — 별도 섹션.
 *   - **MOMENTUM — Gemini 가 BUY 로 판정(4축 컨플루언스 미확정)한 관찰 후보.**
 *     gateScore >= 18 이 이미 워치리스트 진입 바닥이므로 "점수만으로 자동 승격"은
 *     STRONG_BUY vs BUY 의 신호 품질 구분을 무력화한다. 따라서 MOMENTUM 은 여기서
 *     자동 승격하지 않고 만료(2영업일) 또는 universeScanner 재분류로만 이동시킨다.
 */
export function computeFocusCodes(list: WatchlistEntry[]): Set<string> {
  const swingCandidates = list.filter(
    (w) =>
      w.addedBy !== 'MANUAL' &&
      w.section !== 'CATALYST' &&
      w.section !== 'MOMENTUM',
  );
  const sorted = [...swingCandidates].sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0));
  return new Set(sorted.slice(0, SWING_MAX_SIZE).map((w) => w.code));
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

export interface AddToWatchlistOptions {
  evictionStrategy?: (
    watchlist: WatchlistEntry[],
    entry: WatchlistEntry,
  ) => WatchlistEntry | null;
}

export interface AddToWatchlistResult {
  added: boolean;
  evicted?: WatchlistEntry | null;
  existing?: WatchlistEntry;
  reason?: 'duplicate' | 'full';
}

/**
 * 한국 종목코드(숫자 6자리) 정규화. 이미 6자리이거나 숫자가 아니면 원본 유지.
 * 예: '5930' → '005930' (KIS 호환), 'M999' → 'M999' (테스트/가상 코드 비파괴).
 *
 * 이전 구현은 모든 code 를 padStart(6, '0') 하여 'A001' → '00A001' 처럼
 * 비숫자 코드도 변형시켰고, 중복 검사 양변의 정규화가 어긋나 test 회귀를 유발했다.
 */
function normalizeStockCode(code: string): string {
  if (/^\d+$/.test(code)) return code.padStart(6, '0');
  return code;
}

/**
 * 워치리스트 직접 push를 대체하는 단일 진입점.
 * 중복 코드 차단, 섹션 상한 체크, 기본 품질 경쟁(eviction)까지 여기서 처리한다.
 */
export function addToWatchlist(
  watchlist: WatchlistEntry[],
  entry: WatchlistEntry,
  options: AddToWatchlistOptions = {},
): AddToWatchlistResult {
  const code = normalizeStockCode(entry.code);
  const existing = watchlist.find((item) => normalizeStockCode(item.code) === code);
  if (existing) {
    return { added: false, existing, reason: 'duplicate' };
  }

  const section = entry.section ?? 'MOMENTUM';
  const maxSize = SECTION_MAX[section];
  const sectionCount = watchlist.filter((item) => item.section === section).length;
  if (sectionCount >= maxSize) {
    const evicted = (options.evictionStrategy ?? ((list, nextEntry) =>
      tryEvictWeakest(list, nextEntry.gateScore ?? 0, section)))(watchlist, entry);
    if (!evicted) {
      return { added: false, evicted: null, reason: 'full' };
    }
    Array.prototype.push.call(watchlist, { ...entry, code });
    return { added: true, evicted };
  }

  Array.prototype.push.call(watchlist, { ...entry, code });
  return { added: true, evicted: null };
}

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

/**
 * 데이터 빈곤 종목 우선 교체.
 *
 * 섹션이 만석이고 gateScore 경쟁에서도 밀릴 때, "완성도 점수가 바닥인 종목"을
 * 찾아 밀어낸다. DART 공시로 새 CATALYST 후보가 들어올 때 기존 리스트 중
 * 실측 데이터가 모자란 종목이 있다면 교체하는 쪽이 낫다 —
 * 게이트 평가 자체가 불완전한 종목을 붙잡는 건 기회비용.
 *
 * @param minGap  기존 최저 완성도와 신규의 차이가 이 이상이어야 교체.
 *                (예: 0.3 → 신규가 30%p 더 완전해야 교체)
 */
export function tryEvictMostDataStarved(
  watchlist: WatchlistEntry[],
  newCompletenessScore: number,
  getStockCompleteness: (code: string) => number | null,
  section: WatchlistSection,
  minGap: number = 0.3,
): WatchlistEntry | null {
  const maxSize = SECTION_MAX[section];
  const sectionEntries = watchlist.filter(w => w.section === section && w.addedBy !== 'MANUAL');
  if (sectionEntries.length < maxSize) return null;

  let worst: { entry: WatchlistEntry; score: number } | null = null;
  for (const e of sectionEntries) {
    const s = getStockCompleteness(e.code);
    if (s == null) continue;
    if (!worst || s < worst.score) worst = { entry: e, score: s };
  }
  if (!worst) return null;
  if (newCompletenessScore - worst.score < minGap) return null;

  const idx = watchlist.findIndex(w => w.code === worst!.entry.code);
  if (idx === -1) return null;
  watchlist.splice(idx, 1);
  console.log(
    `[Watchlist] 데이터 완성도 교체: ${section} 만석 → ` +
    `${worst.entry.name}(완성도 ${(worst.score * 100).toFixed(0)}%) 밀어냄 ← ` +
    `신규(완성도 ${(newCompletenessScore * 100).toFixed(0)}%)`,
  );
  return worst.entry;
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
