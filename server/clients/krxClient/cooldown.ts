// @responsibility krxClient bld 회로차단 — ADR-0009 cooldown + ADR-0259 recovery probe
/**
 * krxClient/cooldown.ts — ADR-0502c 분해 SSOT.
 *
 * - ADR-0009: 동일 bld 가 연속 5회 실패하면 1시간 soft cooldown.
 * - ADR-0259: cooldown 만료 후 30분 이내 → probe mode (1회만 시도).
 *
 * 의존성: `./constants.js` (BLD_FAILURE_THRESHOLD / BLD_COOLDOWN_MS /
 *         RECOVERY_PROBE_WINDOW_MS) 만.
 */

import {
  BLD_FAILURE_THRESHOLD,
  BLD_COOLDOWN_MS,
  RECOVERY_PROBE_WINDOW_MS,
} from './constants.js';

interface BldFailureState {
  consecutiveFailures: number;
  cooldownUntilMs: number;
  /** ADR-0259: probe 윈도우 안 마지막 시도 시각 — 30분 안 추가 호출 skip 용. */
  recoveryProbedAt?: number;
}

const _bldFailureState = new Map<string, BldFailureState>();

export function isBldCooldown(bld: string): boolean {
  const s = _bldFailureState.get(bld);
  if (!s) return false;
  return s.cooldownUntilMs > Date.now();
}

/**
 * ADR-0259 wiring: probe 윈도우 안 추가 호출 skip — cooldown 만료 후 30분 안에는
 * 1회만 시도. 이미 probed 했으면 다음 일반 호출 (윈도우 종료 후) 까지 skip.
 *
 * 시간 분기:
 *   - cooldownUntilMs === 0: 처음부터 cooldown 없음 → false (정상 호출)
 *   - cooldown 활성: false (별도 isBldCooldown 분기에서 처리)
 *   - cooldown 만료 + 30분 윈도우 안: recoveryProbedAt > cooldownUntilMs 이면 true
 *   - 30분 지난 후: false (일반 호출)
 */
export function shouldSkipForRecoveryProbe(bld: string): boolean {
  const s = _bldFailureState.get(bld);
  if (!s || s.cooldownUntilMs === 0) return false;
  if (s.cooldownUntilMs > Date.now()) return false;
  const probeWindowEnd = s.cooldownUntilMs + RECOVERY_PROBE_WINDOW_MS;
  if (Date.now() >= probeWindowEnd) return false;
  return (s.recoveryProbedAt ?? 0) >= s.cooldownUntilMs;
}

/** ADR-0259: probe 시도 시점 마킹 — 30분 안 추가 호출 skip 트리거. */
export function markRecoveryProbed(bld: string): void {
  const s = _bldFailureState.get(bld);
  if (!s || s.cooldownUntilMs === 0) return;
  if (Date.now() < s.cooldownUntilMs + RECOVERY_PROBE_WINDOW_MS) {
    s.recoveryProbedAt = Date.now();
    _bldFailureState.set(bld, s);
  }
}

export function recordBldFailure(bld: string, options: { cooldownThreshold?: number; reason?: string } = {}): BldFailureState {
  const s = _bldFailureState.get(bld) ?? { consecutiveFailures: 0, cooldownUntilMs: 0 };
  s.consecutiveFailures += 1;
  const cooldownThreshold = options.cooldownThreshold ?? BLD_FAILURE_THRESHOLD;
  if (s.consecutiveFailures >= cooldownThreshold) {
    s.cooldownUntilMs = Date.now() + BLD_COOLDOWN_MS;
    console.warn(
      `[KRX] ${bld} 연속 ${s.consecutiveFailures}회 실패 — 1시간 soft cooldown 활성화`,
    );
  }
  _bldFailureState.set(bld, s);
  if (options.reason === 'OFF_HOURS_HTTP400' && s.cooldownUntilMs > Date.now()) {
    console.warn(
      `[KRX] QUARANTINED 1h endpoint=${bld.split('/').at(-1) ?? bld} reason=OFF_HOURS_HTTP400 providerIssue=true marketSignal=false useForRouter=false`,
    );
  }
  return s;
}

export function recordBldSuccess(bld: string): void {
  const s = _bldFailureState.get(bld);
  if (!s) return;
  s.consecutiveFailures = 0;
  s.cooldownUntilMs = 0;
  _bldFailureState.set(bld, s);
}

/**
 * ADR-0259: cooldown 만료 후 30분 이내 → probe mode (1회만 시도).
 * 운영자가 무의미한 재호출을 회피하면서도 회복 감지 가능.
 */
export function isBldInRecoveryProbe(bld: string): boolean {
  const s = _bldFailureState.get(bld);
  if (!s) return false;
  const PROBE_WINDOW_MS = 30 * 60 * 1000;
  return s.cooldownUntilMs > 0
      && Date.now() > s.cooldownUntilMs
      && Date.now() < s.cooldownUntilMs + PROBE_WINDOW_MS;
}

/** 진단 — 외부 노출 (예: /health_full 명령). */
export function getKrxBldFailureStates(): Array<{
  bld: string;
  consecutiveFailures: number;
  cooldownActive: boolean;
  cooldownRemainingMs: number;
  recoveryProbe: boolean;
}> {
  const out: Array<{
    bld: string;
    consecutiveFailures: number;
    cooldownActive: boolean;
    cooldownRemainingMs: number;
    recoveryProbe: boolean;
  }> = [];
  for (const [bld, s] of _bldFailureState.entries()) {
    out.push({
      bld,
      consecutiveFailures: s.consecutiveFailures,
      cooldownActive: s.cooldownUntilMs > Date.now(),
      cooldownRemainingMs: Math.max(0, s.cooldownUntilMs - Date.now()),
      recoveryProbe: isBldInRecoveryProbe(bld),
    });
  }
  return out;
}

/** `cache.resetKrxCache` 가 호출 — 테스트 격리 + /api/system/reset. */
export function resetCooldownState(): void {
  _bldFailureState.clear();
}

/** 내부 — http.ts 의 krxFailureMeta 가 cooldown state read-only. */
export function getBldFailureState(bld: string): BldFailureState | undefined {
  return _bldFailureState.get(bld);
}
