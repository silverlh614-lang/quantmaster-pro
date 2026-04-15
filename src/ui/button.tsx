/**
 * Neo-Brutalism Button System
 * Bold offset shadows + thick borders for primary actions.
 */
import React from 'react';
import { cn } from './cn';
import { Spinner, type SpinnerSize, type SpinnerVariant } from './spinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'neo' | 'neo-secondary';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
  loadingText?: string;
  spinnerVariant?: SpinnerVariant;
  spinnerSize?: SpinnerSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-orange-500 hover:bg-orange-600 text-white shadow-[0_8px_30px_rgba(249,115,22,0.25)] active:scale-[0.97]',
  secondary: 'bg-white/[0.04] hover:bg-white/[0.08] text-theme-text-secondary border border-white/[0.06] hover:border-white/[0.12]',
  ghost: 'text-theme-text-muted hover:text-theme-text hover:bg-white/[0.04]',
  danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40',
  accent: 'bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white shadow-[0_8px_30px_rgba(59,130,246,0.25)] active:scale-[0.97]',
  neo: 'neo-btn bg-orange-500 hover:bg-orange-600 text-white',
  'neo-secondary': 'neo-btn bg-white/[0.04] hover:bg-white/[0.08] text-theme-text-secondary',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'px-4 py-2.5 text-sm gap-2 rounded-xl',
  lg: 'px-6 py-3.5 text-base gap-3 rounded-2xl',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  loadingText,
  spinnerVariant = 'ring',
  spinnerSize = 'md',
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
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
        <Spinner variant={spinnerVariant} size={spinnerSize} />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
