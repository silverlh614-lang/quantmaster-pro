/**
 * @responsibility AutoTradeContextualLayout 정렬·접힘·hidden 회귀 테스트 — ADR-0049 §2.3
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import {
  AutoTradeContextSection,
  resolvePriority,
  resolveCollapsed,
  isHidden,
  DEFAULT_CONTEXT_PRIORITY,
  HIDDEN_PRIORITY_THRESHOLD,
} from './AutoTradeContextSection';
import { collectSections } from './AutoTradeContextualLayout';

describe('resolvePriority — 컨텍스트별 우선순위 결정', () => {
  it('priorityByContext 미지정 시 DEFAULT_CONTEXT_PRIORITY (5) 반환', () => {
    expect(resolvePriority(undefined, 'LIVE_MARKET')).toBe(DEFAULT_CONTEXT_PRIORITY);
    expect(resolvePriority({}, 'LIVE_MARKET')).toBe(DEFAULT_CONTEXT_PRIORITY);
  });

  it('priorityByContext 에 정의된 컨텍스트는 해당 값 반환', () => {
    expect(resolvePriority({ LIVE_MARKET: 1, OVERNIGHT: 7 }, 'LIVE_MARKET')).toBe(1);
    expect(resolvePriority({ LIVE_MARKET: 1, OVERNIGHT: 7 }, 'OVERNIGHT')).toBe(7);
  });

  it('priorityByContext 에 미정의된 컨텍스트는 기본값', () => {
    expect(resolvePriority({ LIVE_MARKET: 1 }, 'WEEKEND_HOLIDAY')).toBe(DEFAULT_CONTEXT_PRIORITY);
  });
});

describe('resolveCollapsed — 컨텍스트별 접힘 결정', () => {
  it('collapsedByContext 미지정 시 false', () => {
    expect(resolveCollapsed(undefined, 'LIVE_MARKET')).toBe(false);
    expect(resolveCollapsed({}, 'LIVE_MARKET')).toBe(false);
  });

  it('collapsedByContext 에 true 정의된 컨텍스트는 true', () => {
    expect(resolveCollapsed({ WEEKEND_HOLIDAY: true }, 'WEEKEND_HOLIDAY')).toBe(true);
  });

  it('정의되지 않은 컨텍스트는 false', () => {
    expect(resolveCollapsed({ WEEKEND_HOLIDAY: true }, 'LIVE_MARKET')).toBe(false);
  });
});

describe('isHidden — priority ≥ 9 가 hidden', () => {
  it('priority 9 → hidden=true', () => {
    expect(isHidden(HIDDEN_PRIORITY_THRESHOLD)).toBe(true);
  });

  it('priority 8 → hidden=false', () => {
    expect(isHidden(8)).toBe(false);
  });

  it('priority 1 → hidden=false', () => {
    expect(isHidden(1)).toBe(false);
  });
});

describe('collectSections — children 정렬 (ADR-0049 §2.3 안정 정렬)', () => {
  it('priority 오름차순 정렬', () => {
    const children = (
      <>
        <AutoTradeContextSection id="c" priorityByContext={{ LIVE_MARKET: 3 }}>
          <div>C</div>
        </AutoTradeContextSection>
        <AutoTradeContextSection id="a" priorityByContext={{ LIVE_MARKET: 1 }}>
          <div>A</div>
        </AutoTradeContextSection>
        <AutoTradeContextSection id="b" priorityByContext={{ LIVE_MARKET: 2 }}>
          <div>B</div>
        </AutoTradeContextSection>
      </>
    );
    const sections = collectSections(children, 'LIVE_MARKET');
    expect(sections.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('동률은 originalIndex 오름차순 (안정 정렬 — 선언 순서 보존)', () => {
    const children = (
      <>
        <AutoTradeContextSection id="x" priorityByContext={{ LIVE_MARKET: 5 }}>
          <div>X</div>
        </AutoTradeContextSection>
        <AutoTradeContextSection id="y" priorityByContext={{ LIVE_MARKET: 5 }}>
          <div>Y</div>
        </AutoTradeContextSection>
        <AutoTradeContextSection id="z" priorityByContext={{ LIVE_MARKET: 5 }}>
          <div>Z</div>
        </AutoTradeContextSection>
      </>
    );
    const sections = collectSections(children, 'LIVE_MARKET');
    expect(sections.map((s) => s.id)).toEqual(['x', 'y', 'z']);
  });

  it('hidden (priority ≥ 9) 섹션은 결과에서 제외', () => {
    const children = (
      <>
        <AutoTradeContextSection id="show" priorityByContext={{ LIVE_MARKET: 1 }}>
          <div>show</div>
        </AutoTradeContextSection>
        <AutoTradeContextSection id="hide" priorityByContext={{ LIVE_MARKET: 9 }}>
          <div>hide</div>
        </AutoTradeContextSection>
      </>
    );
    const sections = collectSections(children, 'LIVE_MARKET');
    expect(sections.map((s) => s.id)).toEqual(['show']);
  });

  it('비-AutoTradeContextSection children 은 무시', () => {
    const children = (
      <>
        <div>raw div</div>
        <AutoTradeContextSection id="real" priorityByContext={{ LIVE_MARKET: 1 }}>
          <div>real</div>
        </AutoTradeContextSection>
        <span>raw span</span>
      </>
    );
    const sections = collectSections(children, 'LIVE_MARKET');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).toBe('real');
  });

  it('미지정 priorityByContext 는 DEFAULT(5) 적용 후 정렬', () => {
    const children = (
      <>
        <AutoTradeContextSection id="default-prio">
          <div>D</div>
        </AutoTradeContextSection>
        <AutoTradeContextSection id="explicit-low" priorityByContext={{ LIVE_MARKET: 1 }}>
          <div>L</div>
        </AutoTradeContextSection>
      </>
    );
    const sections = collectSections(children, 'LIVE_MARKET');
    expect(sections.map((s) => s.id)).toEqual(['explicit-low', 'default-prio']);
    expect(sections[1]!.priority).toBe(DEFAULT_CONTEXT_PRIORITY);
  });

  it('collapsed 메타데이터가 결과에 보존됨', () => {
    const children = (
      <>
        <AutoTradeContextSection
          id="c1"
          priorityByContext={{ WEEKEND_HOLIDAY: 3 }}
          collapsedByContext={{ WEEKEND_HOLIDAY: true }}
        >
          <div>collapsed</div>
        </AutoTradeContextSection>
      </>
    );
    const sections = collectSections(children, 'WEEKEND_HOLIDAY');
    expect(sections[0]!.collapsed).toBe(true);
  });
});
