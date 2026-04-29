// @vitest-environment jsdom
/**
 * @responsibility SettingsModal 안 UIVerbosityToggle 임베드 회귀 (ADR-0100 PR-Verbose-Embed)
 *
 * 검증 항목:
 * 1) showSettings=true 시 모달 렌더 + UIVerbosityToggle 임베드 노출
 * 2) showSettings=false 시 모달 미렌더 → 토글 미노출
 * 3) 임베드 토글 작동 — 옵션 클릭 시 store.uiVerbosity 갱신
 * 4) 임베드 후 기존 섹션 (API Key / Theme) 무영향 — Migration Gate 정합
 * 5) "정보 밀도" 라벨 + 설명 텍스트 노출
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { useSettingsStore } from '../../stores/useSettingsStore';

beforeEach(() => {
  useSettingsStore.getState().setUIVerbosity('balanced');
  useSettingsStore.getState().setShowSettings(false);
});

afterEach(() => cleanup());

describe('SettingsModal — UIVerbosityToggle 임베드 (ADR-0100)', () => {
  it('showSettings=true → 모달 렌더 + UIVerbosityToggle 임베드 노출', () => {
    useSettingsStore.getState().setShowSettings(true);
    const { container } = render(<SettingsModal />);
    // 토글 임베드 확인
    expect(container.querySelector('[data-ui-verbosity-toggle]')).not.toBeNull();
    // 3 옵션 모두 렌더
    expect(container.querySelector('[data-ui-verbosity-option="minimal"]')).not.toBeNull();
    expect(container.querySelector('[data-ui-verbosity-option="balanced"]')).not.toBeNull();
    expect(container.querySelector('[data-ui-verbosity-option="verbose"]')).not.toBeNull();
  });

  it('showSettings=false → 모달 미렌더, 토글 미노출', () => {
    useSettingsStore.getState().setShowSettings(false);
    const { container } = render(<SettingsModal />);
    expect(container.querySelector('[data-ui-verbosity-toggle]')).toBeNull();
  });

  it('임베드 토글 클릭 → store.uiVerbosity 즉시 갱신', () => {
    useSettingsStore.getState().setShowSettings(true);
    const { container } = render(<SettingsModal />);
    const verboseBtn = container.querySelector('[data-ui-verbosity-option="verbose"]') as HTMLButtonElement;
    expect(verboseBtn).not.toBeNull();
    fireEvent.click(verboseBtn);
    expect(useSettingsStore.getState().uiVerbosity).toBe('verbose');
  });

  it('임베드 후 기존 섹션 (API Key / Theme) 무영향 — Migration Gate', () => {
    useSettingsStore.getState().setShowSettings(true);
    const { container } = render(<SettingsModal />);
    // API Key input 보존
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    // Theme 옵션 다수 보존
    expect(container.textContent).toContain('테마');
    expect(container.textContent).toContain('API Key');
  });

  it('"정보 밀도" 라벨 + 설명 텍스트 노출', () => {
    useSettingsStore.getState().setShowSettings(true);
    const { container } = render(<SettingsModal />);
    expect(container.textContent).toContain('정보 밀도');
    // 설명 텍스트
    expect(container.textContent).toContain('간결');
    expect(container.textContent).toContain('균형');
    expect(container.textContent).toContain('상세');
    expect(container.textContent).toContain('운영자');
  });

  it('balanced 기본값 → balanced 옵션 active', () => {
    useSettingsStore.getState().setShowSettings(true);
    const { container } = render(<SettingsModal />);
    const balanced = container.querySelector('[data-ui-verbosity-option="balanced"]');
    expect(balanced?.getAttribute('data-ui-verbosity-active')).toBe('true');
  });

  it('toggle → minimal → balanced 순환 가능', () => {
    useSettingsStore.getState().setShowSettings(true);
    const { container } = render(<SettingsModal />);
    const minimalBtn = container.querySelector('[data-ui-verbosity-option="minimal"]') as HTMLButtonElement;
    fireEvent.click(minimalBtn);
    expect(useSettingsStore.getState().uiVerbosity).toBe('minimal');
    const balancedBtn = container.querySelector('[data-ui-verbosity-option="balanced"]') as HTMLButtonElement;
    fireEvent.click(balancedBtn);
    expect(useSettingsStore.getState().uiVerbosity).toBe('balanced');
  });

  it('Settings 저장 버튼 클릭 → showSettings=false (임베드 영향 0)', () => {
    useSettingsStore.getState().setShowSettings(true);
    const { container } = render(<SettingsModal />);
    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('설정 저장'));
    expect(saveBtn).toBeDefined();
    fireEvent.click(saveBtn!);
    expect(useSettingsStore.getState().showSettings).toBe(false);
    // 토글 변경 사항은 영속 (별도 store 슬롯)
    expect(useSettingsStore.getState().uiVerbosity).toBe('balanced');
  });
});
