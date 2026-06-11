// @responsibility ADR-0604 3단계 — 미국 야간 급락 시 개장 전 보수 강등 스위치·임계 (default OFF, 레짐 보조 입력).

/** default OFF (`=== 'true'`) — 2단계 stratify 실측으로 효과 확인 후 운영자 활성화. */
export function isUsOvernightDefenseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.US_OVERNIGHT_DEFENSE_ENABLED === 'true';
}

/** 급락 임계 % (음수, -10~-0.5 가드 외 -2.5). usOvernightBoost(+1.5%→+10)의 하방 대칭. */
export function resolveUsOvernightDefenseThresholdPct(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.US_OVERNIGHT_DEFENSE_THRESHOLD_PCT ?? '');
  return Number.isFinite(raw) && raw <= -0.5 && raw >= -10 ? raw : -2.5;
}

/** 발동 시 bias 감점 (boost +10 의 대칭 -12 — 하방 보수 우위). */
export const US_OVERNIGHT_DEFENSE_BIAS_PENALTY = 12;
