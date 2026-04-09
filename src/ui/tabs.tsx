import React from 'react';
import { cn } from './cn';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-1 p-1 bg-white/[0.03] rounded-xl border border-theme-border', className)}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap',
            value === tab.id
              ? 'bg-orange-500/15 text-orange-400 shadow-sm'
              : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/5'
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.count != null && tab.count > 0 && (
            <span className={cn(
              'text-[9px] px-1.5 py-0.5 rounded font-black',
              value === tab.id ? 'bg-orange-500/25 text-orange-300' : 'bg-white/10 text-white/40'
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
