// @responsibility AppMenuButton 레이아웃 컴포넌트
/**
 * AppMenuButton — <lg 화면 전용 햄버거 버튼.
 * 탭 시 드로어 사이드바 오픈 + 가벼운 햅틱.
 */
import React from 'react';
import { Menu } from 'lucide-react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useHapticFeedback } from '../hooks/useHapticFeedback';
import { cn } from '../ui/cn';

interface AppMenuButtonProps {
  className?: string;
}

export function AppMenuButton({ className }: AppMenuButtonProps) {
  const setOpen = useSettingsStore((s) => s.setSidebarDrawerOpen);
  const haptic = useHapticFeedback();

  return (
    <button
      type="button"
      aria-label="메뉴 열기"
      onClick={() => {
        haptic('light');
        setOpen(true);
      }}
      className={cn(
        'lg:hidden inline-flex items-center justify-center',
        'h-10 w-10 rounded-xl border border-white/[0.06]',
        'bg-white/[0.04] text-theme-text-secondary',
        'hover:bg-white/[0.08] hover:text-theme-text hover:border-white/[0.12]',
        'active:scale-95 transition-all',
        className,
      )}
    >
      <Menu className="w-5 h-5" />
    </button>
  );
}
