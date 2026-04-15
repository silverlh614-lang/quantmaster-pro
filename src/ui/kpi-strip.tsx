/**
 * Neo-Brutalism KPI Scoreboard Strip
 * Large numeric cards with semantic color coding for instant visual judgment.
 * Click any card to drill-down into Gate details.
 */
import React, { useState } from 'react';
import { cn } from './cn';
import { ChevronDown, ChevronUp } from 'lucide-react';

/* ---------- Types ---------- */
export type KpiStatus = 'pass' | 'fail' | 'warn' | 'neutral';

export interface KpiItem {
  label: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  status?: KpiStatus;
  details?: KpiDetail[];
  onClick?: () => void;
}

export interface KpiDetail {
  condition: string;
  passed: boolean;
  value?: string;
}

/* ---------- Status Styling Maps ---------- */
const statusCardClass: Record<KpiStatus, string> = {
  pass: 'border-green-500/40 bg-green-500/[0.06]',
  fail: 'border-red-500/40 bg-red-500/[0.06]',
  warn: 'border-yellow-500/40 bg-yellow-500/[0.06]',
  neutral: 'border-slate-600/40 bg-white/[0.02]',
};

const statusValueClass: Record<KpiStatus, string> = {
  pass: 'text-green-400',
  fail: 'text-red-400',
  warn: 'text-yellow-400',
  neutral: 'text-theme-text',
};

const statusDotClass: Record<KpiStatus, string> = {
  pass: 'bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.6)]',
  fail: 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]',
  warn: 'bg-yellow-400 shadow-[0_0_8px_rgba(234,179,8,0.6)]',
  neutral: 'bg-slate-500',
};

/* ---------- Legacy KPI Strip (backward compat) ---------- */
interface KpiStripProps {
  items: KpiItem[];
  className?: string;
  size?: 'sm' | 'lg';
}

export function KpiStrip({ items, className, size = 'sm' }: KpiStripProps) {
  if (size === 'lg') {
    return <KpiScoreboard items={items} className={className} />;
  }

  return (
    <div className={cn('grid gap-3', className)} style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 5)}, 1fr)` }}>
      {items.map((item, i) => {
        const status = item.status ?? (item.trend === 'up' ? 'pass' : item.trend === 'down' ? 'fail' : 'neutral');
        return (
          <div
            key={i}
            className={cn(
              'border-2 rounded-xl sm:rounded-2xl p-3 sm:p-4 text-center transition-all',
              statusCardClass[status],
              item.onClick && 'cursor-pointer hover:scale-[1.02]'
            )}
            onClick={item.onClick}
          >
            <p className="text-[9px] sm:text-[10px] text-theme-text-muted uppercase tracking-widest font-bold truncate">{item.label}</p>
            <p className={cn('text-lg sm:text-xl font-black mt-1 font-num', statusValueClass[status])}>
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
        );
      })}
    </div>
  );
}

/* ---------- Large Neo-Brutalism Scoreboard ---------- */
interface KpiScoreboardProps {
  items: KpiItem[];
  className?: string;
}

export function KpiScoreboard({ items, className }: KpiScoreboardProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div className={cn('space-y-2', className)}>
      {/* Main Scoreboard Grid */}
      <div
        className="grid gap-3 sm:gap-4"
        style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 5)}, 1fr)` }}
      >
        {items.map((item, i) => {
          const status = item.status ?? (item.trend === 'up' ? 'pass' : item.trend === 'down' ? 'fail' : 'neutral');
          const hasDetails = item.details && item.details.length > 0;
          const isExpanded = expandedIndex === i;

          return (
            <button
              key={i}
              type="button"
              className={cn(
                'relative border-2 rounded-xl sm:rounded-2xl p-4 sm:p-5 text-left transition-all group',
                statusCardClass[status],
                'box-shadow-[4px_4px_0px_rgba(0,0,0,0.3)]',
                hasDetails && 'cursor-pointer',
                isExpanded && 'ring-1 ring-white/10'
              )}
              onClick={() => {
                if (item.onClick) { item.onClick(); return; }
                if (hasDetails) setExpandedIndex(isExpanded ? null : i);
              }}
            >
              {/* Status dot */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] sm:text-[10px] text-theme-text-muted uppercase tracking-[0.15em] font-black truncate">
                  {item.label}
                </span>
                <span className={cn('w-2 h-2 rounded-full shrink-0', statusDotClass[status])} />
              </div>

              {/* Large value */}
              <p className={cn('neo-kpi-value-sm', statusValueClass[status])}>
                {item.value}
              </p>

              {/* Change indicator */}
              {item.change && (
                <p className={cn(
                  'text-xs font-bold mt-1.5 font-num',
                  item.trend === 'up' ? 'text-green-400/80' :
                  item.trend === 'down' ? 'text-red-400/80' :
                  'text-theme-text-muted'
                )}>
                  {item.change}
                </p>
              )}

              {/* Drill-down indicator */}
              {hasDetails && (
                <div className="absolute bottom-2 right-3 text-theme-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Drill-down Detail Panel */}
      {expandedIndex !== null && items[expandedIndex]?.details && (
        <div className="neo-section rounded-xl p-4 sm:p-5 animate-fade-slide-up">
          <h4 className="text-[10px] font-black uppercase tracking-[0.15em] text-theme-text-muted mb-3">
            {items[expandedIndex].label} — 조건 상세
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {items[expandedIndex].details!.map((detail, j) => (
              <div
                key={j}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs font-bold',
                  detail.passed
                    ? 'border-green-500/25 bg-green-500/[0.04] text-green-400'
                    : 'border-red-500/20 bg-red-500/[0.03] text-red-400/70'
                )}
              >
                <span className={cn(
                  'w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center text-[8px] font-black',
                  detail.passed
                    ? 'bg-green-500/30 border-green-400 text-green-200'
                    : 'bg-white/5 border-white/20 text-white/40'
                )}>
                  {detail.passed ? '\u2713' : '\u2013'}
                </span>
                <span className="truncate">{detail.condition}</span>
                {detail.value && (
                  <span className="ml-auto font-num text-theme-text-muted shrink-0">{detail.value}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
