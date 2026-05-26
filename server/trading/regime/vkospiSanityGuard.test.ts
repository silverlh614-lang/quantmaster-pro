// @responsibility ADR-0522 VKOSPI sanity 가드 발동/미발동 매트릭스와 R6-recovery level gate 격리 회귀 검증.
import { describe, expect, it, afterEach } from 'vitest';
import type { MacroState } from '../../persistence/macroStateRepo.js';
import { defaultRegimeTransitionState } from '../../persistence/regimeTransitionStateRepo.js';
import { classifyVkospiSanity } from './vkospiSanityGuard.js';
import { evaluateR6RecoveryTransition, getRawRegime } from '../regimeBridge.js';

/** 가드 입력에 필요한 필드만 채운 최소 MacroState. */
function macro(overrides: Partial<MacroState> = {}): MacroState {
  return {
    mhs: 70,
    regime: 'GREEN',
    updatedAt: '2026-05-26T05:00:00.000Z',
    vkospi: 18,
    vix: 16,
    kospiDayReturn: 0.3,
    kospiCloseReturn: 0.3,
    usdKrwDayChange: 0.3,
    ...overrides,
  } as MacroState;
}

afterEach(() => {
  delete process.env.VKOSPI_SANITY_GUARD_DISABLED;
  delete process.env.VKOSPI_VIX_DIVERGENCE_CAP;
  delete process.env.VKOSPI_GUARD_KOSPI_FLOOR;
});

