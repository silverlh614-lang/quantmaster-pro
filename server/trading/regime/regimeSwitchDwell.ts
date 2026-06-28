// @responsibility 레짐 전환 알림/재보정의 flapping 억제 dwell(연속확인) 게이트 — 순수 결정 SSOT.

/**
 * regimeSwitchDwell.ts — 레짐 전환 "확정" dwell 게이트 (W26 알림감사 regime_switch 7배 후속).
 *
 * 문제: macroSectorAlignmentCheck 가 30분마다 effectiveRegime 을 재측정하고 직전값과
 * 다르면 즉시 regime_switch 알림 + calibrateByRegimeSingle 을 실행했다. intraday 과민
 * bias score(kospiDay×12 …)가 버킷 경계에서 출렁이면 R3↔R4 진동이 1:1 알림으로 샜다.
 * dedup(HIGH=1분 쿨다운)은 측정간격(30분)보다 짧아 무력했고, dedupeKey 가 방향성
 * (`A->B`/`B->A` 별개)이라 진동을 묶지도 못했다.
 *
 * 해법: 새 후보 레짐이 연속 N tick(default 2 ≈ 1시간) 유지될 때만 전환을 확정한다.
 * 확정 전 원래 레짐으로 되돌아오면 후보를 폐기 → flapping 은 영구 미확정(무알림).
 * 진짜 지속 전환만 알림/재보정한다. dwellTicks≤1 이면 즉시 확정(레거시 byte-equivalent).
 *
 * 본 모듈은 SourceSnapshot/effectiveRegime/Gate/실행을 건드리지 않는다 — macroSync 의
 * 전환 *이벤트 발사 시점*만 디바운스한다(advisory + 학습 재보정 경로, executionImpact=NONE).
 */

export interface RegimeDwellState {
  /** 확정 대기 중인 후보 레짐 (없으면 null). */
  pendingRegime: string | null;
  /** 후보가 연속 관측된 tick 수. */
  pendingRegimeCount: number;
}

export interface RegimeDwellDecision {
  /** true → 전환 확정: prevRegime 갱신 + 알림 + 재보정 실행. */
  confirmed: boolean;
  /** 다음 tick 으로 넘길 후보 레짐 (확정/리셋 시 null). */
  nextPending: string | null;
  /** 다음 tick 으로 넘길 후보 연속 카운트. */
  nextPendingCount: number;
}

/**
 * ENV `REGIME_SWITCH_DWELL_CONFIRM_TICKS` — 전환 확정에 필요한 연속 관측 tick 수.
 * default 2(≈1시간). `=1` 로 설정하면 즉시 확정(레거시 동작 byte-equivalent 롤백).
 * 비유효/음수 → default 2. 하한 1.
 */
export function resolveRegimeDwellConfirmTicks(): number {
  const raw = process.env.REGIME_SWITCH_DWELL_CONFIRM_TICKS;
  if (raw === undefined) return 2;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 2;
}

/**
 * 레짐 전환 dwell 결정 (순수 함수).
 *
 * @param confirmedRegime 마지막으로 확정(커밋)된 레짐 (loadPrevRegime).
 * @param currRegime      이번 tick 의 effectiveRegime.
 * @param state           직전까지의 후보 상태.
 * @param dwellTicks      확정 필요 연속 tick (resolveRegimeDwellConfirmTicks).
 */
export function evaluateRegimeDwell(
  confirmedRegime: string,
  currRegime: string,
  state: RegimeDwellState,
  dwellTicks: number,
): RegimeDwellDecision {
  // 확정값과 동일 → 변화 없음. 진행 중이던 후보가 있으면 폐기(flapping 원복 케이스).
  if (currRegime === confirmedRegime) {
    return { confirmed: false, nextPending: null, nextPendingCount: 0 };
  }

  // 후보 지속(같은 후보면 +1, 다른 후보면 1 로 재시작).
  const count = state.pendingRegime === currRegime ? state.pendingRegimeCount + 1 : 1;
  const need = Math.max(1, dwellTicks);

  if (count >= need) {
    return { confirmed: true, nextPending: null, nextPendingCount: 0 };
  }
  return { confirmed: false, nextPending: currRegime, nextPendingCount: count };
}
