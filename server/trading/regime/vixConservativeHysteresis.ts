// @responsibility VIX 보수모드 진입/해제 히스테리시스(Schmitt trigger) — flapping 억제 순수 결정 SSOT.

/**
 * vixConservativeHysteresis.ts — VIX 보수모드 토글 히스테리시스 (W26 vix-conservative-on 3배 후속).
 *
 * 문제: handleVixSpike 가 단일 임계(vixIntradayChangePct ≥ 3)로 진입/해제를 모두 판단했다.
 * VIX 장중 변화가 +3% 근처에서 출렁이면(2.9→3.1→2.8→3.2) 30분 tick 마다 보수모드가
 * ON↔OFF 토글되어 vix-conservative-on/off 알림이 1:1 로 샜다(W26: 3배 서지).
 *
 * 해법: 진입(ON)과 해제(OFF) 임계를 분리한 Schmitt trigger.
 *   - 비보수 상태: intradayPct ≥ on(기본 3%) 일 때만 진입.
 *   - 보수 상태:   intradayPct < off(기본 1.5%) 로 충분히 내려와야 해제.
 *   - [off, on) 밴드: 현재 상태 유지(HOLD) → 경계 출렁임 무시.
 *
 * 불변식 #6 — intradayPct 부재(null, 예: Yahoo VIX fetch 실패)는 HOLD 한다. 기존 단일임계
 * 로직은 null → "급등 아님" → 보수모드 해제(공격적 사이징 복원)였는데, 이는 provider 장애를
 * market signal(정상화)로 변환하는 것이라 금지(provider issue ≠ market signal). 데이터가 없으면
 * 실행 권한을 바꾸지 않는다.
 *
 * 진입 임계(on)는 기본값에서 기존과 동일(3%) — 진입 민감도는 보존하고 해제만 끈적하게 한다.
 * 보수모드는 절대 기존보다 *덜* 보수적으로 동작하지 않는다(해제가 더 늦을 뿐).
 */

export type VixConservativeTransition = 'ENTER' | 'EXIT' | 'HOLD';

export interface VixConservativeThresholds {
  /** 진입 임계 % — intradayPct ≥ on 이면 보수모드 진입. */
  on: number;
  /** 해제 임계 % — 보수모드에서 intradayPct < off 면 해제. off ≤ on. */
  off: number;
}

function readPct(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return dflt; // 빈 문자열은 미설정 취급(Number('')=0 함정 회피).
  const n = Number(raw);
  return Number.isFinite(n) ? n : dflt;
}

/**
 * ENV 임계 해석.
 *   VIX_CONSERVATIVE_ON_THRESHOLD_PCT  — 진입 임계, 기본 3.
 *   VIX_CONSERVATIVE_OFF_THRESHOLD_PCT — 해제 임계, 기본 1.5.
 * off > on 으로 잘못 설정되면 히스테리시스가 무효이므로 off=on 으로 clamp(레거시 단일임계).
 * 레거시 동작 롤백: VIX_CONSERVATIVE_OFF_THRESHOLD_PCT=3 (= on) → 해제도 <3 단일임계.
 */
export function resolveVixConservativeThresholds(): VixConservativeThresholds {
  const on = readPct('VIX_CONSERVATIVE_ON_THRESHOLD_PCT', 3);
  const offRaw = readPct('VIX_CONSERVATIVE_OFF_THRESHOLD_PCT', 1.5);
  return { on, off: Math.min(offRaw, on) };
}

/**
 * 보수모드 전이 결정 (순수 함수).
 *
 * @param intradayPct     VIX 장중 변화율 %, 데이터 부재 시 null.
 * @param wasConservative 직전 보수모드 활성 여부.
 * @param thresholds      resolveVixConservativeThresholds().
 */
export function resolveVixConservativeTransition(
  intradayPct: number | null,
  wasConservative: boolean,
  thresholds: VixConservativeThresholds,
): VixConservativeTransition {
  // 데이터 부재 → 현재 상태 유지(불변식 #6: provider issue ≠ market signal).
  if (intradayPct === null || !Number.isFinite(intradayPct)) return 'HOLD';

  if (!wasConservative) {
    return intradayPct >= thresholds.on ? 'ENTER' : 'HOLD';
  }
  return intradayPct < thresholds.off ? 'EXIT' : 'HOLD';
}
