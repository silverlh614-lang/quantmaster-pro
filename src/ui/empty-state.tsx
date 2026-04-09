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
    <div className={cn('py-16 sm:py-24 text-center glass-3d rounded-2xl sm:rounded-3xl border border-theme-border border-dashed', className)}>
      {icon && (
        <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 sm:mb-6 rounded-2xl bg-white/5 flex items-center justify-center text-theme-text-muted">
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
