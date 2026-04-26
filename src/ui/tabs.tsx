// @responsibility tabs UI 프리미티브 컴포넌트
import React from 'react';
import { cn } from './cn';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

export type TabsTone = 'blue' | 'amber';

interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  /** 활성 탭 테마 — Pro 모드에서는 'amber' 로 간단 모드와 시각적 구분. */
  tone?: TabsTone;
}

const TONE_STYLES: Record<
  TabsTone,
  { active: string; count: string; border: string }
> = {
  blue: {
    active:
      'bg-gradient-to-r from-blue-500/[0.12] to-indigo-500/[0.08] text-blue-300 shadow-sm shadow-blue-500/10',
    count: 'bg-blue-500/20 text-blue-300',
    border: 'border-white/[0.05]',
  },
  amber: {
    active:
      'bg-gradient-to-r from-amber-500/[0.18] via-orange-500/[0.14] to-rose-500/[0.08] text-amber-200 shadow-sm shadow-amber-500/10 ring-1 ring-amber-400/20',
    count: 'bg-amber-500/25 text-amber-200',
    border: 'border-amber-500/[0.12]',
  },
};

export function Tabs({ tabs, value, onChange, className, tone = 'blue' }: TabsProps) {
  const toneStyles = TONE_STYLES[tone];
  return (
    <div
      className={cn(
        'flex items-center gap-1 p-1 bg-white/[0.02] rounded-xl border',
        toneStyles.border,
        className,
      )}
    >
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap',
            value === tab.id
              ? toneStyles.active
              : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/[0.04]'
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.count != null && tab.count > 0 && (
            <span className={cn(
              'text-[9px] px-1.5 py-0.5 rounded font-black',
              value === tab.id ? toneStyles.count : 'bg-white/[0.06] text-white/40'
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
