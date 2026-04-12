import React from 'react';
import { cn } from './cn';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('py-16 sm:py-24 text-center rounded-2xl sm:rounded-3xl border border-dashed border-white/[0.06] bg-white/[0.01]', className)}>
      {icon && (
        <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 sm:mb-6 rounded-2xl bg-gradient-to-br from-blue-500/[0.08] to-indigo-500/[0.04] border border-blue-500/10 flex items-center justify-center text-blue-400/60">
          {icon}
        </div>
      )}
      <p className="text-sm sm:text-base font-bold text-theme-text-secondary mb-2">{title}</p>
      {description && (
        <p className="text-xs sm:text-sm text-theme-text-muted max-w-md mx-auto leading-relaxed px-4">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
