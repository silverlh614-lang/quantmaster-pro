// @vitest-environment jsdom
/**
 * @responsibility TimeBand 회귀 (ADR-0097 PR-Phase-C #8)
 *
 * 검증 항목:
 * 1) computeRemainingPct 순수 함수 — 다양한 시점 진행률
 * 2) classifyTimeBandGrade 4 분기 (FRESH/AGING/STALE/EXPIRED) 경계값
 * 3) 안전 가드 — 잘못된 입력 (NaN/Infinity/createdAt≥expiresAt) → 0 만료 취급
 * 4) Ribbon 컴포넌트 — width/grade 속성 (e2e)
 * 5) onExpire 콜백 — 만료 도달 시 1회 호출
 * 6) ARIA progressbar 접근성
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TimeBand, computeRemainingPct, classifyTimeBandGrade } from './TimeBand';

afterEach(() => cleanup());

describe('computeRemainingPct — 순수 함수 (ADR-0097)', () => {
  const T0 = new Date('2026-04-29T00:00:00Z').getTime();
  const T_END = new Date('2026-04-29T10:00:00Z').getTime(); // 10시간

  it('시작 시점 (now=createdAt) → remainingPct=1.0', () => {
    expect(computeRemainingPct(T0, T_END, T0)).toBe(1);
  });

  it('중간 시점 (50% 경과) → remainingPct=0.5', () => {
    expect(computeRemainingPct(T0, T_END, T0 + 5 * 3600_000)).toBeCloseTo(0.5, 5);
  });

  it('80% 경과 → remainingPct=0.2', () => {
    expect(computeRemainingPct(T0, T_END, T0 + 8 * 3600_000)).toBeCloseTo(0.2, 5);
  });

  it('만료 시점 (now=expiresAt) → 0', () => {
    expect(computeRemainingPct(T0, T_END, T_END)).toBe(0);
  });

  it('만료 후 → 0', () => {
    expect(computeRemainingPct(T0, T_END, T_END + 3600_000)).toBe(0);
  });

  it('시작 전 → 1.0 (clamp)', () => {
    expect(computeRemainingPct(T0, T_END, T0 - 3600_000)).toBe(1);
  });

  it('createdAt ≥ expiresAt → 0 (보수적 만료)', () => {
    expect(computeRemainingPct(T_END, T0, T0)).toBe(0);
    expect(computeRemainingPct(T0, T0, T0)).toBe(0);
  });

  it('NaN 입력 → 0', () => {
    expect(computeRemainingPct(NaN as unknown as number, T_END, T0)).toBe(0);
    expect(computeRemainingPct(T0, NaN as unknown as number, T0)).toBe(0);
  });

  it('ISO 문자열 / Date 객체 입력 동작', () => {
    expect(computeRemainingPct('2026-04-29T00:00:00Z', '2026-04-29T10:00:00Z', T0 + 5 * 3600_000)).toBeCloseTo(0.5, 5);
    expect(computeRemainingPct(new Date(T0), new Date(T_END), T0)).toBe(1);
  });
});

describe('classifyTimeBandGrade — 4 분기 (ADR-0097)', () => {
  it('1.0 → FRESH', () => expect(classifyTimeBandGrade(1.0)).toBe('FRESH'));
  it('0.51 → FRESH', () => expect(classifyTimeBandGrade(0.51)).toBe('FRESH'));
  it('0.5 boundary → AGING', () => expect(classifyTimeBandGrade(0.5)).toBe('AGING'));
  it('0.21 → AGING', () => expect(classifyTimeBandGrade(0.21)).toBe('AGING'));
  it('0.2 boundary → STALE', () => expect(classifyTimeBandGrade(0.2)).toBe('STALE'));
  it('0.05 → STALE', () => expect(classifyTimeBandGrade(0.05)).toBe('STALE'));
  it('0 → EXPIRED', () => expect(classifyTimeBandGrade(0)).toBe('EXPIRED'));
  it('음수 (방어) → EXPIRED', () => expect(classifyTimeBandGrade(-0.1)).toBe('EXPIRED'));
});

describe('TimeBand 컴포넌트 회귀 (ADR-0097)', () => {
  const T0 = new Date('2026-04-29T00:00:00Z').getTime();
  const T_END = new Date('2026-04-29T10:00:00Z').getTime();

  it('초기 상태 — FRESH grade + width 100%', () => {
    const { container } = render(
      <TimeBand createdAt={T0} expiresAt={T_END} nowProvider={() => T0} />,
    );
    const el = container.querySelector('[data-time-band-grade]');
    expect(el?.getAttribute('data-time-band-grade')).toBe('FRESH');
    expect(el?.getAttribute('data-time-band-pct')).toBe('100');
  });

  it('50% 경과 → AGING grade + width 50%', () => {
    const { container } = render(
      <TimeBand createdAt={T0} expiresAt={T_END} nowProvider={() => T0 + 5 * 3600_000} />,
    );
    const el = container.querySelector('[data-time-band-grade]');
    expect(el?.getAttribute('data-time-band-grade')).toBe('AGING');
    expect(el?.getAttribute('data-time-band-pct')).toBe('50');
  });

  it('만료 → EXPIRED grade + width 0%', () => {
    const { container } = render(
      <TimeBand createdAt={T0} expiresAt={T_END} nowProvider={() => T_END + 3600_000} />,
    );
    const el = container.querySelector('[data-time-band-grade]');
    expect(el?.getAttribute('data-time-band-grade')).toBe('EXPIRED');
    expect(el?.getAttribute('data-time-band-pct')).toBe('0');
  });

  it('STALE grade — 5% 잔여 시 적색 segment', () => {
    const { container } = render(
      <TimeBand createdAt={T0} expiresAt={T_END} nowProvider={() => T0 + 9.5 * 3600_000} />,
    );
    const el = container.querySelector('[data-time-band-grade]');
    expect(el?.getAttribute('data-time-band-grade')).toBe('STALE');
  });

  it('onExpire 콜백 — 만료 시 1회 호출', () => {
    const onExpire = vi.fn();
    render(
      <TimeBand createdAt={T0} expiresAt={T_END} nowProvider={() => T_END} onExpire={onExpire} />,
    );
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('onExpire 콜백 — 만료 전엔 미호출', () => {
    const onExpire = vi.fn();
    render(
      <TimeBand createdAt={T0} expiresAt={T_END} nowProvider={() => T0 + 3600_000} onExpire={onExpire} />,
    );
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('ARIA progressbar 접근성 (role + aria-valuenow)', () => {
    const { container } = render(
      <TimeBand createdAt={T0} expiresAt={T_END} nowProvider={() => T0 + 3 * 3600_000} />,
    );
    const el = container.querySelector('[role="progressbar"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-valuenow')).toBe('70');
    expect(el?.getAttribute('aria-valuemin')).toBe('0');
    expect(el?.getAttribute('aria-valuemax')).toBe('100');
  });

  it('aria-label 신뢰 grade 한국어 라벨', () => {
    const { container } = render(
      <TimeBand createdAt={T0} expiresAt={T_END} nowProvider={() => T_END + 3600_000} />,
    );
    const el = container.querySelector('[role="progressbar"]');
    const aria = el?.getAttribute('aria-label') ?? '';
    expect(aria).toContain('재검증 대기');
    expect(aria).toContain('0% 잔여');
  });

  it('height prop 적용 (style.height)', () => {
    const { container } = render(
      <TimeBand createdAt={T0} expiresAt={T_END} height={4} nowProvider={() => T0} />,
    );
    const el = container.querySelector('[data-time-band-grade]') as HTMLElement;
    expect(el.style.height).toBe('4px');
  });

  it('className prop 전파', () => {
    const { container } = render(
      <TimeBand createdAt={T0} expiresAt={T_END} className="my-band" nowProvider={() => T0} />,
    );
    const el = container.querySelector('[data-time-band-grade]');
    expect(el?.className).toContain('my-band');
  });
});
