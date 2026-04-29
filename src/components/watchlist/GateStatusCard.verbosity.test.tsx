// @vitest-environment jsdom
/**
 * @responsibility GateStatusCard verbosity wiring 회귀 (ADR-0110 PR-Verbose-Wiring-5)
 *
 * 검증: verbose ✅ / minimal·balanced ❌ / forceShow override.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { GateStatusCard } from './GateStatusCard';
import type { GateCardSummary } from '../../types/ui';
import { useSettingsStore } from '../../stores/useSettingsStore';

beforeEach(() => useSettingsStore.getState().setUIVerbosity('balanced'));
afterEach(() => cleanup());

const summary: GateCardSummary = {
  gate0Passed: true,
  gate1: { passed: 4, required: 5, verdict: 'PASS' },
  gate2: { passed: 7, required: 12, verdict: 'FAIL' },
  gate3: { passed: 3, required: 9, verdict: 'FAIL' },
  overallVerdict: 'BUY',
};

describe('GateStatusCard — verbosity wiring (ADR-0110)', () => {
  it('verbose → 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<GateStatusCard summary={summary} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('balanced → 미렌더', () => {
    const { container } = render(<GateStatusCard summary={summary} />);
    expect(container.firstChild).toBeNull();
  });

  it('minimal → 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<GateStatusCard summary={summary} />);
    expect(container.firstChild).toBeNull();
  });

  it('forceShow=true: balanced 시에도 렌더 (WatchlistCard 강제 노출 옵션)', () => {
    const { container } = render(<GateStatusCard summary={summary} forceShow />);
    expect(container.firstChild).not.toBeNull();
  });

  it('forceShow=true: minimal 시에도 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<GateStatusCard summary={summary} forceShow />);
    expect(container.firstChild).not.toBeNull();
  });

  it('forceShow=false: verbose 시에도 미렌더 (강제 차단)', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<GateStatusCard summary={summary} forceShow={false} />);
    expect(container.firstChild).toBeNull();
  });
});
