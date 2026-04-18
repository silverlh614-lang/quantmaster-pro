/**
 * MobileTopBar — <lg 에서 최상단에 고정 표시되는 얇은 헤더.
 *                햄버거 버튼 + 브랜드 로고만 포함 (데스크톱은 Sidebar 가 대체).
 */
import React from 'react';
import { Zap } from 'lucide-react';
import { AppMenuButton } from './AppMenuButton';
import { useSettingsStore } from '../stores/useSettingsStore';

export function MobileTopBar() {
  const setView = useSettingsStore((s) => s.setView);

  return (
    <div
      className="lg:hidden sticky top-0 z-[44] flex items-center gap-3 px-3 py-2 border-b border-white/[0.06] backdrop-blur-xl"
      style={{ background: 'rgba(6, 9, 13, 0.9)' }}
    >
      <AppMenuButton />
      <button
        type="button"
        onClick={() => setView('DISCOVER')}
        className="flex items-center gap-2"
        aria-label="홈으로"
      >
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-blue-500/20 border border-blue-400/30">
          <Zap className="w-4 h-4 text-white" />
        </span>
        <span className="text-sm font-black text-theme-text tracking-tight">
          QuantMaster <span className="text-gradient-blue">PRO</span>
        </span>
      </button>
    </div>
  );
}
