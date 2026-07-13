/**
 * @responsibility 워치리스트 Tier별 KIS REST 호출 빈도 차등화 정책 SSOT — KIS 400/부하 완화
 *
 * ADR-0516 — Watchlist Tier-based KIS REST 호출 차등화.
 *
 * 핵심 원칙:
 *   - OPEN_POSITION (보유 종목) 은 KIS 부하 상태와 무관하게 항상 REST 허용 (P0 보호).
 *   - Force buy (사용자 강제 매수) 는 ENTRY_CANDIDATE 로 격상 (P0 보호).
 *   - MOMENTUM 은 momentumRank 상위 N개만 MOMENTUM_ACTIVE (REST 허용), 나머지는
 *     MOMENTUM_PASSIVE (REST 차단 — WS/cache 만).
 *   - KIS_LOAD_STATE ENV (GREEN/YELLOW/RED): YELLOW 는 MOMENTUM_ACTIVE 정원 축소,
 *     RED 는 모든 MOMENTUM REST 금지 + ENTRY_CANDIDATE WS/cache 우선.
 *
 * 본 모듈은 *정책 결정* 만 한다. 실제 REST 차단은 helpers.getPrice() 의
 * `allowRestFallback` 컨텍스트가 수행한다. 매매엔진 / 주문 / 매도 / Shadow learning
 * 로직은 본 모듈을 import 하지 않는다.
 */

/**
 * 워치리스트 Tier — KIS REST 호출 빈도 차등화 분류.
 *
 *   OPEN_POSITION    — 보유 종목. 5s TTL, REST 항상 허용 (P0).
 *   ENTRY_CANDIDATE  — SWING 섹션 또는 force buy. 15s TTL, REST 허용 (RED 시 WS 우선).
 *   CATALYST_ACTIVE  — CATALYST 섹션. 30s TTL, REST 허용.
 *   MOMENTUM_ACTIVE  — MOMENTUM 상위 N개. 90s TTL, REST 허용.
 *   MOMENTUM_PASSIVE — MOMENTUM 하위 / no-rank. 180s TTL, REST 차단 (WS/cache 만).
 */
type WatchlistKisTier =
  | 'OPEN_POSITION'
  | 'ENTRY_CANDIDATE'
  | 'CATALYST_ACTIVE'
  | 'MOMENTUM_ACTIVE'
  | 'MOMENTUM_PASSIVE';

/** KIS 부하 상태 — ENV `KIS_LOAD_STATE` (GREEN/YELLOW/RED), 미설정 시 GREEN. */
export type KisLoadState = 'GREEN' | 'YELLOW' | 'RED';

/** 워치리스트 섹션 (watchlistRepo.WatchlistSection 과 동일 값 — import 회피용 재선언). */
type WatchlistKisSection = 'SWING' | 'CATALYST' | 'MOMENTUM';

export interface WatchlistKisPolicyInput {
  /** watchlistManager.assignSection 결과 — 미상 시 보수 fallback (ENTRY_CANDIDATE). */
  section?: WatchlistKisSection;
  /** Gate Score (진단/로그용 — tier 결정에는 momentumRank 우선). */
  gateScore?: number;
  /** Stage2 Score (진단/로그용). */
  stage2Score?: number;
  /** MOMENTUM 섹션 내 1-based 순위 (assignMomentumRanks 산출, runtime-only 필드). */
  momentumRank?: number;
  /** 보유 종목 여부 — true 시 OPEN_POSITION (KIS 부하 무관 항상 REST 허용). */
  isOpenPosition?: boolean;
  /** 사용자 강제 매수 여부 — true 시 ENTRY_CANDIDATE 로 격상 (P0 보호). */
  isForceBuy?: boolean;
  /** KIS 부하 상태 — 미전달 시 ENV 에서 도출. */
  kisLoadState?: KisLoadState;
}

export interface WatchlistKisPolicy {
  tier: WatchlistKisTier;
  /** REST fallback (fetchCurrentPrice) 호출 허용 여부. false 시 WS/cache 만. */
  allowRestPrice: boolean;
  /** REST 결과 캐시 TTL (ms) — 진단/향후 캐시 wiring 용 컨텍스트 carry. */
  priceTtlMs: number;
  /** 결정 사유 (compact 로그용). */
  reason: string;
}

