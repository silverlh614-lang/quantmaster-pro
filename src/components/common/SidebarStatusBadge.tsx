// @responsibility 사이드바 아이템의 우측에 부착되어 상태값만 시각적으로 노출하는 순수 표시 컴포넌트
import React from 'react';
import type { BadgeTone, SidebarStatus } from '../../hooks/useSidebarStatusAdapter';

interface SidebarStatusBadgeProps {
  status: SidebarStatus | null;
}

export const SidebarStatusBadge: React.FC<SidebarStatusBadgeProps> = ({ status }) => {
  if (!status) return null;

  const getToneClasses = (tone: BadgeTone) => {
    switch (tone) {
      case 'emerald':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800';
      case 'rose':
        return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800';
      case 'amber':
        return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800';
      case 'blue':
        return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800';
      case 'slate':
        return 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
      case 'zinc':
      default:
        return 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800/50 dark:text-zinc-400 dark:border-zinc-700';
    }
  };

  return (
    <span
      className={`ml-auto inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide border ${getToneClasses(
        status.tone
      )}`}
    >
      {status.label}
    </span>
  );
};