describe('classifyVkospiSanity — ADR-0522 발동/미발동 매트릭스', () => {
  it('#7 현 사고(vkospi67/vix16.6/kospi+3.28%) → guardTriggered=true, UNTRUSTED_IMPLAUSIBLE', () => {
    const verdict = classifyVkospiSanity(
      macro({ vkospi: 67.0, vix: 16.6, kospiDayReturn: 3.28, kospiCloseReturn: 3.28 }),
    );
    expect(verdict.guardTriggered).toBe(true);
    expect(verdict.trustState).toBe('UNTRUSTED_IMPLAUSIBLE');
    expect(verdict.providerIssue).toBe(true);
    expect(verdict.marketSignal).toBe(false);
    expect(verdict.vixDivergence).toBeCloseTo(50.4, 1);
    expect(verdict.reasons).toContain('VIX_DIVERGENCE');
    expect(verdict.reasons).toContain('KOSPI_NOT_STRESSED');
    expect(verdict.reasons).toContain('INTRADAY_NOT_STRESSED');
  });

  it('#8 진짜 폭락(45/40/-6%) → 미발동(G2 KOSPI 스트레스). 절대 마스킹 금지 회귀', () => {
    const verdict = classifyVkospiSanity(
      macro({ vkospi: 45, vix: 40, kospiDayReturn: -6, kospiCloseReturn: -6 }),
    );
    expect(verdict.guardTriggered).toBe(false);
    expect(verdict.trustState).not.toBe('UNTRUSTED_IMPLAUSIBLE');
    expect(verdict.marketSignal).toBe(false);
  });

  it('#9 진짜 동행 폭락(67/55/-8%) → 미발동(G1 괴리 12 ≤ CAP 25 & G2 실패)', () => {
    const verdict = classifyVkospiSanity(
      macro({ vkospi: 67, vix: 55, kospiDayReturn: -8, kospiCloseReturn: -8 }),
    );
    expect(verdict.guardTriggered).toBe(false);
    expect(verdict.vixDivergence).toBeCloseTo(12, 5);
    expect(verdict.trustState).not.toBe('UNTRUSTED_IMPLAUSIBLE');
  });

  it('#10 평상(18/16/+0.3%) → 미발동, TRUSTED', () => {
    const verdict = classifyVkospiSanity(macro({ vkospi: 18, vix: 16, kospiDayReturn: 0.3 }));
    expect(verdict.guardTriggered).toBe(false);
    expect(verdict.trustState).toBe('TRUSTED');
  });

  it('#11 vkospi MISSING → trustState=MISSING, guardTriggered=false', () => {
    const verdict = classifyVkospiSanity(macro({ vkospi: undefined }));
    expect(verdict.trustState).toBe('MISSING');
    expect(verdict.guardTriggered).toBe(false);
    expect(verdict.vkospi).toBeNull();
    expect(verdict.marketSignal).toBe(false);
  });

  it('#13 불변식 #6: implausible VKOSPI 가 어떤 경로로도 marketSignal=true 로 변환되지 않음', () => {
    const verdict = classifyVkospiSanity(
      macro({ vkospi: 67.0, vix: 16.6, kospiDayReturn: 3.28 }),
    );
    // guard 발동(provider sanity)이어도 marketSignal 은 항상 false literal.
    expect(verdict.marketSignal).toBe(false);
    expect(verdict.providerIssue).toBe(true);
  });

  it('G3 장중 패닉 저점이 깊으면 미발동(intraday 스트레스)', () => {
    const verdict = classifyVkospiSanity(
      macro({ vkospi: 67.0, vix: 16.6, kospiDayReturn: 3.28, kospiIntradayLowReturn: -4 }),
    );
    expect(verdict.guardTriggered).toBe(false);
  });

  it('kospiCloseReturn 이 kospiDayReturn 보다 우선(G2 입력)', () => {
    const verdict = classifyVkospiSanity(
      macro({ vkospi: 67, vix: 16.6, kospiCloseReturn: -3, kospiDayReturn: 5 }),
    );
    // close=-3 < floor(-1) → G2 실패 → 미발동.
    expect(verdict.guardTriggered).toBe(false);
  });

  it('kill-switch: VKOSPI_SANITY_GUARD_DISABLED=true 면 현 사고에서도 미발동(legacy 복원)', () => {
    process.env.VKOSPI_SANITY_GUARD_DISABLED = 'true';
    const verdict = classifyVkospiSanity(
      macro({ vkospi: 67.0, vix: 16.6, kospiDayReturn: 3.28 }),
    );
    expect(verdict.guardTriggered).toBe(false);
  });

  it('기본 ON: 활성화 ENV 없이도 현 사고에서 발동(운영자 override)', () => {
    // ENV 미설정 상태에서 발동해야 한다.
    const verdict = classifyVkospiSanity(
      macro({ vkospi: 67.0, vix: 16.6, kospiDayReturn: 3.28 }),
    );
    expect(verdict.guardTriggered).toBe(true);
  });

  it('튜닝 ENV: VKOSPI_VIX_DIVERGENCE_CAP 상향 시 경계 케이스 미발동', () => {
    process.env.VKOSPI_VIX_DIVERGENCE_CAP = '60';
    const verdict = classifyVkospiSanity(
      macro({ vkospi: 67.0, vix: 16.6, kospiDayReturn: 3.28 }),
    );
    // 괴리 50.4 ≤ 60 → G1 실패 → 미발동.
    expect(verdict.guardTriggered).toBe(false);
  });

  it('vix 결손이면 G1 충족 불가 → 미발동(괴리 판정 불가)', () => {
    const verdict = classifyVkospiSanity(
      macro({ vkospi: 67.0, vix: undefined, kospiDayReturn: 3.28 }),
    );
    expect(verdict.guardTriggered).toBe(false);
    expect(verdict.vixDivergence).toBeNull();
  });
});

