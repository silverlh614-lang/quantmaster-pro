// @vitest-environment jsdom
/**
 * @responsibility ConfluenceMeter verbosity wiring 회귀 (ADR-0102 PR-Verbose-Wiring-2)
 *
 * 검증 항목:
 * 1) verbose 모드 → 렌더
 * 2) balanced 모드 → 미렌더 (null 반환)
 * 3) minimal 모드 → 미렌더
 * 4) forceShow=true override → 모든 모드에서 렌더
 * 5) forceShow=false override → verbose 에서도 미렌더
 * 6) VerdictCard.Evidence 안 임베드 시 — verbose 모드에서만 렌더 (이중 분기 안전)
 * 7) compact 모드 — verbosity 분기 동일 적용
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ConfluenceMeter, type ConfluenceAxis } from './ConfluenceMeter';
import { VerdictCard } from './VerdictCard';
import { useSettingsStore } from '../../stores/useSettingsStore';

beforeEach(() => {
  useSettingsStore.getState().setUIVerbosity('balanced');
});

afterEach(() => cleanup());

const axes: ConfluenceAxis[] = [
  { id: 'FUNDAMENTAL', score: 8.2, reason: 'ROE 17.5%' },
  { id: 'FLOW', score: 4.1, reason: '외인 5일 -50억' },
  { id: 'TECHNICAL', score: 7.8 },
  { id: 'MACRO', score: 3.2, reason: 'VKOSPI 28' },
];

describe('ConfluenceMeter — verbosity wiring (ADR-0102)', () => {
  it('verbose 모드 → 렌더 (4 축 모두 표시)', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<ConfluenceMeter axes={axes} />);
    expect(container.querySelector('[data-confluence-overall]')).not.toBeNull();
    expect(container.querySelectorAll('[data-confluence-axis]').length).toBe(4);
  });

  it('balanced 모드 → 미렌더 (null 반환)', () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(<ConfluenceMeter axes={axes} />);
    expect(container.querySelector('[data-confluence-overall]')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('minimal 모드 → 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<ConfluenceMeter axes={axes} />);
    expect(container.querySelector('[data-confluence-overall]')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('forceShow=true: balanced 시에도 렌더 (override)', () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(<ConfluenceMeter axes={axes} forceShow />);
    expect(container.querySelector('[data-confluence-overall]')).not.toBeNull();
  });

  it('forceShow=true: minimal 시에도 렌더 (override)', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<ConfluenceMeter axes={axes} forceShow />);
    expect(container.querySelector('[data-confluence-overall]')).not.toBeNull();
  });

  it('forceShow=false: verbose 시에도 미렌더 (강제 차단)', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<ConfluenceMeter axes={axes} forceShow={false} />);
    expect(container.querySelector('[data-confluence-overall]')).toBeNull();
  });

  it('compact 모드 — verbosity 분기 동일 적용 (balanced 미렌더)', () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(<ConfluenceMeter axes={axes} compact />);
    expect(container.querySelector('[data-confluence-overall]')).toBeNull();
  });

  it('compact 모드 — verbose 시 4 막대만 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<ConfluenceMeter axes={axes} compact />);
    expect(container.querySelector('[data-confluence-overall]')).not.toBeNull();
    expect(container.textContent).not.toContain('펀더멘털'); // compact 라 라벨 미노출
  });

  // ============================================================
  // VerdictCard.Evidence 안 임베드 시 이중 분기 안전성 (#10 단방향 결합)
  // ============================================================
  it('VerdictCard.Evidence 안 임베드: balanced → Evidence 자체는 렌더되지만 ConfluenceMeter 만 미렌더', () => {
    // VerdictCard.Evidence 는 balanced 에서 렌더 (shouldShow('evidence')=true)
    // ConfluenceMeter 는 balanced 에서 미렌더 (shouldShow('confluence')=false)
    // → Evidence 컨테이너는 표시되지만 안의 ConfluenceMeter 는 null
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="STRONG_BUY" />
        <VerdictCard.Evidence>
          <ConfluenceMeter axes={axes} />
        </VerdictCard.Evidence>
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-slot="evidence"]')).not.toBeNull();
    expect(container.querySelector('[data-confluence-overall]')).toBeNull();
  });

  it('VerdictCard.Evidence 안 임베드: verbose → Evidence + ConfluenceMeter 모두 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="STRONG_BUY" />
        <VerdictCard.Evidence>
          <ConfluenceMeter axes={axes} />
        </VerdictCard.Evidence>
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-slot="evidence"]')).not.toBeNull();
    expect(container.querySelector('[data-confluence-overall]')).not.toBeNull();
  });

  it('VerdictCard.Evidence 안 임베드: minimal → Evidence + ConfluenceMeter 모두 미렌더 (이중 차단)', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="STRONG_BUY" />
        <VerdictCard.Evidence>
          <ConfluenceMeter axes={axes} />
        </VerdictCard.Evidence>
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-slot="evidence"]')).toBeNull();
    expect(container.querySelector('[data-confluence-overall]')).toBeNull();
  });

  // ============================================================
  // 기존 Slot 단독 사용 (Screener / Backtest 헤더 KPI 등) — verbose 한정
  // ============================================================
  it('단독 사용 + verbose: 어디서든 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<ConfluenceMeter axes={axes} />);
    // VerdictCard 마커 부재 — 단방향 결합 보존 (#10)
    expect(container.querySelector('[data-vcard-variant]')).toBeNull();
    expect(container.querySelector('[data-confluence-overall]')).not.toBeNull();
  });

  it('빈 axes + verbose: empty placeholder 표시', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<ConfluenceMeter axes={[]} />);
    expect(container.querySelector('[data-confluence-empty]')).not.toBeNull();
  });

  it('빈 axes + balanced: 미렌더 (verbosity 우선)', () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(<ConfluenceMeter axes={[]} />);
    expect(container.querySelector('[data-confluence-empty]')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
