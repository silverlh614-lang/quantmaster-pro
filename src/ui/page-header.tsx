import React from 'react';
import { cn } from './cn';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: string;
  accentColor?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, badge, accentColor = 'bg-gradient-to-b from-blue-400 to-indigo-500', actions, children, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className={cn('w-1.5 sm:w-2 h-8 sm:h-10 rounded-full shadow-lg', accentColor)} />
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-black tracking-tight truncate text-gradient-blue">
              {title}
            </h2>
            {subtitle && (
              <p className="text-[10px] sm:text-xs font-bold text-theme-text-muted uppercase tracking-[0.15em] mt-1">
                {subtitle}
              </p>
            )}
          </div>
          {badge && (
            <span className="hidden sm:inline-flex px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg bg-blue-500/[0.08] text-blue-300/80 border border-blue-500/[0.12]">
              {badge}
            </span>
          )}
        </div>
        {children && (
          <p className="mt-3 text-sm text-theme-text-secondary max-w-2xl leading-relaxed pl-5 sm:pl-7">
            {children}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-3 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
