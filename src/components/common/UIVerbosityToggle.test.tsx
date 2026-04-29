// @vitest-environment jsdom
/**
 * @responsibility UIVerbosityToggle 회귀 (ADR-0099 PR-Verbose 사용자 #12)
 *
 * 검증 항목:
 * 1) 3 옵션 (minimal / balanced / verbose) 모두 렌더
 * 2) 활성 옵션 강조 (data-ui-verbosity-active="true")
 * 3) 클릭 시 store 갱신 + 활성 옵션 전환
 * 4) compact 모드 — 라벨 미노출, 아이콘만
 * 5) ARIA 접근성 (role="radiogroup" + radio + aria-checked)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { UIVerbosityToggle } from './UIVerbosityToggle';
import { useSettingsStore } from '../../stores/useSettingsStore';

beforeEach(() => {
  useSettingsStore.getState().setUIVerbosity('balanced');
});

afterEach(() => cleanup());

describe('UIVerbosityToggle 회귀 (ADR-0099)', () => {
  it('3 옵션 (minimal / balanced / verbose) 모두 렌더', () => {
    const { container } = render(<UIVerbosityToggle />);
    expect(container.querySelector('[data-ui-verbosity-option="minimal"]')).not.toBeNull();
    expect(container.querySelector('[data-ui-verbosity-option="balanced"]')).not.toBeNull();
    expect(container.querySelector('[data-ui-verbosity-option="verbose"]')).not.toBeNull();
  });

  it('balanced 기본값 → balanced 옵션만 active', () => {
    const { container } = render(<UIVerbosityToggle />);
    const minimal = container.querySelector('[data-ui-verbosity-option="minimal"]');
    const balanced = container.querySelector('[data-ui-verbosity-option="balanced"]');
    const verbose = container.querySelector('[data-ui-verbosity-option="verbose"]');

    expect(minimal?.getAttribute('data-ui-verbosity-active')).toBe('false');
    expect(balanced?.getAttribute('data-ui-verbosity-active')).toBe('true');
    expect(verbose?.getAttribute('data-ui-verbosity-active')).toBe('false');
  });

  it('verbose 옵션 클릭 → store 갱신 + 활성 전환', () => {
    const { container } = render(<UIVerbosityToggle />);
    const verboseBtn = container.querySelector('[data-ui-verbosity-option="verbose"]') as HTMLButtonElement;
    fireEvent.click(verboseBtn);

    expect(useSettingsStore.getState().uiVerbosity).toBe('verbose');
    // re-render 후 active 전환
    const { container: c2 } = render(<UIVerbosityToggle />);
    const verbose2 = c2.querySelector('[data-ui-verbosity-option="verbose"]');
    expect(verbose2?.getAttribute('data-ui-verbosity-active')).toBe('true');
  });

  it('minimal 옵션 클릭 → store=minimal', () => {
    const { container } = render(<UIVerbosityToggle />);
    const minimalBtn = container.querySelector('[data-ui-verbosity-option="minimal"]') as HTMLButtonElement;
    fireEvent.click(minimalBtn);
    expect(useSettingsStore.getState().uiVerbosity).toBe('minimal');
  });

  it('compact 모드 — 라벨 텍스트 미노출, data 속성 보존', () => {
    const { container } = render(<UIVerbosityToggle compact />);
    expect(container.textContent).not.toContain('간결');
    expect(container.textContent).not.toContain('균형');
    expect(container.textContent).not.toContain('상세');
    // data 속성은 보존
    expect(container.querySelectorAll('[data-ui-verbosity-option]').length).toBe(3);
  });

  it('기본 모드 — 한국어 라벨 표시 (간결/균형/상세)', () => {
    const { container } = render(<UIVerbosityToggle />);
    expect(container.textContent).toContain('간결');
    expect(container.textContent).toContain('균형');
    expect(container.textContent).toContain('상세');
  });

  it('ARIA — role="radiogroup" + 각 옵션 role="radio" + aria-checked 정합', () => {
    const { container } = render(<UIVerbosityToggle />);
    const group = container.querySelector('[role="radiogroup"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute('aria-label')).toBe('UI 정보 밀도');

    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios.length).toBe(3);

    // balanced 만 aria-checked=true
    const balanced = container.querySelector('[data-ui-verbosity-option="balanced"]');
    expect(balanced?.getAttribute('aria-checked')).toBe('true');
    const minimal = container.querySelector('[data-ui-verbosity-option="minimal"]');
    expect(minimal?.getAttribute('aria-checked')).toBe('false');
  });

  it('aria-label — 옵션 설명 노출 (인지 부하 안내)', () => {
    const { container } = render(<UIVerbosityToggle />);
    const verbose = container.querySelector('[data-ui-verbosity-option="verbose"]');
    const aria = verbose?.getAttribute('aria-label') ?? '';
    expect(aria).toContain('상세');
    expect(aria).toContain('운영자');
  });

  it('className prop 전파', () => {
    const { container } = render(<UIVerbosityToggle className="my-toggle" />);
    expect(container.querySelector('[data-ui-verbosity-toggle]')?.className).toContain('my-toggle');
  });
});
