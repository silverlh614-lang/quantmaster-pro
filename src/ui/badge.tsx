import React from 'react';
import { cn } from './cn';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'violet';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-white/10 text-white/60',
  success: 'bg-green-500/15 text-green-400 border-green-500/20',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  danger: 'bg-red-500/15 text-red-400 border-red-500/20',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  accent: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  violet: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
};

const sizeClasses = {
  sm: 'px-1.5 py-0.5 text-[9px]',
  md: 'px-2.5 py-1 text-[10px]',
};

export function Badge({ variant = 'default', size = 'md', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-black uppercase tracking-wider rounded-md border border-transparent',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
