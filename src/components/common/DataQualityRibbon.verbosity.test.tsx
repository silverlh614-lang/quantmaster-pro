// @vitest-environment jsdom
/**
 * @responsibility DataQualityRibbon verbosity wiring 회귀 (ADR-0103 PR-Verbose-Wiring-3)
 *
 * 검증 항목:
 * 1) verbose → 렌더
 * 2) balanced → 미렌더 (null)
 * 3) minimal → 미렌더
 * 4) forceShow=true override → 모든 모드에서 렌더
 * 5) forceShow=false override → verbose 시에도 미렌더
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DataQualityRibbon } from './DataQualityRibbon';
import type { DataQualityCount } from '../../types/ui';
import { useSettingsStore } from '../../stores/useSettingsStore';

beforeEach(() => useSettingsStore.getState().setUIVerbosity('balanced'));
afterEach(() => cleanup());

const counts: DataQualityCount[] = [
  { computed: 10, api: 5, aiInferred: 3, total: 18, tier: 'HIGH', sourceMetaAvailable: true },
];

describe('DataQualityRibbon — verbosity wiring (ADR-0103)', () => {
  it('verbose → 렌더 (data-quality-ribbon-grade)', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<DataQualityRibbon counts={counts} />);
    expect(container.querySelector('[data-quality-ribbon-grade]')).not.toBeNull();
  });

  it('balanced → 미렌더 (null)', () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(<DataQualityRibbon counts={counts} />);
    expect(container.firstChild).toBeNull();
  });

  it('minimal → 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<DataQualityRibbon counts={counts} />);
    expect(container.firstChild).toBeNull();
  });

  it('forceShow=true: balanced 시에도 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(<DataQualityRibbon counts={counts} forceShow />);
    expect(container.querySelector('[data-quality-ribbon-grade]')).not.toBeNull();
  });

  it('forceShow=false: verbose 시에도 미렌더 (강제 차단)', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<DataQualityRibbon counts={counts} forceShow={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('빈 counts + verbose → empty placeholder 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<DataQualityRibbon counts={[]} />);
    expect(container.querySelector('[data-quality-ribbon-empty]')).not.toBeNull();
  });

  it('빈 counts + balanced → 미렌더 (verbosity 우선)', () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(<DataQualityRibbon counts={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
