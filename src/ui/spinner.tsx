// @responsibility spinner UI 프리미티브 컴포넌트
import React from 'react';
import { cn } from './cn';

export type SpinnerVariant = 'ring' | 'dots' | 'pulse';
export type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps {
  variant?: SpinnerVariant;
  size?: SpinnerSize;
  className?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-6 h-6',
};

const dotSizeClasses: Record<SpinnerSize, string> = {
  sm: 'w-1 h-1',
  md: 'w-1.5 h-1.5',
  lg: 'w-2 h-2',
};

export function Spinner({ variant = 'ring', size = 'md', className }: SpinnerProps) {
  if (variant === 'dots') {
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        <span className={cn('rounded-full bg-current animate-bounce [animation-delay:-0.3s]', dotSizeClasses[size])} />
        <span className={cn('rounded-full bg-current animate-bounce [animation-delay:-0.15s]', dotSizeClasses[size])} />
        <span className={cn('rounded-full bg-current animate-bounce', dotSizeClasses[size])} />
      </span>
    );
  }

  if (variant === 'pulse') {
    return (
      <span className={cn('inline-block rounded-full bg-current/70 animate-pulse', sizeClasses[size], className)} />
    );
  }

  return (
    <span className={cn('inline-block border-2 border-current/20 border-t-current rounded-full animate-spin', sizeClasses[size], className)} />
  );
}
