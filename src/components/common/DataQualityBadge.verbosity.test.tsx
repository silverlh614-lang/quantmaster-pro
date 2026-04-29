// @vitest-environment jsdom
/**
 * @responsibility DataQualityBadge verbosity wiring 회귀 (ADR-0109 PR-Verbose-Wiring-4)
 *
 * 검증 항목:
 * 1) balanced/verbose → 렌더 (compact + 풀 모드)
 * 2) minimal → 미렌더 (null)
 * 3) forceShow=true override → minimal 시에도 렌더
 * 4) forceShow=false override → balanced 시에도 미렌더
 * 5) 기존 사용처 (WatchlistCard) default 'balanced' 무영향 검증
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DataQualityBadge } from './DataQualityBadge';
import type { DataQualityCount } from '../../types/ui';
import { useSettingsStore } from '../../stores/useSettingsStore';

beforeEach(() => useSettingsStore.getState().setUIVerbosity('balanced'));
afterEach(() => cleanup());

const count: DataQualityCount = {
  computed: 9,
  api: 5,
  aiInferred: 2,
  total: 16,
  tier: 'HIGH',
  sourceMetaAvailable: true,
};

describe('DataQualityBadge — verbosity wiring (ADR-0109)', () => {
  it('balanced (기본): compact 모드 렌더', () => {
    const { container } = render(<DataQualityBadge count={count} />);
    expect(container.firstChild).not.toBeNull();
    expect(container.textContent).toContain('9');
  });

  it('balanced: 풀 모드 렌더', () => {
    const { container } = render(<DataQualityBadge count={count} compact={false} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('verbose: 모든 모드 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<DataQualityBadge count={count} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('minimal: compact 미렌더 (null)', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<DataQualityBadge count={count} />);
    expect(container.firstChild).toBeNull();
  });

  it('minimal: 풀 모드도 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<DataQualityBadge count={count} compact={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('forceShow=true: minimal 시에도 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<DataQualityBadge count={count} forceShow />);
    expect(container.firstChild).not.toBeNull();
  });

  it('forceShow=false: balanced 시에도 미렌더 (강제 차단)', () => {
    const { container } = render(<DataQualityBadge count={count} forceShow={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('forceShow=false: verbose 시에도 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<DataQualityBadge count={count} forceShow={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('total=0 + balanced: "데이터 부족" placeholder 표시 (verbosity 분기 통과 후)', () => {
    const empty: DataQualityCount = { computed: 0, api: 0, aiInferred: 0, total: 0, tier: 'LOW', sourceMetaAvailable: false };
    const { container } = render(<DataQualityBadge count={empty} />);
    expect(container.textContent).toContain('데이터 부족');
  });

  it('total=0 + minimal: 미렌더 (verbosity 우선)', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const empty: DataQualityCount = { computed: 0, api: 0, aiInferred: 0, total: 0, tier: 'LOW', sourceMetaAvailable: false };
    const { container } = render(<DataQualityBadge count={empty} />);
    expect(container.firstChild).toBeNull();
  });
});
