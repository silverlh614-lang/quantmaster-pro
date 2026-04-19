/**
 * useKeyboardShortcuts — 전역 키보드 단축키 관리.
 *
 * 정책:
 *   - 입력 요소(`input`, `textarea`, `contenteditable`) 위에서는 기본적으로 무시
 *     → `allowInInputs` 로 예외 처리 가능 (예: ESC).
 *   - 수식키(Ctrl/Cmd/Shift/Alt) 조합 명시적으로 기술.
 *   - 중복 등록 방지: 동일 키 조합은 마지막 훅이 우선.
 */
import { useEffect, useRef } from 'react';

export interface KeyShortcut {
  /** 키 이름 — KeyboardEvent.key 기반 (예: 'j', '/', '?', 'Escape'). */
  key: string;
  /** 수식키 요구 (기본: none). */
  ctrlOrMeta?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** 인풋 위에서도 동작하게 할지 (기본 false, 단 Escape 기본 허용). */
  allowInInputs?: boolean;
  handler: (ev: KeyboardEvent) => void;
  /** 단축키 설명 — 도움말 오버레이 표시용. */
  description?: string;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  if (!el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(shortcuts: KeyShortcut[]): void {
  const ref = useRef<KeyShortcut[]>(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const editable = isEditableTarget(ev.target);
      for (const sc of ref.current) {
        if (ev.key !== sc.key) continue;
        const needCtrl = Boolean(sc.ctrlOrMeta);
        const gotCtrl = ev.ctrlKey || ev.metaKey;
        if (needCtrl !== gotCtrl) continue;
        if (Boolean(sc.shift) !== ev.shiftKey) continue;
        if (Boolean(sc.alt) !== ev.altKey) continue;
        if (editable) {
          // 기본: 입력 요소에서 단축키 차단. 단 Escape 는 항상 허용.
          if (!sc.allowInInputs && sc.key !== 'Escape') continue;
        }
        sc.handler(ev);
        return; // 첫 매칭만 실행.
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
