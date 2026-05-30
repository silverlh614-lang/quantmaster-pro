// @vitest-environment jsdom
/**
 * @responsibility DataConfidenceBadge semantic visibility regression tests.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DataConfidenceBadge, type DataConfidence } from './DataConfidenceBadge';
import { ConfidenceBadge } from './ConfidenceBadge';

const CONFIDENCES: DataConfidence[] = ['VERIFIED', 'DEGRADED', 'STALE', 'MISSING', 'AI_ESTIMATED', 'UNKNOWN'];

describe('DataConfidenceBadge', () => {
  it('renders every data trust state with data-confidence metadata', () => {
    for (const confidence of CONFIDENCES) {
      const { container, unmount } = render(<DataConfidenceBadge confidence={confidence} compact />);
      const badge = container.querySelector('[data-confidence]');
      expect(badge?.getAttribute('data-confidence')).toBe(confidence);
      expect(container.textContent).not.toHaveLength(0);
      unmount();
    }
  });

  it('shows source and updatedAt in non-compact tooltip and visible metadata', () => {
    const { container } = render(
      <DataConfidenceBadge confidence="STALE" source="KIS fallback" updatedAt="2026-05-17" />,
    );
    expect(container.textContent).toContain('via KIS fallback');
    expect(container.textContent).toContain('2026-05-17');
    expect(container.firstElementChild?.getAttribute('title')).toContain('Source: KIS fallback');
    expect(container.firstElementChild?.getAttribute('title')).toContain('Updated: 2026-05-17');
  });

  it('clearly marks AI estimated data as not verified calculation', () => {
    const { container } = render(<DataConfidenceBadge confidence="AI_ESTIMATED" />);
    expect(container.textContent).toContain('AI 추정');
    expect(container.firstElementChild?.getAttribute('title')).toContain('실계산값이 아니며');
  });

  it('legacy ConfidenceBadge maps data source types to strengthened confidence states', () => {
    const { container, rerender } = render(<ConfidenceBadge type="REALTIME" />);
    expect(container.querySelector('[data-confidence]')?.getAttribute('data-confidence')).toBe('VERIFIED');

    rerender(<ConfidenceBadge type="NAVER" />);
    expect(container.querySelector('[data-confidence]')?.getAttribute('data-confidence')).toBe('DEGRADED');
    expect(container.textContent).toContain('Naver 시세');

    // YAHOO 는 사용자 정책상 신뢰 철회 — 잔존 데이터 호환을 위해 매핑은 유지하되
    // STALE 등급으로 강등 표기 ("Yahoo (사용 중단)").
    rerender(<ConfidenceBadge type="YAHOO" />);
    expect(container.querySelector('[data-confidence]')?.getAttribute('data-confidence')).toBe('STALE');
    expect(container.textContent).toContain('사용 중단');

    rerender(<ConfidenceBadge type="AI" />);
    expect(container.querySelector('[data-confidence]')?.getAttribute('data-confidence')).toBe('AI_ESTIMATED');

    rerender(<ConfidenceBadge type="STALE" />);
    expect(container.querySelector('[data-confidence]')?.getAttribute('data-confidence')).toBe('STALE');
  });
});
