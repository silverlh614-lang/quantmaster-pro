// @responsibility useGlobalShortcuts React hook
/**
 * useGlobalShortcuts — 앱 전역 단축키 바인딩.
 *
 * 구성:
 *   - J / K : 다음/이전 페이지 (NAV_GROUPS flatten 순서)
 *   - G 접두 :  G→H 운영 현황, G→A 전략 판단, G→M 저장 자료 연구
 *   - / : 첫번째 data-search-focus 속성 보유 요소에 포커스
 *   - ? : KeyboardShortcutsModal 열기/닫기
 *   - Esc : 열린 드로어/모달 닫기 (setShowSettings 등)
 */
import { useCallback, useRef, useState } from 'react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { useSettingsStore } from '../stores/useSettingsStore';
import { NAV_GROUPS } from '../config/navigation';

export interface UseGlobalShortcutsResult {
  shortcutsOpen: boolean;
  closeShortcuts: () => void;
}

/** nav 순서 기반으로 flatten 된 view 리스트. J/K 로 순환. */
const NAV_ORDER = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));

export function useGlobalShortcuts(): UseGlobalShortcutsResult {
  const view = useSettingsStore((s) => s.view);
  const setView = useSettingsStore((s) => s.setView);
  const setShowSettings = useSettingsStore((s) => s.setShowSettings);
  const setDrawerOpen = useSettingsStore((s) => s.setSidebarDrawerOpen);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  // G 접두 단축키를 위한 짧은 sequence state.
  const seqRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });

  const jump = useCallback(
    (delta: 1 | -1) => {
      const idx = NAV_ORDER.indexOf(view);
      if (idx < 0) return;
      const nextIdx = (idx + delta + NAV_ORDER.length) % NAV_ORDER.length;
      setView(NAV_ORDER[nextIdx]);
    },
    [view, setView],
  );

  useKeyboardShortcuts([
    {
      key: '?',
      handler: () => setShortcutsOpen((v) => !v),
      description: '단축키 도움말',
    },
    {
      key: 'j',
      handler: () => jump(1),
    },
    {
      key: 'k',
      handler: () => jump(-1),
    },
    {
      key: '/',
      handler: (ev) => {
        const el = document.querySelector<HTMLInputElement>('[data-search-focus]');
        if (el) {
          ev.preventDefault();
          el.focus();
          el.select?.();
        }
      },
    },
    {
      key: 'Escape',
      allowInInputs: true,
      handler: () => {
        // 가장 최근에 열린 오버레이부터 닫힐 수 있도록 순차.
        if (shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        setDrawerOpen(false);
        setShowSettings(false);
      },
    },
    // G 접두 — g 가 눌리고 1초 내 h/a/m 이 오면 점프.
    {
      key: 'g',
      handler: () => {
        seqRef.current = { key: 'g', at: Date.now() };
      },
    },
    {
      key: 'h',
      handler: () => {
        if (seqRef.current.key === 'g' && Date.now() - seqRef.current.at < 1000) {
          setView('DASHBOARD');
          seqRef.current = { key: null, at: 0 };
        }
      },
    },
    {
      key: 'a',
      handler: () => {
        if (seqRef.current.key === 'g' && Date.now() - seqRef.current.at < 1000) {
          setView('PAPER_STRATEGY');
          seqRef.current = { key: null, at: 0 };
        }
      },
    },
    {
      key: 'm',
      handler: () => {
        if (seqRef.current.key === 'g' && Date.now() - seqRef.current.at < 1000) {
          setView('PAPER_RESEARCH');
          seqRef.current = { key: null, at: 0 };
        }
      },
    },
  ]);

  return { shortcutsOpen, closeShortcuts };
}
