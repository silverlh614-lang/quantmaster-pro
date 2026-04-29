// @vitest-environment jsdom
/**
 * @responsibility ConfluenceMeter 4축 회귀 (ADR-0098 PR-Phase-D #9 #10)
 *
 * 검증 항목:
 * 1) 4 axes (Fundamental/Flow/Technical/Macro) 라벨 정확
 * 2) classifyAxisScore 3 분기 (STRONG ≥7 / NEUTRAL 5~7 / WEAK <5) 경계값
 * 3) classifyConfluence 4 분기 (CONVICTION ≥3 / CONFIDENT 2 / MIXED 1 / DIVERGENT 0)
 * 4) 축 결손 사유 자동 표기 (#9) — score < 5 시 reason 노출, ≥5 시 미노출
 * 5) reason 부재 시 "데이터 미수집" placeholder
 * 6) compact 모드 vs 풀 모드 분기
 * 7) 단방향 결합 (#10) — VerdictCard.Evidence 안 자식으로 박힘 + 단독 사용 가능
 * 8) ARIA 접근성 (role + aria-label + progressbar)
 * 9) 안전 가드 — 빈 배열 / NaN 점수
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ConfluenceMeter, classifyAxisScore, classifyConfluence, shouldShowReason, type ConfluenceAxis } from './ConfluenceMeter';
import { VerdictCard } from './VerdictCard';
import { useSettingsStore } from '../../stores/useSettingsStore';

// ADR-0102 PR-Verbose-Wiring-2 후속: ConfluenceMeter 가 verbose 모드 한정 렌더이므로
// 본 컴포넌트 본체 검증 시 verbose 강제. verbosity 분기 자체는 별도 ConfluenceMeter.verbosity.test.tsx
beforeEach(() => {
  useSettingsStore.getState().setUIVerbosity('verbose');
});

afterEach(() => cleanup());

describe('classifyAxisScore — 순수 함수 (ADR-0098)', () => {
  it('10 → STRONG', () => expect(classifyAxisScore(10)).toBe('STRONG'));
  it('7 boundary → STRONG', () => expect(classifyAxisScore(7)).toBe('STRONG'));
  it('6.99 → NEUTRAL', () => expect(classifyAxisScore(6.99)).toBe('NEUTRAL'));
  it('5 boundary → NEUTRAL', () => expect(classifyAxisScore(5)).toBe('NEUTRAL'));
  it('4.99 → WEAK', () => expect(classifyAxisScore(4.99)).toBe('WEAK'));
  it('0 → WEAK', () => expect(classifyAxisScore(0)).toBe('WEAK'));
  it('NaN 안전 fallback → WEAK', () => expect(classifyAxisScore(NaN)).toBe('WEAK'));
  it('Infinity 안전 fallback → WEAK', () => expect(classifyAxisScore(Infinity)).toBe('WEAK'));
});

describe('shouldShowReason — 순수 함수 (#9 결손 사유 표기)', () => {
  it('score >= 5 → false (사유 미노출)', () => {
    expect(shouldShowReason(7)).toBe(false);
    expect(shouldShowReason(5)).toBe(false);
    expect(shouldShowReason(10)).toBe(false);
  });
  it('score < 5 → true (사유 노출)', () => {
    expect(shouldShowReason(4.99)).toBe(true);
    expect(shouldShowReason(0)).toBe(true);
  });
  it('NaN → true (보수적 — 결손 표기)', () => {
    expect(shouldShowReason(NaN)).toBe(true);
  });
});

describe('classifyConfluence — 4 분기 종합 등급', () => {
  it('STRONG 4 → CONVICTION', () => {
    const axes: ConfluenceAxis[] = [
      { id: 'FUNDAMENTAL', score: 8 }, { id: 'FLOW', score: 8 },
      { id: 'TECHNICAL', score: 8 }, { id: 'MACRO', score: 8 },
    ];
    expect(classifyConfluence(axes)).toBe('CONVICTION');
  });
  it('STRONG 3 → CONVICTION', () => {
    const axes: ConfluenceAxis[] = [
      { id: 'FUNDAMENTAL', score: 8 }, { id: 'FLOW', score: 8 },
      { id: 'TECHNICAL', score: 8 }, { id: 'MACRO', score: 4 },
    ];
    expect(classifyConfluence(axes)).toBe('CONVICTION');
  });
  it('STRONG 2 → CONFIDENT', () => {
    const axes: ConfluenceAxis[] = [
      { id: 'FUNDAMENTAL', score: 8 }, { id: 'FLOW', score: 8 },
      { id: 'TECHNICAL', score: 5 }, { id: 'MACRO', score: 4 },
    ];
    expect(classifyConfluence(axes)).toBe('CONFIDENT');
  });
  it('STRONG 1 → MIXED', () => {
    const axes: ConfluenceAxis[] = [
      { id: 'FUNDAMENTAL', score: 8 }, { id: 'FLOW', score: 5 },
      { id: 'TECHNICAL', score: 4 }, { id: 'MACRO', score: 3 },
    ];
    expect(classifyConfluence(axes)).toBe('MIXED');
  });
  it('STRONG 0 → DIVERGENT', () => {
    const axes: ConfluenceAxis[] = [
      { id: 'FUNDAMENTAL', score: 4 }, { id: 'FLOW', score: 4 },
      { id: 'TECHNICAL', score: 3 }, { id: 'MACRO', score: 2 },
    ];
    expect(classifyConfluence(axes)).toBe('DIVERGENT');
  });
});

describe('ConfluenceMeter — 컴포넌트 회귀', () => {
  const fullAxes: ConfluenceAxis[] = [
    { id: 'FUNDAMENTAL', score: 8.2, reason: 'ROE 17.5% / OCF 양호' },
    { id: 'FLOW', score: 4.1, reason: '외인 5일 -50억' },
    { id: 'TECHNICAL', score: 7.8, reason: 'MA20 돌파 + RSI 62' },
    { id: 'MACRO', score: 3.2, reason: 'VKOSPI 28 (불안)' },
  ];

  // ============================================================
  // 4 축 라벨 + 점수
  // ============================================================
  it('4 축 라벨 모두 표시 (펀더멘털/수급/기술/매크로)', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    expect(container.textContent).toContain('펀더멘털');
    expect(container.textContent).toContain('수급');
    expect(container.textContent).toContain('기술');
    expect(container.textContent).toContain('매크로');
  });

  it('각 축 점수 표시 (소수점 1자리)', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    expect(container.textContent).toContain('8.2');
    expect(container.textContent).toContain('4.1');
    expect(container.textContent).toContain('7.8');
    expect(container.textContent).toContain('3.2');
  });

  it('data-confluence-axis 속성 (e2e 친화)', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    expect(container.querySelector('[data-confluence-axis="FUNDAMENTAL"]')).not.toBeNull();
    expect(container.querySelector('[data-confluence-axis="FLOW"]')).not.toBeNull();
    expect(container.querySelector('[data-confluence-axis="TECHNICAL"]')).not.toBeNull();
    expect(container.querySelector('[data-confluence-axis="MACRO"]')).not.toBeNull();
  });

  it('axis-tier 속성 — STRONG/NEUTRAL/WEAK', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    expect(container.querySelector('[data-confluence-axis="FUNDAMENTAL"]')?.getAttribute('data-confluence-axis-tier')).toBe('STRONG');
    expect(container.querySelector('[data-confluence-axis="FLOW"]')?.getAttribute('data-confluence-axis-tier')).toBe('WEAK');
    expect(container.querySelector('[data-confluence-axis="TECHNICAL"]')?.getAttribute('data-confluence-axis-tier')).toBe('STRONG');
    expect(container.querySelector('[data-confluence-axis="MACRO"]')?.getAttribute('data-confluence-axis-tier')).toBe('WEAK');
  });

  // ============================================================
  // 축 결손 사유 자동 표기 (#9)
  // ============================================================
  it('#9: WEAK 축 (score < 5) 만 reason 표시', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    expect(container.textContent).toContain('외인 5일 -50억'); // FLOW WEAK
    expect(container.textContent).toContain('VKOSPI 28 (불안)'); // MACRO WEAK
  });

  it('#9: STRONG/NEUTRAL 축 reason 미표시', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    // FUNDAMENTAL STRONG (8.2) reason 'ROE 17.5%' 는 *결손 사유 영역* 에 없어야 함
    const reasonEls = container.querySelectorAll('[data-confluence-axis-reason]');
    const reasonTexts = Array.from(reasonEls).map((el) => el.textContent);
    expect(reasonTexts).not.toContain('ROE 17.5% / OCF 양호'); // STRONG 축 reason 미노출
    expect(reasonTexts).not.toContain('MA20 돌파 + RSI 62'); // STRONG 축 reason 미노출
  });

  it('#9: WEAK 축 + reason 부재 → "데이터 미수집" placeholder', () => {
    const axes: ConfluenceAxis[] = [
      { id: 'FUNDAMENTAL', score: 3 }, // reason 없음
    ];
    const { container } = render(<ConfluenceMeter axes={axes} />);
    expect(container.textContent).toContain('데이터 미수집');
  });

  it('#9: 결손 사유 영역만 정확히 카운트 (data-confluence-axis-reason)', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    const reasonEls = container.querySelectorAll('[data-confluence-axis-reason]');
    expect(reasonEls.length).toBe(2); // FLOW + MACRO 만
  });

  // ============================================================
  // 종합 등급
  // ============================================================
  it('4 축 STRONG 2 → CONFIDENT 라벨', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    expect(container.textContent).toContain('확신');
    expect(container.querySelector('[data-confluence-overall="CONFIDENT"]')).not.toBeNull();
  });

  it('4 축 STRONG 3 → CONVICTION 라벨', () => {
    const axes: ConfluenceAxis[] = [
      { id: 'FUNDAMENTAL', score: 8 }, { id: 'FLOW', score: 8 },
      { id: 'TECHNICAL', score: 8 }, { id: 'MACRO', score: 4 },
    ];
    const { container } = render(<ConfluenceMeter axes={axes} />);
    expect(container.textContent).toContain('강한 합치');
    expect(container.querySelector('[data-confluence-overall="CONVICTION"]')).not.toBeNull();
  });

  it('4 축 STRONG 0 → DIVERGENT 라벨', () => {
    const axes: ConfluenceAxis[] = [
      { id: 'FUNDAMENTAL', score: 3 }, { id: 'FLOW', score: 2 },
      { id: 'TECHNICAL', score: 1 }, { id: 'MACRO', score: 0 },
    ];
    const { container } = render(<ConfluenceMeter axes={axes} />);
    expect(container.textContent).toContain('신호 충돌');
    expect(container.querySelector('[data-confluence-overall="DIVERGENT"]')).not.toBeNull();
  });

  // ============================================================
  // compact 모드
  // ============================================================
  it('compact 모드 — 4 막대만 표시 (라벨/사유 미노출)', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} compact />);
    // 라벨/사유 미노출
    expect(container.textContent).not.toContain('펀더멘털');
    expect(container.textContent).not.toContain('외인 5일 -50억');
    // 4 axis 데이터 속성은 보존
    expect(container.querySelectorAll('[data-confluence-axis]').length).toBe(4);
    // overall 마커
    expect(container.querySelector('[data-confluence-overall]')).not.toBeNull();
  });

  it('compact 모드 — title attribute 에 점수 hover', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} compact />);
    const fundamental = container.querySelector('[data-confluence-axis="FUNDAMENTAL"]');
    expect(fundamental?.getAttribute('title')).toContain('펀더멘털');
    expect(fundamental?.getAttribute('title')).toContain('8.2');
  });

  // ============================================================
  // 안전 가드
  // ============================================================
  it('빈 배열 → "합치도 데이터 미수집" placeholder', () => {
    const { container } = render(<ConfluenceMeter axes={[]} />);
    expect(container.textContent).toContain('합치도 데이터 미수집');
    expect(container.querySelector('[data-confluence-empty="true"]')).not.toBeNull();
  });

  it('NaN 점수 → WEAK 분류 + 사유 표시 의도', () => {
    const axes: ConfluenceAxis[] = [{ id: 'MACRO', score: NaN, reason: '데이터 오류' }];
    const { container } = render(<ConfluenceMeter axes={axes} />);
    expect(container.querySelector('[data-confluence-axis-tier="WEAK"]')).not.toBeNull();
    expect(container.textContent).toContain('데이터 오류');
  });

  // ============================================================
  // ARIA 접근성
  // ============================================================
  it('full 모드 — role="region" + aria-label 종합 등급', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-label')).toContain('확신');
  });

  it('각 축 progressbar — aria-valuenow 점수 비율', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    const progressbars = container.querySelectorAll('[role="progressbar"]');
    expect(progressbars.length).toBe(4);
    // FUNDAMENTAL 8.2 → 82%
    const fundBar = container.querySelector('[data-confluence-axis="FUNDAMENTAL"] [role="progressbar"]');
    expect(fundBar?.getAttribute('aria-valuenow')).toBe('82');
  });

  // ============================================================
  // 단방향 결합 (#10) — VerdictCard.Evidence 안 자식 + 단독 사용
  // ============================================================
  it('#10 단방향: VerdictCard.Evidence slot 안 자식으로 박힘', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="STRONG_BUY" regime="R2_BULL" />
        <VerdictCard.Evidence>
          <ConfluenceMeter axes={fullAxes} />
        </VerdictCard.Evidence>
      </VerdictCard>,
    );
    // VerdictCard 안에 ConfluenceMeter 가 정확히 렌더
    expect(container.querySelector('[data-vcard-slot="evidence"]')).not.toBeNull();
    expect(container.querySelector('[data-vcard-slot="evidence"] [data-confluence-overall]')).not.toBeNull();
    expect(container.textContent).toContain('펀더멘털');
    expect(container.textContent).toContain('확신');
  });

  it('#10 단방향: ConfluenceMeter 단독 사용 — VerdictCard 외부 (Screener 헤더 KPI 등)', () => {
    // ConfluenceMeter 가 VerdictCard 를 모름 — 어디서든 단독 사용 가능
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    expect(container.querySelector('[data-confluence-overall]')).not.toBeNull();
    // VerdictCard 마커 부재 — 단방향 확인
    expect(container.querySelector('[data-vcard-variant]')).toBeNull();
    expect(container.querySelector('[data-vcard-slot]')).toBeNull();
  });

  // ============================================================
  // 페르소나 정합 — 결손 사유가 *기다림 가능* vs *불가능* 구분 보조
  // ============================================================
  it('페르소나: WEAK FLOW (외인 -50억) 와 WEAK MACRO (VKOSPI 28) 같은 layout 에서 동시 노출', () => {
    const { container } = render(<ConfluenceMeter axes={fullAxes} />);
    const reasons = Array.from(container.querySelectorAll('[data-confluence-axis-reason]'));
    expect(reasons.length).toBe(2);
    // 사용자가 "기다림 가능" (FLOW — 다음 주 외인 매수 가능) vs "기다림 무의미" (MACRO — 시간 외 변수) 구분 보조
    expect(reasons.some((el) => el.textContent?.includes('외인'))).toBe(true);
    expect(reasons.some((el) => el.textContent?.includes('VKOSPI'))).toBe(true);
  });
});