// ── TTL 상수 SSOT ──────────────────────────────────────────────────────────
const TTL_OPEN_POSITION = 5_000;
const TTL_ENTRY_CANDIDATE = 15_000;
const TTL_CATALYST_ACTIVE = 30_000;
const TTL_MOMENTUM_ACTIVE = 90_000;
const TTL_MOMENTUM_PASSIVE = 180_000;

/**
 * MOMENTUM_ACTIVE 정원 — GREEN 기준 상위 N개 (env override).
 * 사용자 명시 "momentumRank top 10~15" 기본값 15.
 */
export const MOMENTUM_ACTIVE_RANK_LIMIT_GREEN = clampRankLimit(
  process.env.MOMENTUM_ACTIVE_RANK_LIMIT,
  15,
);

/**
 * YELLOW 부하 시 MOMENTUM_ACTIVE 정원 축소 (env override).
 * 기본값 7 — GREEN 정원의 절반 수준.
 */
export const MOMENTUM_ACTIVE_RANK_LIMIT_YELLOW = clampRankLimit(
  process.env.MOMENTUM_ACTIVE_RANK_LIMIT_YELLOW,
  7,
);

function clampRankLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(50, parsed);
}

/**
 * ENV `KIS_LOAD_STATE` → KisLoadState. 미설정/미상 시 GREEN (기존 동작 보존).
 * 정확 비교 (ADR-0157 정합) — 대소문자 무관 trim.
 */
export function resolveKisLoadStateFromEnv(): KisLoadState {
  const raw = (process.env.KIS_LOAD_STATE ?? '').trim().toUpperCase();
  if (raw === 'RED') return 'RED';
  if (raw === 'YELLOW') return 'YELLOW';
  return 'GREEN';
}

/**
 * 워치리스트 Tier 정책 결정 SSOT.
 *
 * 우선순위 결정 트리 (절대 변경 금지):
 *   1. isOpenPosition       → OPEN_POSITION (KIS 부하 무관 REST 허용, P0)
 *   2. isForceBuy           → ENTRY_CANDIDATE (P0 보호 — force buy 무성 실패 차단)
 *   3. section === SWING    → ENTRY_CANDIDATE (RED 시 WS 우선 = allowRestPrice false)
 *   4. section === CATALYST → CATALYST_ACTIVE (RED 시에도 REST 허용 — catalyst 우선)
 *   5. section === MOMENTUM →
 *        RED                 → MOMENTUM_PASSIVE (모든 MOMENTUM REST 금지)
 *        rank ≤ 정원          → MOMENTUM_ACTIVE  (REST 허용)
 *        rank > 정원 / no-rank→ MOMENTUM_PASSIVE (REST 차단)
 *   6. section 미상         → ENTRY_CANDIDATE (보수 fallback, REST 허용 — 기존 동작 보존)
 */
