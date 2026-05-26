// @responsibility ADR-0531 canonicalRegimeAccess default-ON/kill-switch/R6 보존 회귀 검증.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { MacroState } from '../../persistence/macroStateRepo.js';
import type { ResolvedRegimeSnapshot } from './effectiveRegimeSnapshot.js';

// 정본/legacy 두 출처를 경계에서 모킹 — accessor 의 책임(어느 출처를 읽는지 + kill-switch + R6 보존)만 검증.
vi.mock('./regimeResolver.js', () => ({
  resolveRegimeSnapshot: vi.fn(),
}));
vi.mock('../regimeBridge.js', () => ({
  getLiveRegime: vi.fn(),
}));

import { resolveRegimeSnapshot } from './regimeResolver.js';
import { getLiveRegime } from '../regimeBridge.js';
import { resolveCanonicalRegimeLevel, isCanonicalR6Defense } from './canonicalRegimeAccess.js';

/** accessor 가 읽는 필드(effectiveRegime/riskOverride)만 채운 최소 스냅샷. */
function snapshot(overrides: Partial<ResolvedRegimeSnapshot> = {}): ResolvedRegimeSnapshot {
  return {
    effectiveRegime: 'R3_EARLY',
    riskOverride: 'NONE',
    ...overrides,
  } as ResolvedRegimeSnapshot;
}

/** 강세장(KOSPI +3.28%, VIX 16.6) 매크로 최소 입력. */
function bullMacro(overrides: Partial<MacroState> = {}): MacroState {
  return {
    mhs: 70,
    regime: 'GREEN',
    updatedAt: '2026-05-26T05:00:00.000Z',
    vkospi: 67.0, // implausible (사고 케이스) — legacy latch 의 원인
    vix: 16.6,
    kospiDayReturn: 3.28,
    kospiCloseReturn: 3.28,
    ...overrides,
  } as MacroState;
}

const KILL_SWITCH = 'GATE0_CANONICAL_REGIME_DISABLED';

beforeEach(() => {
  vi.mocked(resolveRegimeSnapshot).mockReset();
  vi.mocked(getLiveRegime).mockReset();
});

afterEach(() => {
  delete process.env[KILL_SWITCH];
});

describe('resolveCanonicalRegimeLevel — ADR-0531 default canonical-ON', () => {
  it('default(ENV 없음): legacy 가 R5_CAUTION 고착이어도 canonical R3_EARLY 를 반환(사고 해소)', () => {
    delete process.env[KILL_SWITCH];
    vi.mocked(getLiveRegime).mockReturnValue('R5_CAUTION');
    vi.mocked(resolveRegimeSnapshot).mockReturnValue(snapshot({ effectiveRegime: 'R3_EARLY' }));

    const macro = bullMacro();
    expect(resolveCanonicalRegimeLevel(macro)).toBe('R3_EARLY');
    // canonical 출처만 소비 — legacy 는 호출되지 않아야 한다.
    expect(getLiveRegime).not.toHaveBeenCalled();
    expect(resolveRegimeSnapshot).toHaveBeenCalledWith({ macroState: macro, now: undefined });
  });

  it('kill-switch(=true): legacy getLiveRegime 값(R5_CAUTION)을 복원(즉시 롤백)', () => {
    process.env[KILL_SWITCH] = 'true';
    vi.mocked(getLiveRegime).mockReturnValue('R5_CAUTION');
    vi.mocked(resolveRegimeSnapshot).mockReturnValue(snapshot({ effectiveRegime: 'R3_EARLY' }));

    const macro = bullMacro();
    expect(resolveCanonicalRegimeLevel(macro)).toBe('R5_CAUTION');
    // kill-switch 면 canonical 스냅샷은 조회하지 않는다.
    expect(resolveRegimeSnapshot).not.toHaveBeenCalled();
    expect(getLiveRegime).toHaveBeenCalledWith(macro);
  });

  it('kill-switch 가 "true" 가 아닌 임의 값이면 default canonical 유지', () => {
    process.env[KILL_SWITCH] = '1'; // 'true' 만 kill-switch — 그 외는 canonical.
    vi.mocked(resolveRegimeSnapshot).mockReturnValue(snapshot({ effectiveRegime: 'R3_EARLY' }));
    expect(resolveCanonicalRegimeLevel(bullMacro())).toBe('R3_EARLY');
  });

  it('macroState=null 도 통과(canonical 출처에 그대로 위임)', () => {
    delete process.env[KILL_SWITCH];
    vi.mocked(resolveRegimeSnapshot).mockReturnValue(snapshot({ effectiveRegime: 'R4_NEUTRAL' }));
    expect(resolveCanonicalRegimeLevel(null)).toBe('R4_NEUTRAL');
    expect(resolveRegimeSnapshot).toHaveBeenCalledWith({ macroState: null, now: undefined });
  });
});

describe('isCanonicalR6Defense — ADR-0531 진짜 R6 방어 보존', () => {
  it('진짜 R6(riskOverride=R6_DEFENSE)는 true (방어 보존)', () => {
    delete process.env[KILL_SWITCH];
    vi.mocked(resolveRegimeSnapshot).mockReturnValue(
      snapshot({ effectiveRegime: 'R4_NEUTRAL', riskOverride: 'R6_DEFENSE' }),
    );
    expect(isCanonicalR6Defense(bullMacro())).toBe(true);
  });

  it('진짜 R6(effectiveRegime=R6_DEFENSE, riskOverride 미설정)도 true', () => {
    delete process.env[KILL_SWITCH];
    vi.mocked(resolveRegimeSnapshot).mockReturnValue(
      snapshot({ effectiveRegime: 'R6_DEFENSE', riskOverride: 'NONE' }),
    );
    expect(isCanonicalR6Defense(bullMacro())).toBe(true);
  });

  it('강세장(canonical R3_EARLY, riskOverride=NONE)은 false (방어 임의 발동 안 함)', () => {
    delete process.env[KILL_SWITCH];
    vi.mocked(resolveRegimeSnapshot).mockReturnValue(
      snapshot({ effectiveRegime: 'R3_EARLY', riskOverride: 'NONE' }),
    );
    expect(isCanonicalR6Defense(bullMacro())).toBe(false);
    expect(getLiveRegime).not.toHaveBeenCalled();
  });

  it('kill-switch(=true): legacy getLiveRegime===R6_DEFENSE 동작 복원', () => {
    process.env[KILL_SWITCH] = 'true';
    vi.mocked(getLiveRegime).mockReturnValue('R6_DEFENSE');
    expect(isCanonicalR6Defense(bullMacro())).toBe(true);
    expect(resolveRegimeSnapshot).not.toHaveBeenCalled();

    vi.mocked(getLiveRegime).mockReturnValue('R3_EARLY');
    expect(isCanonicalR6Defense(bullMacro())).toBe(false);
  });
});
