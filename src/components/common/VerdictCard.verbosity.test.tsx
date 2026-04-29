// @vitest-environment jsdom
/**
 * @responsibility VerdictCard verbosity wiring 회귀 (ADR-0101 PR-Verbose-Wiring-1)
 *
 * 검증 항목:
 * 1) variant='verdict' + balanced (기본) → V-E-R 3 슬롯 + TimeBand 모두 렌더
 * 2) variant='verdict' + minimal → Verdict slot 만 렌더, Evidence/Risk/TimeBand 미렌더
 * 3) variant='verdict' + verbose → V-E-R 3 슬롯 + TimeBand 모두 렌더 (balanced 와 동일)
 * 4) variant='default' → verbosity 무영향 (기존 동작 보존, 회귀 위험 0)
 * 5) forceShow override — props 명시 시 useUIVerbosity 무시 (특수 케이스)
 * 6) Evidence/Risk slot 단독 사용 — useUIVerbosity 분기 작동
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { VerdictCard } from './VerdictCard';
import { useSettingsStore } from '../../stores/useSettingsStore';

beforeEach(() => {
  useSettingsStore.getState().setUIVerbosity('balanced');
});

afterEach(() => cleanup());

const T0 = new Date('2026-04-29T00:00:00Z').getTime();
const T_END = new Date('2026-04-29T10:00:00Z').getTime();

describe('VerdictCard — verbosity wiring (ADR-0101)', () => {
  // ============================================================
  // 1) balanced (기본) — V-E-R 3 슬롯 + TimeBand 모두 렌더
  // ============================================================
  it('balanced: V-E-R 3 슬롯 + TimeBand 모두 렌더 (기존 동작 보존)', () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(
      <VerdictCard variant="verdict" createdAt={T0} expiresAt={T_END} nowProvider={() => T0}>
        <VerdictCard.Verdict verdict="STRONG_BUY" regime="R2_BULL" />
        <VerdictCard.Evidence>외인 5일 +120억</VerdictCard.Evidence>
        <VerdictCard.Risk stopLoss={9500} entryPrice={10000} />
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-slot="verdict"]')).not.toBeNull();
    expect(container.querySelector('[data-vcard-slot="evidence"]')).not.toBeNull();
    expect(container.querySelector('[data-vcard-slot="risk"]')).not.toBeNull();
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull(); // TimeBand
  });

  // ============================================================
  // 2) minimal — Verdict slot 만, Evidence/Risk/TimeBand 미렌더
  // ============================================================
  it('minimal: Verdict slot 만 렌더 + Evidence/Risk/TimeBand 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(
      <VerdictCard variant="verdict" createdAt={T0} expiresAt={T_END} nowProvider={() => T0}>
        <VerdictCard.Verdict verdict="STRONG_BUY" regime="R2_BULL" />
        <VerdictCard.Evidence>외인 5일 +120억</VerdictCard.Evidence>
        <VerdictCard.Risk stopLoss={9500} entryPrice={10000} />
      </VerdictCard>,
    );
    // Verdict slot 항상 렌더
    expect(container.querySelector('[data-vcard-slot="verdict"]')).not.toBeNull();
    // Evidence / Risk / TimeBand 미렌더 (minimal 모드)
    expect(container.querySelector('[data-vcard-slot="evidence"]')).toBeNull();
    expect(container.querySelector('[data-vcard-slot="risk"]')).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    // 본문 contents 미노출
    expect(container.textContent).not.toContain('외인 5일 +120억');
    expect(container.textContent).not.toContain('9,500원');
  });

  it('minimal: Verdict 라벨은 표시 (강매수 후보)', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="STRONG_BUY" />
      </VerdictCard>,
    );
    expect(container.textContent).toContain('강매수 후보');
  });

  // ============================================================
  // 3) verbose — balanced 와 동일 (모든 슬롯 + TimeBand)
  // ============================================================
  it('verbose: V-E-R 3 슬롯 + TimeBand 모두 렌더 (balanced 와 동일)', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(
      <VerdictCard variant="verdict" createdAt={T0} expiresAt={T_END} nowProvider={() => T0}>
        <VerdictCard.Verdict verdict="STRONG_BUY" />
        <VerdictCard.Evidence>외인 5일 +120억</VerdictCard.Evidence>
        <VerdictCard.Risk stopLoss={9500} entryPrice={10000} />
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-slot="verdict"]')).not.toBeNull();
    expect(container.querySelector('[data-vcard-slot="evidence"]')).not.toBeNull();
    expect(container.querySelector('[data-vcard-slot="risk"]')).not.toBeNull();
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  // ============================================================
  // 4) variant='default' — verbosity 무영향 (Migration Gate 보존)
  // ============================================================
  it("variant='default' + minimal: verbosity 무영향 — children 그대로 렌더", () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(
      <VerdictCard variant="default">
        <div data-testid="custom-child">기존 카드 내용</div>
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-variant="default"]')).not.toBeNull();
    expect(container.textContent).toContain('기존 카드 내용');
  });

  it("variant 부재 (default) + balanced: 기존 동작 100% 보존", () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(
      <VerdictCard>
        <div>기본 카드</div>
      </VerdictCard>,
    );
    expect(container.textContent).toContain('기본 카드');
  });

  // ============================================================
  // 5) forceShow override — props 명시 시 useUIVerbosity 무시
  // ============================================================
  it('forceShow=true: minimal 모드에서도 EvidenceSlot 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="STRONG_BUY" />
        <VerdictCard.Evidence forceShow>강제 노출 evidence</VerdictCard.Evidence>
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-slot="evidence"]')).not.toBeNull();
    expect(container.textContent).toContain('강제 노출 evidence');
  });

  it('forceShow=false: balanced 모드에서도 RiskSlot 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="STRONG_BUY" />
        <VerdictCard.Risk stopLoss={9500} forceShow={false} />
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-slot="risk"]')).toBeNull();
  });

  // ============================================================
  // 6) Slot 단독 사용 (VerdictCard 외부)
  // ============================================================
  it('VerdictCard.Evidence 단독 사용 — minimal 시 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(<VerdictCard.Evidence>단독 evidence</VerdictCard.Evidence>);
    expect(container.querySelector('[data-vcard-slot="evidence"]')).toBeNull();
  });

  it('VerdictCard.Risk 단독 사용 — verbose 시 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('verbose');
    const { container } = render(<VerdictCard.Risk stopLoss={9500} />);
    expect(container.querySelector('[data-vcard-slot="risk"]')).not.toBeNull();
    expect(container.textContent).toContain('9,500원');
  });

  // ============================================================
  // 7) TimeBand 분기 — minimal 시 미렌더 (createdAt/expiresAt 있어도)
  // ============================================================
  it('TimeBand: minimal + createdAt/expiresAt 있어도 미렌더', () => {
    useSettingsStore.getState().setUIVerbosity('minimal');
    const { container } = render(
      <VerdictCard variant="verdict" createdAt={T0} expiresAt={T_END} nowProvider={() => T0}>
        <VerdictCard.Verdict verdict="STRONG_BUY" />
      </VerdictCard>,
    );
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('TimeBand: balanced + createdAt/expiresAt 있으면 렌더', () => {
    useSettingsStore.getState().setUIVerbosity('balanced');
    const { container } = render(
      <VerdictCard variant="verdict" createdAt={T0} expiresAt={T_END} nowProvider={() => T0}>
        <VerdictCard.Verdict verdict="STRONG_BUY" />
      </VerdictCard>,
    );
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
  });
});