export function resolveWatchlistKisPolicy(
  input: WatchlistKisPolicyInput,
): WatchlistKisPolicy {
  const loadState = input.kisLoadState ?? resolveKisLoadStateFromEnv();

  // 1) OPEN_POSITION — KIS 부하 상태와 무관하게 항상 보호 (P0).
  if (input.isOpenPosition) {
    return {
      tier: 'OPEN_POSITION',
      allowRestPrice: true,
      priceTtlMs: TTL_OPEN_POSITION,
      reason: 'open-position',
    };
  }

  // 2) Force buy — 사용자 강제 매수는 ENTRY_CANDIDATE 로 격상 (P0 보호).
  //    MOMENTUM 섹션이라도 force buy 면 REST 허용 — 무성 실패 차단.
  if (input.isForceBuy) {
    return {
      tier: 'ENTRY_CANDIDATE',
      allowRestPrice: true,
      priceTtlMs: TTL_ENTRY_CANDIDATE,
      reason: 'force-buy',
    };
  }

  // 3) SWING → ENTRY_CANDIDATE. RED 시 WS/cache 우선 (allowRestPrice=false).
  if (input.section === 'SWING') {
    if (loadState === 'RED') {
      return {
        tier: 'ENTRY_CANDIDATE',
        allowRestPrice: false,
        priceTtlMs: TTL_ENTRY_CANDIDATE,
        reason: 'swing:load-red:ws-preferred',
      };
    }
    return {
      tier: 'ENTRY_CANDIDATE',
      allowRestPrice: true,
      priceTtlMs: TTL_ENTRY_CANDIDATE,
      reason: 'swing',
    };
  }

  // 4) CATALYST → CATALYST_ACTIVE. RED 시에도 REST 허용 — catalyst 이벤트는
  //    generic ENTRY_CANDIDATE 보다 우선순위가 높다 (OPEN_POSITION 다음).
  if (input.section === 'CATALYST') {
    return {
      tier: 'CATALYST_ACTIVE',
      allowRestPrice: true,
      priceTtlMs: TTL_CATALYST_ACTIVE,
      reason: loadState === 'RED' ? 'catalyst:load-red:rest-kept' : 'catalyst',
    };
  }

  // 5) MOMENTUM → rank 기반 ACTIVE/PASSIVE 분기.
  if (input.section === 'MOMENTUM') {
    // RED — 모든 MOMENTUM REST 금지 (WS/cache 만).
    if (loadState === 'RED') {
      return {
        tier: 'MOMENTUM_PASSIVE',
        allowRestPrice: false,
        priceTtlMs: TTL_MOMENTUM_PASSIVE,
        reason: 'momentum:load-red:no-rest',
      };
    }
    const rankLimit =
      loadState === 'YELLOW'
        ? MOMENTUM_ACTIVE_RANK_LIMIT_YELLOW
        : MOMENTUM_ACTIVE_RANK_LIMIT_GREEN;
    const rank = input.momentumRank;
    if (typeof rank === 'number' && Number.isFinite(rank) && rank >= 1 && rank <= rankLimit) {
      return {
        tier: 'MOMENTUM_ACTIVE',
        allowRestPrice: true,
        priceTtlMs: TTL_MOMENTUM_ACTIVE,
        reason: `momentum:rank-${rank}<=${rankLimit}:${loadState.toLowerCase()}`,
      };
    }
    return {
      tier: 'MOMENTUM_PASSIVE',
      allowRestPrice: false,
      priceTtlMs: TTL_MOMENTUM_PASSIVE,
      reason:
        typeof rank === 'number' && Number.isFinite(rank)
          ? `momentum:rank-${rank}>${rankLimit}:passive`
          : 'momentum:no-rank:passive',
    };
  }

  // 6) section 미상 — 보수 fallback. REST 허용 (기존 동작 100% 보존).
  return {
    tier: 'ENTRY_CANDIDATE',
    allowRestPrice: true,
    priceTtlMs: TTL_ENTRY_CANDIDATE,
    reason: 'section-unknown:default',
  };
}

/**
 * MOMENTUM 섹션 종목에 1-based momentumRank (runtime-only 필드) 부여.
 *
 * 정렬 SSOT:
 *   1. stage2Score 우선 (내림차순)
 *   2. stage2Score 부재 시 gateScore (내림차순)
 *   3. tie → addedAt 최신 우선 (내림차순)
 *   4. final tie → code 오름차순 (deterministic)
 *
 * watchlistRepo 영속 schema 변경 금지 — `momentumRank` 는 runtime-only.
 * 호출자 (candidateSelect.ts) 가 매 스캔 사이클마다 재계산한다.
 *
 * @param momentumList section === 'MOMENTUM' 인 WatchlistEntry 배열
 */
export function assignMomentumRanks(
  momentumList: ReadonlyArray<MomentumRankableEntry>,
): void {
  const sorted = [...momentumList].sort((a, b) => {
    const sa = scoreOf(a);
    const sb = scoreOf(b);
    if (sb !== sa) return sb - sa;
    const ta = Date.parse(a.addedAt ?? '') || 0;
    const tb = Date.parse(b.addedAt ?? '') || 0;
    if (tb !== ta) return tb - ta;
    return (a.code ?? '').localeCompare(b.code ?? '');
  });
  sorted.forEach((entry, idx) => {
    (entry as { momentumRank?: number }).momentumRank = idx + 1;
  });
}

/** assignMomentumRanks 입력 — WatchlistEntry 의 부분 구조 (import 회피용 최소 타입). */
export interface MomentumRankableEntry {
  code?: string;
  addedAt?: string;
  gateScore?: number;
  stage2Score?: number;
}

function scoreOf(entry: MomentumRankableEntry): number {
  const s2 = entry.stage2Score;
  if (typeof s2 === 'number' && Number.isFinite(s2)) return s2;
  const g = entry.gateScore;
  if (typeof g === 'number' && Number.isFinite(g)) return g;
  return 0;
}
