// @responsibility intradayWeakRotation — 신선 리더 admit 위한 MOMENTUM 약세 멤버 회전(evict) 정책 SSOT.
/**
 * intradayWeakRotation.ts — ADR-0628 D5 (약세 종목 회전, admission-triggered).
 *
 * D1(INTRADAY_SCREENER_REFRESH_ENABLED)이 발굴 입력을 신선화해도, MOMENTUM cap
 * (soft 40 / hard 50)이 아침 낙오주로 만석이면 leadershipBridge 가 신선 리더를
 * `momentum_full` 로 튕긴다(2차 차단). 본 모듈은 `addToWatchlist` 의 주입식
 * `evictionStrategy`(watchlistManager.AddToWatchlistOptions)로 bridge admission
 * 경로에서만 활성화되어, 보호 제외·신선신호 보유 MOMENTUM 멤버 중 당일 벤치마크
 * 상대강도(`screener.changeRate − kospiDayReturn`) 최저 1건을 — 신선 리더 강도가
 * 약세 멤버보다 margin(2.0%p) 이상 강하고 사이클 상한(3) 미도달일 때만 — evict 한다.
 *
 * 절대 제약 (불변식 #2·#8):
 *   - evict 는 active scan 풀(watchlist 멤버십) 제거일 뿐 — shadow/counterfactual
 *     ledger row 보존(학습 무중단). 보유(shadow/live) 종목은 D5.5 로 evict 원천 차단.
 *   - flag OFF / 상한 도달 / margin 미달 / 적격 후보 없음 → null 반환
 *     (= addToWatchlist 가 기존 tryEvictWeakest + momentum_full fallback, byte-identical).
 *
 * 신규 fetch 0: 신선 강도는 D1 이 이미 갱신한 screener.json(getScreenerCache) 재사용.
 * src/types 무수정: relativeChangeRate 는 런타임 파생값(영속 0).
 */

import type { WatchlistEntry } from '../persistence/watchlistRepo.js';

/** ADR-0628 D5 — 회전 kill-switch. default OFF → 현행 cap/cleanup byte-identical. */
export function isIntradayWeakRotationEnabled(): boolean {
  return process.env.INTRADAY_WEAK_ROTATION_ENABLED === 'true';
}

