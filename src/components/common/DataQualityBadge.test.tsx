// @vitest-environment jsdom
/**
 * @responsibility DataQualityBadge 5-tier 격상 회귀 테스트 (ADR-0095 PR-Phase-A-2)
 *
 * 검증 항목:
 * 1) 3-tier (computed/api/aiInferred) 항상 표시
 * 2) delayed > 0 시 ⏳ 표시 (자동 사다리 격상 가시화)
 * 3) manual > 0 시 ✏️ 표시
 * 4) delayed=0 + manual=0 일 때 자동 생략 (UI 간결성 보존)
 * 5) total=0 일 때 "데이터 부족" 표시
 * 6) sourceMetaAvailable=false 일 때 ? 아이콘 표시 (PR-A 휴리스틱 fallback)
 * 7) compact / !compact 두 모드 모두 5-tier 격상
 * 8) useUILang() 라벨 사용 — UI_LANG.tier SSOT 정합 (KO 라벨)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DataQualityBadge } from './DataQualityBadge';
import type { DataQualityCount } from '../../types/ui';
import { useSettingsStore } from '../../stores/useSettingsStore';

// ADR-0109 PR-Verbose-Wiring-4: DataQualityBadge default 'balanced' 라 무영향이지만
// 명시적 보호 — minimal 시 미렌더 회귀 차단 위해 balanced 강제.
beforeEach(() => {
  useSettingsStore.getState().setUIVerbosity('balanced');
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

describe('DataQualityBadge — ADR-0095 5-tier 격상', () => {
  it('total=0 → "데이터 부족" 표시', () => {
    const { container } = render(<DataQualityBadge count={makeCount()} />);
    expect(container.textContent).toContain('데이터 부족');
  });

  it('compact 모드 — 3-tier 항상 표시 (기존 후방호환)', () => {
    const count = makeCount({ computed: 18, api: 6, aiInferred: 3, total: 27, tier: 'HIGH', sourceMetaAvailable: true });
    const { container } = render(<DataQualityBadge count={count} />);
    expect(container.textContent).toContain('18');
    expect(container.textContent).toContain('6');
    expect(container.textContent).toContain('3');
    expect(container.textContent).toContain('🟢');
    expect(container.textContent).toContain('🟡');
    expect(container.textContent).toContain('🔴');
  });

  it('compact 모드 — delayed > 0 시 ⏳ 표시 (5-tier 격상 가시화)', () => {
    const count = makeCount({ computed: 18, api: 6, aiInferred: 3, delayed: 2, total: 29, tier: 'HIGH', sourceMetaAvailable: true });
    const { container } = render(<DataQualityBadge count={count} />);
    expect(container.textContent).toContain('⏳');
    expect(container.textContent).toContain('2');
  });

  it('compact 모드 — manual > 0 시 ✏️ 표시', () => {
    const count = makeCount({ computed: 18, api: 6, aiInferred: 3, manual: 1, total: 28, tier: 'HIGH', sourceMetaAvailable: true });
    const { container } = render(<DataQualityBadge count={count} />);
    expect(container.textContent).toContain('✏️');
    expect(container.textContent).toContain('1');
  });

  it('compact 모드 — delayed=0 + manual=0 → 자동 생략 (UI 간결성)', () => {
    const count = makeCount({ computed: 18, api: 6, aiInferred: 3, total: 27, tier: 'HIGH', sourceMetaAvailable: true });
    const { container } = render(<DataQualityBadge count={count} />);
    expect(container.textContent).not.toContain('⏳');
    expect(container.textContent).not.toContain('✏️');
  });

  it('compact 모드 — 5-tier 모두 > 0 시 모두 표시', () => {
    const count = makeCount({ computed: 18, api: 6, aiInferred: 3, delayed: 2, manual: 1, total: 30, tier: 'HIGH', sourceMetaAvailable: true });
    const { container } = render(<DataQualityBadge count={count} />);
    expect(container.textContent).toContain('🟢');
    expect(container.textContent).toContain('🟡');
    expect(container.textContent).toContain('🔴');
    expect(container.textContent).toContain('⏳');
    expect(container.textContent).toContain('✏️');
  });

  it('compact 모드 — sourceMetaAvailable=false → ? 아이콘 표시', () => {
    const count = makeCount({ computed: 9, api: 5, aiInferred: 1, total: 15, tier: 'HIGH', sourceMetaAvailable: false });
    const { container } = render(<DataQualityBadge count={count} />);
    // HelpCircle 아이콘은 lucide-react SVG 라 svg 요소 검색
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('compact 모드 — sourceMetaAvailable=true → ? 아이콘 부재', () => {
    const count = makeCount({ computed: 9, api: 5, aiInferred: 1, total: 15, tier: 'HIGH', sourceMetaAvailable: true });
    const { container } = render(<DataQualityBadge count={count} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeNull();
  });

  it('!compact 모드 — UI_LANG.tier SSOT 라벨 사용 (실측/API 수신/AI 추정)', () => {
    const count = makeCount({ computed: 9, api: 11, aiInferred: 7, total: 27, tier: 'HIGH', sourceMetaAvailable: true });
    const { container } = render(<DataQualityBadge count={count} compact={false} />);
    // UI_LANG.tier 의 한국어 라벨 노출 확인
    expect(container.textContent).toContain('실측');
    expect(container.textContent).toContain('API 수신');
    expect(container.textContent).toContain('AI 추정');
  });

  it('!compact 모드 — delayed > 0 시 "지연 데이터" 라벨 표시', () => {
    const count = makeCount({ computed: 9, delayed: 3, total: 12, tier: 'HIGH', sourceMetaAvailable: true });
    const { container } = render(<DataQualityBadge count={count} compact={false} />);
    expect(container.textContent).toContain('지연 데이터');
  });

  it('!compact 모드 — manual > 0 시 "수동 입력" 라벨 표시', () => {
    const count = makeCount({ computed: 9, manual: 2, total: 11, tier: 'HIGH', sourceMetaAvailable: true });
    const { container } = render(<DataQualityBadge count={count} compact={false} />);
    expect(container.textContent).toContain('수동 입력');
  });

  it('!compact 모드 — sourceMetaAvailable=false → "5-tier 메타 도입 시 정확도 격상" 안내', () => {
    const count = makeCount({ computed: 9, api: 5, aiInferred: 1, total: 15, tier: 'HIGH', sourceMetaAvailable: false });
    const { container } = render(<DataQualityBadge count={count} compact={false} />);
    expect(container.textContent).toContain('5-tier 메타 도입');
  });

  it('aria-label 5-tier 정합 (compact, delayed > 0)', () => {
    const count = makeCount({ computed: 9, api: 5, aiInferred: 1, delayed: 2, total: 17, tier: 'HIGH', sourceMetaAvailable: true });
    const { getByRole } = render(<DataQualityBadge count={count} />);
    const badge = getByRole('img');
    const aria = badge.getAttribute('aria-label') ?? '';
    expect(aria).toContain('실측 9');
    expect(aria).toContain('API 수신 5');
    expect(aria).toContain('AI 추정 1');
    expect(aria).toContain('지연 데이터 2');
  });

  it('aria-label 후방호환 — manual=0 시 manual 부분 부재', () => {
    const count = makeCount({ computed: 9, api: 5, aiInferred: 1, total: 15, tier: 'HIGH', sourceMetaAvailable: true });
    const { getByRole } = render(<DataQualityBadge count={count} />);
    const badge = getByRole('img');
    const aria = badge.getAttribute('aria-label') ?? '';
    expect(aria).not.toContain('수동 입력');
  });
});
