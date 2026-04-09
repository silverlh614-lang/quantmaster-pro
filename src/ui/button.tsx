import React from 'react';
import { cn } from './cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-orange-500 hover:bg-orange-600 text-white shadow-[0_8px_30px_rgba(249,115,22,0.25)] active:scale-[0.97]',
  secondary: 'bg-white/5 hover:bg-white/10 text-theme-text-secondary border border-theme-border hover:border-white/20',
  ghost: 'text-theme-text-muted hover:text-theme-text hover:bg-white/5',
  danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40',
  accent: 'bg-blue-500 hover:bg-blue-600 text-white shadow-[0_8px_30px_rgba(59,130,246,0.25)] active:scale-[0.97]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'px-4 py-2.5 text-sm gap-2 rounded-xl',
  lg: 'px-6 py-3.5 text-base gap-3 rounded-2xl',
};

export function Button({ variant = 'primary', size = 'md', icon, loading, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-bold transition-all whitespace-nowrap',
        variantClasses[variant],
        sizeClasses[size],
        (disabled || loading) && 'opacity-50 cursor-not-allowed pointer-events-none',
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current/20 border-t-current rounded-full animate-spin" />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
