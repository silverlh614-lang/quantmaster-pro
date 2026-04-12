import React from 'react';
import { cn } from './cn';

interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  compact?: boolean;
}

export function Section({ title, subtitle, actions, compact = false, className, children, ...props }: SectionProps) {
  return (
    <section className={cn(compact ? 'space-y-3' : 'space-y-4 sm:space-y-6', className)} {...props}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-4">
          <div>
            {title && (
              <h3 className="text-sm sm:text-base font-black text-theme-text uppercase tracking-wider leading-snug">{title}</h3>
            )}
            {subtitle && (
              <p className="text-[10px] sm:text-xs text-theme-text-muted font-medium mt-0.5">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
