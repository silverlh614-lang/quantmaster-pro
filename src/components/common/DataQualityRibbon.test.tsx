// @vitest-environment jsdom
/**
 * @responsibility DataQualityRibbon + computeRibbonRatios 회귀 테스트 (ADR-0096 PR-Phase-B)
 *
 * 검증 항목:
 * 1) computeRibbonRatios 순수 함수 — 빈 입력 / 5-tier 합산 / grade 분기 (GOOD/OK/WARN)
 * 2) 옵셔널 필드 (delayed/manual) 안전 처리
 * 3) Ribbon 컴포넌트 — 빈 입력 시 placeholder
 * 4) Ribbon — 5 segment 비율 표시 (data-quality-segment-pct)
 * 5) Ribbon — grade 별 data-quality-ribbon-grade 속성 (e2e 친화)
 * 6) ARIA 접근성 (role="img" + aria-label 5-tier 정합)
 * 7) 카운트 0 segment 자동 생략
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DataQualityRibbon, computeRibbonRatios } from './DataQualityRibbon';
import type { DataQualityCount } from '../../types/ui';
import { useSettingsStore } from '../../stores/useSettingsStore';

// ADR-0103 PR-Verbose-Wiring-3: DataQualityRibbon 이 verbose 모드 한정 렌더이므로
// 본 컴포넌트 본체 검증 시 verbose 강제. verbosity 분기는 별도 *.verbosity.test.tsx
beforeEach(() => {
  useSettingsStore.getState().setUIVerbosity('verbose');
});

afterEach(() => cleanup());

function makeCount(opts: Partial<DataQualityCount> = {}): DataQualityCount {
  return {
    computed: 0,
    api: 0,
    aiInferred: 0,
    delayed: 0,
    manual: 0,
    total: 0,
    tier: 'LOW',
    sourceMetaAvailable: false,
    ...opts,
  };
}

describe('computeRibbonRatios — 순수 함수 (ADR-0096)', () => {
  it('빈 배열 → empty=true, grade=WARN', () => {
    const r = computeRibbonRatios([]);
    expect(r.empty).toBe(true);
    expect(r.total).toBe(0);
    expect(r.grade).toBe('WARN');
  });

  it('모든 카운트 0 → empty=true', () => {
    const r = computeRibbonRatios([makeCount(), makeCount()]);
    expect(r.empty).toBe(true);
  });

  it('100% computed → grade=GOOD (verifiedPct=1.0, estimatedPct=0)', () => {
    const r = computeRibbonRatios([makeCount({ computed: 27, total: 27 })]);
    expect(r.empty).toBe(false);
    expect(r.verifiedPct).toBe(1);
    expect(r.estimatedPct).toBe(0);
    expect(r.grade).toBe('GOOD');
  });

  it('estimated 30% (boundary) → grade=OK', () => {
    // computed 7 + ai 3 = total 10, estimated 30%
    const r = computeRibbonRatios([makeCount({ computed: 7, aiInferred: 3, total: 10 })]);
    expect(r.estimatedPct).toBeCloseTo(0.3, 5);
    expect(r.grade).toBe('OK');
  });

  it('estimated 29% → grade=GOOD (boundary 미달)', () => {
    const r = computeRibbonRatios([makeCount({ computed: 71, aiInferred: 29, total: 100 })]);
    expect(r.grade).toBe('GOOD');
  });

  it('estimated 50% (boundary) → grade=WARN', () => {
    const r = computeRibbonRatios([makeCount({ computed: 5, aiInferred: 5, total: 10 })]);
    expect(r.estimatedPct).toBe(0.5);
    expect(r.grade).toBe('WARN');
  });

  it('5-tier 모두 합산 — delayed/manual 옵셔널 안전 처리', () => {
    const counts = [
      makeCount({ computed: 10, api: 5, aiInferred: 3, delayed: 2, manual: 1, total: 21 }),
      makeCount({ computed: 5, api: 5, aiInferred: 2, total: 12 }), // delayed/manual 미지정
    ];
    const r = computeRibbonRatios(counts);
    expect(r.total).toBe(33);
    expect(r.verifiedPct).toBeCloseTo(15 / 33);
    expect(r.externalPct).toBeCloseTo(10 / 33);
    expect(r.delayedPct).toBeCloseTo(2 / 33);
    expect(r.estimatedPct).toBeCloseTo(5 / 33);
    expect(r.manualPct).toBeCloseTo(1 / 33);
  });

  it('비율 합계 = 1.0 (정합성)', () => {
    const r = computeRibbonRatios([makeCount({ computed: 10, api: 5, aiInferred: 3, delayed: 2, manual: 1, total: 21 })]);
    const sum = r.verifiedPct + r.externalPct + r.delayedPct + r.estimatedPct + r.manualPct;
    expect(sum).toBeCloseTo(1.0, 5);
  });
});

describe('DataQualityRibbon — 컴포넌트 회귀 (ADR-0096)', () => {
  it('빈 counts → placeholder (data-quality-ribbon-empty="true")', () => {
    const { container } = render(<DataQualityRibbon counts={[]} />);
    const el = container.querySelector('[data-quality-ribbon-empty]');
    expect(el).not.toBeNull();
  });

  it('정상 counts → grade 속성 표시 (data-quality-ribbon-grade)', () => {
    const counts = [makeCount({ computed: 10, total: 10 })];
    const { container } = render(<DataQualityRibbon counts={counts} />);
    const el = container.querySelector('[data-quality-ribbon-grade]');
    expect(el?.getAttribute('data-quality-ribbon-grade')).toBe('GOOD');
  });

  it('estimated 60% → grade=WARN 적색 segment 우세', () => {
    const counts = [makeCount({ computed: 4, aiInferred: 6, total: 10 })];
    const { container } = render(<DataQualityRibbon counts={counts} />);
    const el = container.querySelector('[data-quality-ribbon-grade]');
    expect(el?.getAttribute('data-quality-ribbon-grade')).toBe('WARN');
    // estimated segment 60%
    const estimated = container.querySelector('[data-quality-segment="estimated"]');
    expect(estimated?.getAttribute('data-quality-segment-pct')).toBe('60');
  });

  it('카운트 0 segment 자동 생략 (DOM 부재)', () => {
    // computed only — manual/delayed segment 부재
    const counts = [makeCount({ computed: 10, total: 10 })];
    const { container } = render(<DataQualityRibbon counts={counts} />);
    expect(container.querySelector('[data-quality-segment="manual"]')).toBeNull();
    expect(container.querySelector('[data-quality-segment="delayed"]')).toBeNull();
    expect(container.querySelector('[data-quality-segment="external"]')).toBeNull();
    expect(container.querySelector('[data-quality-segment="estimated"]')).toBeNull();
    expect(container.querySelector('[data-quality-segment="verified"]')).not.toBeNull();
  });

  it('5-tier 모두 > 0 → 5 segment 모두 표시', () => {
    const counts = [makeCount({ computed: 5, api: 5, aiInferred: 5, delayed: 5, manual: 5, total: 25 })];
    const { container } = render(<DataQualityRibbon counts={counts} />);
    expect(container.querySelector('[data-quality-segment="verified"]')).not.toBeNull();
    expect(container.querySelector('[data-quality-segment="external"]')).not.toBeNull();
    expect(container.querySelector('[data-quality-segment="delayed"]')).not.toBeNull();
    expect(container.querySelector('[data-quality-segment="estimated"]')).not.toBeNull();
    expect(container.querySelector('[data-quality-segment="manual"]')).not.toBeNull();
  });

  it('aria-label 5-tier 정합 (UI_LANG.tier 라벨)', () => {
    const counts = [makeCount({ computed: 10, aiInferred: 5, delayed: 5, total: 20 })];
    const { container } = render(<DataQualityRibbon counts={counts} />);
    const el = container.querySelector('[role="img"]');
    const aria = el?.getAttribute('aria-label') ?? '';
    expect(aria).toContain('실측 50%'); // 10/20
    expect(aria).toContain('지연 데이터 25%');
    expect(aria).toContain('AI 추정 25%');
  });

  it('aria-label — 카운트 0 카테고리 미포함', () => {
    const counts = [makeCount({ computed: 10, total: 10 })];
    const { container } = render(<DataQualityRibbon counts={counts} />);
    const el = container.querySelector('[role="img"]');
    const aria = el?.getAttribute('aria-label') ?? '';
    expect(aria).not.toContain('수동 입력');
    expect(aria).not.toContain('지연 데이터');
  });

  it('height prop 적용 (style)', () => {
    const counts = [makeCount({ computed: 10, total: 10 })];
    const { container } = render(<DataQualityRibbon counts={counts} height={5} />);
    const el = container.querySelector('[data-quality-ribbon-grade]') as HTMLElement;
    expect(el.style.height).toBe('5px');
  });

  it('className prop 전파', () => {
    const counts = [makeCount({ computed: 10, total: 10 })];
    const { container } = render(<DataQualityRibbon counts={counts} className="my-custom-ribbon" />);
    const el = container.querySelector('[data-quality-ribbon-grade]');
    expect(el?.className).toContain('my-custom-ribbon');
  });
});
