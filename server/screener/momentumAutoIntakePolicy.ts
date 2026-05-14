/**
 * @responsibility MOMENTUM AUTO 워치리스트 편입 감속 정책 SSOT — autoPopulate intake control
 *
 * Patch-WATCHLIST-SATURATION-COOLDOWN-001 — AUTO 비중이 높을 때 신규 AUTO 편입을 감속.
 *
 * 핵심:
 *  - autoRatio >= MOMENTUM_AUTO_SLOWDOWN_RATIO && count >= alertCap → 감속 (slowed)
 *  - 감속 시 사이클당 신규 AUTO 편입을 MOMENTUM_AUTO_ADD_PER_CYCLE 이하로 제한
 *  - soft cap 미만에서는 강제 삭제 없음 — 신규 편입 제한만
 *  - 최근 cleanup/탈락된 MOMENTUM AUTO 종목은 re-add cooldown 적용
 *  - SWING/CATALYST/수동(MANUAL)/보유/강제 편입(force buy)은 영향 없음 — MOMENTUM AUTO 만 대상
 *
 * re-add cooldown 은 영속 schema 없이 runtime snapshot diff 로 자체 추적한다.
 *  - syncMomentumAutoSnapshot(현재 MOMENTUM AUTO codes) 가 직전 snapshot 과 diff
 *  - 사라진 code = cleanup/탈락 → removalAt 기록
 *  - isMomentumReAddBlocked(code) 가 cooldown 창 내 재편입 차단
 *
 * 불변식: 매매엔진·주문·매도·Shadow learning·KIS REST tier policy 무변경.
 *         이 모듈은 순수 결정 함수 + runtime Map — 신규 KIS/외부 API 호출 0건.
 *         감속은 *신규 후보 편입* 만 제한한다 — 기존 워치리스트 entry·OPEN Shadow 포지션을
 *         삭제·종료·관리 중단하지 않는다. 워치리스트 cleanup(만료/cap trim)은 candidate 정리
 *         경로이며 Shadow 포지션 lifecycle 과 완전히 분리되어 있다.
 */

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function envFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** 감속 시 사이클당 허용 신규 AUTO 편입 수. */
export function momentumAutoAddPerCycle(): number {
  return envInt("MOMENTUM_AUTO_ADD_PER_CYCLE", 3);
}
/** AUTO 편입 사이클 간 최소 간격 (분) — 진단/모니터 표기용. */
export function momentumAutoAddCooldownMin(): number {
  return envInt("MOMENTUM_AUTO_ADD_COOLDOWN_MIN", 15);
}
/** cleanup/탈락된 MOMENTUM AUTO 종목의 재편입 cooldown (분). */
export function momentumReAddCooldownMin(): number {
  return envInt("MOMENTUM_READD_COOLDOWN_MIN", 120);
}
/** 이 비율 이상 AUTO 비중이면 감속 발동. */
export function momentumAutoSlowdownRatio(): number {
  return envFloat("MOMENTUM_AUTO_SLOWDOWN_RATIO", 0.8);
}

export interface MomentumAutoIntakeInput {
  /** 현재 MOMENTUM 섹션 총 entry 수. */
  momentumCount: number;
  /** MOMENTUM saturation alert 임계 (보통 30). */
  alertCap: number;
  /** 현재 MOMENTUM 섹션의 AUTO 출처 entry 수. */
  autoCount: number;
  /** 현재 MOMENTUM 섹션의 MANUAL 출처 entry 수. */
  manualCount: number;
  /** 현재 MOMENTUM 섹션의 DART 출처 entry 수. */
  dartCount?: number;
}

export interface MomentumAutoIntakeDecision {
  /** 감속 발동 여부. */
  slowed: boolean;
  /** 사이클당 허용 신규 AUTO 편입 수 (감속 아니면 Infinity). */
  perCycleLimit: number;
  autoRatio: number;
  momentumCount: number;
  autoCount: number;
  reason: string;
}

/**
 * AUTO 편입 감속 결정 SSOT.
 * slowed = momentumCount >= alertCap && autoRatio >= MOMENTUM_AUTO_SLOWDOWN_RATIO.
 */
export function evaluateMomentumAutoIntake(
  input: MomentumAutoIntakeInput,
): MomentumAutoIntakeDecision {
  const momentumCount = Math.max(0, Math.trunc(input.momentumCount));
  const autoCount = Math.max(0, Math.trunc(input.autoCount));
  const manualCount = Math.max(0, Math.trunc(input.manualCount));
  const dartCount = Math.max(0, Math.trunc(input.dartCount ?? 0));
  const totalSource = autoCount + manualCount + dartCount;
  const autoRatio = totalSource > 0 ? autoCount / totalSource : 0;
  const slowdownRatio = momentumAutoSlowdownRatio();

  const slowed =
    momentumCount >= input.alertCap && autoRatio >= slowdownRatio;
  const perCycleLimit = slowed ? momentumAutoAddPerCycle() : Number.POSITIVE_INFINITY;

  return {
    slowed,
    perCycleLimit,
    autoRatio,
    momentumCount,
    autoCount,
    reason: slowed
      ? `autoRatio ${autoRatio.toFixed(2)} >= ${slowdownRatio} && count ${momentumCount} >= alert ${input.alertCap}`
      : `정상 — autoRatio ${autoRatio.toFixed(2)} / count ${momentumCount}`,
  };
}

// ── re-add cooldown — runtime snapshot diff (영속 schema 무변경) ────────────────
/** code → 마지막 cleanup/탈락 관찰 시각(ms). */
const _removalAt = new Map<string, number>();
/** 직전 sync 시점의 MOMENTUM AUTO code 집합. */
let _prevAutoSnapshot: Set<string> | null = null;

/**
 * 현재 MOMENTUM AUTO code 집합을 직전 snapshot 과 diff —
 * 사라진 code 를 cleanup/탈락으로 간주하고 removalAt 기록.
 * autoPopulateWatchlist 진입부에서 1회 호출.
 */
export function syncMomentumAutoSnapshot(
  currentAutoMomentumCodes: readonly string[],
  now: Date = new Date(),
): { newlyRemoved: string[] } {
  const current = new Set(currentAutoMomentumCodes);
  const newlyRemoved: string[] = [];
  if (_prevAutoSnapshot) {
    for (const code of _prevAutoSnapshot) {
      if (!current.has(code)) {
        _removalAt.set(code, now.getTime());
        newlyRemoved.push(code);
      }
    }
  }
  // 다시 watchlist 에 존재하면 removal 기록 해제 (재편입 성공한 종목).
  for (const code of current) {
    if (_removalAt.has(code)) _removalAt.delete(code);
  }
  _prevAutoSnapshot = current;
  return { newlyRemoved };
}

/** code 가 re-add cooldown 창 내에 있으면 true (신규 AUTO 편입 차단). */
export function isMomentumReAddBlocked(
  code: string,
  now: Date = new Date(),
): boolean {
  const removedAt = _removalAt.get(code);
  if (removedAt === undefined) return false;
  const cooldownMs = momentumReAddCooldownMin() * 60 * 1000;
  const elapsed = now.getTime() - removedAt;
  if (!Number.isFinite(elapsed)) return false;
  if (elapsed >= cooldownMs) {
    _removalAt.delete(code);
    return false;
  }
  return true;
}

/** 테스트 격리 — runtime 상태 초기화. */
export function __resetMomentumAutoIntakeStateForTests(): void {
  _removalAt.clear();
  _prevAutoSnapshot = null;
}