/** 사이클당 evict 상한 (기본 3, 하한 가드: 0 이하/NaN → 3). */
export function getWeakRotationMaxPerCycle(): number {
  const raw = Number(process.env.INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
}

/** 신선 리더가 evict 후보보다 이만큼(%p) 더 강해야 회전 (churn 방지 margin). */
export const WEAK_ROTATION_STRENGTH_MARGIN = 2.0;
/** bridge 신규 편입 grace (방금 admit 된 리더 thrash 차단). */
export const WEAK_ROTATION_GRACE_MS = 10 * 60 * 1000;

/** 회전 컨텍스트 — bridge 가 주입(신규 fetch 0; kospiDayReturn·신선 screener·보호 집합). */
export interface WeakRotationContext {
  /** 벤치마크 — leadershipBridge ctx.kospiDayReturn 재사용(상대강도 산출). */
  kospiDayReturn: number;
  /** 신선 리더 강도(LeaderCandidate.sectorRelativeStrength). */
  leaderStrength: number;
  /** 보유(shadow/live) 종목 코드 — getOpenPositions().trade.stockCode 집합. */
  heldCodes: ReadonlySet<string>;
  /** intradayReady 진행 중 종목 코드(미주입 시 해당 보호만 skip). */
  intradayActiveCodes?: ReadonlySet<string>;
  /** 신선 screener 강도 조회: code → changeRate(%) | null(미수록/stale). */
  freshChangeRateOf: (code: string) => number | null;
  /** 이번 admission 사이클 누적 evict 수(상한 비교용, bridge 가 카운트). */
  evictedThisCycle: number;
}

/**
 * evict 후보별 신선 약세 강도(낮을수록 약세) = screener.changeRate − kospiDayReturn.
 * screener 미수록/stale(freshChangeRateOf→null·비유한) → null(회전 제외, D5.2 보수 fallback).
 */
export function weakRotationStrengthOf(
  entry: WatchlistEntry,
  ctx: WeakRotationContext,
): number | null {
  const fresh = ctx.freshChangeRateOf(entry.code);
  if (fresh === null || !Number.isFinite(fresh)) return null;
  return fresh - ctx.kospiDayReturn;
}

/**
 * evict 적격성(보호 목록 통과 시 true). D5.5 SSOT.
 *
 * 절대 evict 금지(false 반환):
 *   - 섹션 보호: SWING / CATALYST (MOMENTUM 만 대상)
 *   - 보유 포지션 보호 (불변식 #2·#8): heldCodes 포함
 *   - pinned/MANUAL 보호: addedBy==='MANUAL' || isFocus===true
 *   - bridge 신규 편입 grace: leadershipBridge && addedAt 이 GRACE_MS 이내
 *   - intradayReady 진행 중: intradayActiveCodes 포함 (집합 미주입 시 해당 보호만 skip)
 *   - 신선 신호 부재: weakRotationStrengthOf===null (D5.2 — 약세 단정 금지)
 */
export function isWeakRotationEvictable(
  entry: WatchlistEntry,
  ctx: WeakRotationContext,
): boolean {
  // 섹션 보호 — MOMENTUM 만 회전 대상
  if (entry.section === 'SWING' || entry.section === 'CATALYST') return false;

  // 보유 포지션 보호 (불변식 #2·#8 직결 — shadow/live 보유는 원천 차단)
  if (ctx.heldCodes.has(entry.code)) return false;

  // pinned/MANUAL 보호 (tryEvictWeakest 와 동일 MANUAL 보호 + SWING focus 마커)
  if (entry.addedBy === 'MANUAL') return false;
  if (entry.isFocus === true) return false;

  // bridge 신규 편입 grace — 방금 admit 된 신선 리더 thrash 차단
  if (entry.leadershipBridge === true) {
    const addedMs = entry.addedAt ? new Date(entry.addedAt).getTime() : NaN;
    if (Number.isFinite(addedMs) && Date.now() - addedMs < WEAK_ROTATION_GRACE_MS) {
      return false;
    }
  }

  // intradayReady 진행 중 보호 — 집합 미주입 시 해당 보호만 skip(다른 보호는 유지)
  if (ctx.intradayActiveCodes?.has(entry.code)) return false;

  // 신선 신호 부재 → 회전 제외(보수, D5.2 fallback)
  if (weakRotationStrengthOf(entry, ctx) === null) return false;

  return true;
}

/**
 * addToWatchlist(evictionStrategy) 주입용 팩토리. cap 만석 시 호출돼
 * 보호 제외·신선신호 보유 멤버 중 relativeChangeRate 최저 1건을 선택,
 * leaderStrength > weakest + MARGIN 이고 사이클 상한 미도달일 때만 evict(반환).
 *
 * flag OFF / 상한 도달 / margin 미달 / 적격 후보 없음 → null
 * (= addToWatchlist 가 'full' → 기존 momentum_full fallback, byte-identical).
 *
 * 반환 규약: tryEvictWeakest 와 동일하게 watchlist 배열에서 대상 entry 를
 * in-place splice 한 뒤 evicted entry 를 반환(addToWatchlist 가 신규 entry push).
 */
export function buildWeakRotationEvictionStrategy(
  ctx: WeakRotationContext,
): (watchlist: WatchlistEntry[], entry: WatchlistEntry) => WatchlistEntry | null {
  return (watchlist, _entry) => {
    // 사이클 상한 도달 — 추가 evict 금지(기존 momentum_full fallback)
    if (ctx.evictedThisCycle >= getWeakRotationMaxPerCycle()) return null;

    // 보호 제외 · 신선신호 보유 MOMENTUM 멤버 중 relativeChangeRate 최저 1건 선택
    let weakest: WatchlistEntry | null = null;
    let weakestStrength = Number.POSITIVE_INFINITY;
    for (const w of watchlist) {
      if (!isWeakRotationEvictable(w, ctx)) continue;
      const strength = weakRotationStrengthOf(w, ctx);
      if (strength === null) continue; // 방어 (isWeakRotationEvictable 이 이미 차단)
      if (strength < weakestStrength) {
        weakest = w;
        weakestStrength = strength;
      }
    }

    if (!weakest) return null; // 적격 후보 없음 → fallback

    // 회전 조건: 신선 리더 강도 > 최약체 강도 + margin (미세 우위 churn 차단)
    if (!(ctx.leaderStrength > weakestStrength + WEAK_ROTATION_STRENGTH_MARGIN)) {
      return null;
    }

    const idx = watchlist.findIndex((w) => w.code === weakest!.code);
    if (idx === -1) return null;
    watchlist.splice(idx, 1);
    console.log(
      `[WeakRotation] MOMENTUM 회전 — ${weakest.name}(rel ${weakestStrength.toFixed(2)}%p) evict ` +
      `← 신선 리더(strength ${ctx.leaderStrength.toFixed(2)}%p, margin ${WEAK_ROTATION_STRENGTH_MARGIN})`,
    );
    return weakest;
  };
}
