// @vitest-environment jsdom
/**
 * @responsibility IDontKnow 4-variant 회귀 테스트 (ADR-0096 PR-Phase-B)
 *
 * 검증 항목:
 * 1) 4 variant (Delayed/Insufficient/Stale/Conflicted) 모두 export
 * 2) 각 variant 다른 아이콘 / 다른 색상 (data-idontknow-variant 속성)
 * 3) UI_LANG.empty SSOT 기본 메시지 사용
 * 4) message prop 으로 override 가능
 * 5) action prop 으로 권고 액션 override
 * 6) compact 모드 vs 배너 모드 분기
 * 7) ARIA 접근성 (role + aria-label)
 * 8) 페르소나 정합 — 각 variant 의 사용자 인지 (기다림 / 누적 / 갱신 / 검토)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { IDontKnow } from './IDontKnow';

afterEach(() => cleanup());

describe('IDontKnow — 4-variant 회귀 (ADR-0096)', () => {
  // ============================================================
  // export 정합
  // ============================================================
  it('4 variant 모두 export (Delayed/Insufficient/Stale/Conflicted)', () => {
    expect(typeof IDontKnow.Delayed).toBe('function');
    expect(typeof IDontKnow.Insufficient).toBe('function');
    expect(typeof IDontKnow.Stale).toBe('function');
    expect(typeof IDontKnow.Conflicted).toBe('function');
    expect(Object.keys(IDontKnow).length).toBe(4);
  });

  // ============================================================
  // data-idontknow-variant 속성 (e2e 친화)
  // ============================================================
  it('Delayed → data-idontknow-variant="DELAYED"', () => {
    const { container } = render(<IDontKnow.Delayed />);
    const el = container.querySelector('[data-idontknow-variant]');
    expect(el?.getAttribute('data-idontknow-variant')).toBe('DELAYED');
  });

  it('Insufficient → data-idontknow-variant="INSUFFICIENT"', () => {
    const { container } = render(<IDontKnow.Insufficient />);
    const el = container.querySelector('[data-idontknow-variant]');
    expect(el?.getAttribute('data-idontknow-variant')).toBe('INSUFFICIENT');
  });

  it('Stale → data-idontknow-variant="STALE"', () => {
    const { container } = render(<IDontKnow.Stale />);
    const el = container.querySelector('[data-idontknow-variant]');
    expect(el?.getAttribute('data-idontknow-variant')).toBe('STALE');
  });

  it('Conflicted → data-idontknow-variant="CONFLICTED"', () => {
    const { container } = render(<IDontKnow.Conflicted />);
    const el = container.querySelector('[data-idontknow-variant]');
    expect(el?.getAttribute('data-idontknow-variant')).toBe('CONFLICTED');
  });

  // ============================================================
  // UI_LANG.empty SSOT 기본 메시지 (ADR-0094 정합)
  // ============================================================
  it('Delayed 기본 메시지 — UI_LANG.empty.DELAYED ("동기화 중")', () => {
    const { container } = render(<IDontKnow.Delayed />);
    expect(container.textContent).toContain('동기화 중');
  });

  it('Insufficient 기본 메시지 — UI_LANG.empty.INSUFFICIENT ("표본 부족")', () => {
    const { container } = render(<IDontKnow.Insufficient />);
    expect(container.textContent).toContain('표본 부족');
  });

  it('Stale 기본 메시지 — UI_LANG.empty.STALE ("시장 외 시간")', () => {
    const { container } = render(<IDontKnow.Stale />);
    expect(container.textContent).toContain('시장 외 시간');
  });

  it('Conflicted 기본 메시지 — UI_LANG.empty.CONFLICTED ("신호 충돌")', () => {
    const { container } = render(<IDontKnow.Conflicted />);
    expect(container.textContent).toContain('신호 충돌');
  });

  // ============================================================
  // message override
  // ============================================================
  it('message prop 으로 SSOT 기본값 override', () => {
    const { container } = render(<IDontKnow.Delayed message="custom 동기화 진행 중 — 30초 대기" />);
    expect(container.textContent).toContain('custom 동기화 진행 중');
    expect(container.textContent).toContain('30초 대기');
    expect(container.textContent).not.toContain('동기화 중 — 잠시');
  });

  // ============================================================
  // 권고 액션
  // ============================================================
  it('Delayed 기본 권고 액션 — "잠시 후 자동 갱신"', () => {
    const { container } = render(<IDontKnow.Delayed />);
    expect(container.textContent).toContain('잠시 후 자동 갱신');
  });

  it('Insufficient 기본 권고 — "데이터 누적 후 활성화"', () => {
    const { container } = render(<IDontKnow.Insufficient />);
    expect(container.textContent).toContain('데이터 누적 후 활성화');
  });

  it('Stale 기본 권고 — "다음 영업일 09:00 갱신"', () => {
    const { container } = render(<IDontKnow.Stale />);
    expect(container.textContent).toContain('09:00 갱신');
  });

  it('Conflicted 기본 권고 — "운영자 검토 필요"', () => {
    const { container } = render(<IDontKnow.Conflicted />);
    expect(container.textContent).toContain('운영자 검토 필요');
  });

  it('action prop 으로 기본 권고 override', () => {
    const { container } = render(<IDontKnow.Conflicted action="운영자 /reset 후 재시도" />);
    expect(container.textContent).toContain('/reset');
    expect(container.textContent).not.toContain('운영자 검토 필요');
  });

  // ============================================================
  // compact vs 배너 모드
  // ============================================================
  it('기본 (배너) 모드 — message + action 모두 표시', () => {
    const { container } = render(<IDontKnow.Delayed />);
    expect(container.textContent).toContain('동기화 중'); // message
    expect(container.textContent).toContain('잠시 후 자동 갱신'); // action
  });

  it('compact 모드 — 라벨만 표시 (message/action 본문 부재)', () => {
    const { container } = render(<IDontKnow.Stale compact />);
    // 컴팩트 라벨
    expect(container.textContent).toContain('시장 외');
    // action 본문은 미노출 (title attribute 로 hover 노출)
    expect(container.textContent).not.toContain('09:00 갱신');
  });

  it('compact 모드 — title attribute 에 message 노출 (hover)', () => {
    const { container } = render(<IDontKnow.Stale compact />);
    const el = container.querySelector('[data-idontknow-variant]');
    expect(el?.getAttribute('title')).toContain('시장 외 시간');
  });

  // ============================================================
  // ARIA 접근성
  // ============================================================
  it('role="status" + aria-label SSOT 정합', () => {
    const { container } = render(<IDontKnow.Insufficient />);
    const el = container.querySelector('[role="status"]');
    expect(el).not.toBeNull();
    const aria = el?.getAttribute('aria-label') ?? '';
    expect(aria).toContain('표본 부족');
  });

  // ============================================================
  // className 전파
  // ============================================================
  it('className prop 전파', () => {
    const { container } = render(<IDontKnow.Delayed className="my-custom-class" />);
    const el = container.querySelector('[data-idontknow-variant]');
    expect(el?.className).toContain('my-custom-class');
  });

  // ============================================================
  // 페르소나 정합 — 4 variant 시각 언어 차이 (다른 색상 클래스)
  // ============================================================
  it('4 variant 모두 다른 색상 클래스 적용 (시각 언어 차이)', () => {
    const { container: c1 } = render(<IDontKnow.Delayed />);
    const { container: c2 } = render(<IDontKnow.Insufficient />);
    const { container: c3 } = render(<IDontKnow.Stale />);
    const { container: c4 } = render(<IDontKnow.Conflicted />);

    const cls1 = c1.querySelector('[data-idontknow-variant]')?.className ?? '';
    const cls2 = c2.querySelector('[data-idontknow-variant]')?.className ?? '';
    const cls3 = c3.querySelector('[data-idontknow-variant]')?.className ?? '';
    const cls4 = c4.querySelector('[data-idontknow-variant]')?.className ?? '';

    expect(cls1).toContain('slate'); // DELAYED
    expect(cls2).toContain('zinc'); // INSUFFICIENT
    expect(cls3).toContain('blue'); // STALE
    expect(cls4).toContain('amber'); // CONFLICTED
  });
});
