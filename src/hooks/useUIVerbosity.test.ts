// @vitest-environment jsdom
/**
 * @responsibility useUIVerbosity hook + shouldShowAtVerbosity SSOT 회귀 (ADR-0099 PR-Verbose)
 *
 * 검증 항목:
 * 1) shouldShowAtVerbosity 매트릭스 SSOT — 11 컨텐츠 × 3 verbosity 분기
 * 2) atLeastVerbosity — minimal/balanced/verbose ranking 비교
 * 3) useUIVerbosity hook contract — verbosity / setVerbosity / shouldShow / atLeast
 * 4) zustand store 통합 — setVerbosity 후 useUIVerbosity().verbosity 반영
 * 5) 메모이즈 일관성 — 같은 verbosity 시 hook 결과 동일 reference
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { shouldShowAtVerbosity, atLeastVerbosity, useUIVerbosity, type VerbosityContent } from './useUIVerbosity';
import { useSettingsStore } from '../stores/useSettingsStore';

beforeEach(() => {
  // store 격리 — 각 테스트 전 default verbosity 복원
  useSettingsStore.getState().setUIVerbosity('balanced');
});

describe('shouldShowAtVerbosity — SSOT 매트릭스 (ADR-0099)', () => {
  // ============================================================
  // minimal — Verdict + 미니 게이트만
  // ============================================================
  it('minimal: verdict ✅', () => expect(shouldShowAtVerbosity('verdict', 'minimal')).toBe(true));
  it('minimal: gate-mini ✅', () => expect(shouldShowAtVerbosity('gate-mini', 'minimal')).toBe(true));
  it('minimal: evidence ❌', () => expect(shouldShowAtVerbosity('evidence', 'minimal')).toBe(false));
  it('minimal: risk ❌', () => expect(shouldShowAtVerbosity('risk', 'minimal')).toBe(false));
  it('minimal: time-band ❌', () => expect(shouldShowAtVerbosity('time-band', 'minimal')).toBe(false));
  it('minimal: confluence ❌', () => expect(shouldShowAtVerbosity('confluence', 'minimal')).toBe(false));
  it('minimal: axis-reasons ❌', () => expect(shouldShowAtVerbosity('axis-reasons', 'minimal')).toBe(false));
  it('minimal: data-quality ❌', () => expect(shouldShowAtVerbosity('data-quality', 'minimal')).toBe(false));
  it('minimal: data-quality-ribbon ❌', () => expect(shouldShowAtVerbosity('data-quality-ribbon', 'minimal')).toBe(false));
  it('minimal: idontknow ❌', () => expect(shouldShowAtVerbosity('idontknow', 'minimal')).toBe(false));
  it('minimal: gate-status ❌', () => expect(shouldShowAtVerbosity('gate-status', 'minimal')).toBe(false));

  // ============================================================
  // balanced (기본) — V-E-R + DataQuality + IDontKnow
  // ============================================================
  it('balanced: verdict ✅', () => expect(shouldShowAtVerbosity('verdict', 'balanced')).toBe(true));
  it('balanced: evidence ✅', () => expect(shouldShowAtVerbosity('evidence', 'balanced')).toBe(true));
  it('balanced: risk ✅', () => expect(shouldShowAtVerbosity('risk', 'balanced')).toBe(true));
  it('balanced: time-band ✅', () => expect(shouldShowAtVerbosity('time-band', 'balanced')).toBe(true));
  it('balanced: data-quality ✅', () => expect(shouldShowAtVerbosity('data-quality', 'balanced')).toBe(true));
  it('balanced: idontknow ✅', () => expect(shouldShowAtVerbosity('idontknow', 'balanced')).toBe(true));
  it('balanced: gate-mini ✅', () => expect(shouldShowAtVerbosity('gate-mini', 'balanced')).toBe(true));
  it('balanced: confluence ❌ (verbose 전용)', () => expect(shouldShowAtVerbosity('confluence', 'balanced')).toBe(false));
  it('balanced: axis-reasons ❌ (verbose 전용)', () => expect(shouldShowAtVerbosity('axis-reasons', 'balanced')).toBe(false));
  it('balanced: data-quality-ribbon ❌ (verbose 전용)', () => expect(shouldShowAtVerbosity('data-quality-ribbon', 'balanced')).toBe(false));
  it('balanced: gate-status ❌ (verbose 전용)', () => expect(shouldShowAtVerbosity('gate-status', 'balanced')).toBe(false));

  // ============================================================
  // verbose — 모든 컨텐츠 노출
  // ============================================================
  it('verbose: 11 컨텐츠 모두 ✅', () => {
    const all: VerbosityContent[] = [
      'verdict', 'evidence', 'risk', 'time-band',
      'confluence', 'axis-reasons',
      'data-quality', 'data-quality-ribbon',
      'idontknow', 'gate-status', 'gate-mini',
    ];
    for (const c of all) {
      expect(shouldShowAtVerbosity(c, 'verbose')).toBe(true);
    }
  });
});

describe('atLeastVerbosity — ranking 비교 (ADR-0099)', () => {
  it('minimal vs minimal → true', () => expect(atLeastVerbosity('minimal', 'minimal')).toBe(true));
  it('balanced vs minimal → true', () => expect(atLeastVerbosity('balanced', 'minimal')).toBe(true));
  it('verbose vs minimal → true', () => expect(atLeastVerbosity('verbose', 'minimal')).toBe(true));

  it('minimal vs balanced → false', () => expect(atLeastVerbosity('minimal', 'balanced')).toBe(false));
  it('balanced vs balanced → true', () => expect(atLeastVerbosity('balanced', 'balanced')).toBe(true));
  it('verbose vs balanced → true', () => expect(atLeastVerbosity('verbose', 'balanced')).toBe(true));

  it('minimal vs verbose → false', () => expect(atLeastVerbosity('minimal', 'verbose')).toBe(false));
  it('balanced vs verbose → false', () => expect(atLeastVerbosity('balanced', 'verbose')).toBe(false));
  it('verbose vs verbose → true', () => expect(atLeastVerbosity('verbose', 'verbose')).toBe(true));
});

describe('useUIVerbosity hook (ADR-0099)', () => {
  it('hook 호출 시 contract 반환 (verbosity / setVerbosity / shouldShow / atLeast)', () => {
    const { result } = renderHook(() => useUIVerbosity());
    expect(result.current.verbosity).toBe('balanced');
    expect(typeof result.current.setVerbosity).toBe('function');
    expect(typeof result.current.shouldShow).toBe('function');
    expect(typeof result.current.atLeast).toBe('function');
  });

  it('shouldShow — balanced 모드 정합 (evidence ✅, confluence ❌)', () => {
    const { result } = renderHook(() => useUIVerbosity());
    expect(result.current.shouldShow('verdict')).toBe(true);
    expect(result.current.shouldShow('evidence')).toBe(true);
    expect(result.current.shouldShow('risk')).toBe(true);
    expect(result.current.shouldShow('confluence')).toBe(false);
    expect(result.current.shouldShow('axis-reasons')).toBe(false);
  });

  it('setVerbosity → 즉시 반영 + shouldShow 갱신', () => {
    const { result } = renderHook(() => useUIVerbosity());
    expect(result.current.shouldShow('confluence')).toBe(false);
    act(() => {
      result.current.setVerbosity('verbose');
    });
    expect(result.current.verbosity).toBe('verbose');
    expect(result.current.shouldShow('confluence')).toBe(true);
    expect(result.current.shouldShow('axis-reasons')).toBe(true);
  });

  it('setVerbosity("minimal") → Verdict 만 가시', () => {
    const { result } = renderHook(() => useUIVerbosity());
    act(() => {
      result.current.setVerbosity('minimal');
    });
    expect(result.current.shouldShow('verdict')).toBe(true);
    expect(result.current.shouldShow('gate-mini')).toBe(true);
    expect(result.current.shouldShow('evidence')).toBe(false);
    expect(result.current.shouldShow('risk')).toBe(false);
    expect(result.current.shouldShow('idontknow')).toBe(false);
  });

  it('atLeast 헬퍼 — 가독성 체크', () => {
    const { result } = renderHook(() => useUIVerbosity());
    expect(result.current.atLeast('minimal')).toBe(true); // balanced ≥ minimal
    expect(result.current.atLeast('balanced')).toBe(true); // balanced ≥ balanced
    expect(result.current.atLeast('verbose')).toBe(false); // balanced < verbose

    act(() => {
      result.current.setVerbosity('verbose');
    });
    expect(result.current.atLeast('verbose')).toBe(true);
  });

  it('zustand store 단일 SSOT — setVerbosity 가 store 에 반영', () => {
    const { result } = renderHook(() => useUIVerbosity());
    act(() => {
      result.current.setVerbosity('verbose');
    });
    expect(useSettingsStore.getState().uiVerbosity).toBe('verbose');
  });

  it('rerender 시 동일 객체 reference (메모이즈)', () => {
    const { result, rerender } = renderHook(() => useUIVerbosity());
    const first = result.current;
    rerender();
    const second = result.current;
    expect(first).toBe(second);
  });
});
