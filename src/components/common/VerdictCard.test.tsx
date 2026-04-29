// @vitest-environment jsdom
/**
 * @responsibility VerdictCard V-E-R compound 회귀 (ADR-0097 PR-Phase-C #6 #7 #8)
 *
 * 검증 항목:
 * 1) Migration Gate (#6) — variant='default' (기본) → 기본 카드 / variant='verdict' → V-E-R 모드
 * 2) 3 슬롯 모두 부재 시 자동 placeholder 다운그레이드
 * 3) Verdict slot — 5 OverallVerdict 라벨 + regime 표시 + 만료 시 "재검증 대기"
 * 4) Stop-loss First (#7) — 손절가 가장 큰 폰트 (text-2xl), invalidation 두 번째, target 가장 작게
 * 5) Time-band 띠 (#8) — createdAt/expiresAt 있을 때만 렌더, 만료 시 onExpire
 * 6) 라벨 SSOT — useUILang().card / .regime 정합 (ADR-0094)
 * 7) data-vcard-* 속성 (e2e 친화)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { VerdictCard } from './VerdictCard';

afterEach(() => cleanup());

describe('VerdictCard — Migration Gate (사용자 #6)', () => {
  it('variant 부재 → default 모드 (data-vcard-variant="default")', () => {
    const { container } = render(<VerdictCard>아무거나</VerdictCard>);
    const root = container.querySelector('[data-vcard-variant]');
    expect(root?.getAttribute('data-vcard-variant')).toBe('default');
  });

  it("variant='default' 명시 → default 모드", () => {
    const { container } = render(<VerdictCard variant="default">기본 카드</VerdictCard>);
    expect(container.querySelector('[data-vcard-variant="default"]')).not.toBeNull();
    expect(container.textContent).toContain('기본 카드');
  });

  it("variant='verdict' → V-E-R 모드", () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="STRONG_BUY" />
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-variant="verdict"]')).not.toBeNull();
  });

  it("variant='verdict' + children 부재 → placeholder 다운그레이드", () => {
    const { container } = render(<VerdictCard variant="verdict" />);
    expect(container.textContent).toContain('V-E-R 슬롯 미입력');
  });

  it("default 모드 + children 부재 → 정보 미수집 placeholder", () => {
    const { container } = render(<VerdictCard />);
    expect(container.textContent).toContain('정보 미수집');
  });
});

describe('VerdictCard.Verdict — slot (#6)', () => {
  it('STRONG_BUY 라벨 + UI_LANG.card SSOT 사용', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="STRONG_BUY" regime="R2_BULL" />
      </VerdictCard>,
    );
    expect(container.textContent).toContain('강매수 후보'); // UI_LANG.card.STRONG_BUY
    expect(container.querySelector('[data-vcard-verdict="STRONG_BUY"]')).not.toBeNull();
  });

  it('regime 라벨 — UI_LANG.regime SSOT 사용', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="BUY" regime="R6_DEFENSE" />
      </VerdictCard>,
    );
    expect(container.textContent).toContain('방어'); // UI_LANG.regime.R6_DEFENSE
    expect(container.querySelector('[data-vcard-regime="R6_DEFENSE"]')).not.toBeNull();
  });

  it('regime 미지정 시 표시 부재', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="HOLD" />
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-regime]')).toBeNull();
  });

  it('expired=true → "재검증 대기" 라벨 자동 전환', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="STRONG_BUY" expired />
      </VerdictCard>,
    );
    expect(container.textContent).toContain('재검증 대기');
    expect(container.textContent).not.toContain('강매수 후보');
    expect(container.querySelector('[data-vcard-expired="true"]')).not.toBeNull();
  });

  it('5 OverallVerdict 모두 라벨 정합 (CAUTION → AVOID 흡수)', () => {
    const verdicts = ['STRONG_BUY', 'BUY', 'HOLD', 'CAUTION', 'AVOID'] as const;
    for (const v of verdicts) {
      const { container, unmount } = render(
        <VerdictCard variant="verdict">
          <VerdictCard.Verdict verdict={v} />
        </VerdictCard>,
      );
      expect(container.querySelector(`[data-vcard-verdict="${v}"]`)).not.toBeNull();
      unmount();
    }
  });
});

describe('VerdictCard.Risk — Stop-loss First 디자인 (#7)', () => {
  it('손절가 가장 큰 폰트 (text-2xl 클래스)', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Risk stopLoss={9500} entryPrice={10000} targetPrice={11000} />
      </VerdictCard>,
    );
    const stopLoss = container.querySelector('[data-vcard-risk="stop-loss"]');
    expect(stopLoss).not.toBeNull();
    expect(stopLoss?.className).toContain('text-2xl');
  });

  it('손절가 표시 — 정수 포맷팅 (9,500원)', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Risk stopLoss={9500} />
      </VerdictCard>,
    );
    expect(container.textContent).toContain('9,500원');
  });

  it('손절 % 산출 — entryPrice 있을 때 (-5.0%)', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Risk stopLoss={9500} entryPrice={10000} />
      </VerdictCard>,
    );
    expect(container.textContent).toContain('-5.0%');
  });

  it('손절 % 부재 — entryPrice 미지정 시 % 표시 안 함', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Risk stopLoss={9500} />
      </VerdictCard>,
    );
    expect(container.textContent).not.toContain('%');
  });

  it('invalidation 두 번째 강조 (text-sm)', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Risk stopLoss={9500} invalidation="박스권 하단 이탈" />
      </VerdictCard>,
    );
    const inv = container.querySelector('[data-vcard-risk="invalidation"]');
    expect(inv).not.toBeNull();
    expect(inv?.className).toContain('text-sm');
    expect(container.textContent).toContain('박스권 하단 이탈');
    expect(container.textContent).toContain('무효화 조건');
  });

  it('target 가장 작은 폰트 (text-xs)', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Risk stopLoss={9500} targetPrice={11000} />
      </VerdictCard>,
    );
    const target = container.querySelector('[data-vcard-risk="target"]')?.parentElement;
    expect(target?.className).toContain('text-xs');
    expect(container.textContent).toContain('11,000원');
  });

  it('scenarios — 가장 작은 폰트 + 리스트 표시', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Risk stopLoss={9500} scenarios={['긍정 +20%', '부정 -10%']} />
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-risk="scenarios"]')).not.toBeNull();
    expect(container.textContent).toContain('긍정 +20%');
    expect(container.textContent).toContain('부정 -10%');
  });

  it('Stop-loss First 폰트 위계 — stop-loss > invalidation > target', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Risk
          stopLoss={9500}
          entryPrice={10000}
          invalidation="박스권 하단 이탈"
          targetPrice={11000}
        />
      </VerdictCard>,
    );
    const stopLossClass = container.querySelector('[data-vcard-risk="stop-loss"]')?.className ?? '';
    const invalidationClass = container.querySelector('[data-vcard-risk="invalidation"]')?.className ?? '';
    const targetClass = container.querySelector('[data-vcard-risk="target"]')?.parentElement?.className ?? '';

    expect(stopLossClass).toContain('text-2xl'); // 가장 큰
    expect(invalidationClass).toContain('text-sm'); // 두 번째
    expect(targetClass).toContain('text-xs'); // 가장 작은
  });

  it('NaN/Infinity 손절가 — "—" 안전 fallback', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Risk stopLoss={NaN} />
      </VerdictCard>,
    );
    expect(container.textContent).toContain('—');
  });
});

describe('VerdictCard.Evidence — slot', () => {
  it('children 표시', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Evidence>
          <div>외인 5일 순매수 +120억</div>
        </VerdictCard.Evidence>
      </VerdictCard>,
    );
    expect(container.textContent).toContain('외인 5일 순매수');
  });

  it('children 부재 → "근거 미수집" placeholder', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Evidence />
      </VerdictCard>,
    );
    expect(container.textContent).toContain('근거 미수집');
  });
});

describe('VerdictCard — Time-band (#8)', () => {
  const T0 = new Date('2026-04-29T00:00:00Z').getTime();
  const T_END = new Date('2026-04-29T10:00:00Z').getTime();

  it('createdAt + expiresAt 있을 때 TimeBand 렌더', () => {
    const { container } = render(
      <VerdictCard variant="verdict" createdAt={T0} expiresAt={T_END} nowProvider={() => T0}>
        <VerdictCard.Verdict verdict="STRONG_BUY" />
      </VerdictCard>,
    );
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  it('createdAt 부재 시 TimeBand 미렌더', () => {
    const { container } = render(
      <VerdictCard variant="verdict">
        <VerdictCard.Verdict verdict="STRONG_BUY" />
      </VerdictCard>,
    );
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('만료 도달 → onExpire 콜백 호출 + data-vcard-expired="true" 마커', () => {
    const onExpire = vi.fn();
    const { container } = render(
      <VerdictCard
        variant="verdict"
        createdAt={T0}
        expiresAt={T_END}
        nowProvider={() => T_END}
        onExpire={onExpire}
      >
        <VerdictCard.Verdict verdict="STRONG_BUY" />
      </VerdictCard>,
    );
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-vcard-variant="verdict"][data-vcard-expired="true"]')).not.toBeNull();
  });

  it('만료 전 — onExpire 미호출 + expired=false', () => {
    const onExpire = vi.fn();
    const { container } = render(
      <VerdictCard
        variant="verdict"
        createdAt={T0}
        expiresAt={T_END}
        nowProvider={() => T0 + 3600_000}
        onExpire={onExpire}
      >
        <VerdictCard.Verdict verdict="STRONG_BUY" />
      </VerdictCard>,
    );
    expect(onExpire).not.toHaveBeenCalled();
    expect(container.querySelector('[data-vcard-expired="false"]')).not.toBeNull();
  });
});

describe('VerdictCard — 통합 (3 슬롯 모두 사용)', () => {
  const T0 = new Date('2026-04-29T00:00:00Z').getTime();
  const T_END = new Date('2026-04-29T10:00:00Z').getTime();

  it('V + E + R + Time-band 모두 렌더', () => {
    const { container } = render(
      <VerdictCard variant="verdict" createdAt={T0} expiresAt={T_END} nowProvider={() => T0 + 5 * 3600_000}>
        <VerdictCard.Verdict verdict="STRONG_BUY" regime="R2_BULL" />
        <VerdictCard.Evidence>
          <div>외인 5일 +120억 / RRR 3.2 / 가속도 +2.1σ</div>
        </VerdictCard.Evidence>
        <VerdictCard.Risk
          stopLoss={9500}
          entryPrice={10000}
          invalidation="박스권 하단 이탈"
          targetPrice={11000}
          scenarios={['긍정 +20%', '부정 -10%']}
        />
      </VerdictCard>,
    );

    expect(container.textContent).toContain('강매수 후보'); // Verdict
    expect(container.textContent).toContain('안정 강세'); // Regime
    expect(container.textContent).toContain('외인 5일 +120억'); // Evidence
    expect(container.textContent).toContain('9,500원'); // Stop-loss First
    expect(container.textContent).toContain('-5.0%'); // 손절 %
    expect(container.textContent).toContain('박스권 하단 이탈'); // Invalidation
    expect(container.textContent).toContain('11,000원'); // Target (작게)
    expect(container.textContent).toContain('긍정 +20%'); // Scenarios
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull(); // TimeBand
  });

  it('className prop 전파', () => {
    const { container } = render(
      <VerdictCard variant="verdict" className="my-vcard">
        <VerdictCard.Verdict verdict="HOLD" />
      </VerdictCard>,
    );
    expect(container.querySelector('[data-vcard-variant="verdict"]')?.className).toContain('my-vcard');
  });
});
