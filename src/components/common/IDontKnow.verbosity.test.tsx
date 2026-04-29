// @vitest-environment jsdom
/**
 * @responsibility IDontKnow 4-variant verbosity wiring 회귀 (ADR-0103 PR-Verbose-Wiring-3)
 *
 * 검증 항목:
 * 1) balanced/verbose → 4 variant 모두 렌더
 * 2) minimal → 4 variant 모두 미렌더 (null)
 * 3) forceShow=true: minimal 시에도 렌더
 * 4) forceShow=false: balanced 시에도 미렌더
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { IDontKnow } from './IDontKnow';
import { useSettingsStore } from '../../stores/useSettingsStore';

beforeEach(() => useSettingsStore.getState().setUIVerbosity('balanced'));
afterEach(() => cleanup());

describe('IDontKnow — verbosity wiring (ADR-0103)', () => {
  // ============================================================
  // 4 variant — balanced/verbose 렌더
  // ============================================================
  it('balanced: Delayed 렌더', () => {
    const { container } = render(<IDontKnow.Delayed />);
    expect(container.querySelector('[data-idontknow-variant="DELAYED"]')).not.toBeNull();
  });

  it('balanced: Insufficient 렌더', () => {
    const { container } = render(<IDontKnow.Insufficient />);
    expect(container.querySelector('[data-idontknow-variant="INSUFFICIENT"]')).not.toBeNull();
  });

  it('balanced: Stale 렌더', () => {
    const { container } = render(<IDontKnow.Stale />);
    expect(container.querySelector('[data-idontknow-variant="STALE"]')).not.toBeNull();
  });

  it('balanced: Conflicted 렌더', () => {
    const { container } = render(<IDontKnow.Conflicted />);
    expect(container.querySelector('[data-idontknow-variant="CONFLICTED"]')).not.toBeNull();
  });

  it('verbose: 4 variant 모두 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container: c1 } = render(<IDontKnow.Delayed />);
    const { container: c2 } = render(<IDontKnow.Stale />);
    expect(c1.querySelector('[data-idontknow-variant="DELAYED"]')).not.toBeNull();
    expect(c2.querySelector('[data-idontknow-variant="STALE"]')).not.toBeNull();
  });

  // ============================================================
  // minimal → 4 variant 모두 미렌더
  // ============================================================
  it('minimal: Delayed 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<IDontKnow.Delayed />);
    expect(container.firstChild).toBeNull();
  });

  it('minimal: Insufficient 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<IDontKnow.Insufficient />);
    expect(container.firstChild).toBeNull();
  });

  it('minimal: Stale 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<IDontKnow.Stale />);
    expect(container.firstChild).toBeNull();
  });

  it('minimal: Conflicted 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<IDontKnow.Conflicted />);
    expect(container.firstChild).toBeNull();
  });

  // ============================================================
  // forceShow override
  // ============================================================
  it('forceShow=true: minimal 시에도 Delayed 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<IDontKnow.Delayed forceShow />);
    expect(container.querySelector('[data-idontknow-variant="DELAYED"]')).not.toBeNull();
  });

  it('forceShow=true: minimal 시에도 Conflicted 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<IDontKnow.Conflicted forceShow />);
    expect(container.querySelector('[data-idontknow-variant="CONFLICTED"]')).not.toBeNull();
  });

  it('forceShow=false: balanced 시에도 Stale 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(<IDontKnow.Stale forceShow={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('forceShow=false: verbose 시에도 Insufficient 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<IDontKnow.Insufficient forceShow={false} />);
    expect(container.firstChild).toBeNull();
  });

  // ============================================================
  // compact / message / action 옵션 — verbosity 분기 통과 후 정상 작동
  // ============================================================
  it('compact 모드 + balanced → 라벨만 표시', () => {
    const { container } = render(<IDontKnow.Stale compact />);
    expect(container.querySelector('[data-idontknow-variant="STALE"]')).not.toBeNull();
    expect(container.textContent).toContain('시장 외');
  });

  it('compact 모드 + minimal → 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<IDontKnow.Stale compact />);
    expect(container.firstChild).toBeNull();
  });

  it('message override 작동 (verbosity 통과 후)', () => {
    const { container } = render(<IDontKnow.Delayed message="custom message" />);
    expect(container.textContent).toContain('custom message');
  });
});
