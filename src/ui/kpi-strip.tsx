import React from 'react';
import { cn } from './cn';

interface KpiItem {
  label: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
}

interface KpiStripProps {
  items: KpiItem[];
  className?: string;
}

export function KpiStrip({ items, className }: KpiStripProps) {
  return (
    <div className={cn('grid gap-3', className)} style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 5)}, 1fr)` }}>
      {items.map((item, i) => (
        <div
          key={i}
          className="bg-white/[0.03] border border-theme-border rounded-xl sm:rounded-2xl p-3 sm:p-4 text-center"
        >
          <p className="text-[9px] sm:text-[10px] text-theme-text-muted uppercase tracking-widest font-bold truncate">{item.label}</p>
          <p className={cn(
            'text-lg sm:text-xl font-black mt-1 font-num',
            item.trend === 'up' ? 'text-green-400' :
            item.trend === 'down' ? 'text-red-400' :
            'text-theme-text'
          )}>
            {item.value}
          </p>
          {item.change && (
            <p className={cn(
              'text-[10px] font-bold mt-0.5',
              item.trend === 'up' ? 'text-green-400/70' :
              item.trend === 'down' ? 'text-red-400/70' :
              'text-theme-text-muted'
            )}>
              {item.change}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
