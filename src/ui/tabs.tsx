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
    <div className={cn('flex items-center gap-1 p-1 bg-white/[0.02] rounded-xl border border-white/[0.05]', className)}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap',
            value === tab.id
              ? 'bg-gradient-to-r from-blue-500/[0.12] to-indigo-500/[0.08] text-blue-300 shadow-sm shadow-blue-500/10'
              : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/[0.04]'
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.count != null && tab.count > 0 && (
            <span className={cn(
              'text-[9px] px-1.5 py-0.5 rounded font-black',
              value === tab.id ? 'bg-blue-500/20 text-blue-300' : 'bg-white/[0.06] text-white/40'
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
