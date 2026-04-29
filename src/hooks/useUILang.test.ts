/**
 * @responsibility useUILang() 훅 회귀 (ADR-0094)
 *
 * 검증 항목:
 * 1) 훅 호출 시 UILang 객체 반환
 * 2) 7 메서드 (nav/card/tier/regime/gate/empty/action) + raw 모두 존재
 * 3) 각 메서드 호출 시 UI_LANG SSOT 와 동일 값 반환
 * 4) raw 가 UI_LANG 자체와 동일 reference (메모이즈 일관성)
 * 5) 잘못된 키는 TypeScript 컴파일 시점에 차단 (런타임은 undefined)
 * 6) 다중 호출 시 메모이즈 일관성 (같은 객체 reference)
 *
 * 참고: vitest jsdom 환경 + react renderHook 사용.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUILang } from './useUILang';
import { UI_LANG } from '../config/uiLanguage';

describe('useUILang() hook', () => {
  it('훅 호출 시 UILang 객체 반환', () => {
    const { result } = renderHook(() => useUILang());
    expect(result.current).toBeDefined();
    expect(typeof result.current).toBe('object');
  });

  it('7 메서드 + raw 모두 존재', () => {
    const { result } = renderHook(() => useUILang());
    const t = result.current;
    expect(typeof t.nav).toBe('function');
    expect(typeof t.card).toBe('function');
    expect(typeof t.tier).toBe('function');
    expect(typeof t.regime).toBe('function');
    expect(typeof t.gate).toBe('function');
    expect(typeof t.empty).toBe('function');
    expect(typeof t.action).toBe('function');
    expect(t.raw).toBe(UI_LANG);
  });

  it('nav() 메서드가 UI_LANG.nav 와 동일 값 반환', () => {
    const { result } = renderHook(() => useUILang());
    expect(result.current.nav('DISCOVER')).toBe(UI_LANG.nav.DISCOVER);
    expect(result.current.nav('AUTO_TRADE')).toBe(UI_LANG.nav.AUTO_TRADE);
    expect(result.current.nav('POSITIONS')).toBe(UI_LANG.nav.POSITIONS);
  });

  it('card() 메서드가 UI_LANG.card 와 동일 값 반환', () => {
    const { result } = renderHook(() => useUILang());
    expect(result.current.card('STRONG_BUY')).toBe(UI_LANG.card.STRONG_BUY);
    expect(result.current.card('HOLD')).toBe(UI_LANG.card.HOLD);
    expect(result.current.card('SELL')).toBe(UI_LANG.card.SELL);
  });

  it('tier() 메서드가 5-tier 모두 정확히 반환', () => {
    const { result } = renderHook(() => useUILang());
    expect(result.current.tier('VERIFIED')).toBe('실측');
    expect(result.current.tier('EXTERNAL')).toBe('API 수신');
    expect(result.current.tier('DELAYED')).toBe('지연 데이터');
    expect(result.current.tier('ESTIMATED')).toBe('AI 추정');
    expect(result.current.tier('MANUAL')).toBe('수동 입력');
  });

  it('regime() 메서드가 6 RegimeLevel 모두 정확히 반환', () => {
    const { result } = renderHook(() => useUILang());
    expect(result.current.regime('R1_TURBO')).toContain('가속 강세');
    expect(result.current.regime('R2_BULL')).toContain('안정 강세');
    expect(result.current.regime('R3_EARLY')).toContain('초기 강세');
    expect(result.current.regime('R4_NEUTRAL')).toContain('중립');
    expect(result.current.regime('R5_CAUTION')).toContain('경계');
    expect(result.current.regime('R6_DEFENSE')).toContain('방어');
  });

  it('gate() 메서드가 4 단계 모두 정확히 반환', () => {
    const { result } = renderHook(() => useUILang());
    expect(result.current.gate('GATE_0')).toBe('시장 게이트');
    expect(result.current.gate('GATE_1')).toBe('필수 조건');
    expect(result.current.gate('GATE_2')).toBe('강화 조건');
    expect(result.current.gate('GATE_3')).toBe('확신 조건');
  });

  it('empty() 메서드가 4 sub-variant 모두 정확히 반환', () => {
    const { result } = renderHook(() => useUILang());
    expect(result.current.empty('DELAYED')).toContain('동기화');
    expect(result.current.empty('INSUFFICIENT')).toContain('표본 부족');
    expect(result.current.empty('STALE')).toContain('시장 외 시간');
    expect(result.current.empty('CONFLICTED')).toContain('신호 충돌');
  });

  it('action() 메서드가 모든 액션 라벨 반환', () => {
    const { result } = renderHook(() => useUILang());
    expect(result.current.action('APPROVE')).toBe('승인');
    expect(result.current.action('REJECT')).toBe('거부');
    expect(result.current.action('SKIP')).toBe('건너뜀');
    expect(result.current.action('REFRESH')).toBe('새로고침');
  });

  it('raw 가 UI_LANG 과 동일 reference (배열 매핑 케이스 지원)', () => {
    const { result } = renderHook(() => useUILang());
    expect(result.current.raw).toBe(UI_LANG);
    // 배열 매핑 사용 패턴 예시 검증
    const allTiers = Object.entries(result.current.raw.tier);
    expect(allTiers.length).toBe(5);
  });

  it('rerender 시 동일 객체 reference (메모이즈 일관성)', () => {
    const { result, rerender } = renderHook(() => useUILang());
    const first = result.current;
    rerender();
    const second = result.current;
    expect(first).toBe(second); // useMemo 로 동일 객체 보장
  });
});
