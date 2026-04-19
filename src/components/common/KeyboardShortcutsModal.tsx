/**
 * KeyboardShortcutsModal — "?" 로 여는 전역 단축키 안내 오버레이.
 */
import React from 'react';
import { Keyboard, X } from 'lucide-react';
import { cn } from '../../ui/cn';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutRow {
  keys: string[];
  description: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: ['?'], description: '이 단축키 도움말 열기/닫기' },
  { keys: ['J'], description: '다음 페이지로 이동' },
  { keys: ['K'], description: '이전 페이지로 이동' },
  { keys: ['G', 'H'], description: '홈 (AI 추천) 으로 이동' },
  { keys: ['G', 'A'], description: '자동매매 관제실로 이동' },
  { keys: ['G', 'M'], description: '시장 대시보드로 이동' },
  { keys: ['/'], description: '검색창에 포커스' },
  { keys: ['Esc'], description: '열린 모달·드로어 닫기' },
  { keys: ['Shift', 'V'], description: '간단 ↔ 프로 뷰 토글 (자동매매)' },
];

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-blue-400" />
            <h2
              id="shortcuts-title"
              className="text-base font-black tracking-tight text-theme-text"
            >
              키보드 단축키
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-theme-text-muted transition hover:bg-white/5 hover:text-theme-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="max-h-[60vh] divide-y divide-white/5 overflow-y-auto">
          {SHORTCUTS.map((row, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-4 px-5 py-3 text-sm"
            >
              <span className="text-theme-text-secondary">{row.description}</span>
              <div className="flex items-center gap-1">
                {row.keys.map((k, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && (
                      <span className="text-[10px] text-theme-text-muted">then</span>
                    )}
                    <kbd
                      className={cn(
                        'inline-flex min-w-[24px] items-center justify-center rounded-md',
                        'border border-white/[0.12] bg-white/[0.04]',
                        'px-2 py-0.5 text-[11px] font-bold text-theme-text font-mono',
                      )}
                    >
                      {k}
                    </kbd>
                  </React.Fragment>
                ))}
              </div>
            </li>
          ))}
        </ul>

        <div className="border-t border-white/10 px-5 py-3 text-[11px] text-theme-text-muted">
          입력 필드 위에서는 단축키가 비활성화됩니다. <kbd className="mx-1 px-1 font-mono">Esc</kbd> 는 언제나 동작.
        </div>
      </div>
    </div>
  );
}