describe('regimeBridge R6-recovery 통합 — implausible VKOSPI level gate 격리', () => {
  /** buildR6RecoveryEvidence 가 호출되려면 previousState 가 recovery flow(이전 R6) 여야 한다. */
  function previousR6State(nowIso: string) {
    return {
      ...defaultRegimeTransitionState(nowIso),
      currentRegime: 'R6_DEFENSE' as const,
      rawRegime: 'R6_DEFENSE' as const,
      effectiveRegime: 'R6_DEFENSE' as const,
      r6RecoveryStatus: 'R6_DEFENSE' as const,
      r6StateMachineState: 'R6_DEFENSE' as const,
      sourceUpdatedAt: '2026-05-26T04:00:00.000Z',
    };
  }

  it('현 사고 macroState 입력 시 vkospiOk 가 격리되어 VKOSPI level 로 차단되지 않음', () => {
    const now = new Date('2026-05-26T05:00:00.000Z');
    // recovery 가능한 안정 evidence + implausible VKOSPI(67). 다른 evidence 는 모두 OK.
    const incidentMacro = macro({
      vkospi: 67.0,
      vix: 16.6,
      kospiDayReturn: 3.28,
      kospiCloseReturn: 3.28,
      vkospiDayChange: 0,
      usdKrwDayChange: 0.3,
      mhs: 70,
      updatedAt: now.toISOString(),
    });
    const rawRegime = getRawRegime(incidentMacro, now);
    const state = evaluateR6RecoveryTransition(
      previousR6State(now.toISOString()),
      incidentMacro,
      rawRegime,
      now,
    );
    const evidence = state.r6RecoveryEvidence;
    // 핵심: VKOSPI level gate 가 격리되어 vkospiOk=true (67>threshold 임에도 차단 근거 제외).
    expect(evidence.vkospiOk).toBe(true);
    expect(evidence.vkospiTrustState).toBe('UNTRUSTED_IMPLAUSIBLE');
    expect(evidence.reasons).toContain('VKOSPI_UNTRUSTED_IMPLAUSIBLE_PROVIDER_SANITY');
    // legacy VKOSPI_LEVEL_NOT_STABLE 차단 사유는 부착되지 않아야 한다.
    expect(evidence.reasons.some((r) => r.startsWith('VKOSPI_LEVEL_NOT_STABLE'))).toBe(false);
  });

  it('진짜 폭락(45/40/-6%) 은 격리되지 않고 VKOSPI level 차단 사유 유지(방어 보존)', () => {
    const now = new Date('2026-05-26T05:00:00.000Z');
    const crashMacro = macro({
      vkospi: 45,
      vix: 40,
      kospiDayReturn: -6,
      kospiCloseReturn: -6,
      vkospiDayChange: 0,
      usdKrwDayChange: 0.3,
      mhs: 70,
      updatedAt: now.toISOString(),
    });
    const rawRegime = getRawRegime(crashMacro, now);
    const state = evaluateR6RecoveryTransition(
      previousR6State(now.toISOString()),
      crashMacro,
      rawRegime,
      now,
    );
    const evidence = state.r6RecoveryEvidence;
    expect(evidence.vkospiTrustState).not.toBe('UNTRUSTED_IMPLAUSIBLE');
    // VKOSPI 45 > threshold → 정상 level gate 차단(방어 유지). 격리 사유 미부착.
    expect(evidence.reasons).not.toContain('VKOSPI_UNTRUSTED_IMPLAUSIBLE_PROVIDER_SANITY');
    expect(evidence.vkospiOk).toBe(false);
  });

  it('kill-switch ON 시 현 사고도 legacy vkospiOk(level 차단) 동작 복원', () => {
    process.env.VKOSPI_SANITY_GUARD_DISABLED = 'true';
    const now = new Date('2026-05-26T05:00:00.000Z');
    const incidentMacro = macro({
      vkospi: 67.0,
      vix: 16.6,
      kospiDayReturn: 3.28,
      kospiCloseReturn: 3.28,
      vkospiDayChange: 0,
      usdKrwDayChange: 0.3,
      mhs: 70,
      updatedAt: now.toISOString(),
    });
    const rawRegime = getRawRegime(incidentMacro, now);
    const state = evaluateR6RecoveryTransition(
      previousR6State(now.toISOString()),
      incidentMacro,
      rawRegime,
      now,
    );
    const evidence = state.r6RecoveryEvidence;
    // kill-switch 면 guard 미발동 → 67>threshold 로 level gate 차단 복원.
    expect(evidence.vkospiTrustState).not.toBe('UNTRUSTED_IMPLAUSIBLE');
    expect(evidence.vkospiOk).toBe(false);
    expect(evidence.reasons).not.toContain('VKOSPI_UNTRUSTED_IMPLAUSIBLE_PROVIDER_SANITY');
  });
});
